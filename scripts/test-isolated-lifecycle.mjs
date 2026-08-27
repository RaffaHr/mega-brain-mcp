#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const positiveOnly = process.argv.includes('--positive-only');
const negativeOnly = process.argv.includes('--negative-only');
const scenarioIndex = process.argv.indexOf('--scenario');
const selectedScenario = scenarioIndex >= 0 ? process.argv[scenarioIndex + 1] : undefined;
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
  if (selectedScenario && name !== selectedScenario) return;
  if (positiveOnly && !name.startsWith('supported-')) return;
  if (negativeOnly && name.startsWith('supported-')) return;
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

const installPackage = `
export NPM_CONFIG_USERCONFIG=/tmp/mega-brain-npmrc
export NPM_CONFIG_CACHE=/tmp/mega-brain-npm-cache
npm install --global /artifact/package.tgz --no-audit --no-fund >/dev/null
`;

const waitForAutonomousShutdown = `
for attempt in $(seq 1 30); do
  remaining="$(find /tmp/mega-data/projects -path '*/runtime-state.json' -o -path '*/supervisor/manifest.json')"
  test -z "$remaining" && break
  sleep 1
done
remaining="$(find /tmp/mega-data/projects -path '*/runtime-state.json' -o -path '*/supervisor/manifest.json')"
test -z "$remaining" || { echo "autonomous shutdown left runtime files:" >&2; echo "$remaining" >&2; exit 1; }
`;

const probe = `
import { Client } from 'file:///usr/local/lib/node_modules/@raffahr/mega-brain-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from 'file:///usr/local/lib/node_modules/@raffahr/mega-brain-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const expected = ['brain_recall','brain_learn','brain_change_context','brain_history','brain_validate','brain_status'];
const repository = process.env.MEGA_BRAIN_REPO;
const sentinel = process.env.MEGA_BRAIN_SENTINEL;
if (!repository || !sentinel) throw new Error('probe requires repository and sentinel');
const client = new Client({ name: 'isolated-probe', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'mega-brain', args: ['mcp', '--repo', repository], env: process.env, stderr: 'pipe' }));
const names = (await client.listTools()).tools.map(({ name }) => name);
if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Unexpected public tools: ' + names.join(','));
const learned = await client.callTool({ name: 'brain_learn', arguments: { statement: sentinel, type: 'decision' } });
const memoryId = String(learned.structuredContent?.result?.memoryId ?? '');
const calls = [
  ['brain_recall', { query: sentinel }],
  ['brain_change_context', { target: 'example.ts' }],
  ['brain_history', { limit: 5 }],
  ['brain_validate', { memoryId, outcome: 'confirmed', evidence: ['isolated-lifecycle'] }],
  ['brain_status', {}],
];
const results = await Promise.all(calls.map(([name, args]) => client.callTool({ name, arguments: args })));
const namedResults = [['brain_learn', learned], ...calls.map(([name], index) => [name, results[index]])];
const failures = namedResults.filter(([, result]) => result.isError || result.structuredContent?.schemaVersion !== '1.0');
if (failures.length) throw new Error('public tool failure: ' + JSON.stringify(failures));
const recall = JSON.stringify(results[0].structuredContent);
if (!recall.includes(sentinel)) throw new Error('own sentinel was not recalled');
if (process.env.MEGA_BRAIN_OTHER_SENTINEL && recall.includes(process.env.MEGA_BRAIN_OTHER_SENTINEL)) throw new Error('cross-project sentinel leak');
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

  dockerScenario('python-below-minimum', 'node:22.22.0-bookworm', `
