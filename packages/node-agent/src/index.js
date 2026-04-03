/**
 * polycast node-agent
 * Entry point — loads config, starts watchdog + player + sync client.
 *
 * Config file: /opt/polycast/config.json (or POLYCAST_CONFIG env var)
 * Log file: ~/polycast.log (or POLYCAST_LOG env var)
 */
import { readFileSync, existsSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { MpvPlayer } from './player.js';
import { MpvWatchdog } from './watchdog.js';
import { SyncClient } from './sync.js';

const CONFIG_PATH = process.env.POLYCAST_CONFIG || '/opt/polycast/config.json';
const LOG_PATH = process.env.POLYCAST_LOG || join(homedir(), 'polycast.log');

// ─── Logging ────────────────────────────────────────────────────────────────

export function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_PATH, line + '\n');
  } catch (e) {
    // log file write failure should never crash the agent
  }
}

// ─── Load Config ────────────────────────────────────────────────────────────

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    // Fallback defaults for development/testing
    log(`[config] ${CONFIG_PATH} not found — using defaults`);
    return {
      nodeId: `node-${process.env.HOSTNAME || 'unknown'}`,
      masterHost: process.env.MASTER_HOST || 'localhost',
      masterPort: parseInt(process.env.MASTER_PORT || '3001'),
      videoFile: process.env.VIDEO_FILE || '/opt/polycast/content/video.mp4'
    };
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    log(`[config] loaded: nodeId=${raw.nodeId} master=${raw.masterHost}:${raw.masterPort}`);
    return raw;
  } catch (e) {
    log(`[config] ERROR reading config: ${e.message}`);
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log('─────────────────────────────────────');
  log('polycast node-agent v0.1.0 starting');
  log('─────────────────────────────────────');

  const config = loadConfig();
  log(`[main] nodeId: ${config.nodeId}`);
  log(`[main] video: ${config.videoFile}`);
  log(`[main] master: ${config.masterHost}:${config.masterPort}`);

  // Start mpv watchdog
  const watchdog = new MpvWatchdog(config);
  const player = new MpvPlayer();
  const syncClient = new SyncClient(config, player);

  // When mpv starts, connect player IPC
  watchdog.on('started', async () => {
    let attempts = 0;
    const MAX_ATTEMPTS = 10;

    // Retry connecting to mpv socket
    const tryConnect = async () => {
      try {
        await player.connect();
        log('[main] connected to mpv IPC');
        // Start sync client after player is ready
        syncClient.start();
      } catch (e) {
        attempts++;
        if (attempts < MAX_ATTEMPTS) {
          setTimeout(tryConnect, 500);
        } else {
          log(`[main] failed to connect to mpv after ${MAX_ATTEMPTS} attempts`);
        }
      }
    };

    await tryConnect();
  });

  // When mpv dies, disconnect player and stop sync
  watchdog.on('died', () => {
    player.close();
    // syncClient keeps running, will reconnect when mpv restarts
  });

  // Start the watchdog
  watchdog.start();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log('[main] SIGTERM received — shutting down');
    syncClient.stop();
    watchdog.stop();
    setTimeout(() => process.exit(0), 1000);
  });

  process.on('SIGINT', () => {
    log('[main] SIGINT received — shutting down');
    syncClient.stop();
    watchdog.stop();
    setTimeout(() => process.exit(0), 1000);
  });
}

main().catch(e => {
  log(`[main] FATAL: ${e.message}`);
  process.exit(1);
});
