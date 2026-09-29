import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { OpenCodeAdapter } from '../src/adapters/opencode.js';

function createV2Db(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      title TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      seq INTEGER NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  const t0 = 1790686877303;
  db.prepare(`INSERT INTO session_v2 (id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`)
    .run('ses_v2test001', '/home/test/proj', 'V2 session title', t0, t0 + 5000);

  const insert = db.prepare(
    `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const sid = 'ses_v2test001';

  insert.run('msg_u1', sid, 'user', 1, t0 + 10, t0 + 10, JSON.stringify({ text: 'Fix docker compose error' }));
  insert.run(
    'msg_a1',
    sid,
    'assistant',
    2,
    t0 + 20,
    t0 + 30,
    JSON.stringify({
      content: [
        { type: 'reasoning', text: 'Need to check compose plugin.' },
        { type: 'text', text: 'The compose plugin is missing.' },
        {
          type: 'tool',
          name: 'bash',
          state: {
            status: 'completed',
            input: { command: 'docker compose up' },
            content: [{ type: 'text', text: 'docker: unknown command' }],
            metadata: { output: 'docker: unknown command', exit: 1 },
          },
        },
      ],
    })
  );
  insert.run(
    'msg_a2',
    sid,
    'assistant',
    3,
    t0 + 40,
    t0 + 50,
    JSON.stringify({
      content: [
        {
          type: 'tool',
          name: 'read',
          state: { status: 'error', input: { filePath: '/x.ts' }, error: { message: 'File not found' } },
        },
      ],
    })
  );
  // system catalog + idle lifecycle rows must be skipped
  insert.run('msg_sys', sid, 'system', 4, t0 + 60, t0 + 60, JSON.stringify({ text: 'The Code Mode tool catalog...' }));
  insert.run('msg_idle', sid, 'idle', 5, t0 + 70, t0 + 70, JSON.stringify({ outcome: 'succeeded' }));
  // compaction summary kept as truncated system message
  insert.run(
    'msg_cmp',
    sid,
    'compaction',
    6,
    t0 + 80,
    t0 + 80,
    JSON.stringify({ status: 'completed', summary: '## Goal\nSummarized context here' })
  );
  db.close();
}

describe('OpenCodeAdapter v2', () => {
  let tmpDir: string;
  let dbPath: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-vault-opencode-test-'));
    dbPath = path.join(tmpDir, 'opencode.db');
    createV2Db(dbPath);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('has name "opencode" and detects db', () => {
    const adapter = new OpenCodeAdapter(dbPath);
    assert.equal(adapter.name, 'opencode');
    assert.equal(adapter.isAvailable(), true);
    assert.equal(new OpenCodeAdapter(path.join(tmpDir, 'nope.db')).isAvailable(), false);
  });

  it('parses v2 user/assistant/reasoning/tool messages', async () => {
    const sessions = await new OpenCodeAdapter(dbPath).collect();
    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.session.native_id, 'ses_v2test001');
    assert.equal(s.session.title, 'V2 session title');
    assert.equal(s.session.workspace, '/home/test/proj');

    const roles = s.messages.map((m) => m.role);
    assert.deepEqual(roles, ['user', 'thinking', 'assistant', 'assistant', 'system']);

    assert.ok(s.messages[0].content.includes('Fix docker compose error'));
    assert.equal(s.messages[1].role, 'thinking');
    assert.ok(s.messages[1].content.includes('Need to check compose plugin'));

    assert.ok(s.messages[2].content.includes('The compose plugin is missing.'));
    assert.ok(s.messages[2].content.includes('[Tool Call: bash]'));
    assert.ok(s.messages[2].content.includes('docker compose up'));
    assert.ok(s.messages[2].content.includes('docker: unknown command'));
    assert.equal(s.messages[2].has_tool_calls, true);

    // error-status tool surfaces the error message
    assert.ok(s.messages[3].content.includes('[Tool Call: read]'));
    assert.ok(s.messages[3].content.includes('File not found'));

    // compaction summary kept as system message
    assert.ok(s.messages[4].content.includes('Summarized context here'));
  });

  it('truncates oversized compaction summaries', async () => {
    const db2Path = path.join(tmpDir, 'opencode-big.db');
    const db = new Database(db2Path);
    db.exec(`
      CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
      CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    `);
    const t = 1790686900000;
    db.prepare(`INSERT INTO session_v2 (id, directory, title, time_created, time_updated) VALUES (?,?,?,?,?)`)
      .run('ses_big', '/w', null, t, t);
    db.prepare(`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?,?,?,?,?,?,?)`).run(
      'm1',
      'ses_big',
      'compaction',
      1,
      t,
      t,
      JSON.stringify({ summary: 'x'.repeat(20000) })
    );
    db.close();

    const sessions = await new OpenCodeAdapter(db2Path).collect();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].session.title, 'Session ses_big');
    assert.ok(sessions[0].messages[0].content.length < 20000);
    assert.ok(sessions[0].messages[0].content.includes('[truncated'));
  });

  it('falls back to legacy session/message/part tables', async () => {
    const db3Path = path.join(tmpDir, 'opencode-v1.db');
    const db = new Database(db3Path);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
    `);
    const t = 1787390571068;
    db.prepare(`INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?,?,?,?,?)`).run(
      'ses_legacy1',
      'Legacy title',
      '/legacy',
      t,
      t + 100
    );
    db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)`).run(
      'm_u1',
      'ses_legacy1',
      t,
      JSON.stringify({ role: 'user' })
    );
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?,?,?,?,?)`).run(
      'p1',
      'm_u1',
      'ses_legacy1',
      t,
      JSON.stringify({ type: 'text', text: 'hello legacy' })
    );
    db.close();

    const sessions = await new OpenCodeAdapter(db3Path).collect();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].session.title, 'Legacy title');
    assert.equal(sessions[0].messages[0].role, 'user');
    assert.ok(sessions[0].messages[0].content.includes('hello legacy'));
  });

  it('supports incremental sync with metadata-preserving placeholders', async () => {
    const adapter = new OpenCodeAdapter(dbPath);
    const all = await adapter.collect();
    const target = all[0];
    const existing = new Map([[target.id, { id: target.id, updatedAt: target.session.updated_at, messageCount: 5 }]]);
    const second = await adapter.collect({ existingSessions: existing });
    const skipped = second.find((s) => s.id === target.id);
    assert.ok(skipped);
    assert.equal(skipped.messages.length, 5);
    assert.equal(skipped.session.updated_at, target.session.updated_at);
  });
});
