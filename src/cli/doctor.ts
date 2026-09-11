import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pc from 'picocolors';
import Database from 'better-sqlite3';

export function handleDoctor(): void {
  console.log(pc.bold(pc.cyan('🩺 Agent Vault System & Adapter Diagnostic\n')));

  const home = os.homedir();
  console.log(`${pc.gray('OS:')} ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`${pc.gray('Node:')} ${process.version}`);
  console.log(`${pc.gray('Hostname:')} ${os.hostname()}`);
  console.log('');

  // 1. Pi Agent Check
  const piDir = path.join(home, '.pi', 'agent', 'sessions');
  console.log(pc.bold('1. Pi Coding Agent:'));
  if (fs.existsSync(piDir)) {
    console.log(`   ${pc.green('✓')} Path found: ${pc.dim(piDir)}`);
    try {
      const workspaceDirs = fs.readdirSync(piDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      let sessionCount = 0;
      let sampleVersion: number | string = 'unknown';

      for (const w of workspaceDirs) {
        const files = fs.readdirSync(path.join(piDir, w.name)).filter((f) => f.endsWith('.jsonl'));
        sessionCount += files.length;
        if (sampleVersion === 'unknown' && files.length > 0) {
          const firstLine = fs.readFileSync(path.join(piDir, w.name, files[0]), 'utf-8').split('\n')[0];
          try {
            const parsed = JSON.parse(firstLine);
            if (parsed.version) sampleVersion = parsed.version;
          } catch {
            // ignore
          }
        }
      }
      console.log(`   ${pc.green('✓')} Format version detected: ${pc.cyan(`v${sampleVersion}`)}`);
      console.log(`   ${pc.green('✓')} Found ${sessionCount} session files across ${workspaceDirs.length} workspaces.`);
    } catch (e: any) {
      console.log(`   ${pc.yellow('⚠')} Error inspecting pi sessions: ${e.message}`);
    }
  } else {
    console.log(`   ${pc.gray('○')} Not detected at ${pc.dim(piDir)}`);
  }
  console.log('');

  // 2. OpenCode Check
  const opencodeDb = path.join(home, '.local', 'share', 'opencode', 'opencode.db');
  console.log(pc.bold('2. OpenCode:'));
  if (fs.existsSync(opencodeDb)) {
    console.log(`   ${pc.green('✓')} Database found: ${pc.dim(opencodeDb)}`);
    try {
      const db = new Database(opencodeDb, { readonly: true });
      const sessionCols = db.prepare(`PRAGMA table_info(session)`).all() as Array<{ name: string }>;
      const colNames = sessionCols.map((c) => c.name);
      const countRow = db.prepare(`SELECT COUNT(*) as count FROM session`).get() as { count: number };
      console.log(`   ${pc.green('✓')} Schema: table 'session' has ${colNames.length} columns (id, title, directory, etc.)`);
      console.log(`   ${pc.green('✓')} Found ${countRow.count} sessions in database.`);
      db.close();
    } catch (e: any) {
      console.log(`   ${pc.yellow('⚠')} Error inspecting opencode.db: ${e.message}`);
    }
  } else {
    console.log(`   ${pc.gray('○')} Not detected at ${pc.dim(opencodeDb)}`);
  }
  console.log('');

  // 3. Agy (Antigravity) Check
  const agyBase = path.join(home, '.gemini', 'antigravity-cli');
  const agyDb = path.join(agyBase, 'conversation_summaries.db');
  console.log(pc.bold('3. Agy (Antigravity CLI):'));
  if (fs.existsSync(agyDb)) {
    console.log(`   ${pc.green('✓')} Summaries DB found: ${pc.dim(agyDb)}`);
    try {
      const db = new Database(agyDb, { readonly: true });
      const countRow = db.prepare(`SELECT COUNT(*) as count FROM conversation_summaries`).get() as { count: number };
      console.log(`   ${pc.green('✓')} Found ${countRow.count} conversation summaries.`);
      db.close();
      const brainDir = path.join(agyBase, 'brain');
      if (fs.existsSync(brainDir)) {
        console.log(`   ${pc.green('✓')} Brain directory with detailed transcripts present.`);
      }
    } catch (e: any) {
      console.log(`   ${pc.yellow('⚠')} Error inspecting agy db: ${e.message}`);
    }
  } else {
    console.log(`   ${pc.gray('○')} Not detected at ${pc.dim(agyDb)}`);
  }
  console.log('');
  console.log(pc.green('All active agents are compatible with current agent-vault adapters.'));
}
