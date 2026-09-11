import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import type { AgentAdapter } from './base.js';
import type { NormalizedMessage, NormalizedSession } from '../core/types.js';
import { sanitizeText } from '../core/sanitizer.js';

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode' as const;
  private dbPath: string;

  constructor(customPath?: string) {
    this.dbPath = customPath || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dbPath);
  }

  async collect(): Promise<NormalizedSession[]> {
    if (!this.isAvailable()) return [];

    const results: NormalizedSession[] = [];
    const hostname = os.hostname();
    const platform = os.platform();

    let db: Database.Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true, fileMustExist: true });

      const sessions = db.prepare(`
        SELECT id, title, directory, time_created, time_updated
        FROM session
        ORDER BY time_created ASC
      `).all() as Array<{
        id: string;
        title: string;
        directory: string;
        time_created: number;
        time_updated: number;
      }>;

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
        try {
          const rawMessages = messageStmt.all(s.id) as Array<{ id: string; time_created: number; data: string }>;
          const rawParts = partsStmt.all(s.id) as Array<{ id: string; message_id: string; time_created: number; data: string }>;

          // Group parts by message_id
          const partsByMsg = new Map<string, Array<{ type?: string; text?: string }>>();
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
            let hasToolCalls = false;

            for (const part of parts) {
              if (part.text) {
                contentText += (contentText ? '\n' : '') + part.text;
              }
              if (part.type === 'tool' || part.type === 'tool_use' || part.type === 'tool_call') {
                hasToolCalls = true;
              }
            }

            if (contentText.trim()) {
              messages.push({
                id: m.id,
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
              id: `opencode_${hostname}_${s.id}`,
              agent: 'opencode',
              machine: {
                hostname,
                platform,
              },
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
}