set -euo pipefail
${installPackage}
${repositorySetup}
printf '#!/bin/sh\\nprintf "Python 3.9.19\\\\n"\\n' > /tmp/python-old
chmod +x /tmp/python-old
if mega-brain install --repo /tmp/repo --hosts codex --python /tmp/python-old; then echo 'install unexpectedly succeeded' >&2; exit 1; fi
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

  dockerScenario('supported-node-22-stdio-lifecycle', 'node:22.22.0-bookworm', `
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
mega-brain install --repo /tmp/repo --hosts codex
grep '\\[mcp_servers.mega-brain\\]' /tmp/repo/.codex/config.toml
grep -F 'args = ["--no-warnings"' /tmp/repo/.codex/config.toml
grep -F '@raffahr/mega-brain-mcp/dist/cli/index.js' /tmp/repo/.codex/config.toml
grep -F '"mcp","--repo","/tmp/repo"' /tmp/repo/.codex/config.toml
! grep -F 'command = "mega-brain"' /tmp/repo/.codex/config.toml
grep -F '@raffahr/mega-brain-mcp/dist/cli/index.js' /tmp/repo/.codex/hooks.json
grep 'hook.*host.*codex' /tmp/repo/.codex/hooks.json
! grep -R '\\.staging-' /tmp/mega-data/projects/*/runtime/current/runtime-lock.json
cleanup() {
  find /tmp/mega-data/projects -path '*/logs/*.log' -type f -exec sh -c 'echo "--- $1"; cat "$1"' _ {} \\; 2>/dev/null || true
  mega-brain stop --repo /tmp/repo >/dev/null 2>&1 || true
}
trap cleanup EXIT
export MEGA_BRAIN_REPO=/tmp/repo
export MEGA_BRAIN_SENTINEL=node-22-project-sentinel
node /artifact/probe.mjs
${waitForAutonomousShutdown}
mega-brain uninstall --repo /tmp/repo --hosts codex
cmp /tmp/codex-original.toml /tmp/repo/.codex/config.toml
test ! -e /tmp/mega-data/projects/*/runtime/current
trap - EXIT
`);

  dockerScenario('supported-node-24-concurrent-isolation', 'node:24.19.0-bookworm', `
set -euo pipefail
apt-get update -qq && apt-get install -y -qq python3-venv >/dev/null
${installPackage}
for repo in repo-a repo-b; do
  mkdir -p "/tmp/$repo"
  git init "/tmp/$repo" >/dev/null
  git -C "/tmp/$repo" config user.name 'Mega Brain Isolated Test'
  git -C "/tmp/$repo" config user.email 'mega-brain@example.test'
  printf 'export const handler = () => "ok";\n' > "/tmp/$repo/example.ts"
  git -C "/tmp/$repo" add example.ts
  git -C "/tmp/$repo" commit -m "add $repo handler architecture" >/dev/null
  mkdir -p "/tmp/$repo/.codex"
  printf '[mcp_servers.existing]\nurl = "http://localhost:9999/mcp"\n' > "/tmp/$repo/.codex/config.toml"
done
export MEGA_BRAIN_DATA_DIR=/tmp/mega-data
export AGENTMEMORY_USE_DOCKER=false
export AGENTMEMORY_TOOLS=core
mega-brain install --repo /tmp/repo-a --hosts codex
mega-brain install --repo /tmp/repo-b --hosts codex
test "$(find /tmp/mega-data/projects -path '*/runtime/current/runtime-lock.json' | wc -l)" -eq 2
MEGA_BRAIN_REPO=/tmp/repo-a MEGA_BRAIN_SENTINEL=repo-a-only MEGA_BRAIN_OTHER_SENTINEL=repo-b-only node /artifact/probe.mjs > /tmp/probe-a.log 2>&1 &
probe_a=$!
MEGA_BRAIN_REPO=/tmp/repo-b MEGA_BRAIN_SENTINEL=repo-b-only MEGA_BRAIN_OTHER_SENTINEL=repo-a-only node /artifact/probe.mjs > /tmp/probe-b.log 2>&1 &
probe_b=$!
wait "$probe_a" || { cat /tmp/probe-a.log; exit 1; }
wait "$probe_b" || { cat /tmp/probe-b.log; exit 1; }
${waitForAutonomousShutdown}
node -e "const fs=require('fs'),path=require('path');const roots=fs.readdirSync('/tmp/mega-data/projects').map(x=>path.join('/tmp/mega-data/projects',x,'runtime/current/runtime-lock.json'));const ports=roots.flatMap(x=>Object.values(JSON.parse(fs.readFileSync(x)).isolation.ports));if(new Set(ports).size!==ports.length)throw new Error('backend port collision')"
mega-brain uninstall --repo /tmp/repo-a --hosts codex
mega-brain uninstall --repo /tmp/repo-b --hosts codex
test -z "$(find /tmp/mega-data/projects -path '*/runtime/current')"
`);

  process.stdout.write('\nAll isolated lifecycle scenarios passed.\n');
} finally {
  rmSync(artifactDir, { recursive: true, force: true });
}
