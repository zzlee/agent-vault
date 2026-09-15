# agent-vault 🛡️

> Unified conversation history aggregator, search engine, and cross-machine vault for AI coding agents (`pi`, `opencode`, `agy`, `freebuff`, and `hermes`).

`agent-vault` solves the fragmentation of AI coding conversations. When you work across multiple machines (desktop, laptop, servers) and multiple AI agents, your decision logs, troubleshooting steps, and context are scattered across various formats and directories. `agent-vault` continuously ingests, sanitizes, normalizes, indexes, and synchronizes all sessions into a Git-backed, collision-free vault with instant full-text search and a built-in MCP server.

---

## 🌟 Key Features

- 🤖 **5 Supported AI Agents**: Native zero-config adapters for `pi`, `opencode`, `agy` (Antigravity), `freebuff` (Codebuff AI / Manicode), and `hermes` (Nous Research).
- 🌐 **Git-Native Multi-Machine Vault**: Collision-free machine naming ensures effortless cross-machine collaboration without Git merge conflicts.
- ⚡ **Local High-Performance FTS5 Engine**: Local SQLite with Full-Text Search enables sub-millisecond querying across tens of thousands of messages.
- 🔒 **Automated Secret Sanitization**: Redacts sensitive API keys (OpenAI, Anthropic, Google, AWS, GitHub) and Bearer tokens before writing to Git.
- 🔌 **Streamable HTTP MCP Server (SSE)**: Built-in Model Context Protocol server exposing `vault_search`, `vault_list`, and `vault_get_session` tools to any AI assistant.
- 📝 **Flexible Export**: View sessions in rich terminal color, export to clean GitHub Flavored Markdown, or dump raw JSON.

---

## 🤖 Supported Agents

| Agent | Default Storage Location | Format | Extraction Details |
| :--- | :--- | :--- | :--- |
| **pi coding agent** | `~/.pi/agent/sessions/--<workspace>--/*.jsonl` | JSON Lines (`v3`) | Streams lines using Node `readline`. Parses first `session` turn for metadata and subsequent `message` turns for user/assistant roles and tool calls. |
| **opencode** | `~/.local/share/opencode/opencode.db` | SQLite (Drizzle ORM) | Read-only connection querying `session`, `message`, and `part` tables. Combines message parts and associates directory workspaces. |
| **agy (Antigravity)** | `~/.gemini/antigravity-cli/` | SQLite + JSONL | Queries `conversation_summaries.db` for session index, then parses `brain/<id>/.system_generated/logs/transcript.jsonl` for turn-by-turn history. |
| **freebuff (Manicode)** | `~/.config/manicode/projects/<project>/chats/` | JSON | Reads `chat-messages.json` (user/assistant blocks & tool calls), `chat-meta.json` (title & counts), and `run-state.json` (workspace). |
| **hermes (Nous Research)** | `~/.hermes/state.db` | SQLite / JSONL | Reads `sessions` and `messages` tables via dynamic PRAGMA inspection; supports profile paths (`profiles/*/state.db`) and fallback JSONL transcripts. |

### Environment Overrides

You can customize search locations or machine identities via environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `AGENT_VAULT_MACHINE_NAME` | Custom human-readable alias for this machine | System hostname |
| `AGENT_VAULT_ROOT` | Custom path to the `agent-vault` repository | Auto-detected from script path |
| `MANICODE_DIR` / `FREEBUFF_DIR` | Custom directory for Freebuff / Manicode data | `~/.config/manicode` |
| `HERMES_HOME` | Custom home directory for Nous Hermes Agent | `~/.hermes` |

---

## 🚀 Quickstart

### 1. Fresh Clone Setup

On any machine:

```bash
git clone <your-agent-vault-repo-url> conv-hist
cd conv-hist
./scripts/init.sh
```

`init.sh` automatically installs dependencies, builds the TypeScript project into `dist/`, and links the `agent-vault` binary globally.

### 2. Verify Your Environment

Run `agent-vault doctor` to verify system health and detect installed agents:

```bash
agent-vault doctor
```

