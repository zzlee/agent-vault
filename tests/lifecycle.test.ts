import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaultDB } from '../src/core/db.js';
import { LifecycleManager, parseTimeCutoff } from '../src/core/lifecycle.js';
import type { NormalizedSession } from '../src/core/types.js';

describe('LifecycleManager (Archive, Unarchive, Prune, Vacuum)', () => {
  let tmpDir: string;
  let testDataDir: string;
  let testArchiveDir: string;
  let testDbPath: string;
  let db: VaultDB;
  let manager: LifecycleManager;

  const mockSessionOld: NormalizedSession = {
    schema_version: '1.0',
    id: 'pi_test_old',
    agent: 'pi',
    machine: { id: 'test-mach', name: 'Test', hostname: 'host', platform: 'linux' },
    session: {
      native_id: 'old-sess',
      title: 'Old Archived Session',
      workspace: '/test/workspace',
      created_at: '2025-01-01T10:00:00.000Z',
      updated_at: '2025-01-01T12:00:00.000Z',
    },
    messages: [
      { id: 'm1', role: 'user', content: 'hello old', timestamp: '2025-01-01T10:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: 'hi old', timestamp: '2025-01-01T10:01:00.000Z' },
      {
        id: 'm3',
        role: 'tool',
        content: `[Tool Result: bash]\n${'x'.repeat(4000)}`,
        timestamp: '2025-01-01T10:02:00.000Z',
      },
    ],
  };

  const mockSessionRecent: NormalizedSession = {
    schema_version: '1.0',
    id: 'pi_test_recent',
    agent: 'pi',
    machine: { id: 'test-mach', name: 'Test', hostname: 'host', platform: 'linux' },
    session: {
      native_id: 'recent-sess',
      title: 'Recent Active Session',
      workspace: '/test/workspace',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    messages: [
      { id: 'm1', role: 'user', content: 'hello recent', timestamp: new Date().toISOString() },
      { id: 'm2', role: 'assistant', content: 'hi recent', timestamp: new Date().toISOString() },
    ],
  };

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-lifecycle-test-'));
    testDataDir = path.join(tmpDir, 'data', 'sessions');
    testArchiveDir = path.join(tmpDir, 'data', 'archive');
    testDbPath = path.join(tmpDir, 'vault.db');

    fs.mkdirSync(path.join(testDataDir, 'pi'), { recursive: true });

    fs.writeFileSync(
      path.join(testDataDir, 'pi', `${mockSessionOld.id}.json`),
      JSON.stringify(mockSessionOld, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(testDataDir, 'pi', `${mockSessionRecent.id}.json`),
      JSON.stringify(mockSessionRecent, null, 2),
      'utf-8'
    );

    db = new VaultDB(testDbPath);
    db.upsertSession(mockSessionOld, path.join(testDataDir, 'pi', `${mockSessionOld.id}.json`));
    db.upsertSession(mockSessionRecent, path.join(testDataDir, 'pi', `${mockSessionRecent.id}.json`));

    manager = new LifecycleManager(db, testDataDir, testArchiveDir);
  });

  after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses duration cutoffs and ISO dates correctly', () => {
    const cutoff30d = parseTimeCutoff('30d');
    const expectedApprox = Date.now() - 30 * 86400 * 1000;
    assert.ok(Math.abs(cutoff30d - expectedApprox) < 5000);

    const cutoffDate = parseTimeCutoff('2025-06-01');
    assert.equal(cutoffDate, new Date('2025-06-01').getTime());

    assert.throws(() => parseTimeCutoff('invalid-date-format'));
  });

  it('prunes oversized tool outputs from older sessions without deleting user messages', async () => {
    // Dry run first
    const dryRes = await manager.prune({
      olderThan: '30d',
      maxToolChars: 1000,
      dryRun: true,
    });
    assert.equal(dryRes.prunedSessions, 1);
    assert.equal(dryRes.prunedMessages, 1);
    assert.ok(dryRes.bytesSaved > 2500);

    // File should not be modified yet
    const rawBefore = fs.readFileSync(path.join(testDataDir, 'pi', `${mockSessionOld.id}.json`), 'utf-8');
    assert.ok(rawBefore.includes('x'.repeat(3000)));

    // Live prune
    const liveRes = await manager.prune({
      olderThan: '30d',
      maxToolChars: 1000,
      dryRun: false,
    });
    assert.equal(liveRes.prunedSessions, 1);
    assert.ok(liveRes.bytesSaved > 2500);

    // Verify pruned content
    const rawAfter = fs.readFileSync(path.join(testDataDir, 'pi', `${mockSessionOld.id}.json`), 'utf-8');
    const parsed = JSON.parse(rawAfter) as NormalizedSession;
    const toolMsg = parsed.messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg?.content.includes('omitted by agent-vault prune'));
    assert.ok(toolMsg!.content.length < 1500);
  });

  it('archives sessions older than cutoff, removing from DB and moving file to data/archive/', async () => {
    // Dry-run archive
    const dryRes = await manager.archive({
      before: '30d',
      dryRun: true,
    });
    assert.equal(dryRes.archivedSessions, 1);
    assert.equal(dryRes.sessions[0].id, mockSessionOld.id);
    assert.ok(fs.existsSync(path.join(testDataDir, 'pi', `${mockSessionOld.id}.json`)));

    // Live archive
    const liveRes = await manager.archive({
      before: '30d',
      dryRun: false,
    });
    assert.equal(liveRes.archivedSessions, 1);

    // Old session should now be in archive and NOT in sessions dir
    assert.ok(!fs.existsSync(path.join(testDataDir, 'pi', `${mockSessionOld.id}.json`)));
    assert.ok(fs.existsSync(path.join(testArchiveDir, 'pi', `${mockSessionOld.id}.json`)));

    // Recent session must remain untouched
    assert.ok(fs.existsSync(path.join(testDataDir, 'pi', `${mockSessionRecent.id}.json`)));

    // SQLite query should no longer return old session
    const oldInDb = db.getSession(mockSessionOld.id);
    assert.equal(oldInDb, null);

    const recentInDb = db.getSession(mockSessionRecent.id);
    assert.ok(recentInDb !== null);
  });

  it('unarchives session back to data/sessions/ and re-indexes into SQLite', async () => {
    const unarchiveRes = await manager.unarchive(mockSessionOld.id);
    assert.equal(unarchiveRes.success, true);
    assert.equal(unarchiveRes.sessionId, mockSessionOld.id);

    // File should be back in data/sessions/pi/
    assert.ok(fs.existsSync(path.join(testDataDir, 'pi', `${mockSessionOld.id}.json`)));
    assert.ok(!fs.existsSync(path.join(testArchiveDir, 'pi', `${mockSessionOld.id}.json`)));

    // Should be back in database
    const restored = db.getSession(mockSessionOld.id);
    assert.ok(restored !== null);
    assert.equal(restored?.session.title, mockSessionOld.session.title);
  });

  it('runs vacuum successfully on SQLite database', () => {
    const vacuumRes = manager.vacuum();
    assert.ok(typeof vacuumRes.beforeBytes === 'number');
    assert.ok(typeof vacuumRes.afterBytes === 'number');
    assert.ok(vacuumRes.afterBytes > 0);
  });
});
