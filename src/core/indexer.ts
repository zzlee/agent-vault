import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { VaultDB } from './db.js';
import type { NormalizedSession } from './types.js';

export class Indexer {
  private db: VaultDB;
  private dataDir: string;

  constructor(db: VaultDB, dataDir?: string) {
    this.db = db;
    this.dataDir = dataDir || path.join(process.cwd(), 'data', 'sessions');
  }

  async reindexAll(): Promise<{ indexedCount: number; errors: number }> {
    if (!fs.existsSync(this.dataDir)) {
      return { indexedCount: 0, errors: 0 };
    }

    const files = await fg('**/*.json', {
      cwd: this.dataDir,
      absolute: true,
    });

    let indexedCount = 0;
    let errors = 0;

    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const session = JSON.parse(raw) as NormalizedSession;
        if (session && session.id && session.messages) {
          this.db.upsertSession(session, file);
          indexedCount++;
        }
      } catch {
        errors++;
      }
    }

    return { indexedCount, errors };
  }
}
