import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { CodexAdapter } from '../src/adapters/codex.js';

describe('CodexAdapter', () => {
  let tmpDir: string;
  let sessionsDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-vault-codex-test-'));
    sessionsDir = path.join(tmpDir, 'sessions', '2026', '03', '15');
    fs.mkdirSync(sessionsDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('has name "codex"', () => {
    const adapter = new CodexAdapter(tmpDir);
    assert.equal(adapter.name, 'codex');
  });

  it('reports availability correctly', () => {
    const availableAdapter = new CodexAdapter(tmpDir);
    assert.equal(availableAdapter.isAvailable(), true);

    const nonExistentDir = path.join(os.tmpdir(), 'non-existent-' + Date.now());
    const unavailableAdapter = new CodexAdapter(nonExistentDir);
    assert.equal(unavailableAdapter.isAvailable(), false);
  });

  it('parses rollout JSONL session with user, assistant, tool call/output, and reasoning', async () => {
    const rolloutId = '019c88cd-63d3-7a33-a9c3-fc1907592f78';
    const rolloutFileName = `rollout-2026-03-15T10-00-00-${rolloutId}.jsonl`;
    const rolloutPath = path.join(sessionsDir, rolloutFileName);

    const lines = [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: rolloutId,
          cwd: '/home/test/my-project',
          timestamp: '2026-03-15T10:00:00.000Z',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-03-15T10:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Can you check my API token ghp_123456789012345678901234567890123456 and fix the bug?',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-15T10:00:02.000Z',
        payload: {
          type: 'reasoning',
          summary: [{ type: 'text', text: 'Inspecting repository and identifying the token.' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-15T10:00:03.000Z',
        payload: {
          type: 'function_call',
          call_id: 'call_abc123',
          name: 'shell',
          arguments: { command: 'git status' },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-15T10:00:04.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call_abc123',
          output: 'On branch main\nnothing to commit',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-15T10:00:05.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'I checked the status, your branch is clean.' }],
        },
      }),
    ];

    fs.writeFileSync(rolloutPath, lines.join('\n'), 'utf-8');

    const adapter = new CodexAdapter(tmpDir);
    const sessions = await adapter.collect();

    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.agent, 'codex');
    assert.equal(s.session.native_id, rolloutId);
    assert.equal(s.session.workspace, '/home/test/my-project');
    assert.ok(s.session.title.includes('Can you check my API token'));

    // Check message count & roles
    assert.equal(s.messages.length, 5);

    // 1. User message (token sanitized)
    assert.equal(s.messages[0].role, 'user');
    assert.ok(s.messages[0].content.includes('[REDACTED_GITHUB_TOKEN]'));
    assert.ok(!s.messages[0].content.includes('ghp_1234567890'));

    // 2. Reasoning
    assert.equal(s.messages[1].role, 'assistant');
    assert.ok(s.messages[1].content.includes('[Reasoning]'));
    assert.ok(s.messages[1].content.includes('Inspecting repository'));

    // 3. Tool call
    assert.equal(s.messages[2].role, 'assistant');
    assert.ok(s.messages[2].has_tool_calls);
    assert.ok(s.messages[2].content.includes('[Tool Call: shell]'));

    // 4. Tool output
    assert.equal(s.messages[3].role, 'tool');
    assert.ok(s.messages[3].content.includes('[Tool Result: shell]'));
    assert.ok(s.messages[3].content.includes('On branch main'));

    // 5. Assistant response
    assert.equal(s.messages[4].role, 'assistant');
    assert.ok(s.messages[4].content.includes('your branch is clean'));
  });

  it('ignores empty rollout files without valid user or assistant turns', async () => {
    const emptyRolloutPath = path.join(sessionsDir, 'rollout-2026-03-15T11-00-00-019c88cd-empty-0000-0000-000000000000.jsonl');
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: '019c88cd-empty-0000-0000-000000000000', cwd: '/empty' },
      }),
    ];
    fs.writeFileSync(emptyRolloutPath, lines.join('\n'), 'utf-8');

    const adapter = new CodexAdapter(tmpDir);
    const sessions = await adapter.collect();
    // Only the non-empty session from previous test should be returned
    assert.equal(sessions.filter((s) => s.session.native_id.includes('empty')).length, 0);
  });

  it('reads metadata from state_5.sqlite when available', async () => {
    const dbPath = path.join(tmpDir, 'state_5.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT,
        cwd TEXT,
        title TEXT,
        first_user_message TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        created_at_ms INTEGER,
        updated_at_ms INTEGER
      );
    `);

    const threadId = '019c9999-state-db-test-0000-000000000000';
    const rolloutFile = `rollout-2026-03-15T12-00-00-${threadId}.jsonl`;
    const fullRolloutPath = path.join(sessionsDir, rolloutFile);

    db.prepare(`
      INSERT INTO threads (id, rollout_path, cwd, title, first_user_message, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      threadId,
      fullRolloutPath,
      '/custom/sqlite/workspace',
      'SQLite Thread Title',
      'First User Question',
      1773570000000,
      1773571000000
    );
    db.close();

    const lines = [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: threadId, cwd: '/different/cwd' },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Hello from SQLite thread!' },
      }),
    ];
    fs.writeFileSync(fullRolloutPath, lines.join('\n'), 'utf-8');

    const adapter = new CodexAdapter(tmpDir);
    const sessions = await adapter.collect();
    const threadSession = sessions.find((s) => s.session.native_id === threadId);

    assert.ok(threadSession);
    assert.equal(threadSession.session.title, 'SQLite Thread Title');
    assert.equal(threadSession.session.workspace, '/custom/sqlite/workspace');
  });

  it('supports incremental sync skipping unchanged files', async () => {
    const adapter = new CodexAdapter(tmpDir);
    const allSessions = await adapter.collect();
    const target = allSessions[0];

    const existingSessions = new Map<string, { id: string; updatedAt: string; messageCount: number }>();
    existingSessions.set(target.id, {
      id: target.id,
      updatedAt: new Date(Date.now() + 60000).toISOString(),
      messageCount: 5,
    });

    const incrementalSessions = await adapter.collect({ existingSessions });
    const skipped = incrementalSessions.find((s) => s.id === target.id);
    assert.ok(skipped);
    assert.equal(skipped.messages.length, 5); // placeholder array length
    assert.equal(skipped.session.title, '');   // lightweight placeholder
  });
});
