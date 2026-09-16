/**
 * Self-contained Single Page Application (HTML/CSS/JS) for Agent Vault Web UI.
 * Zero external CDN or asset dependencies - works 100% offline and air-gapped.
 */
export function renderWebUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Vault • Cross-Agent Conversation Search</title>
  <style>
    :root {
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      
      /* Light Mode */
      --bg-body: #f8fafc;
      --bg-surface: #ffffff;
      --bg-surface-hover: #f1f5f9;
      --bg-surface-active: #e2e8f0;
      --bg-input: #ffffff;
      --bg-code: #f1f5f9;
      --border: #e2e8f0;
      --border-focus: #3b82f6;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --text-subtle: #94a3b8;
      
      --role-user-bg: #eff6ff;
      --role-user-border: #bfdbfe;
      --role-user-text: #1e40af;
      --role-asst-bg: #ffffff;
      --role-asst-border: #e2e8f0;
      --role-asst-text: #0f172a;
      --role-tool-bg: #0f172a;
      --role-tool-border: #1e293b;
      --role-tool-text: #e2e8f0;
      --role-think-bg: #faf5ff;
      --role-think-border: #e9d5ff;
      --role-think-text: #7e22ce;
      
      --mark-bg: #fef08a;
      --mark-text: #854d0e;
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    }

    html.dark {
      /* Dark Mode */
      --bg-body: #090d16;
      --bg-surface: #0f172a;
      --bg-surface-hover: #1e293b;
      --bg-surface-active: #273548;
      --bg-input: #0b1120;
      --bg-code: #060a12;
      --border: #1e293b;
      --border-focus: #38bdf8;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-subtle: #64748b;
      
      --role-user-bg: #172554;
      --role-user-border: #1e3a8a;
      --role-user-text: #93c5fd;
      --role-asst-bg: #0f172a;
      --role-asst-border: #1e293b;
      --role-asst-text: #f1f5f9;
      --role-tool-bg: #050811;
      --role-tool-border: #1e293b;
      --role-tool-text: #cbd5e1;
      --role-think-bg: #2e1065;
      --role-think-border: #581c87;
      --role-think-text: #d8b4fe;
      
      --mark-bg: #854d0e;
      --mark-text: #fef08a;
      --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.3);
      --shadow-md: 0 4px 8px -1px rgb(0 0 0 / 0.4);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background-color: var(--bg-body);
      color: var(--text-main);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* Top Bar */
    header {
      height: 54px;
      min-height: 54px;
      background-color: var(--bg-surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.25rem;
      z-index: 20;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      font-weight: 700;
      font-size: 1.1rem;
      color: var(--text-main);
      text-decoration: none;
    }
    .brand-icon {
      font-size: 1.3rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .brand-version {
      font-size: 0.75rem;
      font-weight: 600;
      background: var(--bg-surface-hover);
      color: var(--text-muted);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .header-stats {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .stat-item {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .stat-num {
      font-weight: 700;
      color: var(--text-main);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .btn-icon {
      background: var(--bg-surface-hover);
      border: 1px solid var(--border);
      color: var(--text-muted);
      width: 32px;
      height: 32px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 0.95rem;
      transition: all 0.15s ease;
    }
    .btn-icon:hover {
      background: var(--bg-surface-active);
      color: var(--text-main);
    }

    /* Main Container (Split Panes) */
    .workspace-layout {
      flex: 1;
      display: flex;
      height: calc(100vh - 54px);
      overflow: hidden;
    }

    /* Left Sidebar: Search & Results */
    .sidebar-pane {
      width: 440px;
      min-width: 380px;
      max-width: 580px;
      background-color: var(--bg-surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      height: 100%;
      resize: horizontal;
      overflow: hidden;
    }
    .search-section {
      padding: 1rem 1.15rem 0.75rem;
      border-bottom: 1px solid var(--border);
      background-color: var(--bg-surface);
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-input {
      width: 100%;
      height: 40px;
      padding: 0 2.4rem 0 2.4rem;
      background-color: var(--bg-input);
      border: 1.5px solid var(--border);
      border-radius: 8px;
      color: var(--text-main);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .search-input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }
    .search-icon-left {
      position: absolute;
      left: 0.75rem;
      color: var(--text-subtle);
      font-size: 1rem;
      pointer-events: none;
    }
    .search-clear-btn {
      position: absolute;
      right: 0.65rem;
      background: none;
      border: none;
      color: var(--text-subtle);
      cursor: pointer;
      font-size: 1.1rem;
      padding: 0.2rem;
      display: none;
      border-radius: 4px;
    }
    .search-clear-btn:hover { color: var(--text-main); }
    .search-spinner {
      position: absolute;
      right: 0.75rem;
      width: 16px;
      height: 16px;
      border: 2px solid var(--text-subtle);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      display: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Filters */
    .filter-pills-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      overflow-x: auto;
      padding-bottom: 0.2rem;
      scrollbar-width: none;
    }
    .filter-pills-row::-webkit-scrollbar { display: none; }
    .pill {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      background: var(--bg-surface-hover);
      border: 1px solid var(--border);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .pill:hover {
      background: var(--bg-surface-active);
      color: var(--text-main);
    }
    .pill.active {
      background: #2563eb;
      color: #ffffff;
      border-color: #2563eb;
    }
    .sub-filters-row {
      display: flex;
      gap: 0.5rem;
    }
    .sub-select, .sub-input {
      flex: 1;
      height: 28px;
      font-size: 0.76rem;
      background: var(--bg-input);
      border: 1px solid var(--border);
      color: var(--text-main);
      border-radius: 5px;
      padding: 0 0.45rem;
      outline: none;
    }
    .sub-select:focus, .sub-input:focus { border-color: var(--border-focus); }

    /* Results Header / Tabs */
    .results-meta-bar {
      padding: 0.6rem 1.15rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      background-color: var(--bg-surface);
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .results-count {
      font-weight: 600;
      color: var(--text-main);
    }
    .pagination-mini {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .page-btn {
      background: var(--bg-surface-hover);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
      font-size: 0.72rem;
      cursor: pointer;
    }
    .page-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Results Scroll Area */
    .results-list-container {
      flex: 1;
      overflow-y: auto;
      background-color: var(--bg-body);
      padding: 0.65rem;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .result-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.85rem;
      cursor: pointer;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .result-card:hover {
      background: var(--bg-surface-hover);
      border-color: var(--border-focus);
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }
    .result-card.selected {
      border-color: #3b82f6;
      background: var(--bg-surface-active);
      box-shadow: 0 0 0 1px #3b82f6;
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .badge-agent {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      color: #fff;
    }
    .badge-agent.pi { background-color: #f97316; }
    .badge-agent.opencode { background-color: #10b981; }
    .badge-agent.agy { background-color: #0284c7; }
    .badge-agent.freebuff { background-color: #8b5cf6; }
    .badge-agent.hermes { background-color: #f43f5e; }
    .badge-agent.codex { background-color: #0d9488; }
    
    .badge-role {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0.12rem 0.35rem;
      border-radius: 4px;
      background: var(--bg-surface-hover);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .badge-role.thinking {
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
      border-color: rgba(168, 85, 247, 0.3);
    }
    .card-date {
      font-size: 0.72rem;
      color: var(--text-subtle);
    }
    .card-title {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.35;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .card-workspace {
      font-size: 0.72rem;
      color: var(--text-muted);
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-snippet {
      font-size: 0.8rem;
      color: var(--text-muted);
      line-height: 1.4;
      background: var(--bg-code);
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      font-family: var(--font-mono);
      overflow: hidden;
      word-break: break-word;
    }
    mark {
      background-color: var(--mark-bg);
      color: var(--mark-text);
      font-weight: 600;
      border-radius: 2px;
      padding: 0 0.15rem;
    }

    /* Right Viewer Pane */
    .viewer-pane {
      flex: 1;
      background-color: var(--bg-body);
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .session-header-bar {
      min-height: 64px;
      background-color: var(--bg-surface);
      border-bottom: 1px solid var(--border);
      padding: 0.85rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      z-index: 10;
    }
    .session-title-group {
      flex: 1;
      overflow: hidden;
    }
    .session-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text-main);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 0.25rem;
    }
    .session-meta-tags {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      flex-wrap: wrap;
    }
    .session-action-btns {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .btn-action {
      font-size: 0.78rem;
      font-weight: 600;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      background: var(--bg-surface-hover);
      border: 1px solid var(--border);
      color: var(--text-main);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      transition: all 0.15s ease;
    }
    .btn-action:hover {
      background: var(--bg-surface-active);
    }
    .btn-action.active {
      background: #3b82f6;
      color: #fff;
      border-color: #3b82f6;
    }

    /* Messages Stream */
    .messages-stream-container {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      padding: 1.5rem 2rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .message-item {
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      min-height: min-content;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-sm);
    }
    .message-item.role-user {
      border-color: var(--role-user-border);
      background-color: var(--role-user-bg);
    }
    .message-item.role-assistant {
      border-color: var(--role-asst-border);
      background-color: var(--role-asst-bg);
    }
    .message-item.role-tool {
      border-color: var(--role-tool-border);
      background-color: var(--role-tool-bg);
    }
    .message-item.role-thinking {
      border-color: var(--role-think-border);
      background-color: var(--role-think-bg);
    }
    .message-meta-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--border);
      font-size: 0.75rem;
      background: rgba(0, 0, 0, 0.03);
    }
    html.dark .message-meta-header {
      background: rgba(255, 255, 255, 0.03);
    }
    .message-role-label {
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .role-user .message-role-label { color: var(--role-user-text); }
    .role-assistant .message-role-label { color: #38bdf8; }
    .role-tool .message-role-label { color: #a855f7; }
    .role-thinking .message-role-label { color: var(--role-think-text); }

    .message-body {
      padding: 1rem;
      font-size: 0.92rem;
      line-height: 1.65;
      color: var(--text-main);
      overflow-x: auto;
      word-break: break-word;
    }
    .role-tool .message-body {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--role-tool-text);
      line-height: 1.45;
      white-space: pre-wrap;
    }

    /* Markdown styling inside assistant message */
    .message-body pre {
      background: var(--bg-code);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.85rem;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      margin: 0.6rem 0;
    }
    .message-body code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--bg-code);
      padding: 0.15rem 0.35rem;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .message-body p { margin-bottom: 0.65rem; }
    .message-body p:last-child { margin-bottom: 0; }
    .message-body ul, .message-body ol { margin: 0.5rem 0 0.5rem 1.4rem; }

    /* Tool collapse preview */
    .tool-expand-bar {
      padding: 0.4rem 1rem;
      background: rgba(0, 0, 0, 0.2);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tool-expand-btn {
      background: none;
      border: none;
      color: #93c5fd;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .tool-expand-btn:hover { text-decoration: underline; }

    /* Empty States */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      text-align: center;
      padding: 2rem;
      gap: 0.75rem;
    }
    .empty-icon { font-size: 2.8rem; }
    .empty-title { font-size: 1.15rem; font-weight: 700; color: var(--text-main); }
    .empty-desc { font-size: 0.85rem; max-width: 320px; line-height: 1.5; }
  </style>
</head>
<body>
  <!-- Header -->
  <header>
    <div class="brand">
      <span class="brand-icon">🛡️</span>
      <span>Agent Vault</span>
      <span class="brand-version">v1.2.0</span>
    </div>

    <div class="header-stats">
      <div class="stat-item">
        <span>Messages:</span>
        <span class="stat-num" id="stat-messages">-</span>
      </div>
      <div class="stat-item">
        <span>Sessions:</span>
        <span class="stat-num" id="stat-sessions">-</span>
      </div>
      <div class="stat-item">
        <span>Agents:</span>
        <span class="stat-num" id="stat-agents">6</span>
      </div>
    </div>

    <div class="header-actions">
      <button class="btn-icon" id="theme-toggle" title="Toggle Dark / Light theme">🌓</button>
    </div>
  </header>

  <!-- Workspace Split Panes -->
  <div class="workspace-layout">
    <!-- Left Sidebar -->
    <aside class="sidebar-pane">
      <div class="search-section">
        <div class="search-input-wrapper">
          <span class="search-icon-left">🔍</span>
          <input type="text" id="search-input" class="search-input" placeholder="Search conversations across all agents..." autocomplete="off" autofocus />
          <button id="search-clear" class="search-clear-btn" title="Clear search">×</button>
          <div id="search-spinner" class="search-spinner"></div>
        </div>

        <!-- Filter Pills for Agents -->
        <div class="filter-pills-row" id="agent-filters">
          <button class="pill active" data-agent="">All Agents</button>
          <button class="pill" data-agent="pi">pi</button>
          <button class="pill" data-agent="opencode">opencode</button>
          <button class="pill" data-agent="agy">agy</button>
          <button class="pill" data-agent="freebuff">freebuff</button>
          <button class="pill" data-agent="hermes">hermes</button>
          <button class="pill" data-agent="codex">codex</button>
        </div>

        <!-- Secondary Filters: Role, Machine, Workspace -->
        <div class="sub-filters-row">
          <select id="role-filter" class="sub-select" title="Filter by role">
            <option value="">All Roles</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
            <option value="thinking">Thinking (CoT)</option>
            <option value="tool">Tool</option>
          </select>

          <select id="machine-filter" class="sub-select" title="Filter by machine">
            <option value="">All Machines</option>
          </select>

          <input type="text" id="workspace-filter" class="sub-input" placeholder="Filter workspace..." />
        </div>
      </div>

      <!-- Results Meta & Pager -->
      <div class="results-meta-bar">
        <span class="results-count" id="results-count-label">Loading sessions...</span>
        <div class="pagination-mini" id="pagination-controls" style="display: none;">
          <button class="page-btn" id="page-prev" disabled>◀ Prev</button>
          <span id="page-indicator">1 / 1</span>
          <button class="page-btn" id="page-next" disabled>Next ▶</button>
        </div>
      </div>

      <!-- Results List -->
      <div class="results-list-container" id="results-container">
        <!-- Result Cards Rendered Here -->
      </div>
    </aside>

    <!-- Right Viewer Pane -->
    <main class="viewer-pane">
      <div class="session-header-bar" id="viewer-header" style="display: none;">
        <div class="session-title-group">
          <h2 class="session-title" id="viewer-title">-</h2>
          <div class="session-meta-tags">
            <span class="badge-agent" id="viewer-agent">pi</span>
            <span id="viewer-machine">-</span>
            <span>•</span>
            <span id="viewer-workspace" style="font-family: var(--font-mono);">-</span>
            <span>•</span>
            <span id="viewer-date">-</span>
            <span>•</span>
            <span id="viewer-msgcount">- msgs</span>
          </div>
        </div>

        <div class="session-action-btns">
          <button class="btn-action" id="btn-toggle-tools" title="Toggle Tool outputs on/off">
            <span>⚙️ Tools</span>
          </button>
          <button class="btn-action" id="btn-copy-id" title="Copy Session ID">
            <span>📋 Copy ID</span>
          </button>
          <button class="btn-action" id="btn-export-md" title="Export as Markdown">
            <span>⬇ Markdown</span>
          </button>
        </div>
      </div>

      <div class="messages-stream-container" id="messages-container">
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <div class="empty-title">Select a session or search</div>
          <div class="empty-desc">Explore chat histories, tool executions, and solutions across all machines and agents.</div>
        </div>
      </div>
    </main>
  </div>

  <script>
    // State management
    const state = {
      query: '',
      agent: '',
      role: '',
      machine: '',
      workspace: '',
      page: 1,
      pageSize: 20,
      totalPages: 1,
      totalCount: 0,
      activeSessionId: null,
      hideTools: false,
      currentSessionData: null,
      lruCache: new Map(), // queryKey -> { data, timestamp }
      activeAbortController: null,
    };

    // DOM Elements
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const searchSpinner = document.getElementById('search-spinner');
    const agentFilters = document.getElementById('agent-filters');
    const roleFilter = document.getElementById('role-filter');
    const machineFilter = document.getElementById('machine-filter');
    const workspaceFilter = document.getElementById('workspace-filter');
    const resultsContainer = document.getElementById('results-container');
    const resultsCountLabel = document.getElementById('results-count-label');
    const paginationControls = document.getElementById('pagination-controls');
    const pagePrev = document.getElementById('page-prev');
    const pageNext = document.getElementById('page-next');
    const pageIndicator = document.getElementById('page-indicator');
    
    const viewerHeader = document.getElementById('viewer-header');
    const viewerTitle = document.getElementById('viewer-title');
    const viewerAgent = document.getElementById('viewer-agent');
    const viewerMachine = document.getElementById('viewer-machine');
    const viewerWorkspace = document.getElementById('viewer-workspace');
    const viewerDate = document.getElementById('viewer-date');
    const viewerMsgCount = document.getElementById('viewer-msgcount');
    const messagesContainer = document.getElementById('messages-container');
    const btnToggleTools = document.getElementById('btn-toggle-tools');
    const btnCopyId = document.getElementById('btn-copy-id');
    const btnExportMd = document.getElementById('btn-export-md');
    const themeToggle = document.getElementById('theme-toggle');

    // Stats
    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('stat-messages').textContent = (data.totalMessages || 0).toLocaleString();
        document.getElementById('stat-sessions').textContent = (data.totalSessions || 0).toLocaleString();
        
        if (data.machines) {
          const mList = Array.isArray(data.machines) ? data.machines : Object.keys(data.machines);
          machineFilter.innerHTML = '<option value="">All Machines</option>' +
            mList.map(m => {
              const name = typeof m === 'object' ? (m.machineName || m.machineId) : m;
              return \`<option value="\${name}">\${name}</option>\`;
            }).join('');
        }
      } catch (err) {
        console.error('Failed to load stats:', err);
      }
    }

    // Debounce helper
    function debounce(fn, delay = 200) {
      let timer = null;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    }

    function getCacheKey() {
      return JSON.stringify({
        q: state.query,
        agent: state.agent,
        role: state.role,
        machine: state.machine,
        ws: state.workspace,
        page: state.page,
      });
    }

    async function executeSearch() {
      if (state.activeAbortController) {
        state.activeAbortController.abort();
      }
      state.activeAbortController = new AbortController();

      const cacheKey = getCacheKey();
      if (state.lruCache.has(cacheKey)) {
        renderSearchResults(state.lruCache.get(cacheKey));
        return;
      }

      searchSpinner.style.display = 'block';
      searchClear.style.display = state.query ? 'block' : 'none';

      try {
        const params = new URLSearchParams();
        if (state.query.trim()) params.set('q', state.query.trim());
        if (state.agent) params.set('agent', state.agent);
        if (state.role) params.set('role', state.role);
        if (state.machine) params.set('machine', state.machine);
        if (state.workspace.trim()) params.set('workspace', state.workspace.trim());
        params.set('page', state.page.toString());
        params.set('limit', state.pageSize.toString());

        const endpoint = state.query.trim() ? '/api/search' : '/api/sessions';
        const res = await fetch(\`\${endpoint}?\${params.toString()}\`, {
          signal: state.activeAbortController.signal,
        });

        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();

        // Put in LRU Cache (limit 40)
        if (state.lruCache.size > 40) {
          const firstKey = state.lruCache.keys().next().value;
          state.lruCache.delete(firstKey);
        }
        state.lruCache.set(cacheKey, data);

        renderSearchResults(data);
      } catch (err) {
        if (err.name === 'AbortError') return;
        resultsContainer.innerHTML = \`<div class="empty-state"><div class="empty-title">Search Error</div><div class="empty-desc">\${err.message}</div></div>\`;
      } finally {
        searchSpinner.style.display = 'none';
      }
    }

    const debouncedSearch = debounce(() => {
      state.page = 1;
      executeSearch();
    }, 200);

    function renderSearchResults(data) {
      const items = data.results || data.sessions || [];
      state.totalCount = data.total || 0;
      state.totalPages = data.totalPages || 1;

      // Update Header
      if (state.query.trim()) {
        resultsCountLabel.textContent = \`\${state.totalCount.toLocaleString()} matches\`;
      } else {
        resultsCountLabel.textContent = \`\${state.totalCount.toLocaleString()} sessions\`;
      }

      // Update Pagination
      if (state.totalPages > 1) {
        paginationControls.style.display = 'flex';
        pageIndicator.textContent = \`\${state.page} / \${state.totalPages}\`;
        pagePrev.disabled = state.page <= 1;
        pageNext.disabled = state.page >= state.totalPages;
      } else {
        paginationControls.style.display = 'none';
      }

      if (items.length === 0) {
        resultsContainer.innerHTML = \`
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <div class="empty-title">No conversations found</div>
            <div class="empty-desc">Try loosening your search keywords or clearing filters.</div>
          </div>\`;
        return;
      }

      resultsContainer.innerHTML = items.map((item) => {
        const isMatch = !!item.snippet;
        const sessionId = isMatch ? item.sessionId : item.id;
        const agent = item.agent || 'pi';
        const title = item.title || '(untitled)';
        const dateStr = (item.updatedAt || '').replace('T', ' ').slice(0, 16);
        const workspace = item.workspace ? item.workspace.split('/').filter(Boolean).slice(-2).join('/') : '';
        const role = item.role ? \`<span class="badge-role \${item.role}">\${item.role === 'thinking' ? '🧠 thinking' : item.role}</span>\` : '';
        const isSelected = state.activeSessionId === sessionId;

        return \`
          <div class="result-card \${isSelected ? 'selected' : ''}" data-session-id="\${sessionId}">
            <div class="card-top">
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <span class="badge-agent \${agent}">\${agent}</span>
                \${role}
              </div>
              <span class="card-date">\${dateStr}</span>
            </div>
            <div class="card-title">\${title}</div>
            \${workspace ? \`<div class="card-workspace">📁 \${workspace}</div>\` : ''}
            \${item.snippet ? \`<div class="card-snippet">\${item.snippet}</div>\` : ''}
          </div>
        \`;
      }).join('');

      // Auto-select first item if none active
      if (!state.activeSessionId && items.length > 0) {
        const firstId = items[0].sessionId || items[0].id;
        loadSession(firstId);
      }
    }

    async function loadSession(sessionId) {
      if (!sessionId) return;
      state.activeSessionId = sessionId;

      // Update card selection highlight
      document.querySelectorAll('.result-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.sessionId === sessionId);
      });

      viewerHeader.style.display = 'flex';
      messagesContainer.innerHTML = \`<div class="empty-state"><div class="search-spinner" style="display:block; width:28px; height:28px;"></div><div style="margin-top:1rem;">Loading conversation...</div></div>\`;

      try {
        const res = await fetch(\`/api/sessions/\${encodeURIComponent(sessionId)}\`);
        if (!res.ok) throw new Error('Session not found');
        const data = await res.json();
        state.currentSessionData = data;
        renderSessionView(data);
      } catch (err) {
        messagesContainer.innerHTML = \`<div class="empty-state"><div class="empty-title">Error</div><div class="empty-desc">\${err.message}</div></div>\`;
      }
    }

    function renderSessionView(data) {
      const s = data.session;
      viewerTitle.textContent = s.title || '(untitled)';
      viewerAgent.className = \`badge-agent \${s.agent}\`;
      viewerAgent.textContent = s.agent;
      viewerMachine.textContent = s.machineName || s.machineId || 'local';
      viewerWorkspace.textContent = s.workspace || 'N/A';
      viewerDate.textContent = (s.updatedAt || '').replace('T', ' ').slice(0, 16);
      viewerMsgCount.textContent = \`\${data.messages.length} msgs\`;

      const isToolMsg = (m) => m.role === 'tool' || (typeof m.content === 'string' && m.content.startsWith('[Tool Call:'));
      const visibleMsgs = state.hideTools ? data.messages.filter(m => !isToolMsg(m)) : data.messages;

      if (visibleMsgs.length === 0) {
        messagesContainer.innerHTML = \`<div class="empty-state"><div class="empty-title">No messages to display</div></div>\`;
        return;
      }

      messagesContainer.innerHTML = visibleMsgs.map((m, idx) => {
        const rawRole = (m.role || '').toLowerCase();
        const isTool = isToolMsg(m);
        const isUser = rawRole === 'user';
        const isThinking = rawRole === 'thinking' || (!isUser && !isTool && typeof m.content === 'string' && m.content.startsWith('[Reasoning]'));
        const isAsst = !isUser && !isTool && !isThinking;
        const displayRole = isTool ? 'tool' : isThinking ? 'thinking' : rawRole;
        const time = m.timestamp ? m.timestamp.replace('T', ' ').slice(11, 19) : '';
        const step = m.stepIndex != null ? \`#\${m.stepIndex}\` : '';
        
        let bodyHtml = '';
        if (isTool) {
          // Collapse oversized tool messages
          const isOversized = m.content && m.content.length > 1500;
          if (isOversized) {
            const preview = escapeHtml(m.content.slice(0, 800));
            const full = escapeHtml(m.content);
            bodyHtml = \`
              <div class="tool-content-box" data-expanded="false">
                <div class="tool-text-preview">\${preview}...</div>
                <div class="tool-text-full" style="display:none;">\${full}</div>
                <div class="tool-expand-bar">
                  <button class="tool-expand-btn" onclick="toggleToolExpand(this)">
                    ▶ Expand output (\${m.content.length.toLocaleString()} chars)
                  </button>
                </div>
              </div>
            \`;
          } else {
            bodyHtml = escapeHtml(m.content);
          }
        } else if (isThinking) {
          const isOversized = m.content && m.content.length > 1500;
          let cleanThinking = typeof m.content === 'string' ? m.content : '';
          if (cleanThinking.startsWith('[Reasoning]')) {
            cleanThinking = cleanThinking.replace('[Reasoning]', '').trim();
          }
          if (isOversized) {
            const preview = formatMarkdown(cleanThinking.slice(0, 600));
            const full = formatMarkdown(cleanThinking);
            bodyHtml = \`
              <div class="tool-content-box" data-expanded="false">
                <div class="tool-text-preview">\${preview}...</div>
                <div class="tool-text-full" style="display:none;">\${full}</div>
                <div class="tool-expand-bar">
                  <button class="tool-expand-btn" onclick="toggleToolExpand(this)">
                    🧠 Expand reasoning trace (\${cleanThinking.length.toLocaleString()} chars)
                  </button>
                </div>
              </div>
            \`;
          } else {
            bodyHtml = formatMarkdown(cleanThinking);
          }
        } else {
          bodyHtml = formatMarkdown(m.content);
        }

        const roleLabel = isUser ? '👤 User' : isThinking ? '🧠 Thinking' : isAsst ? '🤖 Assistant' : (rawRole === 'tool' ? '⚙️ Tool Output' : '⚙️ Tool Call');

        return \`
          <div class="message-item role-\${displayRole}">
            <div class="message-meta-header">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <span class="message-role-label">\${roleLabel}</span>
                \${step ? \`<span style="color:var(--text-subtle)">\${step}</span>\` : ''}
              </div>
              <span style="color:var(--text-subtle)">\${time}</span>
            </div>
            <div class="message-body">\${bodyHtml}</div>
          </div>
        \`;
      }).join('');
    }

    window.toggleToolExpand = function(btn) {
      const box = btn.closest('.tool-content-box');
      const isExpanded = box.dataset.expanded === 'true';
      const preview = box.querySelector('.tool-text-preview');
      const full = box.querySelector('.tool-text-full');
      if (isExpanded) {
        preview.style.display = 'block';
        full.style.display = 'none';
        box.dataset.expanded = 'false';
        btn.textContent = '▶ Expand output';
      } else {
        preview.style.display = 'none';
        full.style.display = 'block';
        box.dataset.expanded = 'true';
        btn.textContent = '▼ Collapse output';
      }
    };

    function escapeHtml(str) {
      return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Fast lightweight markdown parser
    function formatMarkdown(content) {
      if (!content) return '';
      let text = escapeHtml(content);

      // Fenced code blocks
      text = text.replace(new RegExp('\\x60\\x60\\x60([\\\\w-]*)\\n([\\\\s\\\\S]*?)\\x60\\x60\\x60', 'g'), function(match, lang, code) {
        return '<pre><code class="lang-' + lang + '">' + code.trim() + '</code></pre>';
      });

      // Inline code
      text = text.replace(new RegExp('\\x60([^\\x60]+)\\x60', 'g'), '<code>$1</code>');

      // Bold & Italic
      text = text.replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>');
      text = text.replace(/\\*([^\\*]+)\\*/g, '<em>$1</em>');

      // Line breaks to paragraphs
      const paragraphs = text.split(/\\n\\n+/).map(function(p) {
        if (p.startsWith('<pre') || p.startsWith('<ul') || p.startsWith('<ol')) return p;
        return '<p>' + p.replace(/\\n/g, '<br/>') + '</p>';
      });

      return paragraphs.join('');
    }

    // Event Listeners
    searchInput.addEventListener('input', (e) => {
      state.query = e.target.value;
      debouncedSearch();
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      state.query = '';
      searchInput.focus();
      state.page = 1;
      executeSearch();
    });

    agentFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.pill');
      if (!btn) return;
      agentFilters.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      state.agent = btn.dataset.agent || '';
      state.page = 1;
      executeSearch();
    });

    roleFilter.addEventListener('change', (e) => {
      state.role = e.target.value;
      state.page = 1;
      executeSearch();
    });

    machineFilter.addEventListener('change', (e) => {
      state.machine = e.target.value;
      state.page = 1;
      executeSearch();
    });

    workspaceFilter.addEventListener('input', debounce((e) => {
      state.workspace = e.target.value;
      state.page = 1;
      executeSearch();
    }, 250));

    resultsContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.result-card');
      if (card && card.dataset.sessionId) {
        loadSession(card.dataset.sessionId);
      }
    });

    pagePrev.addEventListener('click', () => {
      if (state.page > 1) {
        state.page--;
        executeSearch();
      }
    });

    pageNext.addEventListener('click', () => {
      if (state.page < state.totalPages) {
        state.page++;
        executeSearch();
      }
    });

    btnToggleTools.addEventListener('click', () => {
      state.hideTools = !state.hideTools;
      btnToggleTools.classList.toggle('active', state.hideTools);
      const span = btnToggleTools.querySelector('span');
      if (span) span.textContent = state.hideTools ? '⚙️ Tools Hidden' : '⚙️ Tools';
      if (state.currentSessionData) {
        renderSessionView(state.currentSessionData);
      }
    });

    btnCopyId.addEventListener('click', () => {
      if (state.activeSessionId) {
        navigator.clipboard.writeText(state.activeSessionId);
        btnCopyId.innerHTML = '<span>✓ Copied!</span>';
        setTimeout(() => { btnCopyId.innerHTML = '<span>📋 Copy ID</span>'; }, 1500);
      }
    });

    btnExportMd.addEventListener('click', () => {
      if (!state.currentSessionData) return;
      const s = state.currentSessionData.session;
      let md = '# ' + s.title + '\\n\\n';
      md += '- **ID:** \\x60' + s.id + '\\x60\\n';
      md += '- **Agent:** \\x60' + s.agent + '\\x60\\n';
      md += '- **Machine:** \\x60' + (s.machineName || s.machineId) + '\\x60\\n';
      md += '- **Workspace:** \\x60' + (s.workspace || 'N/A') + '\\x60\\n\\n---\\n\\n';
      for (const m of state.currentSessionData.messages) {
        md += '### [' + m.role.toUpperCase() + '] ' + (m.timestamp ? '_(' + m.timestamp + ')_' : '') + '\\n\\n';
        md += m.content + '\\n\\n---\\n\\n';
      }
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = s.id + '.md';
      a.click();
    });

    // Theme toggle
    themeToggle.addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      const isDark = document.documentElement.classList.contains('dark');
      localStorage.setItem('agent-vault-theme', isDark ? 'dark' : 'light');
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'Escape') {
        if (document.activeElement === searchInput) {
          searchInput.blur();
        }
      }
    });

    // Init Theme
    const savedTheme = localStorage.getItem('agent-vault-theme');
    if (savedTheme === 'light') {
      document.documentElement.classList.remove('dark');
    }

    // Initial Load
    loadStats();
    executeSearch();
  </script>
</body>
</html>`;
}
