#!/usr/bin/env bash
# ==============================================================================
# agent-vault: Create New Data Repository & Migrate Existing History
# ==============================================================================
# Usage:
#   ./scripts/create-vault-repo.sh [target_directory] [options]
#
# Examples:
#   ./scripts/create-vault-repo.sh ../agent-vault-data
#   ./scripts/create-vault-repo.sh ../agent-vault-data --remote git@github.com:zzlee/agent-vault-data.git
# ==============================================================================

set -euo pipefail

# Text styling
BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
DIM="\033[2m"
RESET="\033[0m"

# Default configuration
DEFAULT_REPO_NAME="zzlee/agent-vault-data"
DEFAULT_TARGET_DIR="../agent-vault-data"
DEFAULT_REMOTE="https://github.com/zzlee/agent-vault-data.git"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET_DIR=""
REMOTE_URL="$DEFAULT_REMOTE"
REPO_NAME="$DEFAULT_REPO_NAME"
MIGRATE_DATA=true
CLEAN_SOURCE=false

print_help() {
  echo -e "${BOLD}agent-vault - New Data Repository Creation & Migration Tool${RESET}

Usage:
  $(basename "$0") [target_directory] [options]

Arguments:
  target_directory            Path where the new data repo will be created
                              (default: ${DEFAULT_TARGET_DIR})

Options:
  -r, --remote <url>          Git remote URL (default: ${DEFAULT_REMOTE})
  -n, --name <repo_name>      Repository name (default: ${DEFAULT_REPO_NAME})
  --no-migrate                Do not migrate existing conversation sessions
  --clean-source              Remove migrated sessions from source tool repository
  -h, --help                  Display this help message

Examples:
  $(basename "$0") ../agent-vault-data
  $(basename "$0") ../agent-vault-data --remote git@github.com:zzlee/agent-vault-data.git
"
}

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      print_help
      exit 0
      ;;
    -r|--remote)
      REMOTE_URL="$2"
      shift 2
      ;;
    -n|--name)
      REPO_NAME="$2"
      shift 2
      ;;
    --no-migrate)
      MIGRATE_DATA=false
      shift
      ;;
    --clean-source)
      CLEAN_SOURCE=true
      shift
      ;;
    -*)
      echo -e "${RED}Unknown option: $1${RESET}" >&2
      print_help
      exit 1
      ;;
    *)
      if [ -z "$TARGET_DIR" ]; then
        TARGET_DIR="$1"
      else
        echo -e "${RED}Unexpected argument: $1${RESET}" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$TARGET_DIR" ]; then
  TARGET_DIR="$DEFAULT_TARGET_DIR"
fi

# Resolve absolute path for TARGET_DIR
mkdir -p "$TARGET_DIR"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo -e "${CYAN}========================================================${RESET}"
echo -e "${BOLD}🛡️  Creating new agent-vault Data Repository${RESET}"
echo -e "${CYAN}========================================================${RESET}"
echo -e "  ${BOLD}Target Directory:${RESET}  ${TARGET_DIR}"
echo -e "  ${BOLD}Repository Name:${RESET}   ${REPO_NAME}"
echo -e "  ${BOLD}Remote URL:${RESET}        ${REMOTE_URL}"
echo -e "  ${BOLD}Migrate History:${RESET}   ${MIGRATE_DATA}"
echo -e "${CYAN}--------------------------------------------------------${RESET}"

# 1. Sanity check: Ensure Git and Node are available
if ! command -v git >/dev/null 2>&1; then
  echo -e "${RED}❌ Git is not installed. Please install Git first.${RESET}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}❌ Node.js is not installed. Please install Node.js (>= 20).${RESET}" >&2
  exit 1
fi

# 2. Check if target directory already has a Git repo
if [ -d "$TARGET_DIR/.git" ]; then
  echo -e "${YELLOW}⚠️  Warning: Target directory is already a Git repository.${RESET}"
  read -rp "Continue setup in this existing repository? (y/N) " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# 3. Create directory skeleton
echo -e "\n📁 ${BOLD}Creating directory structure...${RESET}"
mkdir -p "$TARGET_DIR/data/sessions/pi"
mkdir -p "$TARGET_DIR/data/sessions/opencode"
mkdir -p "$TARGET_DIR/data/sessions/agy"
mkdir -p "$TARGET_DIR/data/sessions/freebuff"
mkdir -p "$TARGET_DIR/data/sessions/hermes"
mkdir -p "$TARGET_DIR/.cache"
mkdir -p "$TARGET_DIR/scripts"

