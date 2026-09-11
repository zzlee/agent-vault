# agent-vault 🛡️

Unified conversation history aggregator, search engine, and cross-machine vault for AI coding agents (`pi`, `opencode`, and `agy`).

## Features

- 🔄 **Multi-Agent Ingestion**: Automatically detects and extracts chat histories from:
  - **pi coding agent** (`~/.pi/agent/sessions/`)
  - **opencode** (`~/.local/share/opencode/opencode.db`)
  - **agy (Antigravity)** (`~/.gemini/antigravity-cli/`)
- 🌐 **Git-Native Multi-Machine Sync**:
  - Structured JSON storage partitioned by machine and session to prevent merge conflicts.
  - Push and pull across multiple machines via Git.
- ⚡ **Lightweight Full-Text Search**:
  - Embedded local SQLite engine with **FTS5** full-text search.
  - Sub-millisecond keyword lookup across all agents, roles, and workspaces.
- 🖥️ **Developer-Friendly CLI**:
  - Interactive browser / terminal pager.
  - Clean export to Markdown, plain text, or JSON.
  - Built-in data sanitization (redacts API keys and sensitive tokens before sync).

## CLI Quickstart (Preview)

```bash
# Ingest local histories into vault
agent-vault sync

# Search messages across all agents
agent-vault search "sqlite fts"

# List recent conversations
agent-vault list

# View conversation detail
agent-vault show <session-id>

# Push updates to remote repository
agent-vault push

# Pull from remote and re-index
agent-vault pull
```

## Architecture

```
[pi]          [opencode]          [agy]
  │               │                 │
  └───────┬───────┴─────────────────┘
          ▼
   [Agent Adapters] (Normalization & Sanitization)
          │
          ├──► Git-Tracked Data Layer: data/sessions/<agent>/<machine>_<session>.json
          └──► Local Query Cache: .cache/vault.db (SQLite FTS5)
```

## License

MIT
