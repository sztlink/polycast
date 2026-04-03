#!/usr/bin/env node
/**
 * polycast-deploy
 * Rsyncs each node's dist folder to the correct host via SSH.
 *
 * Usage:
 *   polycast-deploy --config layout.json --dist ./dist --user polycast
 *
 * Requirements:
 *   - rsync installed on this machine
 *   - SSH key auth set up for each node (no password)
 *   - Each node must have /opt/polycast/content/ writable by the SSH user
 */
import { program } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { loadLayout } from './config.js';

program
  .name('polycast-deploy')
  .description('Deploy exported node slices to each mini PC via rsync/SSH')
  .requiredOption('-c, --config <file>', 'Layout JSON file')
  .requiredOption('-d, --dist <dir>', 'Dist directory (output of polycast-export)', './dist')
  .option('-u, --user <user>', 'SSH user on each node', 'polycast')
  .option('-p, --path <path>', 'Remote content path', '/opt/polycast/content/')
  .option('--dry-run', 'Print rsync commands without executing')
  .parse(process.argv);

const opts = program.opts();

async function deployNode(node, distDir, user, remotePath, dryRun) {
  const localDir = join(distDir, node.id) + '/';
  const remote = `${user}@${node.host}:${remotePath}`;

  if (!existsSync(localDir.slice(0, -1))) {
    throw new Error(`Local dist folder not found: ${localDir}`);
  }

  const args = [
    '-avz',
    '--progress',
    '-e', 'ssh -o StrictHostKeyChecking=no',
    localDir,
    remote
  ];

  if (dryRun) {
    console.log(chalk.dim(`  [dry-run] rsync ${args.join(' ')}`));
    return;
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('rsync', args, { stdio: 'pipe' });
    let lastLine = '';

    proc.stdout.on('data', (d) => {
      const lines = d.toString().split('\n').filter(Boolean);
      if (lines.length) {
        lastLine = lines[lines.length - 1];
        process.stdout.write(`\r  ${chalk.dim(lastLine.slice(0, 60).padEnd(60))}`);
      }
    });

    proc.stderr.on('data', (d) => {
      // rsync sometimes prints progress to stderr too
    });

    proc.on('close', (code) => {
      process.stdout.write('\r' + ' '.repeat(70) + '\r');
      if (code === 0) resolve();
      else reject(new Error(`rsync exited with code ${code}`));
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('rsync not found. Install it: sudo apt install rsync / brew install rsync'));
      } else {
        reject(err);
      }
    });
  });
}

async function run() {
  const configPath = resolve(opts.config);
  const distDir = resolve(opts.dist);

  let layout;
  try {
    layout = loadLayout(configPath);
  } catch (e) {
    console.error(chalk.red(`✗ ${e.message}`));
    process.exit(1);
  }

  const nodes = layout.nodes.filter(n => n.host);
  if (nodes.length === 0) {
    console.error(chalk.red('✗ No nodes with a "host" field in layout.json'));
    console.error(chalk.dim('  Add "host": "192.168.1.101" to each node entry'));
    process.exit(1);
  }

  console.log(chalk.bold.cyan('\n⬡  polycast-deploy\n'));
  console.log(chalk.dim(`  dist: ${distDir}`));
  console.log(chalk.dim(`  user: ${opts.user}`));
  console.log(chalk.dim(`  remote path: ${opts.path}`));
  if (opts.dryRun) console.log(chalk.yellow('  [dry-run mode]\n'));
  console.log();

  let errors = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    console.log(chalk.bold(`[${i + 1}/${nodes.length}] ${node.id} → ${node.host}`));
    try {
      await deployNode(node, distDir, opts.user, opts.path, opts.dryRun);
      console.log(chalk.green(`  ✓ deployed\n`));
    } catch (e) {
      console.error(chalk.red(`  ✗ ${e.message}\n`));
      errors++;
    }
  }

  if (errors === 0) {
    console.log(chalk.bold.green(`✓ Deploy complete — ${nodes.length} nodes updated`));
    console.log(chalk.dim('\nNext step: open the dashboard and press Play All'));
  } else {
    console.log(chalk.bold.yellow(`⚠ Deploy finished with ${errors} error(s)`));
    process.exit(1);
  }
}

run().catch(e => {
  console.error(chalk.red(`\nFatal: ${e.message}`));
  process.exit(1);
});
