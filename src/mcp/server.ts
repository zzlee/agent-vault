import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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
    version: '1.2.0',
  });

  const db = new VaultDB(options.dbPath);

  const AgentEnum = z.enum(['pi', 'opencode', 'agy', 'freebuff', 'hermes']);
  const RoleEnum = z.enum(['user', 'assistant', 'tool', 'system']);

  // Tool 1: vault_search
  server.tool(
    'vault_search',
    'Search conversation history across all agents (pi, opencode, agy, freebuff, hermes) and machines using SQLite FTS5',
    {
      query: z.string().describe('Search keyword or phrase'),
      agent: AgentEnum.optional().describe('Filter by agent name'),
      machine: z.string().optional().describe('Filter by machine name or ID'),
      role: RoleEnum.optional().describe('Filter by message role (user, assistant, tool)'),
      workspace: z.string().optional().describe('Filter by workspace substring'),
      limit: z.number().optional().default(15).describe('Max results to return (default 15)'),
    },
    async ({ query, agent, machine, role, workspace, limit }) => {
      const results = db.search(query, { agent, machine, role, workspace, limit });
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
      role: RoleEnum.optional().describe('Filter messages by role (user, assistant, tool)'),
      noTools: z.boolean().optional().describe('Hide tool execution outputs from view'),
    },
    async ({ sessionId, role, noTools }) => {
      const data = db.getSession(sessionId, { role, noTools });
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
      agent: AgentEnum.optional().describe('Filter by agent name'),
      machine: z.string().optional().describe('Filter by machine name or ID'),
      workspace: z.string().optional().describe('Filter by workspace substring'),
      limit: z.number().optional().default(20).describe('Max sessions to return (default 20)'),
    },
    async ({ agent, machine, workspace, limit }) => {
      const sessions = db.listSessions({ agent, machine, workspace, limit });
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
    'Trigger a local synchronization of conversation histories from local agents (pi, opencode, agy, freebuff, hermes)',
    {
      agent: AgentEnum.optional().describe('Optional specific agent to sync'),
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

  // Multi-session tracking for Streamable HTTP
  const streamableSessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; db: VaultDB }>();

  // Multi-session tracking for Legacy SSE
  const sseSessions = new Map<string, { transport: SSEServerTransport; server: McpServer; db: VaultDB }>();

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers supporting modern MCP Streamable HTTP and SSE
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');

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
            version: '1.2.0',
            endpoints: {
              streamableHttp: `http://${host}:${port}/mcp`,
              sse: `http://${host}:${port}/sse`,
              messages: `http://${host}:${port}/messages`,
              health: `http://${host}:${port}/health`,
            },
          },
          null,
          2
        )
      );
      return;
    }

    // Modern Streamable HTTP Endpoint (/mcp)
    if (pathname === '/mcp') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let session = sessionId ? streamableSessions.get(sessionId) : undefined;

      if (!session) {
        if (sessionId) {
          // Unknown or expired session ID
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        // Initialize a new Streamable HTTP connection
        const { server, db } = createMcpServer(options);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        await server.connect(transport);

        transport.onclose = () => {
          if (transport.sessionId) {
            streamableSessions.delete(transport.sessionId);
          }
          db.close();
        };

        await transport.handleRequest(req, res);

        if (transport.sessionId) {
          streamableSessions.set(transport.sessionId, { transport, server, db });
        }
        return;
      }

      await session.transport.handleRequest(req, res);
      return;
    }

    // Legacy SSE Stream endpoint (/sse)
    if (pathname === '/sse' && req.method === 'GET') {
      const { server, db } = createMcpServer(options);
      const transport = new SSEServerTransport('/messages', res);
      sseSessions.set(transport.sessionId, { transport, server, db });

      req.on('close', () => {
        sseSessions.delete(transport.sessionId);
        db.close();
      });

      await server.connect(transport);
      return;
    }

    // Legacy Message POST endpoint for SSE sessions (/messages)
    if (pathname === '/messages' && req.method === 'POST') {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      const session = sessionId ? sseSessions.get(sessionId) : undefined;
      if (!session) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }));
        return;
      }

      await session.transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      console.log(pc.bold(pc.cyan('🛡️  Agent Vault MCP Server Started!')));
      console.log(`   ${pc.green('•')} Listening on:     ${pc.bold(`http://${host}:${port}`)}`);
      console.log(`   ${pc.green('•')} Streamable HTTP: ${pc.bold(`http://${host}:${port}/mcp`)}`);
      console.log(`   ${pc.green('•')} SSE Endpoint:   ${pc.bold(`http://${host}:${port}/sse`)}`);
      console.log(`   ${pc.green('•')} Messages:       ${pc.bold(`http://${host}:${port}/messages`)}`);
      console.log(`   ${pc.green('•')} Health:         ${pc.bold(`http://${host}:${port}/health`)}`);
      console.log(pc.gray('\nPress Ctrl+C to stop.'));
      resolve(httpServer);
    });
  });
}
