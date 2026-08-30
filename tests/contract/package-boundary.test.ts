import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Reads the published identity from the single source of truth so a version
 * bump keeps these assertions honest instead of letting the documented install
 * commands drift away from what npm actually produces.
 */
async function packageManifest(): Promise<{ name: string; version: string }> {
  return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { name: string; version: string };
}

function packedTarballName(manifest: { name: string; version: string }): string {
  return `${manifest.name.replace(/^@/u, '').replace('/', '-')}-${manifest.version}.tgz`;
}

function npmCli(): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: 'npm', args: [] };
  return { command: process.execPath, args: [process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')] };
}

test('AC-037: isolated harness defines supported and rejection scenarios @spec:AC-037', async () => {
  const harness = await readFile(path.join(root, 'scripts', 'test-isolated-lifecycle.mjs'), 'utf8');
  expect(harness).toContain("'node-below-minimum'");
  expect(harness).toContain("'python-missing'");
  expect(harness).toContain("'python-below-minimum'");
  expect(harness).toContain("'python-without-venv'");
  expect(harness).toContain("'supported-node-22-stdio-lifecycle'");
  expect(harness).toContain("test ! -e /tmp/mega-data");
});

test('AC-055: tarball isolado cobre Node 22.22 e 24.19 por MCP stdio sem montar o checkout @spec:AC-055', async () => {
  const harness = await readFile(path.join(root, 'scripts', 'test-isolated-lifecycle.mjs'), 'utf8');
  expect(harness).toContain("'node:22.22.0-bookworm'");
  expect(harness).toContain("'node:24.19.0-bookworm'");
  expect(harness).toContain('StdioClientTransport');
  expect(harness).toContain('NPM_CONFIG_USERCONFIG=/tmp/mega-brain-npmrc');
  expect(harness).toContain(`${'${artifactDir}'}:/artifact:ro`);
  expect(harness).not.toContain('/workspace:');
  expect(harness).not.toContain('node_modules:/');
});

test('AC-056: matriz empacotada executa dois projetos concorrentes, sentinelas e shutdown @spec:AC-056', async () => {
  const harness = await readFile(path.join(root, 'scripts', 'test-isolated-lifecycle.mjs'), 'utf8');
  expect(harness).toContain("'supported-node-24-concurrent-isolation'");
  expect(harness).toContain('MEGA_BRAIN_OTHER_SENTINEL');
  expect(harness).toContain("new Error('backend port collision')");
  expect(harness).toContain("find /tmp/mega-data/projects -path '*/runtime-state.json' -o -path '*/supervisor/manifest.json'");
});

test('AC-036: packed tarball installs a functional CLI outside the checkout @spec:AC-036', async () => {
  if (process.env.CI === 'true') {
    const harness = await readFile(path.join(root, 'scripts', 'test-isolated-lifecycle.mjs'), 'utf8');
    expect(harness).toContain('npm install --global /artifact/package.tgz');
    expect(harness).toContain("mega-brain --help | grep 'Usage: mega-brain'");
    expect(harness).toContain('node /artifact/probe.mjs');
    return;
  }

  const temporary = await mkdtemp(path.join(tmpdir(), 'mega-brain-package-boundary-'));
  try {
    const npm = npmCli();
    const npmEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        !['npm_config_userconfig', 'npm_config_allow_scripts'].includes(key.toLowerCase()),
      ),
    );
    npmEnvironment.NPM_CONFIG_USERCONFIG = path.join(temporary, 'npmrc');
    const packed = await execFileAsync(npm.command, [...npm.args, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: npmEnvironment, timeout: 120_000 });
    const details = JSON.parse(packed.stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
    const paths = details[0]!.files.map(({ path: file }) => file);
    expect(paths).toContain('dist/cli/index.js');
    expect(paths.some((file) => file.startsWith('src/') || file.startsWith('tests/') || file.startsWith('node_modules/'))).toBe(false);
    const tarball = path.join(temporary, details[0]!.filename);
    const consumer = path.join(temporary, 'consumer');
    await execFileAsync(npm.command, [
      ...npm.args,
      'install',
      '--prefix',
      consumer,
      '--ignore-scripts',
      '--omit=optional',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--no-bin-links',
      tarball,
    ], { cwd: temporary, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: npmEnvironment, timeout: 420_000 });
    const cli = path.join(consumer, 'node_modules', ...(await packageManifest()).name.split('/'), 'dist', 'cli', 'index.js');
    const help = await execFileAsync(process.execPath, [cli, '--help'], { cwd: temporary, encoding: 'utf8', timeout: 30_000 });
    expect(help.stdout).toContain('Usage: mega-brain');
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 3 : 0 });
  }
}, 600_000);

test('AC-038: docs use the scoped package and automatic host lifecycle @spec:AC-038', async () => {
  const [readme, readmePtBr, configuration, troubleshooting, manifest] = await Promise.all([
    readFile(path.join(root, 'README.md'), 'utf8'),
    readFile(path.join(root, 'README-ptbr.md'), 'utf8'),
    readFile(path.join(root, 'docs', 'configuration.md'), 'utf8'),
    readFile(path.join(root, 'docs', 'troubleshooting.md'), 'utf8'),
    packageManifest(),
  ]);
  expect(readme).toContain(`npm install --global ${manifest.name}`);
  expect(readme).toContain(`npm install --global .\\${packedTarballName(manifest)}`);
  expect(readme).toContain('choose Codex, Claude');
  expect(readme).toContain('Code, or both');
  expect(readme).not.toContain(`--${'hosts'}`);
  expect(readme).toContain('mega-brain uninstall');
  expect(configuration).toContain('.codex/config.toml');
  expect(configuration).toContain('.mcp.json');
  expect(troubleshooting).toContain('venv');
  expect(troubleshooting).toContain('No files were changed');
  for (const document of [readmePtBr, troubleshooting]) {
    expect(document).toContain(packedTarballName(manifest));
  }
});
