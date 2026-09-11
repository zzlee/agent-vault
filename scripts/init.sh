#!/usr/bin/env bash
set -e

# ==============================================================================
# agent-vault Fresh Clone Setup & Initialization Script
# ==============================================================================

echo "--------------------------------------------------------"
echo "🛡️  Initializing agent-vault on this machine..."
echo "--------------------------------------------------------"

# 1. Check Node.js version
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Error: Node.js is not installed. Please install Node.js (>= 20)."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "⚠️ Warning: Recommended Node.js version is >= 20. Current: $(node -v)"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 2. Install dependencies if node_modules does not exist
if [ ! -d "node_modules" ]; then
  echo "📦 Installing npm dependencies..."
  npm install
else
  echo "✓ Dependencies already installed."
fi

# 3. Build project TypeScript -> dist
echo "🔨 Building project..."
npm run build

# 4. Ensure data and cache directories exist
mkdir -p .cache
mkdir -p data/sessions/pi
mkdir -p data/sessions/opencode
mkdir -p data/sessions/agy

# 5. Run initial re-index if there are existing sessions
echo "⚡ Setting up local SQLite FTS5 database index..."
node bin/agent-vault.js reindex

# 6. Check npm link
echo ""
echo "💡 Tip: To run 'agent-vault' globally from anywhere in your shell,"
echo "   you can execute: npm link"
echo ""
echo "✅ Initialization complete! You can now run:"
echo "   agent-vault sync      # Ingest local chat histories"
echo "   agent-vault list      # List all stored sessions"
echo "   agent-vault search \"<keyword>\""
echo "--------------------------------------------------------"
