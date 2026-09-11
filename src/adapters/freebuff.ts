import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentAdapter, CollectOptions } from './base.js';
import type { NormalizedMessage, NormalizedSession, MessageRole } from '../core/types.js';
import { sanitizeText } from '../core/sanitizer.js';
import { getMachineInfo } from '../core/machine.js';

interface FreebuffChatMeta {
  messageCount?: number;
  firstPrompt?: string;
  messagesSize?: number;
  messagesMtimeMs?: number;
}

interface FreebuffBlock {
  type: string;
  content?: string;
  textType?: string;
  toolName?: string;
  input?: any;
  output?: string;
}

interface FreebuffRawMessage {
  id: string;
  variant: 'user' | 'ai' | string;
  content?: string;
  timestamp?: string;
  blocks?: FreebuffBlock[];
}

export class FreebuffAdapter implements AgentAdapter {
  readonly name = 'freebuff' as const;
  private baseDir: string;

  constructor(customBaseDir?: string) {
    this.baseDir =
      customBaseDir ||
      process.env.MANICODE_DIR ||
      process.env.FREEBUFF_DIR ||
      path.join(os.homedir(), '.config', 'manicode');
  }

  isAvailable(): boolean {
    const projectsDir = path.join(this.baseDir, 'projects');
    return fs.existsSync(projectsDir);
  }

