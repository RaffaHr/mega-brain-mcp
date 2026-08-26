import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { runSetupWizard, type SetupPlan } from '../../src/cli/setup.js';
import { loadConfig } from '../../src/config/load.js';
import { writeProjectConfig } from '../../src/config/project-config.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { downloadOfficialIiiEngine, sha256Artifact } from '../../src/runtime/iii-engine.js';
import { ScriptedPrompts } from '../fixtures/setup-answers.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

function preflight(platform: NodeJS.Platform = 'linux') {
  return Promise.resolve({
    platform,
    managedIiiEngineRequired: platform === 'win32',
    nodeVersion: '24.19.0', pythonVersion: '3.12.0', pythonCommand: 'python3',
    gitVersion: '2.50.0', npmVersion: '11.0.0',
  });
}

function storedZip(name: string, content: Buffer): Buffer {
  const filename = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const centralOffset = local.length + filename.length + content.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, filename, content, central, filename, end]);
}

test('AC-042/AC-044: defaults geram plano managed estrito e só instalam após confirmação @spec:AC-042 @spec:AC-044', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-default-'));
  directories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const install = vi.fn(async (_plan: SetupPlan) => undefined);
  const prompts = new ScriptedPrompts({
    repository: [''], hosts: ['both'], agentMemoryMode: ['managed'], advanced: [false], confirm: [true],
  });

  const result = await runSetupWizard({
    prompts,
    currentDirectory: root,
    environment: {},
    defaultDataDir: path.join(root, '.data-root'),
    preflight: async () => preflight(),
    discoverIdentity: async () => identity,
    probeRemote: async () => { throw new Error('remote probe must not run'); },
    install,
  });

  expect(result.status).toBe('installed');
  expect(install).toHaveBeenCalledOnce();
  const plan = install.mock.calls[0]![0];
  expect(plan).toMatchObject({ hosts: ['codex', 'claude'], strictIsolation: true, reopenHost: true });
  expect(plan.config.agentMemory).toMatchObject({ mode: 'managed' });
  expect(plan.config.agentMemory.baseUrl).toBe(`http://127.0.0.1:${plan.config.agentMemory.ports.rest}`);
  expect(JSON.stringify(plan.summary)).not.toMatch(/secret|token/i);
});

test('AC-049: remoto inválido permanece na etapa e pode trocar para managed sem mutação @spec:AC-049', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-retry-'));
  directories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const install = vi.fn(async () => undefined);
  const probeRemote = vi.fn(async () => { throw new Error('namespace isolation unavailable'); });
  const prompts = new ScriptedPrompts({
    repository: [root], hosts: ['codex'], agentMemoryMode: ['remote', 'managed'],
    remoteUrl: ['https://memory.example.test'], remoteSecretEnv: ['REMOTE_MEMORY_SECRET'],
    advanced: [false], confirm: [true],
  });

  await runSetupWizard({
    prompts,
    currentDirectory: root,
    environment: { REMOTE_MEMORY_SECRET: 'runtime-only-secret' },
    defaultDataDir: path.join(root, '.data-root'),
    preflight: async () => preflight(),
    discoverIdentity: async () => identity,
    probeRemote,
    install,
  });

  expect(probeRemote).toHaveBeenCalledOnce();
  expect(prompts.messages.join('\n')).toContain('namespace isolation unavailable');
  expect(install.mock.calls[0]![0].config.agentMemory.mode).toBe('managed');
  expect(JSON.stringify(install.mock.calls[0]![0])).not.toContain('runtime-only-secret');
});

test('AC-049: secret colado no campo de env var recebe erro acionavel @spec:AC-049', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-secret-value-'));
  directories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const install = vi.fn(async () => undefined);
  const probeRemote = vi.fn(async () => undefined);
  const prompts = new ScriptedPrompts({
    repository: [root], hosts: ['codex'], agentMemoryMode: ['remote', 'managed'],
    remoteUrl: ['https://memory.example.test'],
    remoteSecretEnv: ['958dcb9c8d649f268ffe5d54e90c23eb82e91017025e12ca25f5e4c0ef8c0ac5'],
    advanced: [false], confirm: [true],
  });

  await runSetupWizard({
    prompts,
    currentDirectory: root,
    environment: {},
    defaultDataDir: path.join(root, '.data-root'),
    preflight: async () => preflight(),
    discoverIdentity: async () => identity,
    probeRemote,
    install,
  });

  expect(probeRemote).not.toHaveBeenCalled();
  expect(prompts.messages.join('\n')).toContain('not the secret value');
  expect(install.mock.calls[0]![0].config.agentMemory.mode).toBe('managed');
});

