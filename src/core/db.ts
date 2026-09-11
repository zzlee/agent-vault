import { type Database as DatabaseType } from 'better-sqlite3';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { NormalizedSession, SearchResult, SessionSummary } from './types.js';
import { getDbPath } from './paths.js';

export class VaultDB {
  private db: DatabaseType;

  constructor(dbPath?: string) {
    const finalPath = dbPath || getDbPath();
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });

    this.db = new Database(finalPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        hostname TEXT NOT NULL,
        platform TEXT NOT NULL,
        native_id TEXT NOT NULL,
        title TEXT NOT NULL,
        workspace TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        file_path TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT,
        step_index INTEGER,
        has_tool_calls INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace);
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        session_id UNINDEXED,
        message_id UNINDEXED,
        role UNINDEXED,
        title,
        workspace,
        content,
        tokenize = 'unicode61'
      );
    `);
  }

  public upsertSession(session: NormalizedSession, filePath?: string): void {
    const upsertTx = this.db.transaction(() => {
      // 1. Upsert session row
      const upsertSessionStmt = this.db.prepare(`
        INSERT INTO sessions (
          id, agent, hostname, platform, native_id, title, workspace,
          created_at, updated_at, message_count, file_path
        ) VALUES (
          @id, @agent, @hostname, @platform, @native_id, @title, @workspace,
          @created_at, @updated_at, @message_count, @file_path
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          workspace = excluded.workspace,
          updated_at = excluded.updated_at,
          message_count = excluded.message_count,
          file_path = excluded.file_path
      `);

      upsertSessionStmt.run({
        id: session.id,
        agent: session.agent,
        hostname: session.machine.hostname,
        platform: session.machine.platform,
        native_id: session.session.native_id,
        title: session.session.title || '(untitled)',
        workspace: session.session.workspace || '',
        created_at: session.session.created_at,
        updated_at: session.session.updated_at,
        message_count: session.messages.length,
        file_path: filePath || '',
      });

      // 2. Remove previous messages and FTS entries
      this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(session.id);
      this.db.prepare(`DELETE FROM search_fts WHERE session_id = ?`).run(session.id);

      // 3. Insert messages and FTS entries
      const insertMsgStmt = this.db.prepare(`
        INSERT INTO messages (id, session_id, role, content, timestamp, step_index, has_tool_calls)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertFtsStmt = this.db.prepare(`
        INSERT INTO search_fts (session_id, message_id, role, title, workspace, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const msg of session.messages) {
        const globalMsgId = `${session.id}:${msg.id}`;
        insertMsgStmt.run(
          globalMsgId,
          session.id,
          msg.role,
          msg.content,
          msg.timestamp || null,
          msg.step_index ?? null,
          msg.has_tool_calls ? 1 : 0
        );

        if (msg.content && msg.content.trim()) {
          insertFtsStmt.run(
            session.id,
            globalMsgId,
            msg.role,
            session.session.title || '',
            session.session.workspace || '',
            msg.content
          );
        }
      }
    });

    upsertTx();
  }

  public search(
    query: string,
    options: { agent?: string; workspace?: string; limit?: number } = {}
  ): SearchResult[] {
    const limit = options.limit || 20;

    // Clean up query for FTS5 (avoid syntax break on special characters)
    const sanitizedQuery = query
      .replace(/['"*]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"`)
      .join(' ');

    if (!sanitizedQuery) return [];

    let sql = `
      SELECT 
        s.id AS sessionId,
        s.agent,
        s.hostname,
        s.title,
        s.workspace,
        s.updated_at AS updatedAt,
        f.role,
        snippet(search_fts, 5, '\x1b[33m\x1b[1m', '\x1b[0m', '...', 25) AS snippet
      FROM search_fts f
      JOIN sessions s ON s.id = f.session_id
      WHERE search_fts MATCH ?
    `;

    const params: unknown[] = [sanitizedQuery];

    if (options.agent) {
      sql += ` AND s.agent = ?`;
      params.push(options.agent);
    }
    if (options.workspace) {
      sql += ` AND s.workspace LIKE ?`;
      params.push(`%${options.workspace}%`);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as SearchResult[];
  }

  public listSessions(options: { agent?: string; workspace?: string; limit?: number } = {}): SessionSummary[] {
    const limit = options.limit || 25;
    let sql = `
      SELECT 
        id, agent, hostname, native_id AS nativeId, title, workspace,
        created_at AS createdAt, updated_at AS updatedAt, message_count AS messageCount
      FROM sessions
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (options.agent) {
      sql += ` AND agent = ?`;
      params.push(options.agent);
    }
    if (options.workspace) {
      sql += ` AND workspace LIKE ?`;
      params.push(`%${options.workspace}%`);
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as SessionSummary[];
  }

  public getSession(id: string): { session: SessionSummary; messages: any[] } | null {
    const session = this.db.prepare(`
      SELECT 
        id, agent, hostname, native_id AS nativeId, title, workspace,
        created_at AS createdAt, updated_at AS updatedAt, message_count AS messageCount, file_path AS filePath
      FROM sessions
      WHERE id = ?
    `).get(id) as SessionSummary | undefined;

    if (!session) return null;

    const messages = this.db.prepare(`
      SELECT id, role, content, timestamp, step_index AS stepIndex, has_tool_calls AS hasToolCalls
      FROM messages
      WHERE session_id = ?
      ORDER BY step_index ASC, timestamp ASC
    `).all(id);

    return { session, messages };
  }

  public getStats(): { totalSessions: number; totalMessages: number; agents: Record<string, number> } {
    const countRow = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM sessions) as totalSessions,
        (SELECT COUNT(*) FROM messages) as totalMessages
    `).get() as { totalSessions: number; totalMessages: number };

    const agentRows = this.db.prepare(`
      SELECT agent, COUNT(*) as count FROM sessions GROUP BY agent
    `).all() as Array<{ agent: string; count: number }>;

    const agents: Record<string, number> = {};
    for (const row of agentRows) {
      agents[row.agent] = row.count;
    }

    return {
      totalSessions: countRow.totalSessions,
      totalMessages: countRow.totalMessages,
      agents,
    };
  }

  public close(): void {
    this.db.close();
  }
}
