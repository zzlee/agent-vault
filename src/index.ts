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
  handleArchive,
  handleUnarchive,
  handlePrune,
  handleVacuum,
} from './cli/commands.js';
import { handleDoctor } from './cli/doctor.js';
import type { AgentType } from './core/types.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('agent-vault')
    .description('Unified conversation history aggregator, search engine, and cross-machine vault for AI agents')
    .version('1.2.0');

  program
    .command('sync')
    .description('Sync conversation histories from local AI agents into vault')
    .option('-a, --agent <type>', 'Specific agent to sync (pi, opencode, agy, freebuff, hermes)')
    .option('-d, --dry-run', 'Preview changes without modifying files or database')
    .action(async (options) => {
      await handleSync({
        agent: options.agent as AgentType | undefined,
        dryRun: options.dryRun,
      });
    });

  program
    .command('list')
    .description('List stored conversation sessions')
    .option('-a, --agent <type>', 'Filter by agent (pi, opencode, agy, freebuff, hermes)')
    .option('-m, --machine <name>', 'Filter by machine name or ID')
    .option('-w, --workspace <path>', 'Filter by workspace path')
    .option('-l, --limit <number>', 'Number of sessions to show', '25')
    .action((options) => {
      handleList(options);
    });

  program
    .command('search <query>')
    .description('Full-text search messages across all sessions and agents using SQLite FTS5')
    .option('-a, --agent <type>', 'Filter by agent (pi, opencode, agy, freebuff, hermes)')
    .option('-r, --role <type>', 'Filter by message role (user, assistant, tool)')
    .option('-m, --machine <name>', 'Filter by machine name or ID')
    .option('-w, --workspace <path>', 'Filter by workspace path')
    .option('-l, --limit <number>', 'Maximum number of matches', '20')
    .option('--html <path>', 'Export search results as an interactive HTML file')
    .option('--since <date>', 'Filter messages updated since date (YYYY-MM-DD)')
    .option('--until <date>', 'Filter messages updated until date (YYYY-MM-DD)')
    .action((query, options) => {
      handleSearch(query, options);
    });

  program
    .command('show <id>')
    .description('Show full conversation messages for a given session ID')
    .option('-r, --role <type>', 'Filter messages by role (user, assistant, tool)')
    .option('--no-tools', 'Hide tool execution outputs from view')
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
    .command('archive')
    .description('Archive older sessions to data/archive/ and remove them from active SQLite index')
    .option('-b, --before <time>', 'Cutoff time or duration (e.g. 90d, 30d, 2026-06-01)')
    .option('-a, --agent <type>', 'Filter by agent (pi, opencode, agy, freebuff, hermes)')
    .option('-s, --session <id>', 'Specific session ID to archive')
    .option('-d, --dry-run', 'Preview which sessions would be archived without moving them')
    .action(async (options) => {
      await handleArchive(options);
    });

  program
    .command('unarchive <id>')
    .description('Restore an archived session back to data/sessions/ and re-index into vault.db')
    .action(async (id) => {
      await handleUnarchive(id);
    });

  program
    .command('prune')
    .description('Trim oversized tool outputs from older sessions to reduce disk and database footprint')
    .option('-o, --older-than <time>', 'Age threshold for pruning (e.g. 30d, 90d, 2026-06-01)', '30d')
    .option('-m, --max-tool-chars <chars>', 'Maximum tool output character length before truncation', '1500')
    .option('-a, --agent <type>', 'Filter by agent (pi, opencode, agy, freebuff, hermes)')
    .option('-s, --session <id>', 'Specific session ID to prune')
    .option('-d, --dry-run', 'Preview changes without modifying files or database')
    .action(async (options) => {
      await handlePrune(options);
    });

  program
    .command('vacuum')
    .description('Reclaim unused SQLite database space and defragment FTS5 index')
    .action(async () => {
      await handleVacuum();
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
