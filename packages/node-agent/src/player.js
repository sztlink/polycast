/**
 * mpv IPC controller
 * Communicates with mpv via Unix socket (/tmp/polycast.sock)
 * mpv must be started with: --input-ipc-server=/tmp/polycast.sock
 */
import net from 'net';
import { EventEmitter } from 'events';

const SOCKET_PATH = '/tmp/polycast.sock';

export class MpvPlayer extends EventEmitter {
  constructor(socketPath = SOCKET_PATH) {
    super();
    this.socketPath = socketPath;
    this.socket = null;
    this.connected = false;
    this.requestId = 1;
    this.pending = new Map();
    this.buffer = '';
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);

      this.socket.on('connect', () => {
        this.connected = true;
        this.emit('connected');
        resolve();
      });

      this.socket.on('data', (data) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this._handleMessage(msg);
          } catch (e) {
            // ignore parse errors
          }
        }
      });

      this.socket.on('error', (err) => {
        this.connected = false;
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });
    });
  }

  _handleMessage(msg) {
    if (msg.request_id && this.pending.has(msg.request_id)) {
      const { resolve, reject } = this.pending.get(msg.request_id);
      this.pending.delete(msg.request_id);
      if (msg.error === 'success') {
        resolve(msg.data);
      } else {
        reject(new Error(msg.error));
      }
    }
    // Forward events (e.g. end-file, pause)
    if (msg.event) {
      this.emit('mpv-event', msg);
    }
  }

  _send(cmd, args = []) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('mpv socket not connected'));
        return;
      }
      const id = this.requestId++;
      const msg = JSON.stringify({ command: [cmd, ...args], request_id: id }) + '\n';
      this.pending.set(id, { resolve, reject });

      // Timeout pending requests after 3s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`mpv command timeout: ${cmd}`));
        }
      }, 3000);

      this.socket.write(msg);
    });
  }

  async play() {
    return this._send('set_property', ['pause', false]);
  }

  async pause() {
    return this._send('set_property', ['pause', true]);
  }

  async seek(timeSec) {
    return this._send('set_property', ['time-pos', timeSec]);
  }

  async getTimecode() {
    const pos = await this._send('get_property', ['time-pos']);
    return typeof pos === 'number' ? pos : 0;
  }

  async loadFile(path) {
    return this._send('loadfile', [path, 'replace']);
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
    }
  }
}
