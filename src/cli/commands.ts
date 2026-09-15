import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';
import pc from 'picocolors';
import { VaultDB } from '../core/db.js';
import { Syncer } from '../core/syncer.js';
import { Indexer, type ReindexProgress } from '../core/indexer.js';
import type { AgentType } from '../core/types.js';
import {
  formatSessionList,
  formatSearchResults,
  formatSessionDetail,
  formatSyncDryRun,
} from './formatters.js';
import { formatSearchHtml } from './html-export.js';

export async function handleSync(options: { agent?: AgentType; dryRun?: boolean }): Promise<void> {
  const db = new VaultDB();
  const syncer = new Syncer(db);

  if (options.dryRun) {
    console.log(pc.cyan('🔍 Analyzing local agent conversation histories (dry-run)...'));
    const start = Date.now();
    const result = await syncer.sync(options);
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log(formatSyncDryRun(result));
    console.log(pc.dim(`\nDry run completed in ${duration}s.`));
    db.close();
    return;
  }

  console.log(pc.cyan('🔄 Syncing conversation histories from local agents...'));
  const start = Date.now();
  const result = await syncer.sync(options);
  const duration = ((Date.now() - start) / 1000).toFixed(2);

  console.log(
    pc.green(
      `✓ Synced ${result.addedOrUpdated} sessions in ${duration}s ` +
        `(${pc.green(`pi: ${result.agentCounts.pi}`)}, ` +
        `${pc.magenta(`opencode: ${result.agentCounts.opencode}`)}, ` +
        `${pc.blue(`agy: ${result.agentCounts.agy}`)}, ` +
        `${pc.yellow(`freebuff: ${result.agentCounts.freebuff}`)}, ` +
        `${pc.cyan(`hermes: ${result.agentCounts.hermes}`)})`
    )
  );

  db.close();
}

export function handleList(options: { agent?: string; machine?: string; workspace?: string; limit?: string }): void {
  const db = new VaultDB();
  const limit = options.limit ? parseInt(options.limit, 10) : 25;

  const sessions = db.listSessions({
    agent: options.agent,
    machine: options.machine,
    workspace: options.workspace,
    limit,
  });

  console.log(formatSessionList(sessions));
  db.close();
}

export function handleSearch(
  query: string,
  options: { agent?: string; machine?: string; workspace?: string; role?: string; limit?: string; since?: string; until?: string; html?: string }
): void {
  const db = new VaultDB();
  const limit = options.limit ? parseInt(options.limit, 10) : 20;

  const results = db.search(query, {
    agent: options.agent,
    machine: options.machine,
    workspace: options.workspace,
    role: options.role,
    limit,
    since: options.since,
    until: options.until,
  });

  if (options.html) {
    const htmlContent = formatSearchHtml(results, query);
    fs.writeFileSync(options.html, htmlContent, 'utf-8');
    console.log(pc.green(`✓ Exported ${results.length} search results to ${options.html}`));
  } else {
    console.log(formatSearchResults(results));
  }
  db.close();
}

export function handleShow(
  id: string,
  options: { json?: boolean; export?: string; role?: string; noTools?: boolean }
): void {
  const db = new VaultDB();
  const sessionData = db.getSession(id, {
    role: options.role,
    noTools: options.noTools,
  });

  if (!sessionData) {
    console.error(pc.red(`Error: Session with id "${id}" not found.`));
    db.close();
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(sessionData, null, 2));
    db.close();
    return;
  }

  if (options.export) {
    let out = `# ${sessionData.session.title}\n\n`;
    out += `- **ID:** \`${sessionData.session.id}\`\n`;
    out += `- **Agent:** \`${sessionData.session.agent}\`\n`;
    out += `- **Machine:** \`${sessionData.session.machineName} (${sessionData.session.machineId})\`\n`;
    out += `- **Workspace:** \`${sessionData.session.workspace || 'N/A'}\`\n`;
    out += `- **Created:** ${sessionData.session.createdAt}\n`;
    out += `- **Updated:** ${sessionData.session.updatedAt}\n\n---\n\n`;

    for (const msg of sessionData.messages) {
      out += `### [${msg.role.toUpperCase()}] ${msg.timestamp ? `_(${msg.timestamp})_` : ''}\n\n`;
      out += `${msg.content}\n\n---\n\n`;
    }

    if (options.export === 'md' || options.export === 'markdown') {
      console.log(out);
    } else {
      fs.writeFileSync(options.export, out, 'utf-8');
      console.log(pc.green(`✓ Exported session to ${options.export}`));
    }
    db.close();
    return;
  }

  console.log(formatSessionDetail(sessionData.session, sessionData.messages));
  db.close();
}

