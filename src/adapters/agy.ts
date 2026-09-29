import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import Database from 'better-sqlite3';
import type { AgentAdapter, CollectOptions } from './base.js';
import type { NormalizedSession, NormalizedMessage } from '../core/types.js';
import { getMachineInfo } from '../core/machine.js';
import { sanitizeText } from '../core/sanitizer.js';

export class AgyAdapter implements AgentAdapter {
  readonly name = 'agy' as const;
  private baseDir: string;
  private dbPath: string;

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || path.join(os.homedir(), '.gemini', 'antigravity-cli');
    this.dbPath = path.join(this.baseDir, 'conversation_summaries.db');
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dbPath);
  }

  private transcriptPathFor(conversationId: string): string | null {
    // Prefer the untruncated transcript when present; transcript.jsonl may
    // have truncated fields (marked via `truncated_fields`).
    const full = path.join(
      this.baseDir,
      'brain',
      conversationId,
      '.system_generated',
      'logs',
      'transcript_full.jsonl'
    );
    if (fs.existsSync(full)) return full;
    const short = path.join(
      this.baseDir,
      'brain',
      conversationId,
      '.system_generated',
      'logs',
      'transcript.jsonl'
    );
    return fs.existsSync(short) ? short : null;
  }

  async collect(options?: CollectOptions): Promise<NormalizedSession[]> {
    if (!this.isAvailable()) return [];

    const results: NormalizedSession[] = [];
    const machine = getMachineInfo();

    let db: Database.Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true, fileMustExist: true });

      const rows = db.prepare(`
        SELECT conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris
        FROM conversation_summaries
        ORDER BY last_modified_time ASC
      `).all() as Array<{
        conversation_id: string;
        title: string;
        preview: string;
        last_modified_time: string;
        last_user_input_time: string;
        workspace_uris: string;
      }>;

      for (const row of rows) {
        const expectedId = `agy_${machine.id}_${row.conversation_id}`;
        const existing = options?.existingSessions?.get(expectedId);

        // Parse workspace from workspace_uris
        let workspace = '';
        try {
          const uris = JSON.parse(row.workspace_uris);
          if (Array.isArray(uris) && uris.length > 0) {
            workspace = uris[0];
          }
        } catch {
          workspace = row.workspace_uris || '';
        }

        const updatedAt = row.last_modified_time;
        const createdAt = row.last_user_input_time || row.last_modified_time;

        // Fast path: If session is unchanged and already indexed, skip reading/parsing transcript.jsonl
        if (!options?.force && existing && existing.updatedAt === updatedAt) {
          results.push({
            schema_version: '1.0',
            id: expectedId,
            agent: 'agy',
            machine,
            session: {
              native_id: row.conversation_id,
              title: row.title || row.preview || '(untitled)',
              workspace,
              created_at: createdAt,
              updated_at: updatedAt,
            },
            messages: new Array(existing.messageCount),
          });
          continue;
        }

        const transcriptPath = this.transcriptPathFor(row.conversation_id);

        let messages: NormalizedMessage[] = [];
        if (transcriptPath) {
          messages = await this.parseTranscript(transcriptPath);
        }

        // If no transcript found or empty, fallback to summary preview if available
        if (messages.length === 0 && row.preview) {
          messages.push({
            id: 'summary_preview',
            role: 'assistant',
            content: sanitizeText(row.preview),
            timestamp: row.last_modified_time,
            step_index: 0,
          });
        }

        if (messages.length > 0) {
          results.push({
            schema_version: '1.0',
            id: `agy_${machine.id}_${row.conversation_id}`,
            agent: 'agy',
            machine,
            session: {
              native_id: row.conversation_id,
              title: row.title || row.preview?.slice(0, 60) || `Session ${row.conversation_id.slice(0, 8)}`,
              workspace,
              created_at: row.last_user_input_time || row.last_modified_time || new Date().toISOString(),
              updated_at: row.last_modified_time || new Date().toISOString(),
            },
            messages,
          });
        }
      }

      // Fallback: conversations with a brain transcript but no summaries row
      // (e.g. orphaned / unindexed conversations) would otherwise be invisible.
      await this.collectOrphanedTranscripts(machine, options, results);
    } catch {
      // Ignore reading error
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          // ignore
        }
      }
    }

    return results;
  }

  /**
   * Scan brain/ for transcripts missing from conversation_summaries.
   * Title/workspace fall back to transcript content since no summary row exists.
   */
  private async collectOrphanedTranscripts(
    machine: ReturnType<typeof getMachineInfo>,
    options: CollectOptions | undefined,
    results: NormalizedSession[]
  ): Promise<void> {
    const brainDir = path.join(this.baseDir, 'brain');
    if (!fs.existsSync(brainDir)) return;

    const known = new Set(results.map((s) => s.session.native_id));
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(brainDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || known.has(entry.name)) continue;
      const transcriptPath = this.transcriptPathFor(entry.name);
      if (!transcriptPath) continue;

      const expectedId = `agy_${machine.id}_${entry.name}`;
      const existing = options?.existingSessions?.get(expectedId);
      let statMtime = new Date().toISOString();
      try {
        statMtime = fs.statSync(transcriptPath).mtime.toISOString();
      } catch {
        // keep default
      }

      if (!options?.force && existing && existing.updatedAt === statMtime) {
        // Transcript file unchanged since last sync — keep the indexed version.
        results.push({
          schema_version: '1.0',
          id: expectedId,
          agent: 'agy',
          machine,
          session: {
            native_id: entry.name,
            title: '(untitled)',
            workspace: '',
            created_at: statMtime,
            updated_at: statMtime,
          },
          messages: new Array(existing.messageCount),
        });
        continue;
      }

      let messages: NormalizedMessage[];
      try {
        messages = await this.parseTranscript(transcriptPath);
      } catch {
        continue;
      }
      if (messages.length === 0) continue;

      const firstUser = messages.find((m) => m.role === 'user');
      const timestamps = messages.map((m) => m.timestamp).filter(Boolean).sort() as string[];
      results.push({
        schema_version: '1.0',
        id: expectedId,
        agent: 'agy',
        machine,
        session: {
          native_id: entry.name,
          title:
            (firstUser?.content || messages[0].content).slice(0, 60) || `Session ${entry.name.slice(0, 8)}`,
          workspace: '',
          // File mtime as updated_at: stable across syncs for incremental skip.
          created_at: timestamps[0] || statMtime,
          updated_at: statMtime,
        },
        messages,
      });
    }
  }

  private async parseTranscript(filePath: string): Promise<NormalizedMessage[]> {
    const messages: NormalizedMessage[] = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let currentStep = 0;
    const seenMsgIds = new Map<string, number>();

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        const type = item.type;
        const source = item.source;
        let role: 'user' | 'assistant' | 'tool' | 'system' = 'assistant';
        let textContent = '';
        let hasToolCalls = false;

        if (type === 'USER_INPUT') {
          role = 'user';
          textContent = item.content || '';
        } else if (type === 'PLANNER_RESPONSE') {
          if (item.thinking && typeof item.thinking === 'string' && item.thinking.trim()) {
            const baseStep = item.step_index ?? currentStep;
            const thinkId = `agy_${baseStep}_thinking`;
            const count = seenMsgIds.get(thinkId) || 0;
            const msgId = count > 0 ? `${thinkId}_${count}` : thinkId;
            seenMsgIds.set(thinkId, count + 1);

            messages.push({
              id: msgId,
              role: 'thinking',
              content: sanitizeText(item.thinking.trim()),
              timestamp: item.created_at,
              step_index: item.step_index ?? currentStep,
            });
          }

          role = 'assistant';
          textContent = item.content || '';
          if (Array.isArray(item.tool_calls) && item.tool_calls.length > 0) {
            hasToolCalls = true;
            const tcTexts = item.tool_calls.map((tc: any) => {
              const name = tc.name || 'tool';
              const params = tc.parameters ? JSON.stringify(tc.parameters, null, 2) : '';
              return `[Tool Call: ${name}]${params ? `\nInput: ${params}` : ''}`;
            });
            textContent += (textContent ? '\n\n' : '') + tcTexts.join('\n\n');
          }
        } else if (type === 'GENERIC' && source === 'MODEL') {
          role = 'tool';
          textContent = item.content ? `[Tool Result]\n${item.content}` : '';
        }

        if (textContent.trim()) {
          const baseStep = item.step_index ?? currentStep;
          const baseId = `agy_${baseStep}`;
          let msgId = baseId;
          const count = seenMsgIds.get(baseId) || 0;
          if (count > 0) {
            msgId = `${baseId}_${count}`;
          }
          seenMsgIds.set(baseId, count + 1);

          messages.push({
            id: msgId,
            role,
            content: sanitizeText(textContent.trim()),
            timestamp: item.created_at,
            step_index: item.step_index ?? currentStep,
            has_tool_calls: hasToolCalls,
          });
        }
        currentStep++;
      } catch {
        // Skip invalid line
      }
    }

    return messages;
  }
}
