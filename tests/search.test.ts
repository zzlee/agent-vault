import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaultDB } from '../src/core/db.js';
import type { NormalizedSession } from '../src/core/types.js';

function makeSession(id: string, contents: Array<[string, string]>): NormalizedSession {
  return {
    schema_version: '1.0',
    id,
    agent: 'pi',
    machine: { id: 'm1', name: 'M', hostname: 'h', platform: 'linux' },
    session: {
      native_id: id,
      title: `Title ${id}`,
      workspace: '/w',
      created_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-01T12:00:00.000Z',
    },
    messages: contents.map(([mid, content], i) => ({
      id: mid,
      role: 'user' as const,
      content,
      timestamp: '2026-09-01T10:00:00.000Z',
      step_index: i,
    })),
  };
}

describe('Search groups by conversation', () => {
  let tmpDir: string;
  let db: VaultDB;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-vault-search-test-'));
    db = new VaultDB(path.join(tmpDir, 'vault.db'));
    db.upsertSession(
      makeSession('sessA', [
        ['a1', 'docker compose up fails with plugin error'],
        ['a2', 'tried docker compose again still failing'],
        ['a3', 'unrelated weather discussion'],
      ])
    );
    db.upsertSession(makeSession('sessB', [['b1', 'docker compose works fine here']]));
    db.upsertSession(makeSession('sessC', [['c1', 'kubernetes deployment notes']]));
  });

  after(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns one row per session with matchCount', () => {
    const results = db.search('docker compose');
    const ids = results.map((r) => r.sessionId).sort();
    assert.deepEqual(ids, ['sessA', 'sessB']);
    const a = results.find((r) => r.sessionId === 'sessA')!;
    assert.equal(a.matchCount, 2);
    assert.equal(results.find((r) => r.sessionId === 'sessB')!.matchCount, 1);
    assert.ok(a.snippet.length > 0);
  });

  it('searchPaged counts sessions not messages', () => {
    const paged = db.searchPaged('docker compose', { limit: 1 });
    assert.equal(paged.total, 2);
    assert.equal(paged.totalPages, 2);
    assert.equal(paged.results.length, 1);
    assert.ok(paged.results[0].matchCount >= 1);

    const page2 = db.searchPaged('docker compose', { limit: 1, page: 2 });
    assert.equal(page2.results.length, 1);
    assert.notEqual(page2.results[0].sessionId, paged.results[0].sessionId);
  });
});
