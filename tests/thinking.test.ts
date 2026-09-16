import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaultDB } from '../src/core/db.js';
import type { NormalizedSession } from '../src/core/types.js';

test('Thinking Role & Legacy [Reasoning] Compatibility', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-thinking-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new VaultDB(dbPath);

  t.after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('indexes explicit role: thinking messages', () => {
    const session: NormalizedSession = {
      schema_version: '1.0',
      id: 'session_thinking_new',
      agent: 'pi',
      machine: { id: 'm1', name: 'devbox', hostname: 'devbox', platform: 'linux' },
      session: {
        native_id: 's1',
        title: 'Solving complex algorithms',
        workspace: '/home/user/algo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'How do I optimize Dijkstra with priority queue?',
        },
        {
          id: 'm2',
          role: 'thinking',
          content: 'Let me analyze the time complexity of min-heap versus Fibonacci heap in Dijkstra...',
        },
        {
          id: 'm3',
          role: 'assistant',
          content: 'You can use a binary min-heap to achieve O((V + E) log V).',
        },
      ],
    };

    db.upsertSession(session);

    // Search by query + role thinking
    const results = db.search('Fibonacci', { role: 'thinking' });
    assert.equal(results.length, 1);
    assert.equal(results[0].sessionId, 'session_thinking_new');
    assert.equal(results[0].role, 'thinking');

    // Filter getSession by role thinking
    const full = db.getSession('session_thinking_new', { role: 'thinking' });
    assert.ok(full);
    assert.equal(full.messages.length, 1);
    assert.equal(full.messages[0].role, 'thinking');
    assert.ok(full.messages[0].content.includes('Fibonacci heap'));
  });

  await t.test('automatically normalizes legacy [Reasoning] messages to role: thinking in DB', () => {
    const legacySession: NormalizedSession = {
      schema_version: '1.0',
      id: 'session_legacy_reasoning',
      agent: 'codex',
      machine: { id: 'm2', name: 'thinkpad', hostname: 'thinkpad', platform: 'linux' },
      session: {
        native_id: 's2',
        title: 'Legacy session with reasoning prefix',
        workspace: '/home/user/legacy',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      messages: [
        {
          id: 'l1',
          role: 'user',
          content: 'Debug this memory leak in Node.js',
        },
        {
          id: 'l2',
          role: 'assistant',
          content: '[Reasoning]\nInspecting V8 heap snapshot to locate event listener leak',
        },
        {
          id: 'l3',
          role: 'assistant',
          content: 'The leak is caused by unclosed EventEmitter listeners.',
        },
      ],
    };

    db.upsertSession(legacySession);

    // Should find the legacy reasoning block when searching with role: 'thinking'
    const results = db.search('snapshot', { role: 'thinking' });
    assert.equal(results.length, 1);
    assert.equal(results[0].sessionId, 'session_legacy_reasoning');
    assert.equal(results[0].role, 'thinking');

    // getSession with role: 'thinking' should return it as thinking without [Reasoning] prefix
    const full = db.getSession('session_legacy_reasoning', { role: 'thinking' });
    assert.ok(full);
    assert.equal(full.messages.length, 1);
    assert.equal(full.messages[0].role, 'thinking');
    assert.equal(full.messages[0].content, 'Inspecting V8 heap snapshot to locate event listener leak');
  });
});
