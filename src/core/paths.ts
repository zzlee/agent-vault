import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Resolves the agent-vault root directory reliably:
 * 1. AGENT_VAULT_DIR environment variable (if set)
 * 2. Current working directory if it is an agent-vault repository
 * 3. The package installation directory (where bin/dist lives)
 */
export function getVaultRoot(): string {
  if (process.env.AGENT_VAULT_DIR && fs.existsSync(process.env.AGENT_VAULT_DIR)) {
    return path.resolve(process.env.AGENT_VAULT_DIR);
  }

  // Check current working directory and walk up to find a vault root:
  // 1. Has .agentvault marker
  // 2. Has data/sessions directory
  // 3. Has package.json with name === 'agent-vault' or 'agent-vault-data'
  let dir = process.cwd();
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.agentvault'))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, 'data', 'sessions'))) {
      return dir;
    }
    const pkgFile = path.join(dir, 'package.json');
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
        if (pkg.name === 'agent-vault' || pkg.name === 'agent-vault-data') {
          return dir;
        }
      } catch {
        // ignore
      }
    }
    dir = path.dirname(dir);
  }

  // Fallback to the package's own root directory
  const currentFilePath = fileURLToPath(import.meta.url);
  // currentFilePath is in dist/core/paths.js or src/core/paths.ts -> go up 2 levels
  const packageRoot = path.resolve(path.dirname(currentFilePath), '..', '..');
  return packageRoot;
}

export function getDataDir(): string {
  return path.join(getVaultRoot(), 'data', 'sessions');
}

export function getDbPath(): string {
  return path.join(getVaultRoot(), '.cache', 'vault.db');
}
