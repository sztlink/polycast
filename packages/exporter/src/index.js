#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import { writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { loadLayout, nodeConfig } from './config.js';
import { sliceVideo, ensureNodeDir } from './slicer.js';

program
  .name('polycast-export')
  .description('Split a master video into per-node slices with edge blending')
  .requiredOption('-i, --input <file>', 'Master video file')
  .requiredOption('-c, --config <file>', 'Layout JSON file')
  .requiredOption('-o, --output <dir>', 'Output directory', './dist')
  .option('--no-blend', 'Skip blend filter (faster, for testing)')
  .parse(process.argv);

const opts = program.opts();

async function run() {
  const inputPath = resolve(opts.input);
  const configPath = resolve(opts.config);
  const outputDir = resolve(opts.output);

  // Validate
  if (!existsSync(inputPath)) {
    console.error(chalk.red(`✗ Input file not found: ${inputPath}`));
    process.exit(1);
  }

  console.log(chalk.bold.cyan('\n⬡  polycast-export\n'));

  // Load layout
  let layout;
  try {
    layout = loadLayout(configPath);
  } catch (e) {
    console.error(chalk.red(`✗ ${e.message}`));
    process.exit(1);
  }

  const { nodes, canvas } = layout;
  console.log(chalk.dim(`  canvas: ${canvas.width}×${canvas.height} @ ${canvas.fps || 25}fps`));
  console.log(chalk.dim(`  nodes: ${nodes.length}`));
  console.log(chalk.dim(`  output: ${outputDir}\n`));

  // Process each node
  let errors = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nodeDir = ensureNodeDir(outputDir, node.id);
    const videoOut = join(nodeDir, 'video.mp4');
    const configOut = join(nodeDir, 'config.json');

    console.log(chalk.bold(`[${i + 1}/${nodes.length}] ${node.id}`));
    console.log(chalk.dim(`  crop: x=${node.crop.x} y=${node.crop.y} w=${node.crop.w} h=${node.crop.h}`));
    if (node.blend) {
      const bl = node.blend;
      const parts = [];
      if (bl.left) parts.push(`left=${bl.left}px`);
      if (bl.right) parts.push(`right=${bl.right}px`);
      console.log(chalk.dim(`  blend: ${parts.join(', ') || 'none'}`));
    }

    const blendConfig = opts.blend ? (node.blend || {}) : {};

    try {
      let lastPct = -1;
      await sliceVideo(
        inputPath,
        videoOut,
        node.crop,
        blendConfig,
        canvas,
        (current, total) => {
          const pct = total === '?' ? current : Math.min(100, Math.round((current / total) * 100));
          if (pct !== lastPct) {
            process.stdout.write(`\r  ${chalk.green('▶')} encoding... ${pct}%   `);
            lastPct = pct;
          }
        }
      );
      process.stdout.write('\r');
      console.log(chalk.green(`  ✓ video.mp4`));

      // Write node config
      const cfg = nodeConfig(layout, node);
      writeFileSync(configOut, JSON.stringify(cfg, null, 2));
      console.log(chalk.green(`  ✓ config.json`));

    } catch (e) {
      process.stdout.write('\r');
      console.error(chalk.red(`  ✗ Error: ${e.message}`));
      errors++;
    }

    console.log();
  }

  // Summary
  if (errors === 0) {
    console.log(chalk.bold.green(`✓ Export complete — ${nodes.length} nodes → ${outputDir}`));
    console.log(chalk.dim('\nNext step: polycast-deploy --config layout.json --dist ' + outputDir));
  } else {
    console.log(chalk.bold.yellow(`⚠ Export finished with ${errors} error(s)`));
    process.exit(1);
  }
}

run().catch(e => {
  console.error(chalk.red(`\nFatal: ${e.message}`));
  process.exit(1);
});
