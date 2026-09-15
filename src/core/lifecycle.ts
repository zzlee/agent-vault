import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { VaultDB } from './db.js';
import type { NormalizedSession, AgentType } from './types.js';
import { getDataDir, getArchiveDir, getDbPath } from './paths.js';

export interface ArchiveOptions {
  before?: string;
  agent?: AgentType;
  sessionId?: string;
  dryRun?: boolean;
}

export interface ArchiveResult {
  dryRun: boolean;
  archivedSessions: number;
  archivedMessages: number;
  sessions: Array<{
    id: string;
    title: string;
    agent: string;
    updatedAt: string;
    messageCount: number;
  }>;
}

export interface UnarchiveResult {
  success: boolean;
  sessionId: string;
  agent: string;
  title: string;
  filePath: string;
}

export interface PruneOptions {
  olderThan?: string;
  maxToolChars?: number;
  agent?: AgentType;
  sessionId?: string;
  dryRun?: boolean;
}

export interface PruneResult {
  dryRun: boolean;
  scannedSessions: number;
  prunedSessions: number;
  prunedMessages: number;
  bytesSaved: number;
}

export interface VacuumResult {
  beforeBytes: number;
  afterBytes: number;
  bytesReclaimed: number;
}

/**
 * Parses duration or date strings into millisecond epoch timestamp.
 * Supports: '90d', '30d', '12h', '6m'/'6mo', '1y', or ISO dates like '2026-06-01'.
 */
export function parseTimeCutoff(input: string): number {
  const trimmed = input.trim();

  // Check duration patterns (e.g. 90d, 12h, 4w, 6mo, 1y)
  const durationMatch = trimmed.match(/^(\d+)\s*(h|d|w|m|mo|y)$/i);
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2].toLowerCase();
    const now = Date.now();

    switch (unit) {
      case 'h':
        return now - value * 60 * 60 * 1000;
      case 'd':
        return now - value * 24 * 60 * 60 * 1000;
      case 'w':
        return now - value * 7 * 24 * 60 * 60 * 1000;
      case 'm':
      case 'mo':
        return now - value * 30 * 24 * 60 * 60 * 1000;
      case 'y':
        return now - value * 365 * 24 * 60 * 60 * 1000;
    }
  }

  // Fallback to Date parsing
  const parsed = new Date(trimmed).getTime();
  if (isNaN(parsed)) {
    throw new Error(`Invalid time or date format: "${input}". Use formats like "90d", "30d", or "YYYY-MM-DD".`);
  }
  return parsed;
}

export class LifecycleManager {
  private db: VaultDB;
  private dataDir: string;
  private archiveDir: string;

  constructor(db: VaultDB, dataDir?: string, archiveDir?: string) {
    this.db = db;
    this.dataDir = dataDir || getDataDir();
    this.archiveDir = archiveDir || getArchiveDir();
  }

