import fs from 'node:fs';
import path from 'node:path';
import type { AgentAdapter } from '../adapters/base.js';
import { PiAdapter } from '../adapters/pi.js';
import { OpenCodeAdapter } from '../adapters/opencode.js';
import { AgyAdapter } from '../adapters/agy.js';
import type { AgentType, NormalizedSession } from './types.js';
import type { VaultDB } from './db.js';

export class Syncer {
  private adapters: AgentAdapter[];
  private dataDir: string;
  private db: VaultDB;

  constructor(db: VaultDB, dataDir?: string) {
    this.db = db;
    this.dataDir = dataDir || path.join(process.cwd(), 'data', 'sessions');
    this.adapters = [
      new PiAdapter(),
      new OpenCodeAdapter(),
      new AgyAdapter(),
    ];
  }

  async sync(options: { agent?: AgentType } = {}): Promise<{
    addedOrUpdated: number;
    agentCounts: Record<string, number>;
  }> {
    const targetAdapters = options.agent
      ? this.adapters.filter((a) => a.name === options.agent)
      : this.adapters;

    let addedOrUpdated = 0;
    const agentCounts: Record<string, number> = {
      pi: 0,
      opencode: 0,
      agy: 0,
    };

    for (const adapter of targetAdapters) {
      if (!adapter.isAvailable()) {
        continue;
      }

      const sessions: NormalizedSession[] = await adapter.collect();
      const agentDir = path.join(this.dataDir, adapter.name);
      fs.mkdirSync(agentDir, { recursive: true });

      for (const session of sessions) {
        const fileName = `${session.id}.json`;
        const filePath = path.join(agentDir, fileName);

        // Save structured JSON to data layer (git-tracked)
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');

        // Upsert into SQLite FTS5 database (local search layer)
        this.db.upsertSession(session, filePath);

        addedOrUpdated++;
        agentCounts[adapter.name] = (agentCounts[adapter.name] || 0) + 1;
      }
    }

    return { addedOrUpdated, agentCounts };
  }
}
