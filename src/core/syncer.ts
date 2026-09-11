import fs from 'node:fs';
import path from 'node:path';
import type { AgentAdapter } from '../adapters/base.js';
import { PiAdapter } from '../adapters/pi.js';
import { OpenCodeAdapter } from '../adapters/opencode.js';
import { AgyAdapter } from '../adapters/agy.js';
import { FreebuffAdapter } from '../adapters/freebuff.js';
import { HermesAdapter } from '../adapters/hermes.js';
import type { AgentType, NormalizedSession } from './types.js';
import type { VaultDB } from './db.js';
import { getDataDir } from './paths.js';

export interface AgentSyncStats {
  newSessions: number;
  updatedSessions: number;
  unchangedSessions: number;
  totalSessions: number;
  totalMessages: number;
  newMessages: number;
}

export interface SyncResult {
  dryRun: boolean;
  addedOrUpdated: number;
  agentCounts: Record<string, number>;
  agentDetails: Record<string, AgentSyncStats>;
  totalNewSessions: number;
  totalUpdatedSessions: number;
  totalUnchangedSessions: number;
  totalNewMessages: number;
  totalMessages: number;
}

export class Syncer {
  private adapters: AgentAdapter[];
  private dataDir: string;
  private db: VaultDB;

  constructor(db: VaultDB, dataDir?: string) {
    this.db = db;
    this.dataDir = dataDir || getDataDir();
    this.adapters = [
      new PiAdapter(),
      new OpenCodeAdapter(),
      new AgyAdapter(),
      new FreebuffAdapter(),
      new HermesAdapter(),
    ];
  }

  async sync(options: { agent?: AgentType; dryRun?: boolean } = {}): Promise<SyncResult> {
    const isDryRun = Boolean(options.dryRun);
    const targetAdapters = options.agent
      ? this.adapters.filter((a) => a.name === options.agent)
      : this.adapters;

    let addedOrUpdated = 0;
    let totalNewSessions = 0;
    let totalUpdatedSessions = 0;
    let totalUnchangedSessions = 0;
    let totalNewMessages = 0;
    let totalMessages = 0;

    const agentCounts: Record<string, number> = {
      pi: 0,
      opencode: 0,
      agy: 0,
      freebuff: 0,
      hermes: 0,
    };

    const agentDetails: Record<string, AgentSyncStats> = {
      pi: { newSessions: 0, updatedSessions: 0, unchangedSessions: 0, totalSessions: 0, totalMessages: 0, newMessages: 0 },
      opencode: { newSessions: 0, updatedSessions: 0, unchangedSessions: 0, totalSessions: 0, totalMessages: 0, newMessages: 0 },
      agy: { newSessions: 0, updatedSessions: 0, unchangedSessions: 0, totalSessions: 0, totalMessages: 0, newMessages: 0 },
      freebuff: { newSessions: 0, updatedSessions: 0, unchangedSessions: 0, totalSessions: 0, totalMessages: 0, newMessages: 0 },
      hermes: { newSessions: 0, updatedSessions: 0, unchangedSessions: 0, totalSessions: 0, totalMessages: 0, newMessages: 0 },
    };

    for (const adapter of targetAdapters) {
      if (!adapter.isAvailable()) {
        continue;
      }

      const agentDir = path.join(this.dataDir, adapter.name);
      if (!isDryRun) {
        fs.mkdirSync(agentDir, { recursive: true });
      }

      // Pre-fetch in-memory metadata map for this agent (single SQL query)
      const rawMetaMap = this.db.getSessionMetaMap(adapter.name);
      const existingMap = new Map<string, { id: string; updatedAt: string; messageCount: number }>();
      for (const [id, meta] of rawMetaMap) {
        const filePath = path.join(agentDir, `${id}.json`);
        if (fs.existsSync(filePath)) {
          existingMap.set(id, meta);
        }
      }

      const sessions: NormalizedSession[] = await adapter.collect({ existingSessions: existingMap });

      const details = agentDetails[adapter.name] || {
        newSessions: 0,
        updatedSessions: 0,
        unchangedSessions: 0,
        totalSessions: 0,
        totalMessages: 0,
        newMessages: 0,
      };

      for (const session of sessions) {
        const fileName = `${session.id}.json`;
        const filePath = path.join(agentDir, fileName);
        const existing = existingMap.get(session.id);
        const prevCount = existing ? (existing.messageCount || 0) : 0;
        const msgCount = session.messages.length || prevCount;

        details.totalSessions++;
        details.totalMessages += msgCount;
        totalMessages += msgCount;

        // Check if session is new, updated, or unchanged
        let isNew = false;
        let isUpdated = false;
        let deltaMsgs = 0;

        if (!existing || !fs.existsSync(filePath)) {
          isNew = true;
          deltaMsgs = msgCount;
        } else {
          if (session.messages.length > prevCount || session.session.updated_at !== existing.updatedAt) {
            isUpdated = true;
            deltaMsgs = Math.max(0, session.messages.length - prevCount);
          }
        }

        if (isNew) {
          details.newSessions++;
          details.newMessages += deltaMsgs;
          totalNewSessions++;
          totalNewMessages += deltaMsgs;
        } else if (isUpdated) {
          details.updatedSessions++;
          details.newMessages += deltaMsgs;
          totalUpdatedSessions++;
          totalNewMessages += deltaMsgs;
        } else {
          details.unchangedSessions++;
          totalUnchangedSessions++;
        }

        if (!isDryRun && (isNew || isUpdated)) {
          // Save structured JSON to data layer (git-tracked)
          fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');

          // Upsert into SQLite FTS5 database (local search layer)
          this.db.upsertSession(session, filePath);

          addedOrUpdated++;
          agentCounts[adapter.name] = (agentCounts[adapter.name] || 0) + 1;
        }
      }
    }

    return {
      dryRun: isDryRun,
      addedOrUpdated,
      agentCounts,
      agentDetails,
      totalNewSessions,
      totalUpdatedSessions,
      totalUnchangedSessions,
      totalNewMessages,
      totalMessages,
    };
  }
}
