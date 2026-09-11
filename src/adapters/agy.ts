import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import Database from 'better-sqlite3';
import type { AgentAdapter } from './base.js';
import type { NormalizedMessage, NormalizedSession } from '../core/types.js';
import { sanitizeText } from '../core/sanitizer.js';
import { getMachineInfo } from '../core/machine.js';

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

  async collect(): Promise<NormalizedSession[]> {
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
        const transcriptPath = path.join(
          this.baseDir,
          'brain',
          row.conversation_id,
          '.system_generated',
          'logs',
          'transcript.jsonl'
        );

        let messages: NormalizedMessage[] = [];
        if (fs.existsSync(transcriptPath)) {
          messages = await this.parseTranscript(transcriptPath);
        }

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

  private async parseTranscript(filePath: string): Promise<NormalizedMessage[]> {
    const messages: NormalizedMessage[] = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let currentStep = 0;
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
          role = 'assistant';
          textContent = item.content || '';
          if (Array.isArray(item.tool_calls) && item.tool_calls.length > 0) {
            hasToolCalls = true;
          }
        } else if (type === 'GENERIC' && source === 'MODEL') {
          role = 'tool';
          textContent = item.content || '';
        }

        if (textContent.trim()) {
          messages.push({
            id: `agy_${item.step_index ?? currentStep}`,
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