Output:
```text
🩺 Agent Vault System & Adapter Diagnostic

OS:         Linux 7.0.0-31-generic (x64)
Node:       v24.15.0
Machine ID: my-thinkpad-7ca7
Machine:    my-thinkpad (hostname: my-thinkpad)

1. Pi Coding Agent:
   ✓ Path found: /home/user/.pi/agent/sessions
   ✓ Found 173 session files across 16 workspaces.

2. OpenCode:
   ✓ Database found: /home/user/.local/share/opencode/opencode.db
   ✓ Found 141 sessions in database.

3. Agy (Antigravity CLI):
   ✓ Summaries DB found: /home/user/.gemini/antigravity-cli/conversation_summaries.db
   ✓ Found 83 conversation summaries.

4. Freebuff (Codebuff AI / Manicode):
   ✓ Projects directory found: /home/user/.config/manicode/projects
   ✓ Found 5 session(s) across 2 project(s).

5. Hermes Agent (Nous Research):
   ○ Not detected at /home/user/.hermes

All active agents are compatible with current agent-vault adapters.
```

---

## 📖 CLI Usage Reference

### `agent-vault sync`
Extracts and normalizes local conversation histories from all available agents into `data/sessions/` and indexes them into SQLite FTS5.

```bash
# Sync all available agents on current machine
agent-vault sync

# Dry-run: preview how many new/updated sessions and messages will be added without modifying files
agent-vault sync --dry-run
agent-vault sync -d
agent-vault sync -a freebuff -d

# Sync only a specific agent (pi, opencode, agy, freebuff, hermes)
agent-vault sync -a freebuff
agent-vault sync --agent pi
```

---

### `agent-vault search <query>`
Performs instantaneous Full-Text Search across message bodies, titles, and workspaces using SQLite FTS5.

```bash
# Search for keywords across all sessions
agent-vault search "docker compose"

# Filter by message role (user, assistant, tool)
agent-vault search "git push" -r user          # Search only what you (user) asked
agent-vault search "syntax error" -r assistant # Search assistant explanations
agent-vault search "exit code 1" -r tool       # Search terminal/tool outputs

# Filter by agent
agent-vault search "error" -a opencode
agent-vault search "mock_agents" -a freebuff

# Filter by machine name or machine ID
agent-vault search "bug fix" -m thinkpad

# Filter by workspace directory
agent-vault search "version" -w gridsight

# Limit number of results (default: 20)
agent-vault search "refactor" -l 10
```

---

### `agent-vault list`
Lists stored conversation sessions in a clean tabular view.

```bash
# List most recent 25 sessions
agent-vault list

# Filter by agent
agent-vault list -a agy
agent-vault list -a freebuff

# Filter by machine or workspace
agent-vault list -m desktop -w /home/user/projects/my-app

# Show more results
agent-vault list -l 50
```

---

### `agent-vault show <id>`
Inspects or exports the full message transcript of a specific session.

```bash
# View human-friendly colored transcript in terminal
agent-vault show freebuff_my-thinkpad-7ca7_gridsight__2026-08-31T04-52-41.015Z

# Filter transcript by role (e.g. only view user prompts trajectory)
agent-vault show <session-id> -r user

# Hide tool execution outputs to view a clean conversational dialog
agent-vault show <session-id> --no-tools

# Output raw normalized JSON (useful for piping into jq)
agent-vault show <session-id> --json

# Print session as Markdown to stdout
agent-vault show <session-id> -e md

agent-vault show <session-id> -e session_notes.md
```

---

### `agent-vault stats`
Displays total session and message counts broken down by agent and machine.

```bash
agent-vault stats
```

Output:
```text
🛡️  Agent Vault Statistics:
  Total Sessions: 396
  Total Messages: 17271
  Sessions by Agent:
    - pi: 173
    - opencode: 141
    - agy: 77
    - freebuff: 5
  Sessions by Machine:
    - my-thinkpad: 396
```

---

### `agent-vault push`
One-step automated synchronization:
1. Runs `sync` to extract any newly created local agent sessions.
2. Stages `data/` in Git.
3. Commits with an informative machine identity timestamp.
4. Pushes changes to the remote Git repository.

```bash
agent-vault push
```

---

### `agent-vault pull`
Pulls updates from remote machines via Git and automatically rebuilds the local SQLite FTS5 query index:

```bash
agent-vault pull
```

---

### `agent-vault reindex`
Rebuilds the local `.cache/vault.db` SQLite FTS5 database from the Git-tracked `data/sessions/` files. Useful after a manual `git pull` or branch checkout.

