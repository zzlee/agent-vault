import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaultDB } from '../src/core/db.js';
import type { NormalizedSession } from '../src/core/types.js';

function makeSession(
  id: string,
  nativeId: string,
  updatedAt: string,
  agent: NormalizedSession['agent'] = 'opencode'
): NormalizedSession {
  return {
    schema_version: '1.0',
    id,
    agent,
    machine: { id: 'devbox-1234', name: 'devbox', hostname: 'devbox', platform: 'linux' },
    session: {
      native_id: nativeId,
      title: `Session ${id}`,
      workspace: '/home/user/project',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: updatedAt,
    },
    messages: [{ id: `${id}-m1`, role: 'user', content: `hello from ${id}` }],
  };
}

test('resolveSessionId: exact and fuzzy session ID resolution', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-resolve-test-'));
  const db = new VaultDB(path.join(tmpDir, 'test.db'));

  t.after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  db.upsertSession(makeSession('opencode_devbox-1234_ses_abc123', 'ses_abc123', '2026-01-01T00:00:00.000Z'));
  db.upsertSession(makeSession('opencode_devbox-1234_ses_abd456', 'ses_abd456', '2026-02-01T00:00:00.000Z'));
  db.upsertSession(makeSession('pi_devbox-1234_pi-session-001', 'pi-session-001', '2026-03-01T00:00:00.000Z', 'pi'));
  db.upsertSession(makeSession('freebuff_devbox-1234_100%done', '100%done', '2026-04-01T00:00:00.000Z', 'freebuff'));

  await t.test('returns the exact match with exact: true', () => {
    const result = db.resolveSessionId('opencode_devbox-1234_ses_abc123');
    assert.equal(result.exact, true);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, 'opencode_devbox-1234_ses_abc123');
    assert.equal(result.matches[0].nativeId, 'ses_abc123');
    assert.equal(result.matches[0].machineName, 'devbox');
    assert.equal(result.matches[0].workspace, '/home/user/project');
  });

  await t.test('resolves a unique partial session ID', () => {
    const result = db.resolveSessionId('ses_abc1');
    assert.equal(result.exact, false);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, 'opencode_devbox-1234_ses_abc123');
  });

  await t.test('resolves a unique agent-native session ID', () => {
    const result = db.resolveSessionId('pi-session-001');
    assert.equal(result.exact, false);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, 'pi_devbox-1234_pi-session-001');
  });

  await t.test('returns all candidates for an ambiguous partial ID, newest first', () => {
    const result = db.resolveSessionId('opencode_devbox-1234_ses_ab');
    assert.equal(result.exact, false);
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].id, 'opencode_devbox-1234_ses_abd456');
    assert.equal(result.matches[1].id, 'opencode_devbox-1234_ses_abc123');
  });

  await t.test('trims surrounding whitespace', () => {
    const result = db.resolveSessionId('  ses_abc123  ');
    assert.equal(result.exact, false);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, 'opencode_devbox-1234_ses_abc123');
  });

  await t.test('treats LIKE wildcards as literal characters', () => {
    const percent = db.resolveSessionId('%');
    assert.equal(percent.matches.length, 1);
    assert.equal(percent.matches[0].id, 'freebuff_devbox-1234_100%done');

    const underscore = db.resolveSessionId('ses_abc123');
    assert.equal(underscore.matches.length, 1);
  });

  await t.test('returns no matches for unknown or empty IDs', () => {
    assert.deepEqual(db.resolveSessionId('does-not-exist'), { exact: false, matches: [] });
    assert.deepEqual(db.resolveSessionId('   '), { exact: false, matches: [] });
  });

  await t.test('getSession resolves a unique partial ID but rejects ambiguous ones', () => {
    const unique = db.getSession('ses_abc123');
    assert.ok(unique);
    assert.equal(unique.session.id, 'opencode_devbox-1234_ses_abc123');

    assert.equal(db.getSession('opencode_devbox-1234_ses_ab'), null);
    assert.equal(db.getSession('does-not-exist'), null);
  });
});
