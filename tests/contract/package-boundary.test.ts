import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function npmCli(): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: 'npm', args: [] };
  return { command: process.execPath, args: [process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')] };
}

test('AC-036: packed tarball installs a functional CLI outside the checkout @spec:AC-036', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mega-brain-package-boundary-'));
  try {
    const npm = npmCli();
    const packed = await execFileAsync(npm.command, [...npm.args, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    const details = JSON.parse(packed.stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
    const paths = details[0]!.files.map(({ path: file }) => file);
    expect(paths).toContain('dist/cli/index.js');
    expect(paths.some((file) => file.startsWith('src/') || file.startsWith('tests/') || file.startsWith('node_modules/'))).toBe(false);
    const tarball = path.join(temporary, details[0]!.filename);
    const consumer = path.join(temporary, 'consumer');
    await execFileAsync(npm.command, [...npm.args, 'install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: temporary, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    const cli = path.join(consumer, 'node_modules', '@raffahr', 'mega-brain-mcp', 'dist', 'cli', 'index.js');
    const help = await execFileAsync(process.execPath, [cli, '--help'], { cwd: temporary, encoding: 'utf8' });
    expect(help.stdout).toContain('Usage: mega-brain');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 180_000);

test('AC-037: isolated harness defines supported and rejection scenarios @spec:AC-037', async () => {
  const harness = await readFile(path.join(root, 'scripts', 'test-isolated-lifecycle.mjs'), 'utf8');
  expect(harness).toContain("'node-below-minimum'");
  expect(harness).toContain("'python-missing'");
  expect(harness).toContain("'python-below-minimum'");
  expect(harness).toContain("'python-without-venv'");
  expect(harness).toContain("'supported-full-lifecycle'");
  expect(harness).toContain("test ! -e /tmp/mega-data");
});

test('AC-038: docs use the scoped package and automatic host lifecycle @spec:AC-038', async () => {
  const [readme, configuration, troubleshooting] = await Promise.all([
    readFile(path.join(root, 'README.md'), 'utf8'),
    readFile(path.join(root, 'docs', 'configuration.md'), 'utf8'),
    readFile(path.join(root, 'docs', 'troubleshooting.md'), 'utf8'),
  ]);
  expect(readme).toContain('npm install --global @raffahr/mega-brain-mcp');
  expect(readme).toContain('npm install --global .\\raffahr-mega-brain-mcp-0.1.0.tgz');
  expect(readme).toContain('--hosts codex');
  expect(readme).toContain('--hosts claude');
  expect(readme).toContain('mega-brain uninstall');
  expect(configuration).toContain('.codex/config.toml');
  expect(configuration).toContain('.mcp.json');
  expect(troubleshooting).toContain('venv');
  expect(troubleshooting).toContain('No files were changed');
});
