/**
 * Polycast Sync Server
 * Manages WebSocket connections from nodes, tracks state, broadcasts sync pulses.
 */
import { WebSocketServer } from 'ws';
import { log } from './index.js';

const NODE_TIMEOUT_MS = 15000;   // mark as disconnected after 15s silence
const SYNC_INTERVAL_MS = 1000;   // sync pulse every 1s
const DRIFT_WARN_MS = 500;       // flag node in dashboard if drift > 500ms

export class SyncServer {
  constructor(port = 3001) {
    this.port = port;
    this.wss = null;

    // Node registry: nodeId → { ws, state, timecode, driftMs, lastSeen, connected }
    this.nodes = new Map();

    // Master playback clock
    this.masterTimecode = 0;
    this.masterPlaying = false;
    this.masterStartedAt = null; // wall clock when play was called

    this.syncTimer = null;
    this.timeoutTimer = null;
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('listening', () => {
      log(`[sync-server] WebSocket listening on :${this.port}`);
    });

    this.wss.on('connection', (ws) => {
      let nodeId = null;

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          nodeId = this._handleMessage(ws, msg, nodeId);
        } catch (e) {
          log(`[sync-server] parse error: ${e.message}`);
        }
      });

      ws.on('close', () => {
        if (nodeId && this.nodes.has(nodeId)) {
          const node = this.nodes.get(nodeId);
          node.connected = false;
          node.ws = null;
          log(`[sync-server] node disconnected: ${nodeId}`);
        }
      });

      ws.on('error', (err) => {
        log(`[sync-server] ws error (${nodeId || 'unknown'}): ${err.message}`);
      });
    });

    // Start sync pulse
    this.syncTimer = setInterval(() => this._sendSyncPulse(), SYNC_INTERVAL_MS);

    // Check for timed-out nodes
    this.timeoutTimer = setInterval(() => this._checkTimeouts(), 5000);
  }

  _handleMessage(ws, msg, currentNodeId) {
    switch (msg.type) {
      case 'hello': {
        const id = msg.nodeId;
        this.nodes.set(id, {
          ws,
          nodeId: id,
          version: msg.version,
          state: 'idle',
          timecode: 0,
          driftMs: 0,
          lastSeen: Date.now(),
          connected: true
        });
        log(`[sync-server] node registered: ${id} (v${msg.version})`);
        return id;
      }

      case 'status': {
        const id = msg.nodeId || currentNodeId;
        if (id && this.nodes.has(id)) {
          const node = this.nodes.get(id);
          const driftMs = Math.abs((msg.timecode - this._currentMasterTimecode()) * 1000);
          node.state = msg.state;
          node.timecode = msg.timecode;
          node.driftMs = Math.round(driftMs);
          node.lastSeen = Date.now();
          node.connected = true;

          if (driftMs > DRIFT_WARN_MS) {
            log(`[sync-server] ⚠ ${id} drift ${Math.round(driftMs)}ms`);
          }
        }
        return currentNodeId;
      }

      default:
        return currentNodeId;
    }
  }

  _currentMasterTimecode() {
    if (!this.masterPlaying || !this.masterStartedAt) return this.masterTimecode;
    const elapsed = (Date.now() - this.masterStartedAt) / 1000;
    return this.masterTimecode + elapsed;
  }

  _sendSyncPulse() {
    if (this.nodes.size === 0) return;
    const msg = JSON.stringify({
      type: 'sync',
      timecode: this._currentMasterTimecode(),
      ts: Date.now()
    });
    for (const node of this.nodes.values()) {
      if (node.connected && node.ws && node.ws.readyState === 1) {
        node.ws.send(msg);
      }
    }
  }

  _checkTimeouts() {
    const now = Date.now();
    for (const node of this.nodes.values()) {
      if (node.connected && (now - node.lastSeen) > NODE_TIMEOUT_MS) {
        node.connected = false;
        log(`[sync-server] node timed out: ${node.nodeId}`);
      }
    }
  }

  // ─── Commands ─────────────────────────────────────────────────────────────

  broadcast(msg) {
    const data = JSON.stringify(msg);
    let count = 0;
    for (const node of this.nodes.values()) {
      if (node.connected && node.ws && node.ws.readyState === 1) {
        node.ws.send(data);
        count++;
      }
    }
    return count;
  }

  play() {
    this.masterTimecode = this._currentMasterTimecode();
    this.masterPlaying = true;
    this.masterStartedAt = Date.now();
    const count = this.broadcast({ type: 'play' });
    log(`[sync-server] play → ${count} nodes`);
    return count;
  }

  pause() {
    this.masterTimecode = this._currentMasterTimecode();
    this.masterPlaying = false;
    this.masterStartedAt = null;
    const count = this.broadcast({ type: 'pause' });
    log(`[sync-server] pause → ${count} nodes`);
    return count;
  }

  seek(timecode) {
    this.masterTimecode = timecode;
    this.masterStartedAt = this.masterPlaying ? Date.now() : null;
    const count = this.broadcast({ type: 'seek', timecode });
    log(`[sync-server] seek ${timecode}s → ${count} nodes`);
    return count;
  }

  syncAll() {
    // Force all nodes to seek to current master timecode
    const tc = this._currentMasterTimecode();
    const count = this.broadcast({ type: 'seek', timecode: tc });
    log(`[sync-server] sync-all @ ${tc.toFixed(2)}s → ${count} nodes`);
    return count;
  }

  load(filename) {
    const count = this.broadcast({ type: 'load', file: filename });
    log(`[sync-server] load ${filename} → ${count} nodes`);
    return count;
  }

  getStatus() {
    const nodeList = Array.from(this.nodes.values()).map(n => ({
      nodeId: n.nodeId,
      connected: n.connected,
      state: n.state,
      timecode: n.timecode,
      driftMs: n.driftMs,
      lastSeen: n.lastSeen,
      version: n.version
    }));

    return {
      master: {
        playing: this.masterPlaying,
        timecode: this._currentMasterTimecode()
      },
      nodes: nodeList,
      connectedCount: nodeList.filter(n => n.connected).length,
      totalCount: nodeList.length
    };
  }

  stop() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.timeoutTimer) clearInterval(this.timeoutTimer);
    if (this.wss) this.wss.close();
  }
}
