import type { SearchResult } from '../core/types.js';

export function formatSearchHtml(results: SearchResult[], query: string): string {
  // We need to fetch full contents rather than just the snippet to show in HTML,
  // but if only snippet is available from search, we'll display that.
  // We'll generate a single self-contained HTML file.

  const sanitizeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const title = `Search Results: ${sanitizeHtml(query)}`;

  // Collect unique agents, machines, and roles for filters
  const agents = new Set<string>();
  const machines = new Set<string>();
  const roles = new Set<string>();

  for (const r of results) {
    agents.add(r.agent);
    machines.add(r.machineName || r.machineId);
    roles.add(r.role);
  }

  const agentsList = Array.from(agents).sort();
  const machinesList = Array.from(machines).sort();
  const rolesList = Array.from(roles).sort();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg-color: #f9fafb;
      --text-color: #1f2937;
      --card-bg: #ffffff;
      --border-color: #e5e7eb;
      --primary: #3b82f6;
      --user-bg: #fdf6e3;
      --user-border: #fce7b1;
      --assistant-bg: #f0f9ff;
      --assistant-border: #bae6fd;
      --tool-bg: #fdf4ff;
      --tool-border: #f5d0fe;
      --system-bg: #f3f4f6;
      --system-border: #d1d5db;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-color: #111827;
        --text-color: #e5e7eb;
        --card-bg: #1f2937;
        --border-color: #374151;
        --user-bg: #3f3113;
        --user-border: #71551a;
        --assistant-bg: #0c4a6e;
        --assistant-border: #0369a1;
        --tool-bg: #4a044e;
        --tool-border: #86198f;
        --system-bg: #374151;
        --system-border: #4b5563;
      }
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-color);
      line-height: 1.6;
      margin: 0;
      padding: 0;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    header {
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1rem;
    }

    h1 {
      margin-top: 0;
      font-size: 1.8rem;
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      background: var(--card-bg);
      padding: 1rem;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      margin-bottom: 2rem;
      position: sticky;
      top: 1rem;
      z-index: 10;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .filter-group-title {
      font-weight: 600;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .checkbox-labels {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .checkbox-labels label {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.9rem;
      cursor: pointer;
      user-select: none;
    }

    .results {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .result-card {
      background: var(--card-bg);
      border-radius: 8px;
      border: 1px solid var(--border-color);
      overflow: hidden;
      transition: opacity 0.2s;
    }

    .result-header {
      padding: 1rem;
      background: rgba(0,0,0,0.02);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .result-meta {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .result-title {
      font-weight: 600;
      font-size: 1.1rem;
    }

    .result-subtitle {
      font-size: 0.85rem;
      opacity: 0.8;
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-block;
      padding: 0.1rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-agent {
      background: var(--text-color);
      color: var(--bg-color);
    }

    .badge-machine {
      background: var(--border-color);
      color: var(--text-color);
    }

    .result-content {
      padding: 1rem;
    }

    .message {
      padding: 1rem;
      border-radius: 6px;
      border-width: 1px;
      border-style: solid;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.9rem;
    }

    .message.role-user {
      background: var(--user-bg);
      border-color: var(--user-border);
    }

    .message.role-assistant {
      background: var(--assistant-bg);
      border-color: var(--assistant-border);
    }

    .message.role-tool {
      background: var(--tool-bg);
      border-color: var(--tool-border);
    }

    .message.role-system {
      background: var(--system-bg);
      border-color: var(--system-border);
    }

    .role-label {
      font-weight: bold;
      margin-bottom: 0.5rem;
      display: block;
      text-transform: uppercase;
      font-family: sans-serif;
      font-size: 0.8rem;
    }

    .empty-state {
      padding: 3rem;
      text-align: center;
      color: var(--text-color);
      opacity: 0.7;
      background: var(--card-bg);
      border-radius: 8px;
      border: 1px dashed var(--border-color);
      display: none;
    }

    /* Terminal color escapes stripping in snippet */
    .snippet-highlight {
      background-color: rgba(250, 204, 21, 0.3);
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Search Results</h1>
      <p>Query: <strong>${sanitizeHtml(query)}</strong> • Found ${results.length} matches</p>
    </header>

    <div class="filters">
      <div class="filter-group">
        <div class="filter-group-title">Agent</div>
        <div class="checkbox-labels">
          ${agentsList.map(a => `<label><input type="checkbox" class="filter-agent" value="${a}" checked> ${a}</label>`).join('')}
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-group-title">Machine</div>
        <div class="checkbox-labels">
          ${machinesList.map(m => `<label><input type="checkbox" class="filter-machine" value="${m}" checked> ${m}</label>`).join('')}
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-group-title">Role</div>
        <div class="checkbox-labels">
          ${rolesList.map(r => `<label><input type="checkbox" class="filter-role" value="${r}" checked> ${r}</label>`).join('')}
        </div>
      </div>
    </div>

    <div class="results" id="results-container">
      ${results.map((r, index) => {
        const dateStr = r.updatedAt ? r.updatedAt.replace('T', ' ').slice(0, 16) : '';
        const machine = r.machineName || r.machineId;
        const roleClass = `role-${r.role.toLowerCase()}`;

        // Let's replace ANSI highlights with HTML tags
        // The SQLite snippet might contain actual escape bytes OR literal backslash-x-1-b strings.
        let htmlSnippet = r.snippet
          .replace(/\\x1b\[33m\\x1b\[1m/g, '<span class="snippet-highlight">')
          .replace(/\\x1b\[0m/g, '</span>')
          .replace(/\x1b\[33m\x1b\[1m/g, '<span class="snippet-highlight">')
          .replace(/\x1b\[0m/g, '</span>')
          .replace(/</g, '&lt;').replace(/>/g, '&gt;') // prevent HTML injection from raw content
          // Fix the replaced highlight tags
          .replace(/&lt;span class="snippet-highlight"&gt;/g, '<span class="snippet-highlight">')
          .replace(/&lt;\/span&gt;/g, '</span>');

        return `
        <div class="result-card" data-agent="${r.agent}" data-machine="${machine}" data-role="${r.role}">
          <div class="result-header">
            <div class="result-meta">
              <div class="result-title">${r.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
              <div class="result-subtitle">
                <span>Session ID: ${r.sessionId}</span>
                ${r.workspace ? `<span>Workspace: ${r.workspace}</span>` : ''}
                <span>${dateStr}</span>
              </div>
            </div>
            <div class="result-badges">
              <span class="badge badge-agent">${r.agent}</span>
              <span class="badge badge-machine">${machine}</span>
            </div>
          </div>
          <div class="result-content">
            <div class="message ${roleClass}">
              <span class="role-label">${r.role}</span>
              ${htmlSnippet}
            </div>
          </div>
        </div>
        `;
      }).join('')}

      <div class="empty-state" id="empty-state">
        No results match the selected filters.
      </div>
    </div>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const cards = document.querySelectorAll('.result-card');
      const emptyState = document.getElementById('empty-state');

      const agentCheckboxes = document.querySelectorAll('.filter-agent');
      const machineCheckboxes = document.querySelectorAll('.filter-machine');
      const roleCheckboxes = document.querySelectorAll('.filter-role');

      function updateFilters() {
        const selectedAgents = Array.from(agentCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
        const selectedMachines = Array.from(machineCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
        const selectedRoles = Array.from(roleCheckboxes).filter(cb => cb.checked).map(cb => cb.value);

        let visibleCount = 0;

        cards.forEach(card => {
          const agent = card.dataset.agent;
          const machine = card.dataset.machine;
          const role = card.dataset.role;

          if (
            selectedAgents.includes(agent) &&
            selectedMachines.includes(machine) &&
            selectedRoles.includes(role)
          ) {
            card.style.display = 'block';
            visibleCount++;
          } else {
            card.style.display = 'none';
          }
        });

        if (visibleCount === 0 && cards.length > 0) {
          emptyState.style.display = 'block';
        } else {
          emptyState.style.display = 'none';
        }
      }

      agentCheckboxes.forEach(cb => cb.addEventListener('change', updateFilters));
      machineCheckboxes.forEach(cb => cb.addEventListener('change', updateFilters));
      roleCheckboxes.forEach(cb => cb.addEventListener('change', updateFilters));
    });
  </script>
</body>
</html>`;
}
