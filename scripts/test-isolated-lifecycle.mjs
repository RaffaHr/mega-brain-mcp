#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const positiveOnly = process.argv.includes('--positive-only');
const artifactDir = mkdtempSync(path.join(tmpdir(), 'mega-brain-isolated-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
  }
  return result.stdout ?? '';
}

function dockerScenario(name, image, script) {
  if (positiveOnly && name !== 'supported-full-lifecycle') return;
  process.stdout.write(`\n=== isolated scenario: ${name} (${image}) ===\n`);
  run('docker', ['run', '--rm', '--volume', `${artifactDir}:/artifact:ro`, image, 'bash', '-lc', script], { stdio: 'inherit' });
}

const repositorySetup = `
mkdir -p /tmp/repo
git init /tmp/repo >/dev/null
git -C /tmp/repo config user.name 'Mega Brain Isolated Test'
git -C /tmp/repo config user.email 'mega-brain@example.test'
printf 'export const handler = () => "ok";\\n' > /tmp/repo/example.ts
git -C /tmp/repo add example.ts
git -C /tmp/repo commit -m 'add handler architecture' >/dev/null
export MEGA_BRAIN_DATA_DIR=/tmp/mega-data
`;

const installPackage = `npm install --global /artifact/package.tgz --no-audit --no-fund >/dev/null`;

const probe = `
import { Client } from 'file:///usr/local/lib/node_modules/@raffahr/mega-brain-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from 'file:///usr/local/lib/node_modules/@raffahr/mega-brain-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
const expected = ['brain_recall','brain_learn','brain_change_context','brain_history','brain_validate','brain_status'];
let client;
let lastError;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    client = new Client({ name: 'isolated-probe', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3000/mcp')));
    break;
  } catch (error) {
    lastError = error;
    await client?.close().catch(() => undefined);
    client = undefined;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
if (!client) throw lastError ?? new Error('MCP server did not become ready');
const names = (await client.listTools()).tools.map(({ name }) => name);
if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Unexpected public tools: ' + names.join(','));
const status = await client.callTool({ name: 'brain_status', arguments: {} });
if (!('structuredContent' in status) || status.structuredContent?.schemaVersion !== '1.0') throw new Error('brain_status returned no structured envelope');
await client.close();
`;

try {
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const packed = run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', artifactDir]);
  const filename = packed.match(/"filename"\s*:\s*"([^"]+)"/)?.[1];
  if (!filename) throw new Error('npm pack did not report a tarball filename');
  const tarball = path.join(artifactDir, filename);
  writeFileSync(path.join(artifactDir, 'package.tgz'), readFileSync(tarball));
  writeFileSync(path.join(artifactDir, 'probe.mjs'), probe);

  dockerScenario('node-below-minimum', 'node:22.21.1-bookworm', `
set -euo pipefail
${installPackage}
${repositorySetup}
if mega-brain install --repo /tmp/repo --hosts codex; then echo 'install unexpectedly succeeded' >&2; exit 1; fi
test ! -e /tmp/mega-data
test ! -e /tmp/repo/.codex
`);

  dockerScenario('python-missing', 'node:22.22.0-bookworm-slim', `
set -euo pipefail
apt-get update -qq && apt-get install -y -qq git >/dev/null
${installPackage}
${repositorySetup}
if mega-brain install --repo /tmp/repo --hosts codex; then echo 'install unexpectedly succeeded' >&2; exit 1; fi
test ! -e /tmp/mega-data
test ! -e /tmp/repo/.codex
`);

  dockerScenario('python-without-venv', 'node:22.22.0-bookworm', `
set -euo pipefail
${installPackage}
${repositorySetup}
if mega-brain install --repo /tmp/repo --hosts codex; then echo 'install unexpectedly succeeded' >&2; exit 1; fi
test ! -e /tmp/mega-data
test ! -e /tmp/repo/.codex
`);

  dockerScenario('supported-full-lifecycle', 'node:22.22.0-bookworm', `
set -euo pipefail
apt-get update -qq && apt-get install -y -qq python3-venv >/dev/null
${installPackage}
${repositorySetup}
printf '[mcp_servers.existing]\\nurl = "http://localhost:9999/mcp"\\n' > /tmp/codex-original.toml
mkdir -p /tmp/repo/.codex
cp /tmp/codex-original.toml /tmp/repo/.codex/config.toml
export AGENTMEMORY_USE_DOCKER=false
export AGENTMEMORY_TOOLS=core
mega-brain --help | grep 'Usage: mega-brain'
mega-brain install --repo /tmp/repo --hosts codex --port 3000
grep '\\[mcp_servers.mega-brain\\]' /tmp/repo/.codex/config.toml
grep 'mega-brain hook host codex' /tmp/repo/.codex/hooks.json
! grep -R '\\.staging-' /tmp/mega-data/projects/*/runtime/current/runtime-lock.json
serve_pid=''
cleanup() {
  cat /tmp/mega-brain-serve.log 2>/dev/null || true
  find /tmp/mega-data/projects -path '*/logs/*.log' -type f -exec sh -c 'echo "--- $1"; cat "$1"' _ {} \\; 2>/dev/null || true
  test -z "$serve_pid" || kill "$serve_pid" 2>/dev/null || true
  mega-brain stop --repo /tmp/repo >/dev/null 2>&1 || true
}
trap cleanup EXIT
mega-brain start --repo /tmp/repo
doctor_output=$(mega-brain doctor --repo /tmp/repo)
echo "$doctor_output"
echo "$doctor_output" | grep '"status":"ok"'
mega-brain serve --repo /tmp/repo --port 3000 >/tmp/mega-brain-serve.log 2>&1 &
serve_pid=$!
node /artifact/probe.mjs
mega-brain stop --repo /tmp/repo
mega-brain uninstall --repo /tmp/repo --hosts codex --port 3000
cmp /tmp/codex-original.toml /tmp/repo/.codex/config.toml
test ! -e /tmp/mega-data/projects/*/runtime/current
trap - EXIT
kill "$serve_pid" 2>/dev/null || true
`);

  process.stdout.write('\nAll isolated lifecycle scenarios passed.\n');
} finally {
  rmSync(artifactDir, { recursive: true, force: true });
}
