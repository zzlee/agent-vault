import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import Database from 'better-sqlite3';
import fg from 'fast-glob';
import type { AgentAdapter, CollectOptions } from './base.js';
import type { NormalizedMessage, NormalizedSession, MessageRole } from '../core/types.js';
import { sanitizeText } from '../core/sanitizer.js';
import { getMachineInfo } from '../core/machine.js';

interface CodexThreadMeta {
  id: string;
  rolloutPath?: string;
  title?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex' as const;
  private codexDir: string;
  private sessionsDir: string;

  constructor(customDir?: string) {
    this.codexDir = customDir || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.sessionsDir = path.join(this.codexDir, 'sessions');
  }

  isAvailable(): boolean {
    return fs.existsSync(this.sessionsDir) || fs.existsSync(this.codexDir);
  }

  async collect(options?: CollectOptions): Promise<NormalizedSession[]> {
    if (!this.isAvailable()) return [];

    const results: NormalizedSession[] = [];
    const machine = getMachineInfo();

    // 1. Try reading metadata from state_*.sqlite if available
    const threadMap = this.readStateDatabase();

    // 2. Discover all rollout-*.jsonl session files
    let files: string[] = [];
    try {
      if (fs.existsSync(this.sessionsDir)) {
        files = await fg('**/*.jsonl', {
          cwd: this.sessionsDir,
          absolute: true,
        });
      }
    } catch {
      // ignore glob errors
    }

    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        const fileName = path.basename(filePath, '.jsonl');

        // Extract nativeId: e.g. "rollout-2026-02-23T12-41-27-019c88cd-63d3-7a33-a9c3-fc1907592f78" -> "019c88cd-63d3-7a33-a9c3-fc1907592f78"
        let nativeId = fileName;
        const match = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (match) {
          nativeId = match[1];
        }

        const expectedId = `codex_${machine.id}_${nativeId}`;
        const existing = options?.existingSessions?.get(expectedId);

        // Incremental sync fast exit
        if (!options?.force && existing && stat.mtimeMs <= new Date(existing.updatedAt).getTime() + 1000) {
          results.push({
            schema_version: '1.0',
            id: existing.id,
            agent: 'codex',
            machine,
            session: {
              native_id: nativeId,
              title: '',
              workspace: '',
              created_at: existing.updatedAt,
              updated_at: existing.updatedAt,
            },
            messages: new Array(existing.messageCount),
          });
          continue;
        }

        const threadMeta = threadMap.get(filePath) || threadMap.get(nativeId);
        const session = await this.parseRolloutFile(filePath, nativeId, threadMeta, machine);
        if (session && session.messages.length > 0) {
          results.push(session);
        }
      } catch {
        // Skip unreadable or corrupted files
      }
    }

    return results;
  }

  /**
   * Attempts to inspect state_*.sqlite databases in ~/.codex/ for thread metadata.
   */
  private readStateDatabase(): Map<string, CodexThreadMeta> {
    const threadMap = new Map<string, CodexThreadMeta>();
    if (!fs.existsSync(this.codexDir)) return threadMap;

    try {
      const sqliteFiles = fs
        .readdirSync(this.codexDir)
        .filter((f) => f.startsWith('state_') && f.endsWith('.sqlite'))
        .sort()
        .reverse();

      for (const sqlFile of sqliteFiles) {
        const fullSqlPath = path.join(this.codexDir, sqlFile);
        let db: Database.Database | null = null;
        try {
          db = new Database(fullSqlPath, { readonly: true, timeout: 2000 });
          const hasThreads = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'")
            .get();

          if (hasThreads) {
            const rows = db
              .prepare(
                'SELECT id, rollout_path, cwd, title, first_user_message, created_at, updated_at, created_at_ms, updated_at_ms FROM threads'
              )
              .all() as Array<{
              id: string;
              rollout_path?: string;
              cwd?: string;
              title?: string;
              first_user_message?: string;
              created_at?: number;
              updated_at?: number;
              created_at_ms?: number;
              updated_at_ms?: number;
            }>;

            for (const r of rows) {
              const meta: CodexThreadMeta = {
                id: r.id,
                rolloutPath: r.rollout_path,
                title: r.title || r.first_user_message || undefined,
                cwd: r.cwd || undefined,
                createdAt: r.created_at_ms
                  ? new Date(r.created_at_ms).toISOString()
                  : r.created_at
                  ? new Date(r.created_at * 1000).toISOString()
                  : undefined,
                updatedAt: r.updated_at_ms
                  ? new Date(r.updated_at_ms).toISOString()
                  : r.updated_at
                  ? new Date(r.updated_at * 1000).toISOString()
                  : undefined,
              };

              if (r.rollout_path) {
                threadMap.set(r.rollout_path, meta);
              }
              if (r.id) {
                threadMap.set(r.id, meta);
              }
            }
            break; // Newest state database parsed successfully
          }
        } catch {
          // Skip if locked or invalid
        } finally {
          if (db) {
            try {
              db.close();
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return threadMap;
  }

  /**
   * Parses a single Codex rollout-*.jsonl session file into NormalizedSession.
   */
  private async parseRolloutFile(
    filePath: string,
    inferredNativeId: string,
    threadMeta: CodexThreadMeta | undefined,
    machine: ReturnType<typeof getMachineInfo>
  ): Promise<NormalizedSession | null> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let nativeId = inferredNativeId;
    let workspace = threadMeta?.cwd || '';
    let createdAt = threadMeta?.createdAt || '';
    let updatedAt = threadMeta?.updatedAt || '';
    let fallbackTitle = threadMeta?.title || '';

    const messages: NormalizedMessage[] = [];
    let stepIndex = 0;
    const seenMsgIds = new Map<string, number>();
    const toolCallNames = new Map<string, string>();

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const item = JSON.parse(line);
        const type = item.type;
        const payload = item.payload;
        const ts = item.timestamp ? new Date(item.timestamp).toISOString() : undefined;
        if (ts) updatedAt = ts;

        // Line 0 metadata: session_meta
        if (type === 'session_meta' && typeof payload === 'object' && payload !== null) {
          if (payload.id) nativeId = payload.id;
          if (payload.cwd && !workspace) workspace = payload.cwd;
          if (payload.timestamp && !createdAt) {
            createdAt = new Date(payload.timestamp).toISOString();
            if (!updatedAt) updatedAt = createdAt;
          }
          continue;
        }

        // Clean user prompt events: event_msg -> user_message
        if (type === 'event_msg' && typeof payload === 'object' && payload !== null) {
          if (payload.type === 'user_message' && typeof payload.message === 'string') {
            const userText = sanitizeText(payload.message.trim());
            if (userText) {
              if (!fallbackTitle) {
                fallbackTitle = userText.slice(0, 80).replace(/[\r\n]+/g, ' ');
              }

              const baseId = `msg_${stepIndex}`;
              let msgId = baseId;
              const count = seenMsgIds.get(baseId) || 0;
              if (count > 0) {
                msgId = `${baseId}_${count}`;
              }
              seenMsgIds.set(baseId, count + 1);

              messages.push({
                id: msgId,
                role: 'user',
                content: userText,
                timestamp: ts,
                step_index: stepIndex++,
                has_tool_calls: false,
              });
            }
          }
          continue;
        }

        // Response items: message, reasoning, function_call, function_call_output
        if (type === 'response_item' && typeof payload === 'object' && payload !== null) {
          const pt = payload.type;

          // Assistant message
          if (pt === 'message' && payload.role === 'assistant') {
            const textParts: string[] = [];
            if (Array.isArray(payload.content)) {
              for (const part of payload.content) {
                if (part && typeof part.text === 'string' && part.text.trim()) {
                  textParts.push(part.text.trim());
                }
              }
            } else if (typeof payload.content === 'string' && payload.content.trim()) {
              textParts.push(payload.content.trim());
            }

            const fullContent = sanitizeText(textParts.join('\n\n').trim());
            if (fullContent) {
              const baseId = `msg_${stepIndex}`;
              let msgId = baseId;
              const count = seenMsgIds.get(baseId) || 0;
              if (count > 0) {
                msgId = `${baseId}_${count}`;
              }
              seenMsgIds.set(baseId, count + 1);

              messages.push({
                id: msgId,
                role: 'assistant',
                content: fullContent,
                timestamp: ts,
                step_index: stepIndex++,
                has_tool_calls: false,
              });
            }
          }

          // Function call (tool invocation by assistant)
          else if (pt === 'function_call') {
            const callId = payload.call_id;
            const toolName = payload.name || 'tool';
            if (callId) {
              toolCallNames.set(callId, toolName);
            }

            let argsStr = '';
            if (payload.arguments) {
              argsStr =
                typeof payload.arguments === 'object'
                  ? JSON.stringify(payload.arguments, null, 2)
                  : String(payload.arguments);
            }

            const toolCallText = sanitizeText(`[Tool Call: ${toolName}]${argsStr ? `\nInput: ${argsStr}` : ''}`);
            const baseId = `msg_${stepIndex}`;
            let msgId = baseId;
            const count = seenMsgIds.get(baseId) || 0;
            if (count > 0) {
              msgId = `${baseId}_${count}`;
            }
            seenMsgIds.set(baseId, count + 1);

            messages.push({
              id: msgId,
              role: 'assistant',
              content: toolCallText,
              timestamp: ts,
              step_index: stepIndex++,
              has_tool_calls: true,
            });
          }

          // Function call output (tool result)
          else if (pt === 'function_call_output') {
            const callId = payload.call_id;
            const toolName = (callId ? toolCallNames.get(callId) : undefined) || 'tool';
            const outputText = typeof payload.output === 'string' ? payload.output.trim() : '';

            const toolResultText = sanitizeText(`[Tool Result: ${toolName}]\n${outputText}`);
            const baseId = `msg_${stepIndex}`;
            let msgId = baseId;
            const count = seenMsgIds.get(baseId) || 0;
            if (count > 0) {
              msgId = `${baseId}_${count}`;
            }
            seenMsgIds.set(baseId, count + 1);

            messages.push({
              id: msgId,
              role: 'tool',
              content: toolResultText,
              timestamp: ts,
              step_index: stepIndex++,
              has_tool_calls: false,
            });
          }

          // Reasoning step (optional summary or text)
          else if (pt === 'reasoning') {
            let reasoningTexts: string[] = [];
            if (Array.isArray(payload.summary)) {
              reasoningTexts = payload.summary
                .map((s: any) => (s && typeof s.text === 'string' ? s.text.trim() : ''))
                .filter(Boolean);
            } else if (typeof payload.text === 'string' && payload.text.trim()) {
              reasoningTexts = [payload.text.trim()];
            }

            if (reasoningTexts.length > 0) {
              const reasoningContent = sanitizeText(reasoningTexts.join('\n\n'));
              const baseId = `msg_${stepIndex}`;
              let msgId = baseId;
              const count = seenMsgIds.get(baseId) || 0;
              if (count > 0) {
                msgId = `${baseId}_${count}`;
              }
              seenMsgIds.set(baseId, count + 1);

              messages.push({
                id: msgId,
                role: 'thinking',
                content: reasoningContent,
                timestamp: ts,
                step_index: stepIndex++,
                has_tool_calls: false,
              });
            }
          }
        }
      } catch {
        // Skip malformed line
      }
    }

    if (messages.length === 0) return null;

    if (!createdAt && messages[0]?.timestamp) {
      createdAt = messages[0].timestamp;
    }
    if (!updatedAt && messages[messages.length - 1]?.timestamp) {
      updatedAt = messages[messages.length - 1].timestamp!;
    }
    if (!createdAt) {
      const stat = fs.statSync(filePath);
      createdAt = stat.birthtime.toISOString();
      updatedAt = stat.mtime.toISOString();
    }

    const title = sanitizeText(fallbackTitle || `Session ${nativeId.slice(0, 8)}`);
    const sessionId = `codex_${machine.id}_${nativeId}`;

    return {
      schema_version: '1.0',
      id: sessionId,
      agent: 'codex',
      machine,
      session: {
        native_id: nativeId,
        title,
        workspace: workspace || undefined,
        created_at: createdAt,
        updated_at: updatedAt,
      },
      messages,
    };
  }
}