  /**
   * Archives sessions older than the specified cutoff date, moving them
   * from data/sessions/ to data/archive/ and removing them from the active SQLite database.
   */
  public async archive(options: ArchiveOptions = {}): Promise<ArchiveResult> {
    const isDryRun = Boolean(options.dryRun);
    const cutoffMs = options.before ? parseTimeCutoff(options.before) : undefined;

    if (!fs.existsSync(this.dataDir)) {
      return { dryRun: isDryRun, archivedSessions: 0, archivedMessages: 0, sessions: [] };
    }

    const globPattern = options.agent ? `${options.agent}/*.json` : '**/*.json';
    const files = await fg(globPattern, {
      cwd: this.dataDir,
      absolute: true,
    });

    const matchingSessions: Array<{
      file: string;
      session: NormalizedSession;
    }> = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const session = JSON.parse(raw) as NormalizedSession;
        if (!session || !session.id || !session.session) continue;

        if (options.sessionId && session.id !== options.sessionId && !session.id.includes(options.sessionId)) {
          continue;
        }

        if (options.agent && session.agent !== options.agent) {
          continue;
        }

        if (cutoffMs !== undefined) {
          const sessionTime = new Date(session.session.updated_at || session.session.created_at).getTime();
          if (isNaN(sessionTime) || sessionTime >= cutoffMs) {
            continue;
          }
        }

        matchingSessions.push({ file, session });
      } catch {
        // Skip unreadable files
      }
    }

    let archivedMessages = 0;
    const archivedDetails: ArchiveResult['sessions'] = [];

    for (const { file, session } of matchingSessions) {
      const msgCount = session.messages ? session.messages.length : 0;
      archivedMessages += msgCount;
      archivedDetails.push({
        id: session.id,
        title: session.session.title || '(untitled)',
        agent: session.agent,
        updatedAt: session.session.updated_at,
        messageCount: msgCount,
      });

      if (!isDryRun) {
        const destAgentDir = path.join(this.archiveDir, session.agent);
        fs.mkdirSync(destAgentDir, { recursive: true });
        const destFile = path.join(destAgentDir, path.basename(file));

        fs.renameSync(file, destFile);
        this.db.deleteSession(session.id);
      }
    }

    return {
      dryRun: isDryRun,
      archivedSessions: matchingSessions.length,
      archivedMessages,
      sessions: archivedDetails,
    };
  }

  /**
   * Restores an archived session back to data/sessions/ and re-inserts it into the active SQLite database.
   */
  public async unarchive(sessionId: string): Promise<UnarchiveResult> {
    if (!fs.existsSync(this.archiveDir)) {
      throw new Error(`Archive directory does not exist: ${this.archiveDir}`);
    }

    const files = await fg('**/*.json', {
      cwd: this.archiveDir,
      absolute: true,
    });

    const targetFile = files.find((f) => {
      const base = path.basename(f, '.json');
      return base === sessionId || base.includes(sessionId);
    });

    if (!targetFile) {
      throw new Error(`Archived session with id matching "${sessionId}" was not found in ${this.archiveDir}`);
    }

    const raw = fs.readFileSync(targetFile, 'utf-8');
    const session = JSON.parse(raw) as NormalizedSession;

    const destAgentDir = path.join(this.dataDir, session.agent);
    fs.mkdirSync(destAgentDir, { recursive: true });
    const destFile = path.join(destAgentDir, path.basename(targetFile));

    fs.renameSync(targetFile, destFile);
    this.db.upsertSession(session, destFile);

    return {
      success: true,
      sessionId: session.id,
      agent: session.agent,
      title: session.session.title || '(untitled)',
      filePath: destFile,
    };
  }

  /**
   * Prunes oversized tool outputs and build logs from older sessions, keeping the
   * critical start and end of tool results while removing intermediate verbose lines.
   */
  public async prune(options: PruneOptions = {}): Promise<PruneResult> {
    const isDryRun = Boolean(options.dryRun);
    const maxToolChars = options.maxToolChars || 1500;
    const cutoffMs = options.olderThan ? parseTimeCutoff(options.olderThan) : parseTimeCutoff('30d');

    if (!fs.existsSync(this.dataDir)) {
      return { dryRun: isDryRun, scannedSessions: 0, prunedSessions: 0, prunedMessages: 0, bytesSaved: 0 };
    }

    const globPattern = options.agent ? `${options.agent}/*.json` : '**/*.json';
    const files = await fg(globPattern, {
      cwd: this.dataDir,
      absolute: true,
    });

    let scannedSessions = 0;
    let prunedSessions = 0;
    let prunedMessages = 0;
    let bytesSaved = 0;

    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const session = JSON.parse(raw) as NormalizedSession;
        if (!session || !session.id || !session.messages) continue;

        if (options.sessionId && session.id !== options.sessionId && !session.id.includes(options.sessionId)) {
          continue;
        }

        if (options.agent && session.agent !== options.agent) {
          continue;
        }

        const sessionTime = new Date(session.session.updated_at || session.session.created_at).getTime();
        if (!isNaN(sessionTime) && sessionTime >= cutoffMs && !options.sessionId) {
          // Session is newer than cutoff and wasn't explicitly targeted
          continue;
        }

        scannedSessions++;
        let sessionModified = false;

        for (const msg of session.messages) {
          const isToolRole = msg.role === 'tool';
          const hasToolCallContent = msg.content && (msg.content.includes('[Tool Result') || msg.content.includes('[Tool Call:'));

          if ((isToolRole || hasToolCallContent) && msg.content.length > maxToolChars) {
            const originalLength = msg.content.length;
            const headSize = Math.floor(maxToolChars * 0.4);
            const tailSize = Math.floor(maxToolChars * 0.2);
            const omittedChars = originalLength - (headSize + tailSize);

            if (omittedChars > 100) {
              const head = msg.content.slice(0, headSize);
              const tail = msg.content.slice(-tailSize);
              const truncatedContent = `${head}\n\n[... Output truncated: ${omittedChars.toLocaleString()} characters omitted by agent-vault prune ...]\n\n${tail}`;

              const diff = originalLength - truncatedContent.length;
              if (diff > 0) {
                bytesSaved += diff;
                prunedMessages++;
                msg.content = truncatedContent;
                sessionModified = true;
              }
            }
          }
        }

        if (sessionModified) {
          prunedSessions++;
          if (!isDryRun) {
            fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
            this.db.upsertSession(session, file);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      dryRun: isDryRun,
      scannedSessions,
      prunedSessions,
      prunedMessages,
      bytesSaved,
    };
  }

  /**
   * Runs SQLite VACUUM to reclaim disk space and defragment FTS5 index.
   */
  public vacuum(): VacuumResult {
    const dbPath = getDbPath();
    const beforeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

    this.db.vacuum();

    const afterBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const bytesReclaimed = Math.max(0, beforeBytes - afterBytes);

    return {
      beforeBytes,
      afterBytes,
      bytesReclaimed,
    };
  }
}
