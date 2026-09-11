# AGENTS.md - Agent Architecture & Contributor Guide

Welcome to **agent-vault**. This document defines the architectural conventions, data models, and extension patterns for AI agents and human developers collaborating on this project.

---

## 1. Project Overview & System Philosophy

`agent-vault` aggregates, normalizes, indexes, and synchronizes conversation histories across multiple AI coding agents (`pi`, `opencode`, `agy`, `freebuff`, and `hermes`) on multiple machines.

### Dual-Layer Storage Design

1. **Git-Tracked Canonical Data Layer (`data/sessions/`)**:
   - **Source of truth** across machines.
   - Formatted as standardized JSON files: `data/sessions/<agent>/<session_id>.json`.
   - Partitioned by agent and machine identifier to prevent Git merge conflicts.
2. **Local High-Performance Query Layer (`.cache/vault.db`)**:
   - Embedded SQLite database with **FTS5** (Full-Text Search).
   - Rebuilt automatically upon fresh clone (`./scripts/init.sh`), on-demand (`agent-vault reindex`), or after remote pulls (`agent-vault pull`).
   - Ignored in `.gitignore` to avoid repository bloat and binary merge conflicts.

---

## 2. Supported AI Agents & Extraction Mechanics

| Agent | Default Storage Location | Format | Extraction Strategy |
| :--- | :--- | :--- | :--- |
| **pi coding agent** | `~/.pi/agent/sessions/--<workspace>--/*.jsonl` | JSON Lines (`v3`) | Streams lines using Node `readline`. Parses first `session` turn for metadata and subsequent `message` turns for user/assistant roles and tool calls. |
| **opencode** | `~/.local/share/opencode/opencode.db` | SQLite (Drizzle ORM) | Read-only connection querying `session`, `message`, and `part` tables. Combines message parts and associates directory workspaces. |
| **agy (Antigravity)** | `~/.gemini/antigravity-cli/` | SQLite + JSONL | Queries `conversation_summaries.db` for session index, then parses `brain/<id>/.system_generated/logs/transcript.jsonl` for turn-by-turn history. |
| **freebuff** | `~/.config/manicode/projects/<project>/chats/` | JSON | Reads `chat-messages.json` (user/assistant blocks & tool calls), `chat-meta.json` (title & counts), and `run-state.json` (workspace). |
| **hermes** | `~/.hermes/state.db` | SQLite / JSONL | Reads `sessions` and `messages` tables via dynamic PRAGMA inspection; supports profile paths (`profiles/*/state.db`) and fallback JSONL transcripts. |

---

## 3. Canonical Data Model (`schema_version: "1.0"`)

All adapters must normalize agent-specific data structures into this schema before writing to `data/sessions/`:

interface MachineInfo {
  id: string;        // Collision-free ID: <machine_name>-<short_hardware_hash>
  name: string;      // Human-friendly name or AGENT_VAULT_MACHINE_NAME alias
  hostname: string;  // OS hostname
  platform: string;  // OS platform
}

interface NormalizedSession {
  schema_version: "1.0";
  id: string; // Unique ID: e.g. <agent>_<machine.id>_<native_id>
  agent: "pi" | "opencode" | "agy" | "freebuff" | "hermes";
  machine: MachineInfo;
  session: {
    native_id: string;
    title: string;
    workspace?: string;
    created_at: string; // ISO 8601
    updated_at: string; // ISO 8601
  };
  messages: NormalizedMessage[];
}

interface NormalizedMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string; // ISO 8601
  step_index?: number;
  has_tool_calls?: boolean;
}
```

---

## 4. How to Add a New Agent Adapter

To support a new AI agent (e.g. Claude Code, Cursor, Aider, Codex):

1. **Implement `AgentAdapter`** in `src/adapters/<new-agent>.ts`:
   ```typescript
   import type { AgentAdapter } from './base.js';
   import type { NormalizedSession } from '../core/types.js';

   export class NewAgentAdapter implements AgentAdapter {
     readonly name = 'new-agent' as const;
     isAvailable(): boolean | Promise<boolean> { /* check file path */ }
     async collect(): Promise<NormalizedSession[]> { /* parse and return */ }
   }
   ```
2. **Ensure Sanitization**:
   Pass all text content through `sanitizeText()` from `src/core/sanitizer.ts` to redact sensitive API keys, tokens, and credentials.
3. **Register Adapter**:
   Add the adapter instance to `Syncer.constructor` in `src/core/syncer.ts`.
4. **Update Diagnostic Tool**:
   Add detection logic to `handleDoctor()` in `src/cli/doctor.ts`.

---

## 5. Security & Sensitive Data Handling

- **Automatic Redaction**: `src/core/sanitizer.ts` continuously scans and masks:
  - OpenAI / generic API keys (`sk-...`)
  - Anthropic API keys (`sk-ant-...`)
  - GitHub personal tokens (`ghp_...`, `gho_...`)
  - Google API keys (`AIza...`)
  - AWS credentials (`AKIA...`)
  - HTTP `Authorization: Bearer` headers
- Never bypass `sanitizeText()` when collecting messages.

---

## 6. Fresh Clone & Multi-Machine Commands

```bash
# Setup on a newly cloned machine (builds TS, creates .cache/, links CLI, indexes)
./scripts/init.sh

# Verify environment, path detection, and agent status
agent-vault doctor

# Ingest local sessions into vault (all agents or specific agent)
agent-vault sync
agent-vault sync -a freebuff

# List sessions with optional filters
agent-vault list
agent-vault list -a agy -l 50
agent-vault list -w /path/to/workspace

# Full-text search messages using SQLite FTS5
agent-vault search "<query>"
agent-vault search "error" -a opencode -m thinkpad

# Inspect or export session transcripts
agent-vault show <session-id>
agent-vault show <session-id> --json
agent-vault show <session-id> -e session.md

# View vault metrics
agent-vault stats

# Start Model Context Protocol (MCP) Streamable HTTP Server
agent-vault serve --port 3000

# Commit and push synced data to remote Git repository
agent-vault push

# Pull new sessions from other machines and rebuild local index
agent-vault pull

# Rebuild local SQLite FTS5 index from data/sessions/
agent-vault reindex
```
