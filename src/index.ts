import { Command } from 'commander';
import {
  handleSync,
  handleList,
  handleSearch,
  handleShow,
  handleReindex,
  handleStats,
  handlePush,
  handlePull,
} from './cli/commands.js';
import { handleDoctor } from './cli/doctor.js';
import type { AgentType } from './core/types.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('agent-vault')
    .description('Unified conversation history aggregator, search engine, and cross-machine vault for AI agents')
    .version('1.0.0');

  program
    .command('sync')
    .description('Sync conversation histories from local AI agents (pi, opencode, agy) into vault')
    .option('-a, --agent <type>', 'Specific agent to sync (pi, opencode, agy)')
    .action(async (options) => {
      await handleSync({ agent: options.agent as AgentType | undefined });
    });

  program
    .command('list')
    .description('List stored conversation sessions')
    .option('-a, --agent <type>', 'Filter by agent (pi, opencode, agy)')
    .option('-w, --workspace <path>', 'Filter by workspace path')
    .option('-l, --limit <number>', 'Number of sessions to show', '25')
    .action((options) => {
      handleList(options);
    });

  program
    .command('search <query>')
    .description('Full-text search messages across all sessions and agents using SQLite FTS5')
    .option('-a, --agent <type>', 'Filter by agent (pi, opencode, agy)')
    .option('-w, --workspace <path>', 'Filter by workspace path')
    .option('-l, --limit <number>', 'Maximum number of matches', '20')
    .action((query, options) => {
      handleSearch(query, options);
    });

  program
    .command('show <id>')
    .description('Show full conversation messages for a given session ID')
    .option('--json', 'Output raw JSON format')
    .option('-e, --export <path>', 'Export as Markdown (use "md" for stdout or specify a filename)')
    .action((id, options) => {
      handleShow(id, options);
    });

  program
    .command('reindex')
    .description('Rebuild SQLite FTS5 index from git-tracked data/ directory')
    .action(async () => {
      await handleReindex();
    });

  program
    .command('stats')
    .description('Display vault statistics')
    .action(() => {
      handleStats();
    });

  program
    .command('push')
    .description('Sync local agent histories and push data to remote Git repository')
    .action(async () => {
      await handlePush();
    });

  program
    .command('pull')
    .description('Pull latest conversations from remote Git repository and re-index')
    .action(async () => {
      await handlePull();
    });

  program
    .command('doctor')
    .description('Diagnose local agent installation and schema compatibility')
    .action(() => {
      handleDoctor();
    });

  program
    .command('serve')
    .description('Start Model Context Protocol (MCP) Server with Streamable HTTP (SSE)')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .option('-H, --host <host>', 'Host to bind to', '127.0.0.1')
    .action(async (options) => {
      const { startMcpHttpServer } = await import('./mcp/server.js');
      await startMcpHttpServer({
        port: parseInt(options.port, 10),
        host: options.host,
      });
    });

  return program;
}
