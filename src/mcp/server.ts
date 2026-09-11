import http from 'node:http';
import { URL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import pc from 'picocolors';
import { VaultDB } from '../core/db.js';
import { Syncer } from '../core/syncer.js';
import type { AgentType } from '../core/types.js';

export interface McpServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const server = new McpServer({
    name: 'agent-vault',
    version: '0.1.0',
  });

  const db = new VaultDB(options.dbPath);

  // Tool 1: vault_search
  server.tool(
    'vault_search',
    'Search conversation history across all agents (pi, opencode, agy) and machines using SQLite FTS5',
    {
      query: z.string().describe('Search keyword or phrase'),
      agent: z.enum(['pi', 'opencode', 'agy']).optional().describe('Filter by agent name'),
      workspace: z.string().optional().describe('Filter by workspace substring'),
      limit: z.number().optional().default(15).describe('Max results to return (default 15)'),
    },
    async ({ query, agent, workspace, limit }) => {
      const results = db.search(query, { agent, workspace, limit });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // Tool 2: vault_get_session
  server.tool(
    'vault_get_session',
    'Retrieve full conversation messages for a specific session ID',
    {
      sessionId: z.string().describe('Unique session ID (e.g. pi_host_xxx)'),
    },
    async ({ sessionId }) => {
      const data = db.getSession(sessionId);
      if (!data) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Session not found: ${sessionId}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // Tool 3: vault_list_sessions
  server.tool(
    'vault_list_sessions',
    'List recent conversation sessions across agents and workspaces',
    {
      agent: z.enum(['pi', 'opencode', 'agy']).optional().describe('Filter by agent name'),
      workspace: z.string().optional().describe('Filter by workspace substring'),
      limit: z.number().optional().default(20).describe('Max sessions to return (default 20)'),
    },
    async ({ agent, workspace, limit }) => {
      const sessions = db.listSessions({ agent, workspace, limit });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(sessions, null, 2),
          },
        ],
      };
    }
  );

  // Tool 4: vault_get_stats
  server.tool(
    'vault_get_stats',
    'Get statistics on indexed sessions and messages across all agents',
    {},
    async () => {
      const stats = db.getStats();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    }
  );

  // Tool 5: vault_sync
  server.tool(
    'vault_sync',
    'Trigger a local synchronization of conversation histories from pi, opencode, and agy',
    {
      agent: z.enum(['pi', 'opencode', 'agy']).optional().describe('Optional specific agent to sync'),
    },
    async ({ agent }) => {
      const syncer = new Syncer(db);
      const result = await syncer.sync({ agent: agent as AgentType | undefined });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return { server, db };
}

export async function startMcpHttpServer(options: McpServerOptions = {}): Promise<http.Server> {
  const port = options.port || 3000;
  const host = options.host || '127.0.0.1';
  const { server } = createMcpServer(options);

  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
    const pathname = parsedUrl.pathname;

    // Health / Status Check
    if (pathname === '/' || pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          {
            status: 'ok',
            name: 'agent-vault-mcp',
            version: '0.1.0',
            endpoints: {
              sse: `http://${host}:${port}/sse`,
              messages: `http://${host}:${port}/messages`,
            },
          },
          null,
          2
        )
      );
      return;
    }

    // SSE Stream endpoint (Streamable HTTP)
    if (pathname === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);

      req.on('close', () => {
        transports.delete(transport.sessionId);
      });

      await server.connect(transport);
      return;
    }

    // Message POST endpoint for SSE sessions
    if (pathname === '/messages' && req.method === 'POST') {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }));
        return;
      }

      const transport = transports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      console.log(pc.bold(pc.cyan('🛡️  Agent Vault MCP Server (Streamable HTTP / SSE) Started!')));
      console.log(`   ${pc.green('•')} Listening on: ${pc.bold(`http://${host}:${port}`)}`);
      console.log(`   ${pc.green('•')} SSE Endpoint: ${pc.bold(`http://${host}:${port}/sse`)}`);
      console.log(`   ${pc.green('•')} Messages:     ${pc.bold(`http://${host}:${port}/messages`)}`);
      console.log(`   ${pc.green('•')} Health:       ${pc.bold(`http://${host}:${port}/health`)}`);
      console.log(pc.gray('\nPress Ctrl+C to stop.'));
      resolve(httpServer);
    });
  });
}
