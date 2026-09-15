import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { NormalizedSession, SearchResult, SessionSummary, WorkspaceSummary } from './types.js';
import { getDbPath } from './paths.js';

export class VaultDB {
  private db: DatabaseType;
  private upsertSessionStmt?: Statement;
  private insertSessionStmt?: Statement;
  private deleteMessagesStmt?: Statement;
  private deleteFtsStmt?: Statement;
  private insertMsgStmt?: Statement;
  private insertFtsStmt?: Statement;

  constructor(dbPath?: string) {
    const finalPath = dbPath || getDbPath();
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });

    this.db = new Database(finalPath, { timeout: 10000 });
    this.db.pragma('busy_timeout = 10000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -64000');
    this.db.pragma('mmap_size = 268435456');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    // In-place schema migration for older databases
    const tableExists = this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`).get();
    if (tableExists) {
      const cols = this.db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'machine_id')) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN machine_id TEXT NOT NULL DEFAULT '';`);
      }
      if (!cols.some((c) => c.name === 'machine_name')) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN machine_name TEXT NOT NULL DEFAULT '';`);
      }
    }

    // Check if search_fts has the old shadow content table search_fts_content
    const hasShadowContent = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='search_fts_content'`
    ).get();

    if (hasShadowContent) {
      // Migrate from internal-content FTS5 to external-content view table, saving ~600MB
      this.db.exec(`
        DROP TABLE IF EXISTS search_fts;
        DROP VIEW IF EXISTS message_view;
        CREATE VIEW message_view AS
        SELECT m.rowid AS rowid, s.title AS title, s.workspace AS workspace, m.content AS content
        FROM messages m
        JOIN sessions s ON s.id = m.session_id;

        CREATE VIRTUAL TABLE search_fts USING fts5(
          title,
          workspace,
          content,
          content='message_view',
          content_rowid='rowid',
          tokenize='unicode61'
        );

        INSERT INTO search_fts(rowid, title, workspace, content)
        SELECT rowid, title, workspace, content FROM message_view;

        VACUUM;
      `);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        machine_name TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_sessions_machine_id ON sessions(machine_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_machine_name ON sessions(machine_name);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace);
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

      CREATE VIEW IF NOT EXISTS message_view AS
      SELECT m.rowid AS rowid, s.title AS title, s.workspace AS workspace, m.content AS content
      FROM messages m
      JOIN sessions s ON s.id = m.session_id;

      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        title,
        workspace,
        content,
        content='message_view',
        content_rowid='rowid',
        tokenize = 'unicode61'
      );
    `);
  }

  private ensurePreparedStatements(): void {
    if (this.upsertSessionStmt) return;

    this.upsertSessionStmt = this.db.prepare(`
      INSERT INTO sessions (
        id, agent, machine_id, machine_name, hostname, platform, native_id, title, workspace,
        created_at, updated_at, message_count, file_path
      ) VALUES (
        @id, @agent, @machine_id, @machine_name, @hostname, @platform, @native_id, @title, @workspace,
        @created_at, @updated_at, @message_count, @file_path
      )
      ON CONFLICT(id) DO UPDATE SET
        machine_id = excluded.machine_id,
        machine_name = excluded.machine_name,
        title = excluded.title,
        workspace = excluded.workspace,
        updated_at = excluded.updated_at,
        message_count = excluded.message_count,
        file_path = excluded.file_path
    `);

    this.insertSessionStmt = this.db.prepare(`
      INSERT INTO sessions (
        id, agent, machine_id, machine_name, hostname, platform, native_id, title, workspace,
        created_at, updated_at, message_count, file_path
      ) VALUES (
        @id, @agent, @machine_id, @machine_name, @hostname, @platform, @native_id, @title, @workspace,
        @created_at, @updated_at, @message_count, @file_path
      )
    `);

    this.deleteFtsStmt = this.db.prepare(`
      INSERT INTO search_fts(search_fts, rowid, title, workspace, content)
      SELECT 'delete', m.rowid, s.title, s.workspace, m.content
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE s.id = ?
    `);

    this.deleteMessagesStmt = this.db.prepare(`DELETE FROM messages WHERE session_id = ?`);

    this.insertMsgStmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp, step_index, has_tool_calls)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        role = excluded.role,
        content = excluded.content,
        timestamp = excluded.timestamp,
        step_index = excluded.step_index,
        has_tool_calls = excluded.has_tool_calls
    `);

    this.insertFtsStmt = this.db.prepare(`
      INSERT INTO search_fts (rowid, title, workspace, content)
      VALUES (?, ?, ?, ?)
    `);
  }

  public clearAll(): void {
    this.db.exec(`
      DELETE FROM messages;
      DELETE FROM sessions;
      DROP TABLE IF EXISTS search_fts;
      DROP VIEW IF EXISTS message_view;
      CREATE VIEW message_view AS
      SELECT m.rowid AS rowid, s.title AS title, s.workspace AS workspace, m.content AS content
      FROM messages m
      JOIN sessions s ON s.id = m.session_id;

      CREATE VIRTUAL TABLE search_fts USING fts5(
        title,
        workspace,
        content,
        content='message_view',
        content_rowid='rowid',
        tokenize = 'unicode61'
      );
    `);
    this.deleteFtsStmt = undefined;
    this.insertFtsStmt = undefined;
  }

  private doInsertSessionContent(session: NormalizedSession, filePath?: string, isFresh: boolean = false): void {
    this.ensurePreparedStatements();

    const sessionParams = {
      id: session.id,
      agent: session.agent,
      machine_id: session.machine?.id || session.machine?.hostname || 'unknown',
      machine_name: session.machine?.name || session.machine?.hostname || 'unknown',
      hostname: session.machine?.hostname || 'unknown',
      platform: session.machine?.platform || '',
      native_id: session.session.native_id,
      title: session.session.title || '(untitled)',
      workspace: session.session.workspace || '',
      created_at: session.session.created_at,
      updated_at: session.session.updated_at,
      message_count: session.messages.length,
      file_path: filePath || '',
    };

    if (isFresh) {
      this.insertSessionStmt!.run(sessionParams);
    } else {
      this.upsertSessionStmt!.run(sessionParams);
      this.deleteFtsStmt!.run(session.id);
      this.deleteMessagesStmt!.run(session.id);
    }

    const seenMsgIds = new Set<string>();

    for (const msg of session.messages) {
      let msgId = msg.id;
      let globalMsgId = `${session.id}:${msgId}`;
      let suffix = 1;
      while (seenMsgIds.has(globalMsgId)) {
        msgId = `${msg.id}_${suffix++}`;
        globalMsgId = `${session.id}:${msgId}`;
      }
      seenMsgIds.add(globalMsgId);

      const info = this.insertMsgStmt!.run(
        globalMsgId,
        session.id,
        msg.role,
        msg.content,
        msg.timestamp || null,
        msg.step_index ?? null,
        msg.has_tool_calls ? 1 : 0
      );

      if (msg.content && msg.content.trim()) {
        this.insertFtsStmt!.run(
          info.lastInsertRowid,
          session.session.title || '',
          session.session.workspace || '',
          msg.content
        );
      }
    }
  }

  public upsertSession(session: NormalizedSession, filePath?: string): void {
    if (this.db.inTransaction) {
      this.doInsertSessionContent(session, filePath, false);
    } else {
      this.db.transaction(() => {
        this.doInsertSessionContent(session, filePath, false);
      })();
    }
  }

  public deleteSession(id: string): void {
    this.ensurePreparedStatements();
    const runDelete = () => {
      this.deleteFtsStmt!.run(id);
      this.deleteMessagesStmt!.run(id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    };

    if (this.db.inTransaction) {
      runDelete();
    } else {
      this.db.transaction(runDelete)();
    }
  }

  public vacuum(): void {
    this.db.exec('VACUUM;');
  }

  public insertSessionsBatch(items: Array<{ session: NormalizedSession; filePath?: string }>, isFresh: boolean = true): void {
    const tx = this.db.transaction(() => {
      for (const item of items) {
        this.doInsertSessionContent(item.session, item.filePath, isFresh);
      }
    });
    tx();
  }

  public search(
    query: string,
    options: {
      agent?: string;
      machine?: string;
      workspace?: string;
      role?: string;
      limit?: number;
      since?: string;
      until?: string;
      highlight?: { open: string; close: string };
    } = {}
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

    const openTag = options.highlight?.open ?? '\x1b[33m\x1b[1m';
    const closeTag = options.highlight?.close ?? '\x1b[0m';

    let sql = `
      SELECT 
        s.id AS sessionId,
        s.agent,
        s.machine_id AS machineId,
        s.machine_name AS machineName,
        s.title,
        s.workspace,
        s.updated_at AS updatedAt,
        m.role,
        snippet(search_fts, -1, ?, ?, '...', 25) AS snippet
      FROM search_fts
      JOIN messages m ON m.rowid = search_fts.rowid
      JOIN sessions s ON s.id = m.session_id
      WHERE search_fts MATCH ?
    `;

    const params: unknown[] = [openTag, closeTag, sanitizedQuery];

    if (options.agent) {
      sql += ` AND s.agent = ?`;
      params.push(options.agent);
    }
    if (options.machine) {
      sql += ` AND (s.machine_id LIKE ? OR s.machine_name LIKE ?)`;
      params.push(`%${options.machine}%`, `%${options.machine}%`);
    }
    if (options.workspace) {
      sql += ` AND s.workspace LIKE ?`;
      params.push(`%${options.workspace}%`);
    }
    if (options.role) {
      sql += ` AND LOWER(m.role) = ?`;
      params.push(options.role.toLowerCase());
    }
    if (options.since) {
      sql += ` AND s.updated_at >= ?`;
      params.push(options.since);
    }
    if (options.until) {
      sql += ` AND s.updated_at <= ?`;
      params.push(options.until);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as SearchResult[];
  }

  public listWorkspaces(options: { limit?: number; search?: string } = {}): WorkspaceSummary[] {
    const limit = options.limit || 50;
    let sql = `
      SELECT 
        workspace,
        COUNT(*) as sessionCount,
        MAX(updated_at) as lastUpdatedAt,
        GROUP_CONCAT(DISTINCT agent) as agents
      FROM sessions
      WHERE workspace IS NOT NULL AND TRIM(workspace) != ''
    `;
    const params: unknown[] = [];

    if (options.search) {
      sql += ` AND workspace LIKE ?`;
      params.push(`%${options.search}%`);
    }

    sql += ` GROUP BY workspace ORDER BY lastUpdatedAt DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      workspace: string;
      sessionCount: number;
      lastUpdatedAt: string;
      agents: string;
    }>;

    return rows.map((r) => ({
      workspace: r.workspace,
      sessionCount: r.sessionCount,
      agents: (r.agents ? r.agents.split(',') : []) as any,
      lastUpdatedAt: r.lastUpdatedAt,
    }));
  }

  public listSessions(options: { agent?: string; machine?: string; workspace?: string; limit?: number } = {}): SessionSummary[] {
    const limit = options.limit || 25;
    let sql = `
      SELECT 
        id, agent, machine_id AS machineId, machine_name AS machineName, native_id AS nativeId, title, workspace,
        created_at AS createdAt, updated_at AS updatedAt, message_count AS messageCount
      FROM sessions
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (options.agent) {
      sql += ` AND agent = ?`;
      params.push(options.agent);
    }
    if (options.machine) {
      sql += ` AND (machine_id LIKE ? OR machine_name LIKE ?)`;
      params.push(`%${options.machine}%`, `%${options.machine}%`);
    }
    if (options.workspace) {
      sql += ` AND workspace LIKE ?`;
      params.push(`%${options.workspace}%`);
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as SessionSummary[];
  }

  public getSessionMeta(id: string): { id: string; updatedAt: string; messageCount: number } | null {
    const row = this.db.prepare(`
      SELECT id, updated_at AS updatedAt, message_count AS messageCount
      FROM sessions
      WHERE id = ?
    `).get(id) as { id: string; updatedAt: string; messageCount: number } | undefined;
    return row || null;
  }

  public getSessionMetaMap(agent?: string): Map<string, { id: string; updatedAt: string; messageCount: number }> {
    let sql = `SELECT id, updated_at AS updatedAt, message_count AS messageCount FROM sessions`;
    const params: unknown[] = [];
    if (agent) {
      sql += ` WHERE agent = ?`;
      params.push(agent);
    }
    const rows = this.db.prepare(sql).all(...params) as Array<{ id: string; updatedAt: string; messageCount: number }>;
    const map = new Map<string, { id: string; updatedAt: string; messageCount: number }>();
    for (const r of rows) {
      map.set(r.id, r);
    }
    return map;
  }

  public getSession(
    id: string,
    options: { role?: string; noTools?: boolean } = {}
  ): { session: SessionSummary; messages: any[] } | null {
    const session = this.db.prepare(`
      SELECT 
        id, agent, machine_id AS machineId, machine_name AS machineName, native_id AS nativeId, title, workspace,
        created_at AS createdAt, updated_at AS updatedAt, message_count AS messageCount, file_path AS filePath
      FROM sessions
      WHERE id = ?
    `).get(id) as SessionSummary | undefined;

    if (!session) return null;

    let msgSql = `
      SELECT id, role, content, timestamp, step_index AS stepIndex, has_tool_calls AS hasToolCalls
      FROM messages
      WHERE session_id = ?
    `;
    const msgParams: unknown[] = [id];

    if (options.role) {
      msgSql += ` AND LOWER(role) = ?`;
      msgParams.push(options.role.toLowerCase());
    }
    if (options.noTools) {
      msgSql += ` AND LOWER(role) != 'tool'`;
    }

    msgSql += ` ORDER BY step_index ASC, timestamp ASC`;

    const messages = this.db.prepare(msgSql).all(...msgParams);

    return { session, messages };
  }

  public getStats(): { totalSessions: number; totalMessages: number; agents: Record<string, number>; machines: Record<string, number> } {
    const countRow = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM sessions) as totalSessions,
        (SELECT COUNT(*) FROM messages) as totalMessages
    `).get() as { totalSessions: number; totalMessages: number };

    const agentRows = this.db.prepare(`
      SELECT agent, COUNT(*) as count FROM sessions GROUP BY agent
    `).all() as Array<{ agent: string; count: number }>;

    const machineRows = this.db.prepare(`
      SELECT machine_name, COUNT(*) as count FROM sessions GROUP BY machine_name
    `).all() as Array<{ machine_name: string; count: number }>;

    const agents: Record<string, number> = {};
    for (const row of agentRows) {
      agents[row.agent] = row.count;
    }

    const machines: Record<string, number> = {};
    for (const row of machineRows) {
      machines[row.machine_name] = row.count;
    }

    return {
      totalSessions: countRow.totalSessions,
      totalMessages: countRow.totalMessages,
      agents,
      machines,
    };
  }

  public close(): void {
    this.db.close();
  }
}
