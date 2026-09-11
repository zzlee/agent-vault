import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import type { AgentAdapter } from './base.js';
import type { NormalizedMessage, NormalizedSession } from '../core/types.js';
import { sanitizeText } from '../core/sanitizer.js';

export class PiAdapter implements AgentAdapter {
  readonly name = 'pi' as const;
  private sessionsDir: string;

  constructor(customDir?: string) {
    this.sessionsDir = customDir || path.join(os.homedir(), '.pi', 'agent', 'sessions');
  }

  isAvailable(): boolean {
    return fs.existsSync(this.sessionsDir);
  }

  async collect(): Promise<NormalizedSession[]> {
    if (!this.isAvailable()) return [];

    const results: NormalizedSession[] = [];
    const hostname = os.hostname();
    const platform = os.platform();

    try {
      const workspaceDirs = fs.readdirSync(this.sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const wDir of workspaceDirs) {
        const dirPath = path.join(this.sessionsDir, wDir.name);
        const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));

        for (const file of files) {
          const filePath = path.join(dirPath, file);
          try {
            const session = await this.parseSessionFile(filePath, hostname, platform);
            if (session && session.messages.length > 0) {
              results.push(session);
            }
          } catch {
            // Skip corrupted or unreadable files
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }

    return results;
  }

  private async parseSessionFile(
    filePath: string,
    hostname: string,
    platform: string
  ): Promise<NormalizedSession | null> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let nativeId = path.basename(filePath, '.jsonl');
    let workspace = '';
    let createdAt = '';
    let updatedAt = '';
    const messages: NormalizedMessage[] = [];
    let stepIndex = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);

        if (item.type === 'session') {
          if (item.id) nativeId = item.id;
          if (item.cwd) workspace = item.cwd;
          if (item.timestamp) {
            createdAt = item.timestamp;
            updatedAt = item.timestamp;
          }
        } else if (item.type === 'message' && item.message) {
          const rawMsg = item.message;
          const msgRole = rawMsg.role;
          const msgTimestamp = item.timestamp || (rawMsg.timestamp ? new Date(rawMsg.timestamp).toISOString() : undefined);
          if (msgTimestamp) updatedAt = msgTimestamp;

          let role: 'user' | 'assistant' | 'tool' | 'system' = 'assistant';
          if (msgRole === 'user') role = 'user';
          else if (msgRole === 'system') role = 'system';
          else if (msgRole === 'toolResult' || msgRole === 'tool') role = 'tool';

          let textContent = '';
          let hasToolCalls = false;

          if (Array.isArray(rawMsg.content)) {
            for (const part of rawMsg.content) {
              if (part.type === 'text' && typeof part.text === 'string') {
                textContent += (textContent ? '\n' : '') + part.text;
              } else if (part.type === 'toolCall' || part.type === 'toolUse') {
                hasToolCalls = true;
              }
            }
          } else if (typeof rawMsg.content === 'string') {
            textContent = rawMsg.content;
          }

          if (textContent.trim()) {
            messages.push({
              id: item.id || `msg_${stepIndex}`,
              role,
              content: sanitizeText(textContent.trim()),
              timestamp: msgTimestamp,
              step_index: stepIndex++,
              has_tool_calls: hasToolCalls,
            });
          }
        }
      } catch {
        // Skip malformed JSON lines
      }
    }

    if (messages.length === 0) return null;

    // First user prompt as title
    const firstUserMsg = messages.find((m) => m.role === 'user');
    let title = firstUserMsg ? firstUserMsg.content.slice(0, 80).replace(/\n/g, ' ') : `Session ${nativeId.slice(0, 8)}`;
    if (firstUserMsg && firstUserMsg.content.length > 80) {
      title += '...';
    }

    if (!createdAt && messages[0].timestamp) {
      createdAt = messages[0].timestamp;
    }
    const lastMsgTs = messages[messages.length - 1].timestamp;
    if (!updatedAt && lastMsgTs) {
      updatedAt = lastMsgTs;
    }

    return {
      schema_version: '1.0',
      id: `pi_${hostname}_${nativeId}`,
      agent: 'pi',
      machine: {
        hostname,
        platform,
      },
      session: {
        native_id: nativeId,
        title,
        workspace,
        created_at: createdAt || new Date().toISOString(),
        updated_at: updatedAt || createdAt || new Date().toISOString(),
      },
      messages,
    };
  }
}
