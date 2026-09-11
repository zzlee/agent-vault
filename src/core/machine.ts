import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { MachineInfo } from './types.js';

/**
 * Returns a globally collision-free machine identifier.
 * Combines human-friendly machine name/hostname with hardware machine-id hash.
 * Supports AGENT_VAULT_MACHINE_NAME environment variable override.
 */
export function getMachineInfo(): MachineInfo {
  let hardwareId = '';

  // 1. Linux system machine-id
  if (fs.existsSync('/etc/machine-id')) {
    hardwareId = fs.readFileSync('/etc/machine-id', 'utf-8').trim();
  } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
    hardwareId = fs.readFileSync('/var/lib/dbus/machine-id', 'utf-8').trim();
  }

  // 2. Fallback to persistent machine_id in ~/.config/agent-vault/
  if (!hardwareId) {
    const configDir = path.join(os.homedir(), '.config', 'agent-vault');
    const idFile = path.join(configDir, 'machine_id');
    if (fs.existsSync(idFile)) {
      hardwareId = fs.readFileSync(idFile, 'utf-8').trim();
    } else {
      hardwareId = crypto.randomUUID();
      try {
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(idFile, hardwareId, 'utf-8');
      } catch {
        // ignore
      }
    }
  }

  const shortHash = crypto.createHash('sha256').update(hardwareId).digest('hex').slice(0, 4);
  const hostname = os.hostname();
  const customName = process.env.AGENT_VAULT_MACHINE_NAME?.trim();
  const machineName = customName || hostname;
  const machineId = `${machineName}-${shortHash}`;

  return {
    id: machineId,
    name: machineName,
    hostname,
    platform: os.platform(),
  };
}