  async collect(options?: CollectOptions): Promise<NormalizedSession[]> {
    if (!this.isAvailable()) return [];

    const results: NormalizedSession[] = [];
    const machine = getMachineInfo();
    const projectsDir = path.join(this.baseDir, 'projects');

    try {
      const projectEntries = fs.readdirSync(projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const projectEntry of projectEntries) {
        const projectName = projectEntry.name;
        const chatsDir = path.join(projectsDir, projectName, 'chats');

        if (!fs.existsSync(chatsDir)) continue;

        const chatEntries = fs.readdirSync(chatsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory());

        for (const chatEntry of chatEntries) {
          const chatFolder = chatEntry.name;
          const chatPath = path.join(chatsDir, chatFolder);
          const messagesFile = path.join(chatPath, 'chat-messages.json');

          if (!fs.existsSync(messagesFile)) continue;

          const nativeId = `${projectName}__${chatFolder}`;
          const expectedId = `freebuff_${machine.id}_${nativeId}`;
          const existing = options?.existingSessions?.get(expectedId);

          if (existing) {
            const stat = fs.statSync(messagesFile);
            if (stat.mtimeMs <= new Date(existing.updatedAt).getTime() + 1000) {
              results.push({
                schema_version: '1.0',
                id: existing.id,
                agent: 'freebuff',
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
          }

          try {
            const session = this.parseChat(chatPath, projectName, chatFolder, machine);
            if (session && session.messages.length > 0) {
              results.push(session);
            }
          } catch {
            // Skip corrupted or unreadable chats
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    return results;
  }

  private parseChat(
    chatDir: string,
    projectName: string,
    chatFolder: string,
    machine: ReturnType<typeof getMachineInfo>
  ): NormalizedSession | null {
    const messagesFile = path.join(chatDir, 'chat-messages.json');
    const metaFile = path.join(chatDir, 'chat-meta.json');
    const runStateFile = path.join(chatDir, 'run-state.json');

    let meta: FreebuffChatMeta = {};
    if (fs.existsSync(metaFile)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      } catch {
        // ignore
      }
    }

    let workspace = projectName;
    if (fs.existsSync(runStateFile)) {
      try {
        const runState = JSON.parse(fs.readFileSync(runStateFile, 'utf-8'));
        const root =
          runState.sessionState?.fileContext?.projectRoot ||
          runState.sessionState?.fileContext?.cwd;
        if (root && typeof root === 'string') {
          workspace = root;
        }
      } catch {
        // ignore
      }
    }

    let rawMessages: FreebuffRawMessage[] = [];
    try {
      rawMessages = JSON.parse(fs.readFileSync(messagesFile, 'utf-8'));
    } catch {
      return null;
    }

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return null;
    }

    // Determine created_at from folder name: e.g. "2026-08-31T04-52-41.015Z" -> "2026-08-31T04:52:41.015Z"
    let createdAt = chatFolder.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
    if (isNaN(new Date(createdAt).getTime())) {
      const stat = fs.statSync(messagesFile);
      createdAt = stat.birthtime.toISOString();
    }

    let updatedAt = createdAt;
    if (meta.messagesMtimeMs && !isNaN(meta.messagesMtimeMs)) {
      updatedAt = new Date(meta.messagesMtimeMs).toISOString();
    } else {
      try {
        const stat = fs.statSync(messagesFile);
        updatedAt = stat.mtime.toISOString();
      } catch {
        // fallback to createdAt
      }
    }

    const messages: NormalizedMessage[] = [];
    let stepIndex = 0;
    let fallbackTitle = '';

    for (const raw of rawMessages) {
      // Skip empty divider nodes
      if (raw.id && raw.id.startsWith('divider-') && !raw.content) {
        if (!raw.blocks || raw.blocks.length === 0 || raw.blocks.every((b) => b.type === 'mode-divider')) {
          continue;
        }
      }

      let role: MessageRole = 'assistant';
      if (raw.variant === 'user') {
        role = 'user';
      } else if (raw.id && raw.id.startsWith('sys-')) {
        role = 'system';
      }

      const textParts: string[] = [];
      let hasToolCalls = false;

      if (raw.content && raw.content.trim()) {
        textParts.push(raw.content.trim());
      }

      if (Array.isArray(raw.blocks)) {
        for (const block of raw.blocks) {
          if (block.type === 'mode-divider') continue;

          if (block.type === 'text' && block.content && block.content.trim()) {
            if (block.textType === 'reasoning') {
              textParts.push(`[Reasoning]\n${block.content.trim()}`);
            } else {
              textParts.push(block.content.trim());
            }
          } else if (block.type === 'tool') {
            hasToolCalls = true;
            const toolName = block.toolName || 'tool';
            let inputStr = '';
            if (block.input) {
              inputStr = typeof block.input === 'object' ? JSON.stringify(block.input) : String(block.input);
            }
            let toolText = `[Tool Call: ${toolName}]`;
            if (inputStr) toolText += `\nInput: ${inputStr}`;
            if (block.output) toolText += `\nOutput: ${block.output.trim()}`;
            textParts.push(toolText);
          }
        }
      }

      const fullContent = sanitizeText(textParts.join('\n\n').trim());
      if (!fullContent) continue;

      if (!fallbackTitle && role === 'user') {
        fallbackTitle = fullContent.slice(0, 80).replace(/[\r\n]+/g, ' ');
      }

      // Extract timestamp from ID if available: user-1787187229476, ai-1787187229926-...
      let msgTimestamp: string | undefined;
      const tsMatch = raw.id.match(/(?:user|ai|sys|divider)-(\d{13})/);
      if (tsMatch) {
        const epochMs = parseInt(tsMatch[1], 10);
        if (!isNaN(epochMs)) {
          msgTimestamp = new Date(epochMs).toISOString();
        }
      }

      messages.push({
        id: raw.id || `msg-${stepIndex}`,
        role,
        content: fullContent,
        timestamp: msgTimestamp,
        step_index: stepIndex++,
        has_tool_calls: hasToolCalls,
      });
    }

    if (messages.length === 0) return null;

    const title = sanitizeText(meta.firstPrompt?.trim() || fallbackTitle || '(untitled session)');
    const nativeId = `${projectName}__${chatFolder}`;
    const sessionId = `freebuff_${machine.id}_${nativeId}`;

    return {
      schema_version: '1.0',
      id: sessionId,
      agent: 'freebuff',
      machine,
      session: {
        native_id: nativeId,
        title,
        workspace,
        created_at: createdAt,
        updated_at: updatedAt,
      },
      messages,
    };
  }
}
