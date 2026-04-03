/**
 * Polycast Dashboard — vanilla JS, no framework
 * Connects to master via WebSocket and renders node status in real time.
 */

const WS_URL = `ws://${location.host}/dashboard-ws`;
const API_URL = `${location.protocol}//${location.host}`;

// ─── State ───────────────────────────────────────────────────────────────────

let ws = null;
let wsConnected = false;
let nodes = [];
let masterState = { playing: false, timecode: 0 };

// ─── DOM refs ────────────────────────────────────────────────────────────────

const nodesGrid      = document.getElementById('nodes-grid');
const masterStateEl  = document.getElementById('master-state');
const masterTcEl     = document.getElementById('master-tc');
const connDot        = document.getElementById('connection-status');
const connLabel      = document.getElementById('connection-label');

// ─── WebSocket ───────────────────────────────────────────────────────────────

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsConnected = true;
    connDot.className = 'conn-dot connected';
    connLabel.textContent = 'connected to master';
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'status') {
        nodes = msg.nodes || [];
        masterState = msg.master || { playing: false, timecode: 0 };
        render();
      }
    } catch (err) {
      console.warn('WS parse error', err);
    }
  };

  ws.onclose = () => {
    wsConnected = false;
    connDot.className = 'conn-dot disconnected';
    connLabel.textContent = 'disconnected — reconnecting…';
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// ─── API commands ────────────────────────────────────────────────────────────

async function sendCommand(command, args = {}) {
  try {
    const resp = await fetch(`${API_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, args })
    });
    if (!resp.ok) {
      const err = await resp.json();
      console.error('Command error:', err);
    }
  } catch (e) {
    console.error('Command failed:', e);
  }
}

// ─── Render ──────────────────────────────────────────────────────────────────

function formatTimecode(secs) {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function driftClass(driftMs) {
  if (driftMs === undefined || driftMs === null) return 'drift-ok';
  if (driftMs < 200) return 'drift-ok';
  if (driftMs < 500) return 'drift-warn';
  return 'drift-crit';
}

function renderNode(node) {
  const dotClass = !node.connected ? '' : node.driftMs > 500 ? 'warn' : 'connected';
  const cardClass = !node.connected ? 'disconnected' : node.driftMs > 500 ? 'connected drift-warn' : 'connected';
  const dc = driftClass(node.driftMs);

  return `
    <div class="node-card ${cardClass}" data-node="${node.nodeId}">
      <div class="node-header">
        <span class="node-id">${node.nodeId}</span>
        <span class="node-dot ${dotClass}"></span>
      </div>
      <div class="node-rows">
        <div class="node-row">
          <span>status</span>
          <span>${node.connected ? node.state || 'connected' : 'offline'}</span>
        </div>
        <div class="node-row">
          <span>timecode</span>
          <span>${formatTimecode(node.timecode || 0)}</span>
        </div>
        <div class="node-row">
          <span>drift</span>
          <span class="${dc}">${node.connected ? (node.driftMs || 0) + ' ms' : '—'}</span>
        </div>
        <div class="node-row">
          <span>version</span>
          <span>${node.version || '—'}</span>
        </div>
      </div>
    </div>
  `;
}

function render() {
  // Master header
  masterStateEl.textContent = masterState.playing ? 'playing' : 'paused';
  masterStateEl.className = 'badge' + (masterState.playing ? ' playing' : '');
  masterTcEl.textContent = formatTimecode(masterState.timecode || 0);

  // Nodes
  if (nodes.length === 0) {
    nodesGrid.innerHTML = '<div class="empty-state">Waiting for nodes to connect…</div>';
    return;
  }

  nodesGrid.innerHTML = nodes.map(renderNode).join('');
}

// ─── Controls ────────────────────────────────────────────────────────────────

document.getElementById('btn-play').addEventListener('click', () => sendCommand('play'));
document.getElementById('btn-pause').addEventListener('click', () => sendCommand('pause'));
document.getElementById('btn-sync').addEventListener('click', () => sendCommand('sync'));
document.getElementById('btn-restart').addEventListener('click', () => sendCommand('seek', { timecode: 0 }));

// ─── Init ─────────────────────────────────────────────────────────────────────

connect();
render(); // initial empty render
