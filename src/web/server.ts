import http from 'node:http';
import { URL } from 'node:url';
import zlib from 'node:zlib';
import { exec } from 'node:child_process';
import pc from 'picocolors';
import { VaultDB } from '../core/db.js';
import { renderWebUiHtml } from './ui.js';

export interface WebServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  openBrowser?: boolean;
}

function sendJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  data: unknown,
  statusCode = 200
): void {
  const jsonStr = JSON.stringify(data);
  const acceptEncoding = (req.headers['accept-encoding'] as string) || '';

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (acceptEncoding.includes('gzip') && jsonStr.length > 1024) {
    res.setHeader('Content-Encoding', 'gzip');
    res.writeHead(statusCode);
    res.end(zlib.gzipSync(Buffer.from(jsonStr, 'utf-8')));
  } else {
    res.writeHead(statusCode);
    res.end(jsonStr);
  }
}

export function createWebRequestHandler(db: VaultDB) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      res.writeHead(204);
      res.end();
      return true;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;

    // 1. API: Search
    if (pathname === '/api/search' && req.method === 'GET') {
      const q = parsedUrl.searchParams.get('q') || '';
      const agent = parsedUrl.searchParams.get('agent') || undefined;
      const role = parsedUrl.searchParams.get('role') || undefined;
      const machine = parsedUrl.searchParams.get('machine') || undefined;
      const workspace = parsedUrl.searchParams.get('workspace') || undefined;
      const since = parsedUrl.searchParams.get('since') || undefined;
      const until = parsedUrl.searchParams.get('until') || undefined;
      const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '20', 10);

      const result = db.searchPaged(q, {
        agent,
        role,
        machine,
        workspace,
        since,
        until,
        page,
        limit,
        highlight: { open: '<mark>', close: '</mark>' },
      });

      sendJson(req, res, result);
      return true;
    }

    // 2. API: Sessions List (Paged)
    if (pathname === '/api/sessions' && req.method === 'GET') {
      const agent = parsedUrl.searchParams.get('agent') || undefined;
      const machine = parsedUrl.searchParams.get('machine') || undefined;
      const workspace = parsedUrl.searchParams.get('workspace') || undefined;
      const search = parsedUrl.searchParams.get('search') || undefined;
      const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '25', 10);

      const result = db.listSessionsPaged({
        agent,
        machine,
        workspace,
        search,
        page,
        limit,
      });

      sendJson(req, res, result);
      return true;
    }

    // 3. API: Session Detail
    if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.replace('/api/sessions/', ''));
      const role = parsedUrl.searchParams.get('role') || undefined;
      const noTools = parsedUrl.searchParams.get('noTools') === 'true';

      const data = db.getSession(id, { role, noTools });
      if (!data) {
        sendJson(req, res, { error: `Session not found: ${id}` }, 404);
      } else {
        sendJson(req, res, data);
      }
      return true;
    }

    // 4. API: Workspaces
    if (pathname === '/api/workspaces' && req.method === 'GET') {
      const search = parsedUrl.searchParams.get('search') || undefined;
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
      const workspaces = db.listWorkspaces({ search, limit });
      sendJson(req, res, workspaces);
      return true;
    }

    // 5. API: Stats
    if (pathname === '/api/stats' && req.method === 'GET') {
      const stats = db.getStats();
      const machines = db.listMachines();
      const agents = db.listAgents();
      sendJson(req, res, {
        ...stats,
        machineList: machines,
        agentList: agents,
      });
      return true;
    }

    // 6. Web UI Root
    if (pathname === '/' || pathname === '/index.html') {
      const acceptHeader = req.headers['accept'] || '';
      // If a client explicitly asks for application/json at / and not HTML, let MCP / health handle it
      if (acceptHeader.includes('text/html') || !acceptHeader.includes('application/json')) {
        const html = renderWebUiHtml();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.writeHead(200);
        res.end(html);
        return true;
      }
    }

    return false;
  };
}

export async function startWebServer(options: WebServerOptions = {}): Promise<http.Server> {
  const port = options.port || 3333;
  const host = options.host || '127.0.0.1';
  // Open DB in readonly mode for optimal high-concurrency read performance
  const db = new VaultDB(options.dbPath, { readonly: true });
  const handler = createWebRequestHandler(db);

  const server = http.createServer(async (req, res) => {
    try {
      const handled = await handler(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      console.log(pc.bold(pc.cyan('🌐 Agent Vault Web Server Started!')));
      console.log(`   ${pc.green('•')} URL:             ${pc.bold(pc.underline(url))}`);
      console.log(`   ${pc.green('•')} Mode:            ${pc.dim('Interactive Fast FTS5 Search')}`);
      console.log(`   ${pc.green('•')} REST API:        ${pc.dim(`${url}/api/search`)}`);
      console.log(pc.gray('\nPress Ctrl+C to stop.'));

      if (options.openBrowser) {
        const startCmd =
          process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${startCmd} ${url}`, () => {
          // ignore errors when opening browser
        });
      }

      resolve(server);
    });
  });
}
