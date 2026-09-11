import pc from 'picocolors';
import Table from 'cli-table3';
import type { SearchResult, SessionSummary } from '../core/types.js';
import type { SyncResult } from '../core/syncer.js';

export function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return pc.gray('No sessions found in the vault.');
  }

  const table = new Table({
    head: [
      pc.bold(pc.cyan('Agent')),
      pc.bold(pc.cyan('Host')),
      pc.bold(pc.cyan('Title')),
      pc.bold(pc.cyan('Msgs')),
      pc.bold(pc.cyan('Workspace')),
      pc.bold(pc.cyan('Updated At')),
      pc.bold(pc.cyan('Session ID')),
    ],
    style: { head: [], border: [] },
  });

  for (const s of sessions) {
    let agentBadge: string = s.agent;
    if (s.agent === 'pi') agentBadge = pc.green('pi');
    else if (s.agent === 'opencode') agentBadge = pc.magenta('opencode');
    else if (s.agent === 'agy') agentBadge = pc.blue('agy');
    else if (s.agent === 'freebuff') agentBadge = pc.yellow('freebuff');
    else if (s.agent === 'hermes') agentBadge = pc.cyan('hermes');

    const title = s.title.length > 35 ? s.title.slice(0, 32) + '...' : s.title;
    const ws = s.workspace ? (s.workspace.length > 25 ? '...' + s.workspace.slice(-22) : s.workspace) : '-';
    const dateStr = s.updatedAt ? s.updatedAt.replace('T', ' ').slice(0, 16) : '-';

    table.push([
      agentBadge,
      pc.gray(s.machineName || 'local'),
      title,
      s.messageCount.toString(),
      pc.dim(ws),
      pc.dim(dateStr),
      pc.gray(s.id),
    ]);
  }

  return table.toString();
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return pc.gray('No matching messages found.');
  }

  const lines: string[] = [];
  lines.push(pc.bold(pc.green(`Found ${results.length} matching messages:\n`)));

  for (const r of results) {
    let agentBadge = `[${r.agent.toUpperCase()}]`;
    if (r.agent === 'pi') agentBadge = pc.green(agentBadge);
    else if (r.agent === 'opencode') agentBadge = pc.magenta(agentBadge);
    else if (r.agent === 'agy') agentBadge = pc.blue(agentBadge);
    else if (r.agent === 'freebuff') agentBadge = pc.yellow(agentBadge);
    else if (r.agent === 'hermes') agentBadge = pc.cyan(agentBadge);

    let roleBadge = pc.cyan(`[${r.role.toUpperCase()}]`);
    if (r.role === 'user') roleBadge = pc.yellow('[USER]');
    else if (r.role === 'assistant') roleBadge = pc.cyan('[ASSISTANT]');
    else if (r.role === 'tool') roleBadge = pc.magenta('[TOOL OUTPUT]');
    else if (r.role === 'system') roleBadge = pc.dim('[SYSTEM]');

    const dateStr = r.updatedAt ? r.updatedAt.replace('T', ' ').slice(0, 16) : '';

    lines.push(
      `${agentBadge} ${pc.bold(r.title)} ${pc.gray(`(${r.machineName || r.machineId} • ${dateStr})`)}`
    );
    lines.push(`  ${pc.gray('Session ID:')} ${r.sessionId}`);
    if (r.workspace) {
      lines.push(`  ${pc.gray('Workspace:')}  ${pc.dim(r.workspace)}`);
    }
    lines.push(`  ${roleBadge} ${r.snippet}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatSessionDetail(
  session: SessionSummary,
  messages: Array<{ id: string; role: string; content: string; timestamp?: string; hasToolCalls?: boolean }>
): string {
  const lines: string[] = [];
  lines.push(pc.bold(pc.cyan('========================================================')));
  lines.push(pc.bold(`Session: ${session.title}`));
  lines.push(`${pc.gray('ID:')}        ${session.id}`);
  lines.push(`${pc.gray('Agent:')}     ${session.agent}`);
  lines.push(`${pc.gray('Machine:')}   ${session.machineName} (${session.machineId})`);
  if (session.workspace) {
    lines.push(`${pc.gray('Workspace:')} ${session.workspace}`);
  }
  lines.push(`${pc.gray('Created:')}   ${session.createdAt}`);
  lines.push(`${pc.gray('Updated:')}   ${session.updatedAt}`);
  lines.push(`${pc.gray('Messages:')}  ${messages.length}`);
  lines.push(pc.bold(pc.cyan('========================================================\n')));

  for (const m of messages) {
    let roleBadge = pc.cyan(`[${m.role.toUpperCase()}]`);
    if (m.role === 'user') roleBadge = pc.yellow(pc.bold('[USER]'));
    else if (m.role === 'assistant') roleBadge = pc.cyan(pc.bold('[ASSISTANT]'));
    else if (m.role === 'tool') roleBadge = pc.magenta(pc.bold('[TOOL OUTPUT]'));
    else if (m.role === 'system') roleBadge = pc.dim('[SYSTEM]');

    const toolUseBadge = m.hasToolCalls ? pc.magenta(' 🔧 [TOOL USE]') : '';
    const timeStr = m.timestamp ? pc.gray(` (${m.timestamp.replace('T', ' ').slice(0, 19)})`) : '';
    lines.push(`${roleBadge}${toolUseBadge}${timeStr}`);
    lines.push(m.content);
    lines.push(pc.dim('--------------------------------------------------------'));
  }

  return lines.join('\n');
}

export function formatSyncDryRun(result: SyncResult): string {
  const lines: string[] = [];
  lines.push(pc.bold(pc.yellow('🔍 [DRY RUN] Simulation mode — no files or database will be modified.\n')));

  const table = new Table({
    head: [
      pc.bold(pc.cyan('Agent')),
      pc.bold(pc.cyan('New Sessions')),
      pc.bold(pc.cyan('Updated')),
      pc.bold(pc.cyan('Unchanged')),
      pc.bold(pc.cyan('Total Sessions')),
      pc.bold(pc.cyan('Total Msgs')),
      pc.bold(pc.cyan('New Msgs')),
    ],
    style: { head: [], border: [] },
  });

  for (const [agent, stats] of Object.entries(result.agentDetails)) {
    if (stats.totalSessions === 0) continue;
    let agentBadge: string = agent;
    if (agent === 'pi') agentBadge = pc.green('pi');
    else if (agent === 'opencode') agentBadge = pc.magenta('opencode');
    else if (agent === 'agy') agentBadge = pc.blue('agy');
    else if (agent === 'freebuff') agentBadge = pc.yellow('freebuff');
    else if (agent === 'hermes') agentBadge = pc.cyan('hermes');

    table.push([
      agentBadge,
      stats.newSessions > 0 ? pc.green(`+${stats.newSessions}`) : pc.gray('0'),
      stats.updatedSessions > 0 ? pc.yellow(`~${stats.updatedSessions}`) : pc.gray('0'),
      pc.gray(stats.unchangedSessions.toString()),
      stats.totalSessions.toString(),
      stats.totalMessages.toLocaleString(),
      stats.newMessages > 0 ? pc.green(`+${stats.newMessages}`) : pc.gray('0'),
    ]);
  }

  // Summary row
  table.push([
    pc.bold('Total'),
    result.totalNewSessions > 0 ? pc.bold(pc.green(`+${result.totalNewSessions}`)) : pc.bold(pc.gray('0')),
    result.totalUpdatedSessions > 0 ? pc.bold(pc.yellow(`~${result.totalUpdatedSessions}`)) : pc.bold(pc.gray('0')),
    pc.bold(pc.gray(result.totalUnchangedSessions.toString())),
    pc.bold(result.totalNewSessions + result.totalUpdatedSessions + result.totalUnchangedSessions).toString(),
    pc.bold(result.totalMessages.toLocaleString()),
    result.totalNewMessages > 0 ? pc.bold(pc.green(`+${result.totalNewMessages}`)) : pc.bold(pc.gray('0')),
  ]);

  lines.push(table.toString());
  lines.push('');

  if (result.totalNewSessions > 0 || result.totalUpdatedSessions > 0) {
    lines.push(
      pc.green(
        `✓ Would add ${pc.bold(result.totalNewSessions.toString())} new session(s) and ${pc.bold(result.totalNewMessages.toString())} new message(s).`
      )
    );
    lines.push(pc.cyan(`Run 'agent-vault sync' to persist these changes.`));
  } else {
    lines.push(pc.gray('Everything is up-to-date. No new sessions or messages to ingest.'));
  }

  return lines.join('\n');
}
