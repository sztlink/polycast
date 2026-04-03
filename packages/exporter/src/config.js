import { readFileSync, existsSync } from 'fs';

/**
 * Loads and validates a layout.json file.
 * Returns the parsed config or throws with a clear message.
 */
export function loadLayout(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`Layout file not found: ${configPath}`);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    throw new Error(`Failed to parse layout JSON: ${e.message}`);
  }

  validateLayout(raw);
  return raw;
}

function validateLayout(config) {
  if (!config.canvas) throw new Error('Layout missing: canvas');
  if (!config.canvas.width) throw new Error('Layout missing: canvas.width');
  if (!config.canvas.height) throw new Error('Layout missing: canvas.height');
  if (!Array.isArray(config.nodes) || config.nodes.length === 0) {
    throw new Error('Layout missing: nodes (must be non-empty array)');
  }

  config.nodes.forEach((node, i) => {
    const prefix = `nodes[${i}]`;
    if (!node.id) throw new Error(`${prefix} missing: id`);
    if (!node.crop) throw new Error(`${prefix} missing: crop`);
    if (node.crop.x === undefined) throw new Error(`${prefix} missing: crop.x`);
    if (node.crop.y === undefined) throw new Error(`${prefix} missing: crop.y`);
    if (!node.crop.w) throw new Error(`${prefix} missing: crop.w`);
    if (!node.crop.h) throw new Error(`${prefix} missing: crop.h`);
  });
}

/**
 * Returns the per-node config that will be written to dist/{nodeId}/config.json
 * This is what node-agent reads at startup.
 */
export function nodeConfig(layoutConfig, node) {
  return {
    nodeId: node.id,
    masterHost: layoutConfig.master?.host || 'localhost',
    masterPort: layoutConfig.master?.port || 3001,
    videoFile: '/opt/polycast/content/video.mp4',
    canvas: layoutConfig.canvas,
    crop: node.crop,
    blend: node.blend || {}
  };
}
