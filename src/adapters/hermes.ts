import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import type { AgentAdapter, CollectOptions } from './base.js';
import type { NormalizedMessage, NormalizedSession, MessageRole } from '../core/types.js';
import { sanitizeText } from '../core/sanitizer.js';
import { getMachineInfo } from '../core/machine.js';

export class HermesAdapter implements AgentAdapter {
  readonly name = 'hermes' as const;
  private hermesDir: string;

  constructor(customDir?: string) {
    this.hermesDir =
      customDir ||
      process.env.HERMES_HOME ||
      path.join(os.homedir(), '.hermes');
  }

  isAvailable(): boolean {
    if (!fs.existsSync(this.hermesDir)) return false;

    // Check for main state.db, profile db, or sessions directory
    const mainDb = path.join(this.hermesDir, 'state.db');
    if (fs.existsSync(mainDb)) return true;

    const profilesDir = path.join(this.hermesDir, 'profiles');
    if (fs.existsSync(profilesDir)) {
      try {
        const hasDb = fs.readdirSync(profilesDir, { withFileTypes: true })
          .some((d) => d.isDirectory() && fs.existsSync(path.join(profilesDir, d.name, 'state.db')));
        if (hasDb) return true;
      } catch {
        // ignore
      }
    }

    const sessionsDir = path.join(this.hermesDir, 'sessions');
    if (fs.existsSync(sessionsDir)) return true;

    return false;
  }

