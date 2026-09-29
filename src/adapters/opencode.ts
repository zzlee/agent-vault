import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import type { AgentAdapter, CollectOptions } from './base.js';
import type { NormalizedMessage, NormalizedSession } from '../core/types.js';
import { sanitizeText } from '../core/sanitizer.js';
import { getMachineInfo } from '../core/machine.js';

// Truncation budget for system-echoed content (compaction summaries can exceed
// 400KB — they embed full conversation dumps). User/assistant text is kept whole.
const MAX_SYNTHETIC_CHARS = 3000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`;
}

function formatToolBlock(name: string, input: unknown, output: string | undefined, error: string | undefined): string {
  let block = `[Tool Call: ${name}]`;
  if (input !== undefined && input !== null) {
    block += `\nInput: ${typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input)}`;
  }
  if (error) {
    block += `\nError: ${error}`;
  } else if (output) {
    block += `\nOutput: ${output.trim()}`;
  }
  return block;
}

/** Extract readable output text from a v2 tool state object. */
function extractToolOutput(state: any): { output?: string; error?: string } {
  if (!state || typeof state !== 'object') return {};
  if (state.status === 'error') {
    const msg = state.error?.message || state.error?.type || 'unknown error';
    return { error: String(msg) };
  }
  const texts: string[] = [];
  const content = Array.isArray(state.content) ? state.content : [];
  for (const item of content) {
    if (item && typeof item === 'object' && typeof (item as any).text === 'string' && (item as any).text.trim()) {
      texts.push((item as any).text);
    }
  }
  if (texts.length > 0) return { output: texts.join('\n\n') };
  const metaOutput = state.metadata?.output;
  if (typeof metaOutput === 'string' && metaOutput.trim()) return { output: metaOutput };
  return {};
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode' as const;
  private dbPath: string;

  constructor(customPath?: string) {
    this.dbPath = customPath || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dbPath);
  }

  async collect(options?: CollectOptions): Promise<NormalizedSession[]> {
    if (!this.isAvailable()) return [];

    const results: NormalizedSession[] = [];
    const machine = getMachineInfo();

    let db: Database.Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true, fileMustExist: true });

      const hasV2 = Boolean(
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='session_v2'`).get()
      );

      if (hasV2) {
        this.collectV2(db, machine, options, results);
      } else {
        this.collectV1(db, machine, options, results);
      }
    } catch {
      // Ignore SQLite open/read error
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore close error
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // v2 format (opencode >= 1.x late / 2.x): session_v2 + session_message tables.
  // One row per turn; assistant turns embed content[] (reasoning/text/tool).
  // ---------------------------------------------------------------------------
  private collectV2(
    db: Database.Database,
    machine: ReturnType<typeof getMachineInfo>,
    options: CollectOptions | undefined,
    results: NormalizedSession[]
  ): void {
    const sessions = db.prepare(`
      SELECT id, title, directory, time_created, time_updated
      FROM session_v2
      ORDER BY time_created ASC
    `).all() as Array<{
      id: string;
      title: string | null;
      directory: string;
      time_created: number;
      time_updated: number;
    }>;

    const msgStmt = db.prepare(`
      SELECT id, type, seq, time_created, data
      FROM session_message
      WHERE session_id = ?
      ORDER BY seq ASC, time_created ASC, id ASC
    `);

    const v2Ids = new Set(sessions.map((s) => s.id));

    for (const s of sessions) {
      const expectedId = `opencode_${machine.id}_${s.id}`;
      const updatedAt = new Date(s.time_updated).toISOString();
      const createdAt = new Date(s.time_created).toISOString();
      const existing = options?.existingSessions?.get(expectedId);

      if (!options?.force && existing && existing.updatedAt === updatedAt) {
        results.push(
          this.placeholder(machine, expectedId, existing.messageCount, {
            native_id: s.id,
            title: s.title || '(untitled)',
            workspace: s.directory || '',
            created_at: createdAt,
            updated_at: updatedAt,
          })
        );
        continue;
      }

      try {
        const rows = msgStmt.all(s.id) as Array<{
          id: string;
          type: string;
          seq: number;
          time_created: number;
          data: string;
        }>;
        const messages = this.buildV2Messages(rows);

        if (messages.length > 0) {
          results.push({
            schema_version: '1.0',
            id: expectedId,
            agent: 'opencode',
            machine,
            session: {
              native_id: s.id,
              title: s.title || `Session ${s.id.slice(0, 8)}`,
              workspace: s.directory || '',
              created_at: createdAt,
              updated_at: updatedAt,
            },
            messages,
          });
        }
      } catch {
        // Skip broken session
      }
    }

    // Legacy sessions not yet migrated to session_v2 (same native ids, no overlap).
    this.collectV1(db, machine, options, results, v2Ids);
  }

  private buildV2Messages(
    rows: Array<{ id: string; type: string; time_created: number; data: string }>
  ): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];
    let stepIndex = 0;
    const seenIds = new Map<string, number>();

    const push = (baseId: string, role: NormalizedMessage['role'], content: string, ts: number, hasTools = false) => {
      const text = content.trim();
      if (!text) return;
      let msgId = baseId;
      const count = seenIds.get(baseId) || 0;
      if (count > 0) msgId = `${baseId}_${count}`;
      seenIds.set(baseId, count + 1);
      messages.push({
        id: msgId,
        role,
        content: sanitizeText(text),
        timestamp: new Date(ts).toISOString(),
        step_index: stepIndex++,
        has_tool_calls: hasTools,
      });
    };

    for (const row of rows) {
      let data: any;
      try {
        data = JSON.parse(row.data);
      } catch {
        continue;
      }

      if (row.type === 'user') {
        if (typeof data.text === 'string' && data.text.trim()) {
          push(row.id, 'user', data.text, row.time_created);
        }
      } else if (row.type === 'assistant') {
        const content = Array.isArray(data.content) ? data.content : [];
        let thinking = '';
        let body = '';
        let hasTools = false;
        for (const item of content) {
          if (!item || typeof item !== 'object') continue;
          if (item.type === 'reasoning' && typeof item.text === 'string' && item.text.trim()) {
            thinking += (thinking ? '\n\n' : '') + item.text.trim();
          } else if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
            body += (body ? '\n\n' : '') + item.text;
          } else if (item.type === 'tool') {
            hasTools = true;
            const { output, error } = extractToolOutput(item.state);
            body += (body ? '\n\n' : '') + formatToolBlock(item.name || 'tool', item.state?.input, output, error);
          }
        }
        if (thinking.trim()) push(`${row.id}_thinking`, 'thinking', thinking, row.time_created);
        if (body.trim()) push(row.id, 'assistant', body, row.time_created, hasTools);
      } else if (row.type === 'synthetic') {
        // Shell snapshots / tool echoes / notices — useful context, keep truncated.
        if (typeof data.text === 'string' && data.text.trim()) {
          push(row.id, 'system', truncate(data.text.trim(), MAX_SYNTHETIC_CHARS), row.time_created);
        }
      } else if (row.type === 'compaction') {
        // Auto/manual summaries of compacted context — keep truncated.
        if (typeof data.summary === 'string' && data.summary.trim()) {
          push(row.id, 'system', truncate(data.summary.trim(), MAX_SYNTHETIC_CHARS), row.time_created);
        }
      }
      // Skip 'system' (tool-catalog / instruction notices — search noise)
      // and 'idle' (lifecycle metadata without text).
    }

    return messages;
  }

  // ---------------------------------------------------------------------------
  // v1 format (opencode 1.x early): session + message + part tables.
  // ---------------------------------------------------------------------------
  private collectV1(
    db: Database.Database,
    machine: ReturnType<typeof getMachineInfo>,
    options: CollectOptions | undefined,
    results: NormalizedSession[],
    excludeIds?: Set<string>
  ): void {
    let sessions: Array<{
      id: string;
      title: string;
      directory: string;
      time_created: number;
      time_updated: number;
    }>;
    try {
      sessions = db.prepare(`
        SELECT id, title, directory, time_created, time_updated
        FROM session
        ORDER BY time_created ASC
      `).all() as typeof sessions;
    } catch {
      // Legacy table missing (pure v2 database) — nothing to do.
      return;
    }

    const messageStmt = db.prepare(`
      SELECT id, time_created, data
      FROM message
      WHERE session_id = ?
      ORDER BY time_created ASC
    `);

    const partsStmt = db.prepare(`
      SELECT id, message_id, time_created, data
      FROM part
      WHERE session_id = ?
      ORDER BY time_created ASC
    `);

    for (const s of sessions) {
      if (excludeIds?.has(s.id)) continue;
      const expectedId = `opencode_${machine.id}_${s.id}`;
      const existing = options?.existingSessions?.get(expectedId);
      const updatedAt = new Date(s.time_updated).toISOString();
      const createdAt = new Date(s.time_created).toISOString();

      if (!options?.force && existing && existing.updatedAt === updatedAt) {
        results.push(
          this.placeholder(machine, expectedId, existing.messageCount, {
            native_id: s.id,
            title: s.title || '(untitled)',
            workspace: s.directory || '',
            created_at: createdAt,
            updated_at: updatedAt,
          })
        );
        continue;
      }

      try {
        const rawMessages = messageStmt.all(s.id) as Array<{ id: string; time_created: number; data: string }>;
        const rawParts = partsStmt.all(s.id) as Array<{ id: string; message_id: string; time_created: number; data: string }>;

        // Group parts by message_id
        const partsByMsg = new Map<string, Array<any>>();
        for (const p of rawParts) {
          try {
            const partData = JSON.parse(p.data);
            if (!partsByMsg.has(p.message_id)) {
              partsByMsg.set(p.message_id, []);
            }
            partsByMsg.get(p.message_id)!.push(partData);
          } catch {
            // skip
          }
        }

        const messages: NormalizedMessage[] = [];
        let stepIndex = 0;
        const seenMsgIds = new Map<string, number>();

        for (const m of rawMessages) {
          let role: 'user' | 'assistant' | 'tool' | 'system' = 'assistant';
          try {
            const mData = JSON.parse(m.data);
            if (mData.role === 'user') role = 'user';
            else if (mData.role === 'system') role = 'system';
          } catch {
            // default
          }

          const parts = partsByMsg.get(m.id) || [];
          let contentText = '';
          let thinkingText = '';
          let hasToolCalls = false;

          for (const part of parts) {
            if (part.type === 'reasoning' && typeof part.text === 'string' && part.text.trim()) {
              thinkingText += (thinkingText ? '\n\n' : '') + part.text.trim();
            } else if (part.type === 'text' && typeof part.text === 'string') {
              contentText += (contentText ? '\n\n' : '') + part.text;
            } else if (part.type === 'tool' || part.type === 'tool_use' || part.type === 'tool_call') {
              hasToolCalls = true;
              const toolName = part.tool || part.name || 'tool';
              const input = part.state?.input || part.input;
              const output = part.state?.output || part.output;
              contentText += (contentText ? '\n\n' : '') + formatToolBlock(toolName, input, output, undefined);
            }
          }

          if (thinkingText.trim()) {
            const thkBaseId = `${m.id}_thinking`;
            let thkMsgId = thkBaseId;
            const count = seenMsgIds.get(thkBaseId) || 0;
            if (count > 0) {
              thkMsgId = `${thkBaseId}_${count}`;
            }
            seenMsgIds.set(thkBaseId, count + 1);

            messages.push({
              id: thkMsgId,
              role: 'thinking',
              content: sanitizeText(thinkingText.trim()),
              timestamp: new Date(m.time_created).toISOString(),
              step_index: stepIndex++,
              has_tool_calls: false,
            });
          }

          if (contentText.trim()) {
            const baseId = m.id || `msg_${stepIndex}`;
            let msgId = baseId;
            const count = seenMsgIds.get(baseId) || 0;
            if (count > 0) {
              msgId = `${baseId}_${count}`;
            }
            seenMsgIds.set(baseId, count + 1);

            messages.push({
              id: msgId,
              role,
              content: sanitizeText(contentText.trim()),
              timestamp: new Date(m.time_created).toISOString(),
              step_index: stepIndex++,
              has_tool_calls: hasToolCalls,
            });
          }
        }

        if (messages.length > 0) {
          results.push({
            schema_version: '1.0',
            id: `opencode_${machine.id}_${s.id}`,
            agent: 'opencode',
            machine,
            session: {
              native_id: s.id,
              title: s.title || `Session ${s.id.slice(0, 8)}`,
              workspace: s.directory,
              created_at: new Date(s.time_created).toISOString(),
              updated_at: new Date(s.time_updated).toISOString(),
            },
            messages,
          });
        }
      } catch {
        // Skip broken session
      }
    }
  }

  private placeholder(
    machine: ReturnType<typeof getMachineInfo>,
    expectedId: string,
    messageCount: number,
    meta: { native_id: string; title: string; workspace: string; created_at: string; updated_at: string }
  ): NormalizedSession {
    return {
      schema_version: '1.0',
      id: expectedId,
      agent: 'opencode',
      machine,
      session: {
        native_id: meta.native_id,
        title: meta.title,
        workspace: meta.workspace,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
      },
      messages: new Array(messageCount),
    };
  }
}
