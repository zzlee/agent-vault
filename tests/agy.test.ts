import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { AgyAdapter } from '../src/adapters/agy.js';

function writeTranscript(dir: string, name: string, lines: unknown[]): string {
  const logDir = path.join(dir, 'brain', 'conv-1', '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const fp = path.join(logDir, name);
  fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf-8');
  return fp;
}

describe('AgyAdapter improvements', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-vault-agy-test-'));
    const db = new Database(path.join(tmpDir, 'conversation_summaries.db'));
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        preview TEXT NOT NULL DEFAULT '',
        last_modified_time TEXT NOT NULL,
        last_user_input_time TEXT NOT NULL,
        workspace_uris TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO conversation_summaries (conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris) VALUES (?,?,?,?,?,?)`
    ).run(
      'conv-1',
      'Test convo',
      'preview',
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T09:00:00.000Z',
      JSON.stringify(['/work/proj'])
    );
    db.close();
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('prefers transcript_full.jsonl over truncated transcript.jsonl', async () => {
    writeTranscript(tmpDir, 'transcript.jsonl', [
      { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'short q', created_at: '2026-09-01T09:00:00Z', step_index: 0 },
      { type: 'GENERIC', source: 'MODEL', content: 'truncated', truncated_fields: ['content'], created_at: '2026-09-01T09:01:00Z', step_index: 1 },
    ]);
    writeTranscript(tmpDir, 'transcript_full.jsonl', [
      { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'full q', created_at: '2026-09-01T09:00:00Z', step_index: 0 },
      { type: 'GENERIC', source: 'MODEL', content: 'complete untruncated output', created_at: '2026-09-01T09:01:00Z', step_index: 1 },
    ]);

    const sessions = await new AgyAdapter(tmpDir).collect();
    assert.equal(sessions.length, 1);
    const contents = sessions[0].messages.map((m) => m.content).join('\n');
    assert.ok(contents.includes('full q'), 'should read from transcript_full.jsonl');
    assert.ok(contents.includes('complete untruncated output'));
    assert.ok(!contents.includes('short q'));
  });

  it('picks up orphaned brain transcripts missing from summaries', async () => {
    const logDir = path.join(tmpDir, 'brain', 'conv-orphan', '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'transcript.jsonl'),
      [
        JSON.stringify({ type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'orphan question here', created_at: '2026-08-01T09:00:00Z', step_index: 0 }),
        JSON.stringify({ type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'orphan answer', created_at: '2026-08-01T09:01:00Z', step_index: 1 }),
      ].join('\n'),
      'utf-8'
    );

    const sessions = await new AgyAdapter(tmpDir).collect();
    const orphan = sessions.find((s) => s.session.native_id === 'conv-orphan');
    assert.ok(orphan, 'orphan conversation should be collected');
    assert.ok(orphan.session.title.includes('orphan question here'));
    assert.equal(orphan.messages.length, 2);
  });
});