export async function handleReindex(): Promise<void> {
  const db = new VaultDB();
  const indexer = new Indexer(db);

  console.log(pc.cyan('⚡ Re-indexing all stored sessions from data/sessions/ into SQLite FTS5...'));
  const start = Date.now();

  const isTty = process.stdout.isTTY;
  let lastLoggedPercent = -1;

  const renderProgress = (progress: ReindexProgress) => {
    const { current, total, messageCount, session } = progress;
    const percent = Math.min(100, Math.floor((current / total) * 100));
    const elapsedSec = (Date.now() - start) / 1000;
    const speed = elapsedSec > 0 ? (current / elapsedSec).toFixed(0) : '0';

    if (isTty) {
      const barWidth = 28;
      const completed = Math.round((barWidth * current) / total);
      const bar =
        '='.repeat(Math.max(0, completed - 1)) +
        (completed > 0 && completed < barWidth ? '>' : completed === barWidth ? '=' : '') +
        ' '.repeat(Math.max(0, barWidth - completed));

      const agentTag = session?.agent ? ` [${session.agent}]` : '';
      process.stdout.write(
        `\r[${pc.cyan(bar)}] ${pc.bold(`${percent}%`)} (${current}/${total} sessions) | ${pc.dim(`${messageCount.toLocaleString()} msgs`)} | ${pc.yellow(`${speed} sess/s`)}${pc.dim(agentTag)}\x1b[K`
      );
    } else {
      if (percent % 10 === 0 && percent !== lastLoggedPercent) {
        lastLoggedPercent = percent;
        console.log(`  Progress: ${percent}% (${current}/${total} sessions, ${messageCount.toLocaleString()} messages)...`);
      }
    }
  };

  const { indexedCount, messageCount, errors } = await indexer.reindexAll({
    onProgress: renderProgress,
  });

  if (isTty) {
    process.stdout.write('\n');
  }

  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(
    pc.green(
      `✓ Re-indexed ${indexedCount.toLocaleString()} sessions (${messageCount.toLocaleString()} messages) in ${duration}s` +
        (errors > 0 ? pc.yellow(` (${errors} errors)`) : '')
    )
  );

  db.close();
}

export function handleStats(): void {
  const db = new VaultDB();
  const stats = db.getStats();

  console.log(pc.bold(pc.cyan('🛡️  Agent Vault Statistics:')));
  console.log(`  ${pc.bold('Total Sessions:')} ${stats.totalSessions}`);
  console.log(`  ${pc.bold('Total Messages:')} ${stats.totalMessages}`);
  console.log(`  ${pc.bold('Sessions by Agent:')}`);
  for (const [agent, count] of Object.entries(stats.agents)) {
    console.log(`    - ${agent}: ${count}`);
  }
  if (Object.keys(stats.machines).length > 0) {
    console.log(`  ${pc.bold('Sessions by Machine:')}`);
    for (const [m, count] of Object.entries(stats.machines)) {
      console.log(`    - ${m}: ${count}`);
    }
  }

  db.close();
}

export async function handlePush(): Promise<void> {
  // First sync local agent conversations
  await handleSync({});

  console.log(pc.cyan('🚀 Committing and pushing to Git remote repository...'));
  const { getMachineInfo } = await import('../core/machine.js');
  const machine = getMachineInfo();
  const dateStr = new Date().toISOString().slice(0, 10);

  try {
    execSync('git add data/', { stdio: 'inherit' });
    const status = execSync('git status --porcelain data/', { encoding: 'utf-8' });
    if (!status.trim()) {
      console.log(pc.yellow('Everything up-to-date in data/. Nothing new to push.'));
      return;
    }

    execSync(`git commit -m "sync(vault): ${machine.name} (${machine.id}) conversations at ${dateStr}"`, { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
    console.log(pc.green('✓ Successfully pushed conversations to remote repository!'));
  } catch (err: any) {
    console.error(pc.red(`Push failed: ${err.message}`));
    process.exit(1);
  }
}

export async function handlePull(): Promise<void> {
  console.log(pc.cyan('📥 Pulling updates from Git remote repository...'));
  try {
    execSync('git pull', { stdio: 'inherit' });
    await handleReindex();
    console.log(pc.green('✓ Pull and re-index completed successfully!'));
  } catch (err: any) {
    console.error(pc.red(`Pull failed: ${err.message}`));
    process.exit(1);
  }
}
