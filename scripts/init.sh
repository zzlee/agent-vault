#!/usr/bin/env bash
set -e

# ==============================================================================
# agent-vault Fresh Clone CLI Setup & Link Script
# ==============================================================================

echo "--------------------------------------------------------"
echo "🛡️  Building and linking agent-vault CLI on this machine..."
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

# 2b. Ensure better-sqlite3 native binding exists
# (npm v11+ blocks install scripts by default; missing binding causes
# "Could not locate the bindings file" at runtime, especially after a
# Node.js upgrade which invalidates prebuilt binaries.)
if [ ! -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
  echo "🔧 Native binding for better-sqlite3 missing — building..."
  if npm install-scripts ls >/dev/null 2>&1; then
    npm install-scripts approve better-sqlite3 esbuild >/dev/null 2>&1 || true
  fi
  npm rebuild better-sqlite3 || npm install --build-from-source better-sqlite3
fi

# 3. Build project TypeScript -> dist
echo "🔨 Building project..."
npm run build

# 4. Globally link CLI command
echo "🔗 Linking 'agent-vault' command globally via npm link..."
npm link || {
  echo "⚠️ Note: 'npm link' requires global write permission. You can also run: node bin/agent-vault.js"
}

echo "✅ CLI setup complete! You can now run:"
echo "   agent-vault doctor    # Diagnose local agents and environment"
echo "   agent-vault --help    # View available commands"
echo "--------------------------------------------------------"
