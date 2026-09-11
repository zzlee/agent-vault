# AGENTS.md - Agent Architecture & Contributor Guide

Welcome to **agent-vault**. This document defines the architectural conventions, data models, and extension patterns for AI agents and human developers collaborating on this project.

---

## 1. Project Overview & System Philosophy

`agent-vault` aggregates, normalizes, indexes, and synchronizes conversation histories across multiple AI coding agents (`pi`, `opencode`, and `agy`) on multiple machines.

### Dual-Layer Storage Design

1. **Git-Tracked Canonical Data Layer (`data/sessions/`)**:
   - **Source of truth** across machines.
   - Formatted as standardized JSON files: `data/sessions/<agent>/<hostname>_<session_id>.json`.
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

---

## 3. Canonical Data Model (`schema_version: "1.0"`)

All adapters must normalize agent-specific data structures into this schema before writing to `data/sessions/`:

```typescript
interface NormalizedSession {
  schema_version: "1.0";
  id: string; // Unique ID: e.g. <agent>_<hostname>_<native_id>
  agent: "pi" | "opencode" | "agy";
  machine: {
    hostname: string;
    platform: string;
  };
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
# Setup on a newly cloned machine
./scripts/init.sh

# Verify agent compatibility and environment status
node bin/agent-vault.js doctor

# Ingest local sessions into vault
node bin/agent-vault.js sync

# Full-text search messages
node bin/agent-vault.js search "<query>"

# Commit and push synced data to remote
node bin/agent-vault.js push

# Pull new sessions from other machines and rebuild local index
node bin/agent-vault.js pull
```
