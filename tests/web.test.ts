import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { VaultDB } from '../src/core/db.js';
import { startWebServer } from '../src/web/server.js';
import type { NormalizedSession } from '../src/core/types.js';

describe('Web Server & REST API', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: VaultDB;
  let server: http.Server;
  const port = 3989;
  const baseUrl = `http://127.0.0.1:${port}`;

  const mockSession: NormalizedSession = {
    schema_version: '1.0',
    id: 'pi_test-machine_ses-web-1',
    agent: 'pi',
    machine: {
      id: 'test-machine',
      name: 'TestMachine',
      hostname: 'testhost',
      platform: 'linux',
    },
    session: {
      native_id: 'ses-web-1',
      title: 'Fix Docker compilation pipeline error',
      workspace: '/home/user/project',
      created_at: '2026-09-10T10:00:00.000Z',
      updated_at: '2026-09-10T10:30:00.000Z',
    },
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Why is docker build failing with syntax error?',
        timestamp: '2026-09-10T10:00:01.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Here is the solution to fix your Dockerfile syntax error:\n```dockerfile\nFROM alpine:latest\n```',
        timestamp: '2026-09-10T10:00:15.000Z',
      },
      {
        id: 'msg-3',
        role: 'tool',
        content: 'ERROR: failed to solve: syntax error in Dockerfile line 4\n' + 'x'.repeat(2000),
        timestamp: '2026-09-10T10:00:20.000Z',
      },
    ],
  };

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-web-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    db = new VaultDB(dbPath);
    db.upsertSession(mockSession);
    db.close();

    server = await startWebServer({
      port,
      host: '127.0.0.1',
      dbPath,
    });
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('serves Web UI HTML at root /', async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { Accept: 'text/html' },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await res.text();
    assert.match(html, /Agent Vault/);
    assert.match(html, /id="search-input"/);
    assert.match(html, /id="results-container"/);

    // Verify embedded client JavaScript is syntactically valid
    const scriptStart = html.indexOf('<script>') + '<script>'.length;
    const scriptEnd = html.indexOf('</script>');
    assert.ok(scriptStart > 0 && scriptEnd > scriptStart);
    const clientJs = html.substring(scriptStart, scriptEnd);
    assert.doesNotThrow(() => {
      new Function(clientJs);
    }, 'Client JS inside <script> has syntax errors');
  });

  test('returns stats at /api/stats', async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.totalSessions, 1);
    assert.strictEqual(data.totalMessages, 3);
    assert.strictEqual(data.agents.pi, 1);
  });

  test('performs paged search at /api/search with highlights and filters', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=docker&agent=pi&role=user`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.total, 1);
    assert.strictEqual(data.page, 1);
    assert.strictEqual(data.results.length, 1);
    assert.strictEqual(data.results[0].agent, 'pi');
    assert.strictEqual(data.results[0].role, 'user');
    assert.match(data.results[0].snippet, /<mark>docker<\/mark>/i);
  });

  test('lists sessions at /api/sessions with pagination', async () => {
    const res = await fetch(`${baseUrl}/api/sessions?page=1&limit=10`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.total, 1);
    assert.strictEqual(data.sessions.length, 1);
    assert.strictEqual(data.sessions[0].id, mockSession.id);
  });

  test('returns session detail and messages at /api/sessions/:id', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(mockSession.id)}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.session.id, mockSession.id);
    assert.strictEqual(data.messages.length, 3);
  });

  test('supports filtering out tool messages at /api/sessions/:id?noTools=true', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(mockSession.id)}?noTools=true`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.messages.length, 2);
    assert.ok(!data.messages.some((m: any) => m.role === 'tool'));
  });

  test('returns 404 for nonexistent session at /api/sessions/:id', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent-id`);
    assert.strictEqual(res.status, 404);
  });

  test('lists workspaces at /api/workspaces', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces`);
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].workspace, '/home/user/project');
  });

  test('supports gzip compression for large JSON payloads', async () => {
    const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
      http.get(
        `${baseUrl}/api/sessions/${encodeURIComponent(mockSession.id)}`,
        {
          headers: { 'Accept-Encoding': 'gzip' },
        },
        (res) => {
          assert.strictEqual(res.statusCode, 200);
          assert.strictEqual(res.headers['content-encoding'], 'gzip');
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }
      );
    });

    const unzipped = zlib.gunzipSync(rawBuffer).toString('utf-8');
    const data = JSON.parse(unzipped);
    assert.strictEqual(data.session.id, mockSession.id);
  });
});
