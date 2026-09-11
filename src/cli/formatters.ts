import pc from 'picocolors';
import Table from 'cli-table3';
import type { SearchResult, SessionSummary } from '../core/types.js';

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

    const roleBadge = r.role === 'user' ? pc.yellow('[USER]') : pc.cyan('[ASSISTANT]');
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
  messages: Array<{ id: string; role: string; content: string; timestamp?: string }>
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
    else if (m.role === 'tool') roleBadge = pc.dim('[TOOL OUTPUT]');

    const timeStr = m.timestamp ? pc.gray(` (${m.timestamp.replace('T', ' ').slice(0, 19)})`) : '';
    lines.push(`${roleBadge}${timeStr}`);
    lines.push(m.content);
    lines.push(pc.dim('--------------------------------------------------------'));
  }

  return lines.join('\n');
}
