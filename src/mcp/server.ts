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

  const AGENT_DESCRIPTIONS: Record<string, string> = {
    pi: 'Pi terminal coding agent (~/.pi/agent/sessions)',
    opencode: 'OpenCode assistant (~/.local/share/opencode)',
    agy: 'Google Antigravity IDE & CLI agent (~/.gemini/antigravity-cli)',
    freebuff: 'Codebuff / Manicode AI project chats (~/.config/manicode)',
    hermes: 'Nous Research Hermes autonomous agent (~/.hermes)',
  };

  // Tool 1: vault_search
  server.tool(
    'vault_search',
    'Search historical conversation messages across multiple AI coding agents (pi, opencode, agy, freebuff, hermes) and machines using SQLite FTS5 full-text search. Results include markdown-highlighted snippets, role, workspace, and timestamps.',
    {
      query: z.string().describe('Search keyword, error message, command, or technical term'),
      agent: AgentEnum.optional().describe(
        "Filter by AI agent: 'pi' (Pi terminal agent), 'opencode' (OpenCode assistant), 'agy' (Antigravity IDE/CLI), 'freebuff' (Codebuff/Manicode), 'hermes' (Nous Research agent)"
      ),
      machine: z.string().optional().describe('Filter by machine hostname or machine ID (e.g. thinkpad, desktop)'),
      role: RoleEnum.optional().describe(
        "Filter by message role: 'user' (user requests/prompts), 'assistant' (AI plans/solutions), 'tool' (terminal command outputs, compiler errors, tool call results)"
      ),
      workspace: z.string().optional().describe('Filter by project directory path or workspace substring (e.g. /home/user/project)'),
      since: z.string().optional().describe('Filter messages updated on or after date (YYYY-MM-DD)'),
      until: z.string().optional().describe('Filter messages updated on or before date (YYYY-MM-DD)'),
      limit: z.number().optional().default(15).describe('Maximum matching messages to return (default: 15)'),
    },
    async ({ query, agent, machine, role, workspace, since, until, limit }) => {
      const results = db.search(query, {
        agent,
        machine,
        role,
        workspace,
        since,
        until,
        limit,
        highlight: { open: '**', close: '**' },
      });
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
    'Retrieve full turn-by-turn conversation messages and execution traces for a specific session ID. Use this after finding relevant sessions with vault_search.',
    {
      sessionId: z.string().describe('Unique session ID (e.g. opencode_machine_ses_xxx, pi_machine_xxx, agy_machine_xxx)'),
      role: RoleEnum.optional().describe("Filter messages by role: 'user', 'assistant', 'tool'"),
      noTools: z.boolean().optional().describe('Hide tool execution outputs to view only human-readable discussion'),
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

  // Tool 3: vault_list_workspaces (NEW)
  server.tool(
    'vault_list_workspaces',
    'List all recorded project workspaces/repositories across all AI agents, including session counts, active agents, and last updated timestamps.',
    {
      search: z.string().optional().describe('Filter workspace paths by substring or project name'),
      limit: z.number().optional().default(30).describe('Maximum number of workspaces to return (default: 30)'),
    },
    async ({ search, limit }) => {
      const workspaces = db.listWorkspaces({ search, limit });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(workspaces, null, 2),
          },
        ],
      };
    }
  );

  // Tool 4: vault_list_sessions
  server.tool(
    'vault_list_sessions',
    'List recent conversation sessions across agents, machines, and workspaces. Useful for exploring available sessions or recent activities.',
    {
      agent: AgentEnum.optional().describe('Filter by AI agent name (pi, opencode, agy, freebuff, hermes)'),
      machine: z.string().optional().describe('Filter by machine name or ID'),
      workspace: z.string().optional().describe('Filter by workspace path substring'),
      limit: z.number().optional().default(20).describe('Max sessions to return (default: 20)'),
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

  // Tool 5: vault_get_stats
  server.tool(
    'vault_get_stats',
    'Get comprehensive statistics on indexed sessions and messages across all AI agents (pi, opencode, agy, freebuff, hermes) and machines.',
    {},
    async () => {
      const stats = db.getStats();
      const payload = {
        ...stats,
        agentDescriptions: AGENT_DESCRIPTIONS,
      };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
  );

  // Tool 6: vault_sync
  server.tool(
    'vault_sync',
    'Trigger a local synchronization of conversation histories from installed local agents (pi, opencode, agy, freebuff, hermes) into the vault database.',
    {
      agent: AgentEnum.optional().describe('Optional specific agent to sync (pi, opencode, agy, freebuff, hermes)'),
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

  // Prompt 1: recall_solution
  server.prompt(
    'recall_solution',
    'Recall past troubleshooting steps, architectural decisions, and bug fixes from multi-agent histories',
    {
      topic: z.string().describe('The problem, error message, technology, or topic to look up'),
      workspace: z.string().optional().describe('Optional project workspace path to restrict search to'),
      agent: AgentEnum.optional().describe('Optional specific agent to filter by'),
    },
    ({ topic, workspace, agent }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Please search the agent-vault multi-agent history for: "${topic}".` +
              (workspace ? ` Restrict to workspace "${workspace}".` : '') +
              (agent ? ` Filter by agent "${agent}".` : '') +
              `\n\nUse vault_search to find matching messages across agents, and then use vault_get_session to inspect full solutions and commands. Synthesize the findings into clear actionable steps.`,
          },
        },
      ],
    })
  );

  // Resource 1: vault://overview
  server.resource(
    'vault_overview',
    'vault://overview',
    { description: 'High-level summary of the multi-agent conversation vault (agents, machines, statistics)' },
    async (uri: any) => {
      const stats = db.getStats();
      const workspaces = db.listWorkspaces({ limit: 15 });
      const summaryText = [
        '# agent-vault Multi-Agent Conversation Database',
        '',
        'agent-vault indexes conversation histories, decision traces, and tool execution logs across multiple AI coding agents and development machines.',
        '',
        '## Supported Agents:',
        '- `pi`: Pi terminal coding agent sessions (~/.pi/agent/sessions)',
        '- `opencode`: OpenCode local assistant (~/.local/share/opencode)',
        '- `agy`: Google Antigravity IDE & CLI agent (~/.gemini/antigravity-cli)',
        '- `freebuff`: Codebuff / Manicode AI project chats (~/.config/manicode)',
        '- `hermes`: Nous Research Hermes autonomous agent (~/.hermes)',
        '',
        '## Current Vault Statistics:',
        `- Total Sessions: ${stats.totalSessions}`,
        `- Total Messages: ${stats.totalMessages}`,
        '',
        '### Sessions by Agent:',
        ...Object.entries(stats.agents).map(([a, count]) => `- ${a}: ${count}`),
        '',
        '### Sessions by Machine:',
        ...Object.entries(stats.machines).map(([m, count]) => `- ${m}: ${count}`),
        '',
        '## Top Workspaces:',
        ...workspaces.map(
          (w) =>
            `- ${w.workspace} (${w.sessionCount} sessions, agents: ${w.agents.join(', ')}, updated: ${w.lastUpdatedAt})`
        ),
      ].join('\n');

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: summaryText,
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
