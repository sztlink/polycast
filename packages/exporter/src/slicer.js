import { spawn } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Builds the ffmpeg geq filter string for edge blending.
 * Applies linear luminance ramp at left/right edges.
 *
 * @param {number} w - video width in pixels
 * @param {object} blend - { left?: number, right?: number } overlap sizes
 */
function buildBlendFilter(w, blend = {}) {
  const lo = blend.left || 0;
  const ro = blend.right || 0;

  if (lo === 0 && ro === 0) return null;

  // Linear ramp: left edge 0→1 over `lo` px, right edge 1→0 over `ro` px
  const leftRamp  = lo > 0 ? `min(X/${lo}.0,1)` : '1';
  const rightRamp = ro > 0 ? `min((${w}-X)/${ro}.0,1)` : '1';
  const factor = lo > 0 && ro > 0
    ? `(${leftRamp})*(${rightRamp})`
    : lo > 0 ? leftRamp : rightRamp;

  // Apply to luma and chroma channels
  return [
    `geq=`,
    `lum='lum(X\\,Y)*${factor}':`,
    `cb='128+(cb(X\\,Y)-128)*${factor}':`,
    `cr='128+(cr(X\\,Y)-128)*${factor}'`
  ].join('');
}

/**
 * Slices the master video for a single node.
 * Applies crop + blend in a single ffmpeg pass.
 *
 * @param {string} inputPath - path to master video
 * @param {string} outputPath - path to output video
 * @param {object} crop - { x, y, w, h }
 * @param {object} blend - { left?, right? }
 * @param {object} canvas - { fps? }
 * @param {function} onProgress - called with (currentFrame, totalFrames)
 */
export async function sliceVideo(inputPath, outputPath, crop, blend, canvas, onProgress) {
  // Build filter chain
  const filters = [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`];

  const blendFilter = buildBlendFilter(crop.w, blend);
  if (blendFilter) {
    filters.push(blendFilter);
  }

  const filterStr = filters.join(',');

  const args = [
    '-i', inputPath,
    '-vf', filterStr,
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'slow',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y', // overwrite
    outputPath
  ];

  return new Promise((resolve, reject) => {
    // First get duration for progress reporting
    let totalFrames = null;
    let duration = null;
    const fps = canvas?.fps || 25;

    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrBuf = '';

    ff.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;

      // Parse duration once
      if (!duration) {
        const durMatch = stderrBuf.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        if (durMatch) {
          const h = parseInt(durMatch[1]);
          const m = parseInt(durMatch[2]);
          const s = parseFloat(durMatch[3]);
          duration = h * 3600 + m * 60 + s;
          totalFrames = Math.round(duration * fps);
        }
      }

      // Parse progress
      const frameMatch = text.match(/frame=\s*(\d+)/);
      if (frameMatch && onProgress) {
        const current = parseInt(frameMatch[1]);
        onProgress(current, totalFrames || '?');
      }
    });

    ff.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Extract last error line
        const lines = stderrBuf.trim().split('\n');
        const lastLines = lines.slice(-5).join('\n');
        reject(new Error(`ffmpeg exited with code ${code}:\n${lastLines}`));
      }
    });

    ff.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          'ffmpeg not found. Install it:\n' +
          '  Windows: https://ffmpeg.org/download.html (add to PATH)\n' +
          '  Ubuntu:  sudo apt install ffmpeg\n' +
          '  macOS:   brew install ffmpeg'
        ));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Creates the output directory for a node.
 */
export function ensureNodeDir(outputBase, nodeId) {
  const dir = join(outputBase, nodeId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
