import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { VaultDB } from '../src/core/db.js';
import { startMcpHttpServer } from '../src/mcp/server.js';
import type { NormalizedSession } from '../src/core/types.js';

function makeSession(id: string, nativeId: string, updatedAt: string): NormalizedSession {
  return {
    schema_version: '1.0',
    id,
    agent: 'opencode',
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

describe('MCP vault_get_session partial ID resolution', () => {
  let server: http.Server;
  let tmpDir: string;
  let client: Client;
  const port = 3988;
  const host = '127.0.0.1';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-mcp-fuzzy-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const db = new VaultDB(dbPath);
    db.upsertSession(makeSession('opencode_devbox-1234_ses_abc123', 'ses_abc123', '2026-01-01T00:00:00.000Z'));
    db.upsertSession(makeSession('opencode_devbox-1234_ses_abd456', 'ses_abd456', '2026-02-01T00:00:00.000Z'));
    db.close();

    server = await startMcpHttpServer({ port, host, dbPath });

    client = new Client({ name: 'test-fuzzy-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`)));
  });

  after(async () => {
    await client.close();
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves a unique partial session ID and reports resolvedFrom', async () => {
    const res = await client.callTool({ name: 'vault_get_session', arguments: { sessionId: 'ses_abc1' } });
    assert.equal(res.isError, undefined);
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.resolvedFrom, 'ses_abc1');
    assert.equal(data.session.id, 'opencode_devbox-1234_ses_abc123');
    assert.equal(data.messages.length, 1);
  });

  it('returns the session without resolvedFrom for an exact ID', async () => {
    const res = await client.callTool({
      name: 'vault_get_session',
      arguments: { sessionId: 'opencode_devbox-1234_ses_abc123' },
    });
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.resolvedFrom, undefined);
    assert.equal(data.session.id, 'opencode_devbox-1234_ses_abc123');
  });

  it('returns candidate list when a partial ID is ambiguous', async () => {
    const res = await client.callTool({
      name: 'vault_get_session',
      arguments: { sessionId: 'opencode_devbox-1234_ses_ab' },
    });
    assert.equal(res.isError, true);
    const data = JSON.parse(res.content[0].text);
    assert.match(data.error, /Multiple sessions match/);
    assert.equal(data.candidates.length, 2);
    assert.equal(data.candidates[0].id, 'opencode_devbox-1234_ses_abd456');
  });

  it('reports not found for an unknown ID', async () => {
    const res = await client.callTool({ name: 'vault_get_session', arguments: { sessionId: 'nope' } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Session not found: nope/);
  });
});