test('AC-043: opções avançadas preservam CRG customizado, data root e opt-ins seguros @spec:AC-043', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-advanced-'));
  directories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const install = vi.fn(async () => undefined);
  const prompts = new ScriptedPrompts({
    repository: [root], hosts: ['claude'], agentMemoryMode: ['managed'], advanced: [true],
    dataDir: ['.project-data'], crgMode: ['custom'], crgCommand: ['custom-crg'],
    allowEgress: [true], allowLlm: [false], confirm: [true],
  });

  await runSetupWizard({
    prompts, currentDirectory: root, environment: {}, defaultDataDir: path.join(root, '.default-data'),
    preflight: async () => preflight(), discoverIdentity: async () => identity,
    probeRemote: async () => undefined, install,
  });

  expect(install.mock.calls[0]![0]).toMatchObject({
    hosts: ['claude'],
    codeReviewGraphMode: 'custom',
    config: {
      dataDir: path.resolve(identity.root, '.project-data'),
      allowEgress: true,
      allowLlm: false,
      codeReviewGraph: { command: 'custom-crg' },
    },
  });
});

test('AC-042: falha de preflight seguida de cancelamento não cria arquivos nem instala @spec:AC-042', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-cancel-'));
  directories.push(root);
  const prompts = new ScriptedPrompts({ repository: [root, null] });
  const install = vi.fn(async () => undefined);
  const result = await runSetupWizard({
    prompts,
    currentDirectory: root,
    environment: {},
    defaultDataDir: path.join(root, '.data-root'),
    preflight: async () => { throw new Error('Python missing'); },
    discoverIdentity: async () => { throw new Error('must not discover'); },
    probeRemote: async () => undefined,
    install,
  });

  expect(result).toEqual({ status: 'cancelled' });
  expect(prompts.messages.join('\n')).toContain('Python missing');
  expect(install).not.toHaveBeenCalled();
  expect(await access(path.join(root, '.mega-brain')).then(() => true).catch(() => false)).toBe(false);
});

test('AC-043: configuração local persiste referência do secret, nunca o valor @spec:AC-043 @principle:P-002', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-config-'));
  directories.push(root);
  const target = await writeProjectConfig(root, {
    dataDir: path.join(root, '.data'),
    allowEgress: false,
    allowLlm: false,
    agentMemory: {
      mode: 'remote', baseUrl: 'https://memory.example.test', secretEnvVar: 'REMOTE_MEMORY_SECRET',
      ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 49134 }, environment: {},
    },
    codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
  });
  const serialized = await readFile(target, 'utf8');
  expect(serialized).toContain('REMOTE_MEMORY_SECRET');
  expect(serialized).not.toContain('runtime-only-secret');
  const loaded = await loadConfig({ repoPath: root, env: { REMOTE_MEMORY_SECRET: 'runtime-only-secret' } });
  expect(loaded.agentMemory).toMatchObject({
    mode: 'remote',
    baseUrl: 'https://memory.example.test',
    secretEnvVar: 'REMOTE_MEMORY_SECRET',
    authToken: 'runtime-only-secret',
  });
});

test('AC-045: setup sem TTY orienta install e não tenta perguntar @spec:AC-045', async () => {
  const prompts = { interactive: false, notify: vi.fn() } as never;
  await expect(runSetupWizard({
    prompts,
    currentDirectory: '.', environment: {}, defaultDataDir: '.data',
    preflight: async () => preflight(),
    discoverIdentity: async () => { throw new Error('must not run'); },
    probeRemote: async () => undefined,
    install: async () => undefined,
  })).rejects.toThrow(/interactive terminal.*mega-brain install/i);
});

test('AC-044: downloader Windows verifica checksum oficial e extrai apenas iii.exe @spec:AC-044', async () => {
  const executable = Buffer.from('project-local-iii-executable');
  const archive = storedZip('release/iii.exe', executable);
  const fetch = vi.fn(async (input: URL | RequestInfo) => String(input).endsWith('.sha256')
    ? new Response(`${sha256Artifact(archive)}  iii-x86_64-pc-windows-msvc.zip\n`)
    : new Response(archive)) as typeof globalThis.fetch;

  const artifact = await downloadOfficialIiiEngine({ architecture: 'x64', fetch });

  expect(Buffer.from(artifact.bytes)).toEqual(executable);
  expect(artifact.sha256).toBe(sha256Artifact(executable));
  expect(artifact.sourceUrl).toContain('iii%2Fv0.11.2/iii-x86_64-pc-windows-msvc.zip');
  expect(fetch).toHaveBeenCalledTimes(2);
});