# Ensure .gitkeep in each adapter directory
touch "$TARGET_DIR/data/sessions/pi/.gitkeep"
touch "$TARGET_DIR/data/sessions/opencode/.gitkeep"
touch "$TARGET_DIR/data/sessions/agy/.gitkeep"
touch "$TARGET_DIR/data/sessions/freebuff/.gitkeep"
touch "$TARGET_DIR/data/sessions/hermes/.gitkeep"

# 4. Migrate existing sessions if requested
MIGRATED_COUNT=0
if [ "$MIGRATE_DATA" = true ] && [ -d "$TOOL_ROOT/data/sessions" ]; then
  echo -e "\n📦 ${BOLD}Migrating existing conversation sessions...${RESET}"
  for agent in pi opencode agy freebuff hermes; do
    if [ -d "$TOOL_ROOT/data/sessions/$agent" ]; then
      COUNT=$(find "$TOOL_ROOT/data/sessions/$agent" -name "*.json" 2>/dev/null | wc -l || echo 0)
      if [ "$COUNT" -gt 0 ]; then
        cp -f "$TOOL_ROOT/data/sessions/$agent"/*.json "$TARGET_DIR/data/sessions/$agent/" 2>/dev/null || true
        echo -e "  - ${CYAN}${agent}${RESET}: migrated ${COUNT} sessions"
        MIGRATED_COUNT=$((MIGRATED_COUNT + COUNT))
      else
        echo -e "  - ${DIM}${agent}: 0 sessions${RESET}"
      fi
    fi
  done
  echo -e "  ${GREEN}✓ Total migrated sessions:${RESET} ${BOLD}${MIGRATED_COUNT}${RESET}"
fi

# 5. Generate .agentvault marker & config
echo -e "\n⚙️  ${BOLD}Generating vault configuration files...${RESET}"
cat << EOF > "$TARGET_DIR/.agentvault"
{
  "schema_version": "1.0",
  "repository": "${REPO_NAME}",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "initial_machine": "$(hostname)"
}
EOF

# 6. Generate .gitignore
cat << 'EOF' > "$TARGET_DIR/.gitignore"
# Local query cache & SQLite database files (rebuilt locally, never tracked)
.cache/
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3

# Node modules (if any)
node_modules/

# Logs
logs/
*.log

# Environment & credentials
.env
.env.local
.env.*.local

# Operating System files
.DS_Store
Thumbs.db
EOF

# 7. Generate package.json (with convenience npm scripts)
cat << EOF > "$TARGET_DIR/package.json"
{
  "name": "agent-vault-data",
  "version": "1.0.0",
  "description": "Cross-machine conversation history data vault for AI coding agents",
  "private": true,
  "type": "module",
  "scripts": {
    "sync": "agent-vault sync",
    "sync:dry": "agent-vault sync --dry-run",
    "search": "agent-vault search",
    "list": "agent-vault list",
    "show": "agent-vault show",
    "push": "agent-vault push",
    "pull": "agent-vault pull",
    "reindex": "agent-vault reindex",
    "stats": "agent-vault stats",
    "doctor": "agent-vault doctor",
    "serve": "agent-vault serve",
    "setup": "./scripts/setup.sh"
  }
}
EOF

# 8. Generate scripts/setup.sh for freshly cloned machines
cat << 'EOF' > "$TARGET_DIR/scripts/setup.sh"
#!/usr/bin/env bash
set -e

echo "--------------------------------------------------------"
echo "🛡️  Initializing agent-vault-data on this machine..."
echo "--------------------------------------------------------"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Error: Node.js (>= 20) is required."
  exit 1
fi

# 2. Check if agent-vault CLI is installed
if ! command -v agent-vault >/dev/null 2>&1; then
  echo "⚠️  'agent-vault' CLI command was not found globally."
  echo "👉 Please install or link agent-vault:"
  echo "   git clone https://github.com/zzlee/agent-vault.git"
  echo "   cd agent-vault && npm install && npm run build && npm link"
  exit 1
fi

# 3. Create .cache directory
mkdir -p .cache

# 4. Rebuild SQLite FTS5 database from data/sessions/
echo "⚡ Building local SQLite FTS5 index..."
agent-vault reindex

echo "✅ Setup complete! You can now run:"
echo "   agent-vault sync      # Ingest new chats from this machine"
echo "   agent-vault list      # List sessions"
echo "   agent-vault search \"<keyword>\""
echo "--------------------------------------------------------"
EOF
chmod +x "$TARGET_DIR/scripts/setup.sh"

# 9. Generate README.md
cat << EOF > "$TARGET_DIR/README.md"
# ${REPO_NAME}

Private cross-machine conversation history data vault for AI coding agents (**pi**, **opencode**, **agy**, **freebuff**, and **hermes**), managed by [agent-vault](https://github.com/zzlee/agent-vault).

---

## 🏗️ Architecture & Storage Design

1. **Git-Tracked Canonical Data Layer (\`data/sessions/\`)**:
   - Formatted as standardized JSON files: \`data/sessions/<agent>/<session_id>.json\`.
   - Partitioned by agent and machine identifier to prevent Git merge conflicts.
   - Automatically sanitized (API keys and credentials redacted).
2. **Local Query Layer (\`.cache/vault.db\`)**:
   - High-performance SQLite database with Full-Text Search (FTS5).
   - Rebuilt automatically on-demand and excluded from Git.

---

## 🚀 Quick Start on This Machine

Make sure the \`agent-vault\` CLI is installed and linked:

\`\`\`bash
# 1. Ingest local conversation histories
agent-vault sync

# 2. Search messages across all machines and agents
agent-vault search "<query>"

# 3. List recent sessions
agent-vault list

# 4. Push newly synced sessions to remote repository
agent-vault push

# 5. Pull updates from other machines and rebuild local index
agent-vault pull
\`\`\`

---

## 💻 Setup on a Newly Cloned Machine

When cloning this repository to a new computer:

\`\`\`bash
# 1. Clone your private data vault
git clone ${REMOTE_URL}
cd agent-vault-data

# 2. Run one-time setup (rebuilds local SQLite FTS5 index)
./scripts/setup.sh

# 3. Ingest conversations from the new machine
agent-vault sync
\`\`\`

---

## 🔒 Security & Privacy

All session files ingested by \`agent-vault\` pass through automatic token sanitization (masking OpenAI, Anthropic, GitHub, Google, and AWS credentials) prior to disk persistence.
EOF

# 10. Initialize Git repository
echo -e "\n🌿 ${BOLD}Initializing Git repository...${RESET}"
cd "$TARGET_DIR"
if [ ! -d ".git" ]; then
  git init -b main
  echo -e "  ${GREEN}✓ Git initialized on branch 'main'${RESET}"
else
  echo -e "  ${DIM}Git already initialized.${RESET}"
fi

# Set remote origin if provided and not already present
if [ -n "$REMOTE_URL" ]; then
  if git remote | grep -q "^origin$"; then
    git remote set-url origin "$REMOTE_URL"
    echo -e "  ${GREEN}✓ Updated remote 'origin' -> ${REMOTE_URL}${RESET}"
  else
    git remote add origin "$REMOTE_URL"
    echo -e "  ${GREEN}✓ Added remote 'origin' -> ${REMOTE_URL}${RESET}"
  fi
fi

# Initial commit
git add .
if [ -n "$(git status --porcelain)" ]; then
  if [ "$MIGRATED_COUNT" -gt 0 ]; then
    git commit -m "feat(vault): initialize data repository and migrate ${MIGRATED_COUNT} conversation sessions"
    echo -e "  ${GREEN}✓ Created initial commit with ${MIGRATED_COUNT} migrated sessions!${RESET}"
  else
    git commit -m "feat(vault): initialize empty conversation data repository"
    echo -e "  ${GREEN}✓ Created initial commit with clean vault structure!${RESET}"
  fi
else
  echo -e "  ${DIM}Nothing new to commit.${RESET}"
fi

# 11. Run initial reindex in the new repository
echo -e "\n⚡ ${BOLD}Building local SQLite FTS5 index in new repository...${RESET}"
node "$TOOL_ROOT/bin/agent-vault.js" reindex

echo -e "\n${GREEN}========================================================${RESET}"
echo -e "${BOLD}🎉 Success! New data repository ready at:${RESET}"
echo -e "   ${CYAN}${TARGET_DIR}${RESET}"
echo -e "${GREEN}========================================================${RESET}"
echo -e "Next steps:"
echo -e "  1. Push this repository to GitHub:"
echo -e "     ${BOLD}cd ${TARGET_DIR} && git push -u origin main${RESET}"
echo -e "  2. Run vault commands inside the data repository:"
echo -e "     ${BOLD}agent-vault sync${RESET}"
echo -e "     ${BOLD}agent-vault search \"deploy\"${RESET}"
echo -e "     ${BOLD}agent-vault push${RESET}"
echo -e "${GREEN}--------------------------------------------------------${RESET}"
