import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { installManagedRuntime } from '../../src/cli/install.js';
import { runInstallPreflight, type PreflightProbe } from '../../src/cli/preflight.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

function probe(responses: Record<string, string | Error>): PreflightProbe {
  return { async run(command, args) {
    const key = `${command} ${args.join(' ')}`;
    const response = responses[key];
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error(`unexpected probe: ${key}`);
    return { stdout: response, stderr: '' };
  } };
}

test.each([
  ['old Node', '22.21.0', {}],
  ['missing Git', '22.22.0', { 'npm --version': '10.9.0', 'git --version': new Error('ENOENT') }],
  ['missing Python', '22.22.0', { 'npm --version': '10.9.0', 'git --version': 'git version 2.45.0', 'python3 --version': new Error('ENOENT'), 'python --version': new Error('ENOENT') }],
  ['old Python', '22.22.0', { 'npm --version': '10.9.0', 'git --version': 'git version 2.45.0', 'python3 --version': 'Python 3.9.19', 'python --version': new Error('ENOENT') }],
  ['Python without venv', '22.22.0', { 'npm --version': '10.9.0', 'git --version': 'git version 2.45.0', 'python3 --version': 'Python 3.11.9', 'python3 -c import ensurepip, venv': new Error('No module named ensurepip'), 'python --version': new Error('ENOENT') }],
])('AC-030: preflight rejects %s before any runtime mutation @spec:AC-030', async (_label, nodeVersion, responses) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-preflight-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({ root: path.join(dataDir, 'repo'), gitDir: '.git', commonGitDir: '.git' });
  const layout = runtimeLayout(dataDir, identity);
  await expect(installManagedRuntime({ dataDir, identity, preflight: { nodeVersion, platform: 'linux', probe: probe(responses) }, runner: { run: async () => { throw new Error('installer must not run'); } } })).rejects.toThrow();
  await expect(access(layout.runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('AC-031: compatible preflight selects an executable Python with venv support @spec:AC-031', async () => {
  const calls: string[] = [];
  const values: Record<string, string> = { 'npm --version': '11.6.0', 'git --version': 'git version 2.50.1', 'python3 --version': 'Python 3.12.10', 'python3 -c import ensurepip, venv': '' };
  const result = await runInstallPreflight({ nodeVersion: '24.19.0', platform: 'linux', probe: { async run(command, args) {
    const key = `${command} ${args.join(' ')}`;
    calls.push(key);
    if (!(key in values)) throw new Error('unexpected command');
    return { stdout: values[key]!, stderr: '' };
  } } });
  expect(result).toEqual({
    platform: 'linux',
    managedIiiEngineRequired: false,
    nodeVersion: '24.19.0',
    pythonVersion: '3.12.10',
    pythonCommand: 'python3',
    gitVersion: '2.50.1',
    npmVersion: '11.6.0',
  });
  expect(calls.at(-1)).toBe('python3 -c import ensurepip, venv');
});