```bash
agent-vault reindex
```

---

### `agent-vault serve`
Starts a Streamable HTTP Model Context Protocol (MCP) server over Server-Sent Events (SSE).

```bash
# Start on default port 3000 (127.0.0.1:3000)
agent-vault serve

# Custom port and host
agent-vault serve --port 3847 --host 0.0.0.0
```

#### MCP Endpoints
- **SSE Stream**: `GET http://127.0.0.1:3000/sse`
- **Messages**: `POST http://127.0.0.1:3000/messages?sessionId=<uuid>`

#### Tools Exposed to AI Assistants
1. `vault_search(query, agent?, machine?, workspace?, limit?)`: Full-text search across historical conversations.
2. `vault_list(agent?, machine?, workspace?, limit?)`: List sessions with metadata.
3. `vault_get_session(sessionId)`: Retrieve complete session messages and tool traces.
4. `vault_stats()`: Retrieve statistics across agents and machines.

---

### 📦 Lifecycle Management & Maintenance

As historical sessions accumulate over months of AI agent usage, `agent-vault` provides native lifecycle management to keep Git and SQLite lightweight and fast:

#### `agent-vault archive`
Moves older conversation sessions out of `data/sessions/` into `data/archive/<agent>/` and removes them from the active SQLite FTS5 search index.

```bash
# Preview sessions older than 90 days that would be archived
agent-vault archive --before 90d --dry-run

# Archive all sessions older than 90 days (or specific date)
agent-vault archive --before 90d
agent-vault archive --before 2026-06-01

# Archive a specific session
agent-vault archive -s <session-id>
```

#### `agent-vault unarchive <session-id>`
Restores an archived session back into active `data/sessions/` and re-indexes it into SQLite.

```bash
agent-vault unarchive <session-id>
```

#### `agent-vault prune`
Trims oversized tool outputs (such as massive build logs, file listings, test runs) from older sessions while preserving all user and assistant prompts.

```bash
# Preview how many messages and MBs would be saved
agent-vault prune --older-than 30d --dry-run

# Trim oversized tool messages (>1500 chars) in sessions older than 30 days
agent-vault prune --older-than 30d --max-tool-chars 1500
```

#### `agent-vault vacuum`
Runs SQLite `VACUUM` to defragment the FTS5 full-text search index and reclaim unused disk space.

```bash
agent-vault vacuum
```

---

## 🏗️ Architecture & Data Model

```
[pi]      [opencode]      [agy]      [freebuff]      [hermes]
  │           │             │            │               │
  └───────────┴─────────────┼────────────┴───────────────┘
                            ▼
     [Agent Adapters] (Normalization & Redaction)
                            │
       ┌────────────────────┴────────────────────┐
       ▼                                         ▼
Git Canonical Layer                       Local Search Layer
data/sessions/<agent>/<session_id>.json   .cache/vault.db (SQLite FTS5)
(Version-controlled, shared across PCs)   (Ignored in git, local cache)
```

### Collision-Free Session ID Scheme
To prevent filename and database collisions when multiple machines work in parallel, every session ID embeds the machine identity and agent native ID:
```
<agent>_<machine_name>-<short_hash>_<native_id>
```
*Example:* `freebuff_ThinkPad-L560-7ca7_gridsight__2026-08-31T04-52-41.015Z`

---

## 🔒 Security & Privacy

All text ingested into `agent-vault` automatically runs through `sanitizeText()` in `src/core/sanitizer.ts`:
- **OpenAI API keys**: `sk-proj-...` -> `[REDACTED_API_KEY]`
- **Anthropic API keys**: `sk-ant-...` -> `[REDACTED_ANTHROPIC_KEY]`
- **GitHub Personal Tokens**: `ghp_...`, `gho_...` -> `[REDACTED_GITHUB_TOKEN]`
- **Google API keys**: `AIza...` -> `[REDACTED_GOOGLE_API_KEY]`
- **AWS Access Keys**: `AKIA...` -> `[REDACTED_AWS_KEY_ID]`
- **Authorization Headers**: `Bearer ...` -> `Bearer [REDACTED_BEARER_TOKEN]`

---

## 📄 License

MIT © [zzlee](https://github.com/zzlee)
