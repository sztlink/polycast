/**
 * WebSocket sync client
 * Connects to polycast master server and handles sync commands.
 */
import WebSocket from 'ws';
import { log } from './index.js';

const SYNC_DRIFT_THRESHOLD_MS = 200;

export class SyncClient {
  constructor(config, player) {
    this.config = config;
    this.player = player;
    this.ws = null;
    this.connected = false;
    this.retryDelay = 1000;
    this.retryTimer = null;
    this.statusTimer = null;
  }

  start() {
    this._connect();
  }

  _connect() {
    const url = `ws://${this.config.masterHost}:${this.config.masterPort}`;
    log(`[sync] connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      this.retryDelay = 1000; // reset backoff
      log('[sync] connected to master');

      // Announce ourselves
      this._send({ type: 'hello', nodeId: this.config.nodeId, version: '0.1.0' });

      // Start status reporting
      this._startStatusReporting();
    });

    this.ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await this._handleCommand(msg);
      } catch (e) {
        log(`[sync] error handling message: ${e.message}`);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this._stopStatusReporting();
      log(`[sync] disconnected — retrying in ${this.retryDelay / 1000}s`);
      this._scheduleRetry();
    });

    this.ws.on('error', (err) => {
      // 'close' event will fire after error, so just log
      log(`[sync] ws error: ${err.message}`);
    });
  }

  async _handleCommand(msg) {
    switch (msg.type) {
      case 'play':
        log('[sync] command: play');
        await this.player.play();
        break;

      case 'pause':
        log('[sync] command: pause');
        await this.player.pause();
        break;

      case 'seek':
        log(`[sync] command: seek → ${msg.timecode}s`);
        await this.player.seek(msg.timecode);
        break;

      case 'load':
        log(`[sync] command: load ${msg.file}`);
        await this.player.loadFile(msg.file);
        break;

      case 'sync': {
        // Master sends its authoritative timecode + the wall-clock timestamp when it was sent
        // We compute network latency approximation and adjust if drift is too big
        const masterTimecode = msg.timecode;
        const sendTs = msg.ts;
        const nowTs = Date.now();
        const networkLatencyMs = (nowTs - sendTs) / 2; // rough estimate
        const adjustedTimecode = masterTimecode + (networkLatencyMs / 1000);

        try {
          const myTimecode = await this.player.getTimecode();
          const driftMs = Math.abs((myTimecode - adjustedTimecode) * 1000);

          if (driftMs > SYNC_DRIFT_THRESHOLD_MS) {
            log(`[sync] drift ${Math.round(driftMs)}ms — correcting`);
            await this.player.seek(adjustedTimecode);
          }
        } catch (e) {
          // player might not be ready yet
        }
        break;
      }

      default:
        log(`[sync] unknown command: ${msg.type}`);
    }
  }

  _startStatusReporting() {
    this.statusTimer = setInterval(async () => {
      if (!this.connected) return;
      try {
        const timecode = await this.player.getTimecode();
        this._send({
          type: 'status',
          nodeId: this.config.nodeId,
          state: 'playing', // TODO: track actual state from player
          timecode,
          ts: Date.now()
        });
      } catch (e) {
        // player might not be connected yet
      }
    }, 5000);
  }

  _stopStatusReporting() {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  _scheduleRetry() {
    this.retryTimer = setTimeout(() => {
      this._connect();
    }, this.retryDelay);

    // Exponential backoff, max 30s
    this.retryDelay = Math.min(this.retryDelay * 2, 30000);
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  stop() {
    this._stopStatusReporting();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.ws) this.ws.close();
  }
}
