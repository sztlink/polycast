/**
 * mpv process watchdog
 * Starts mpv and restarts it if it dies.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { log } from './index.js';

const SOCKET_PATH = '/tmp/polycast.sock';
const RESTART_DELAY_MS = 2000;

export class MpvWatchdog extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.process = null;
    this.running = false;
    this.restartTimer = null;
  }

  start() {
    this.running = true;
    this._launch();
  }

  _launch() {
    const videoFile = this.config.videoFile;

    // Check if video file exists (might not be deployed yet)
    const args = [
      '--input-ipc-server=' + SOCKET_PATH,
      '--loop=inf',
      '--fullscreen',
      '--no-osc',         // hide OSD controls
      '--no-input-default-bindings', // disable keyboard shortcuts
      '--cursor-autohide=always',
      '--really-quiet',
    ];

    // Only load file if it exists; otherwise mpv shows a black screen
    if (existsSync(videoFile)) {
      args.push(videoFile);
    } else {
      log(`[watchdog] video not found at ${videoFile} — starting mpv without file`);
      // mpv will idle until we send loadfile
      args.push('--idle');
    }

    log(`[watchdog] launching mpv`);
    this.process = spawn('mpv', args, {
      stdio: 'ignore',
      detached: false
    });

    this.process.on('spawn', () => {
      log(`[watchdog] mpv started (pid ${this.process.pid})`);
      // Give mpv a moment to create the socket
      setTimeout(() => {
        this.emit('started');
      }, 500);
    });

    this.process.on('exit', (code, signal) => {
      log(`[watchdog] mpv exited (code=${code} signal=${signal})`);
      this.emit('died');

      if (this.running) {
        log(`[watchdog] restarting mpv in ${RESTART_DELAY_MS / 1000}s`);
        this.restartTimer = setTimeout(() => {
          this._launch();
        }, RESTART_DELAY_MS);
      }
    });

    this.process.on('error', (err) => {
      if (err.code === 'ENOENT') {
        log('[watchdog] FATAL: mpv not found. Install: sudo apt install mpv');
      } else {
        log(`[watchdog] mpv spawn error: ${err.message}`);
      }
    });
  }

  stop() {
    this.running = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.process) {
      this.process.kill('SIGTERM');
    }
  }
}
