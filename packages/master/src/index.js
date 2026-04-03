/**
 * Polycast Master — HTTP server + WebSocket sync server
 *
 * HTTP :3000 — web dashboard
 * WS   :3001 — node communication
 */
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';
import { SyncServer } from './sync-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3000');
const WS_PORT   = parseInt(process.env.WS_PORT   || '3001');

// ─── Logging ────────────────────────────────────────────────────────────────

export function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(chalk.dim(`[${ts}]`) + ' ' + msg);
}

// ─── HTTP Server (dashboard + API) ──────────────────────────────────────────

const app = express();
app.use(express.json());

// Serve static dashboard
app.use(express.static(join(__dirname, 'dashboard')));

// ─── REST API ───────────────────────────────────────────────────────────────

let syncServer; // initialized below

app.get('/status', (req, res) => {
  res.json(syncServer.getStatus());
});

app.post('/command', (req, res) => {
  const { command, args = {} } = req.body;

  switch (command) {
    case 'play':
      syncServer.play();
      break;
    case 'pause':
      syncServer.pause();
      break;
    case 'seek':
      if (typeof args.timecode !== 'number') {
        return res.status(400).json({ error: 'seek requires args.timecode (number)' });
      }
      syncServer.seek(args.timecode);
      break;
    case 'sync':
      syncServer.syncAll();
      break;
    case 'load':
      if (!args.file) {
        return res.status(400).json({ error: 'load requires args.file' });
      }
      syncServer.load(args.file);
      break;
    default:
      return res.status(400).json({ error: `Unknown command: ${command}` });
  }

  res.json({ ok: true, status: syncServer.getStatus() });
});

// ─── Dashboard WebSocket (browser ↔ master) ─────────────────────────────────
// Separate from the node WebSocket — this pushes status to the browser.

const httpServer = createServer(app);
const dashboardWss = new WebSocketServer({ server: httpServer, path: '/dashboard-ws' });

dashboardWss.on('connection', (ws) => {
  log('[dashboard] browser connected');

  // Send current status immediately
  ws.send(JSON.stringify({ type: 'status', ...syncServer.getStatus() }));

  ws.on('close', () => log('[dashboard] browser disconnected'));
});

// Push status to all connected browsers every 2s
setInterval(() => {
  if (dashboardWss.clients.size === 0) return;
  const status = JSON.stringify({ type: 'status', ...syncServer.getStatus() });
  dashboardWss.clients.forEach(client => {
    if (client.readyState === 1) client.send(status);
  });
}, 2000);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  // Start sync server (nodes connect here)
  syncServer = new SyncServer(WS_PORT);
  syncServer.start();

  // Start HTTP server (dashboard)
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(chalk.bold.cyan('\n⬡  polycast master\n'));
    console.log(chalk.green(`  ✓ dashboard  `) + chalk.bold(`http://localhost:${HTTP_PORT}`));
    console.log(chalk.green(`  ✓ node sync  `) + chalk.bold(`ws://0.0.0.0:${WS_PORT}`));
    console.log(chalk.dim('\n  Waiting for nodes to connect...\n'));
  });

  // Graceful shutdown
  const shutdown = () => {
    log('[master] shutting down');
    syncServer.stop();
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(e => {
  console.error(chalk.red(`Fatal: ${e.message}`));
  process.exit(1);
});