  async collect(options?: CollectOptions): Promise<NormalizedSession[]> {
    if (!this.isAvailable()) return [];

    const results: NormalizedSession[] = [];
    const machine = getMachineInfo();

    // 1. Collect from main state.db
    const mainDbPath = path.join(this.hermesDir, 'state.db');
    if (fs.existsSync(mainDbPath)) {
      results.push(...this.collectFromSqlite(mainDbPath, machine, options));
    }

    // 2. Collect from profile state.db instances
    const profilesDir = path.join(this.hermesDir, 'profiles');
    if (fs.existsSync(profilesDir)) {
      try {
        const profileDirs = fs.readdirSync(profilesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory());
        for (const pDir of profileDirs) {
          const profileDb = path.join(profilesDir, pDir.name, 'state.db');
          if (fs.existsSync(profileDb)) {
            results.push(...this.collectFromSqlite(profileDb, machine, options, pDir.name));
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Fallback: Collect from JSONL sessions if present
    const sessionsDir = path.join(this.hermesDir, 'sessions');
    if (fs.existsSync(sessionsDir)) {
      try {
        const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl') || f.endsWith('.json'));
        for (const file of files) {
          const filePath = path.join(sessionsDir, file);
          const baseName = path.basename(file, path.extname(file));
          const expectedId = `hermes_${machine.id}_${baseName}`;
          const existing = options?.existingSessions?.get(expectedId);

          if (existing) {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs <= new Date(existing.updatedAt).getTime() + 1000) {
              results.push({
                schema_version: '1.0',
                id: existing.id,
                agent: 'hermes',
                machine,
                session: {
                  native_id: baseName,
                  title: '',
                  workspace: '',
                  created_at: existing.updatedAt,
                  updated_at: existing.updatedAt,
                },
                messages: new Array(existing.messageCount),
              });
              continue;
            }
          }

          const session = this.parseJsonlFile(filePath, machine);
          if (session && session.messages.length > 0) {
            results.push(session);
          }
        }
      } catch {
        // ignore
      }
    }

    return results;
  }

  private collectFromSqlite(
    dbPath: string,
    machine: ReturnType<typeof getMachineInfo>,
    options?: CollectOptions,
    profileName?: string
  ): NormalizedSession[] {
    const sessions: NormalizedSession[] = [];
    let db: Database.Database | null = null;

    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });

      // Inspect sessions table schema
      const sessionCols = (db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).map(
        (c) => c.name
      );
      if (sessionCols.length === 0) {
        db.close();
        return [];
      }

      const hasTitle = sessionCols.includes('title');
      const hasSummary = sessionCols.includes('summary');
      const hasWorkspace = sessionCols.includes('workspace');
      const hasDirectory = sessionCols.includes('directory');
      const hasCreatedAt = sessionCols.includes('created_at');
      const hasStartedAt = sessionCols.includes('started_at');
      const hasUpdatedAt = sessionCols.includes('updated_at');
      const hasEndedAt = sessionCols.includes('ended_at');

      const titleField = hasTitle ? 'title' : hasSummary ? 'summary' : "'' AS title";
      const workspaceField = hasWorkspace ? 'workspace' : hasDirectory ? 'directory' : "'' AS workspace";
      const createdField = hasCreatedAt ? 'created_at' : hasStartedAt ? 'started_at' : "'' AS created_at";
      const updatedField = hasUpdatedAt ? 'updated_at' : hasEndedAt ? 'ended_at' : "'' AS updated_at";

      const rows = db.prepare(`
        SELECT id, ${titleField} AS title, ${workspaceField} AS workspace,
               ${createdField} AS created_at, ${updatedField} AS updated_at
        FROM sessions
      `).all() as Array<{
        id: string;
        title: string | null;
        workspace: string | null;
        created_at: string | number | null;
        updated_at: string | number | null;
      }>;

      // Inspect messages table schema
      const messageCols = (db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>).map(
        (c) => c.name
      );
      const hasMsgId = messageCols.includes('id');
      const hasMsgRole = messageCols.includes('role');
      const hasMsgContent = messageCols.includes('content');
      const hasMsgTimestamp = messageCols.includes('timestamp');
      const hasMsgToolCalls = messageCols.includes('tool_calls');
      const hasMsgToolName = messageCols.includes('tool_name');

      const msgStmt = db.prepare(`
        SELECT ${hasMsgId ? 'id' : 'rowid AS id'},
               ${hasMsgRole ? 'role' : "'user' AS role"},
               ${hasMsgContent ? 'content' : "'' AS content"},
               ${hasMsgTimestamp ? 'timestamp' : 'NULL AS timestamp'},
               ${hasMsgToolCalls ? 'tool_calls' : 'NULL AS tool_calls'},
               ${hasMsgToolName ? 'tool_name' : 'NULL AS tool_name'}
        FROM messages
        WHERE session_id = ?
        ORDER BY ${hasMsgTimestamp ? 'timestamp ASC, ' : ''}${hasMsgId ? 'id ASC' : 'rowid ASC'}
      `);

      for (const row of rows) {
        let createdAt = new Date().toISOString();
        if (row.created_at) {
          if (typeof row.created_at === 'number') {
            createdAt = new Date(row.created_at > 1e11 ? row.created_at : row.created_at * 1000).toISOString();
          } else {
            createdAt = new Date(row.created_at).toISOString();
          }
        }

        let updatedAt = createdAt;
        if (row.updated_at) {
          if (typeof row.updated_at === 'number') {
            updatedAt = new Date(row.updated_at > 1e11 ? row.updated_at : row.updated_at * 1000).toISOString();
          } else {
            updatedAt = new Date(row.updated_at).toISOString();
          }
        }

        const nativeId = profileName ? `${profileName}__${row.id}` : row.id;
        const sessionId = `hermes_${machine.id}_${nativeId}`;
        const existing = options?.existingSessions?.get(sessionId);

        if (existing && existing.updatedAt === updatedAt) {
          sessions.push({
            schema_version: '1.0',
            id: sessionId,
            agent: 'hermes',
            machine,
            session: {
              native_id: nativeId,
              title: row.title || '(untitled hermes session)',
              workspace: row.workspace || undefined,
              created_at: createdAt,
              updated_at: updatedAt,
            },
            messages: new Array(existing.messageCount),
          });
          continue;
        }

        const rawMsgs = msgStmt.all(row.id) as Array<{
          id: string | number;
          role: string;
          content: string | null;
          timestamp: string | number | null;
          tool_calls: string | null;
          tool_name: string | null;
        }>;

        const messages: NormalizedMessage[] = [];
        let stepIndex = 0;
        let fallbackTitle = '';
        const seenMsgIds = new Map<string, number>();

        for (const m of rawMsgs) {
          let role: MessageRole = 'assistant';
          const rLower = (m.role || '').toLowerCase();
          if (rLower === 'user') role = 'user';
          else if (rLower === 'system') role = 'system';
          else if (rLower === 'tool') role = 'tool';
          let rawContent = m.content || '';

          // Format tool calls if present in Hermes schema
          let hasToolCalls = false;
          if (m.tool_calls) {
            hasToolCalls = true;
            try {
              const parsedCalls = JSON.parse(m.tool_calls);
              if (Array.isArray(parsedCalls)) {
                for (const call of parsedCalls) {
                  const callName = call.name || call.tool || 'tool';
                  const callArgs = call.arguments || call.args || call.input;
                  const argsStr = callArgs
                    ? typeof callArgs === 'object'
                      ? JSON.stringify(callArgs, null, 2)
                      : String(callArgs)
                    : '';
                  const toolStr = `[Tool Call: ${callName}]${argsStr ? `\nInput: ${argsStr}` : ''}`;
                  rawContent = rawContent ? `${rawContent}\n\n${toolStr}` : toolStr;
                }
              }
            } catch {
              // ignore malformed tool calls
            }
          }

          if (m.tool_name && role === 'tool' && !rawContent.startsWith('[Tool Result')) {
            rawContent = `[Tool Result: ${m.tool_name}]\n${rawContent}`;
          }

          const sanitizedContent = sanitizeText(rawContent.trim());
          if (!sanitizedContent) continue;

          if (!fallbackTitle && role === 'user') {
            fallbackTitle = sanitizedContent.slice(0, 80);
          }

          let msgTime: string | undefined;
          if (m.timestamp) {
            if (typeof m.timestamp === 'number') {
              msgTime = new Date(m.timestamp > 1e11 ? m.timestamp : m.timestamp * 1000).toISOString();
            } else {
              msgTime = new Date(m.timestamp).toISOString();
            }
          }

          const baseId = String(m.id);
          let msgId = baseId;
          const count = seenMsgIds.get(baseId) || 0;
          if (count > 0) {
            msgId = `${baseId}_${count}`;
          }
          seenMsgIds.set(baseId, count + 1);

          messages.push({
            id: msgId,
            role,
            content: sanitizedContent,
            timestamp: msgTime,
            step_index: stepIndex++,
            has_tool_calls: hasToolCalls,
          });
        }

        if (messages.length === 0) continue;

        const title = sanitizeText(row.title || fallbackTitle || '(untitled session)');

        sessions.push({
          schema_version: '1.0',
          id: sessionId,
          agent: 'hermes',
          machine,
          session: {
            native_id: nativeId,
            title,
            workspace: row.workspace || undefined,
            created_at: createdAt,
            updated_at: updatedAt,
          },
          messages,
        });
      }
    } catch {
      // Ignore database errors
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          // ignore
        }
      }
    }

    return sessions;
  }

  private parseJsonlFile(
    filePath: string,
    machine: ReturnType<typeof getMachineInfo>
  ): NormalizedSession | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      if (lines.length === 0) return null;

      const fileBase = path.basename(filePath, path.extname(filePath));
      const messages: NormalizedMessage[] = [];
      let stepIndex = 0;
      let title = '';
      const seenMsgIds = new Map<string, number>();

      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          let role: MessageRole = 'assistant';
          const r = (item.role || item.variant || '').toLowerCase();
          if (r === 'user') role = 'user';
          else if (r === 'system') role = 'system';
          else if (r === 'tool') role = 'tool';

          const text = sanitizeText(item.content || item.text || '');
          if (!text) continue;

          if (!title && role === 'user') {
            title = text.slice(0, 80).replace(/[\r\n]+/g, ' ');
          }

          const baseId = item.id || `msg-${stepIndex}`;
          let msgId = baseId;
          const count = seenMsgIds.get(baseId) || 0;
          if (count > 0) {
            msgId = `${baseId}_${count}`;
          }
          seenMsgIds.set(baseId, count + 1);

          messages.push({
            id: msgId,
            role,
            content: text,
            timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : undefined,
            step_index: stepIndex++,
            has_tool_calls: Boolean(item.tool_calls || item.tool_call_id),
          });
        } catch {
          // ignore line
        }
      }

      if (messages.length === 0) return null;

      const stat = fs.statSync(filePath);
      const createdAt = stat.birthtime.toISOString();
      const updatedAt = stat.mtime.toISOString();
      const nativeId = fileBase;
      const sessionId = `hermes_${machine.id}_${nativeId}`;

      return {
        schema_version: '1.0',
        id: sessionId,
        agent: 'hermes',
        machine,
        session: {
          native_id: nativeId,
          title: title || '(untitled session)',
          created_at: createdAt,
          updated_at: updatedAt,
        },
        messages,
      };
    } catch {
      return null;
    }
  }
}
