import fs from 'node:fs';
import fg from 'fast-glob';
import type { VaultDB } from './db.js';
import type { NormalizedSession } from './types.js';
import { getDataDir } from './paths.js';

export interface ReindexProgress {
  current: number;
  total: number;
  messageCount: number;
  session?: NormalizedSession;
}

export type ProgressCallback = (progress: ReindexProgress) => void;

export interface ReindexOptions {
  onProgress?: ProgressCallback;
  batchSize?: number;
}

export class Indexer {
  private db: VaultDB;
  private dataDir: string;

  constructor(db: VaultDB, dataDir?: string) {
    this.db = db;
    this.dataDir = dataDir || getDataDir();
  }

  async reindexAll(options?: ReindexOptions): Promise<{ indexedCount: number; messageCount: number; errors: number }> {
    if (!fs.existsSync(this.dataDir)) {
      return { indexedCount: 0, messageCount: 0, errors: 0 };
    }

    const files = await fg('**/*.json', {
      cwd: this.dataDir,
      absolute: true,
    });

    if (files.length === 0) {
      this.db.clearAll();
      return { indexedCount: 0, messageCount: 0, errors: 0 };
    }

    // Reset database completely for clean, full rebuild
    this.db.clearAll();

    let indexedCount = 0;
    let messageCount = 0;
    let errors = 0;
    const batchSize = options?.batchSize || 50;

    let currentBatch: Array<{ session: NormalizedSession; filePath: string }> = [];

    const flushBatch = () => {
      if (currentBatch.length === 0) return;
      this.db.insertSessionsBatch(currentBatch, true);
      currentBatch = [];
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let currentSession: NormalizedSession | undefined;

      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const session = JSON.parse(raw) as NormalizedSession;
        if (session && session.id && session.messages) {
          currentSession = session;
          currentBatch.push({ session, filePath: file });
          indexedCount++;
          messageCount += session.messages.length;

          if (currentBatch.length >= batchSize) {
            flushBatch();
          }
        }
      } catch {
        errors++;
      }

      if (options?.onProgress) {
        options.onProgress({
          current: i + 1,
          total: files.length,
          messageCount,
          session: currentSession,
        });
      }
    }

    flushBatch();

    return { indexedCount, messageCount, errors };
  }
}
