# agent-vault 🛡️

Unified conversation history aggregator, search engine, and cross-machine vault for AI coding agents (`pi`, `opencode`, `agy`, `freebuff`, and `hermes`).

## Features

- 🔄 **Multi-Agent Ingestion**: Automatically detects and extracts chat histories from:
  - **pi coding agent** (`~/.pi/agent/sessions/`)
  - **opencode** (`~/.local/share/opencode/opencode.db`)
  - **agy (Antigravity)** (`~/.gemini/antigravity-cli/`)
  - **freebuff (Codebuff AI / Manicode)** (`~/.config/manicode/projects/`)
  - **hermes (Nous Research Hermes Agent)** (`~/.hermes/state.db`)
- 🌐 **Git-Native Multi-Machine Sync**:
  - Structured JSON storage partitioned by machine and session to prevent merge conflicts.
  - Push and pull across multiple machines via Git.
- ⚡ **Lightweight Full-Text Search**:
  - Embedded local SQLite engine with **FTS5** full-text search.
  - Sub-millisecond keyword lookup across all agents, roles, and workspaces.
- 🔌 **Streamable HTTP MCP Server**:
  - Built-in Model Context Protocol server over Server-Sent Events (SSE).
  - Allows AI assistants to search, list, and recall conversations on-demand.
- 🖥️ **Developer-Friendly CLI**:
  - Diagnostic tool (`doctor`) to verify agent schema compatibility.
  - Clean export to Markdown, plain text, or JSON.
  - Built-in data sanitization (redacts API keys and sensitive tokens before sync).

## CLI Quickstart

```bash
# Setup on fresh clone
./scripts/init.sh

# Verify agent compatibility
agent-vault doctor

# Ingest local histories into vault
agent-vault sync

# Search messages across all agents
agent-vault search "sqlite fts"

# Start Streamable HTTP MCP Server (SSE)
agent-vault serve --port 3000

# Push updates to remote repository
agent-vault push

# Pull from remote and re-index
agent-vault pull
```

## Connecting MCP Client

Add `agent-vault` to your MCP client config (e.g. Antigravity or Claude Desktop):

```json
{
  "mcpServers": {
    "agent-vault": {
      "url": "http://127.0.0.1:3000/sse"
    }
  }
}
```

## Architecture

```
[pi]      [opencode]      [agy]      [freebuff]      [hermes]
  │           │             │            │               │
  └───────────┴─────────────┼────────────┴───────────────┘
                            ▼
     [Agent Adapters] (Normalization & Sanitization)
                            │
                            ├──► Git-Tracked Data Layer: data/sessions/<agent>/<session_id>.json
                            └──► Local Query Cache: .cache/vault.db (SQLite FTS5)
```

## License

MIT
