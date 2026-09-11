import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { startMcpHttpServer } from '../src/mcp/server.js';

describe('MCP Server (Streamable HTTP & SSE)', () => {
  let server: http.Server;
  const port = 3987;
  const host = '127.0.0.1';

  before(async () => {
    server = await startMcpHttpServer({ port, host });
  });

  after(() => {
    server.close();
  });

  it('responds to health check endpoint', async () => {
    const res = await fetch(`http://${host}:${port}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.name, 'agent-vault-mcp');
    assert.ok(data.endpoints.streamableHttp);
    assert.ok(data.endpoints.sse);
  });

  it('supports modern Streamable HTTP client (/mcp) with tools listing and execution', async () => {
    const client = new Client({ name: 'test-streamable-client', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`));

    await client.connect(transport);

    // List tools
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    assert.ok(toolNames.includes('vault_search'));
    assert.ok(toolNames.includes('vault_get_stats'));
    assert.ok(toolNames.includes('vault_list_sessions'));
    assert.ok(toolNames.includes('vault_get_session'));
    assert.ok(toolNames.includes('vault_sync'));

    // Execute vault_get_stats
    const statsResult = await client.callTool({ name: 'vault_get_stats', arguments: {} });
    assert.ok(statsResult.content && statsResult.content.length > 0);
    assert.equal(statsResult.content[0].type, 'text');
    const stats = JSON.parse(statsResult.content[0].text);
    assert.ok(typeof stats.totalSessions === 'number');

    // Execute vault_list_sessions
    const listResult = await client.callTool({ name: 'vault_list_sessions', arguments: { limit: 5 } });
    assert.ok(listResult.content && listResult.content.length > 0);
    const sessions = JSON.parse(listResult.content[0].text);
    assert.ok(Array.isArray(sessions));

    await client.close();
  });

  it('supports multiple concurrent Streamable HTTP clients without collision', async () => {
    const client1 = new Client({ name: 'client-1', version: '1.0.0' }, { capabilities: {} });
    const client2 = new Client({ name: 'client-2', version: '1.0.0' }, { capabilities: {} });

    const transport1 = new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`));
    const transport2 = new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`));

    await client1.connect(transport1);
    await client2.connect(transport2);

    const res1 = await client1.callTool({ name: 'vault_get_stats', arguments: {} });
    const res2 = await client2.callTool({ name: 'vault_get_stats', arguments: {} });

    assert.equal(res1.content[0].type, 'text');
    assert.equal(res2.content[0].type, 'text');

    await client1.close();
    await client2.close();
  });

  it('supports legacy SSE client (/sse) and /messages endpoint', async () => {
    const client = new Client({ name: 'test-sse-client', version: '1.0.0' }, { capabilities: {} });
    const transport = new SSEClientTransport(new URL(`http://${host}:${port}/sse`));

    await client.connect(transport);

    const tools = await client.listTools();
    assert.ok(tools.tools.length >= 5);

    const res = await client.callTool({ name: 'vault_get_stats', arguments: {} });
    assert.equal(res.content[0].type, 'text');

    await client.close();
  });
});
