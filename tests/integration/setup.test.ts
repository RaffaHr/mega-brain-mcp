import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { runSetupWizard, type SetupPlan } from '../../src/cli/setup.js';
import { mergeEnvFile } from '../../src/cli/setup.js';
import { loadConfig } from '../../src/config/load.js';
import { writeProjectConfig } from '../../src/config/project-config.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';
import { DEFAULT_MANAGED_DEPENDENCY_VERSIONS, MANAGED_DEPENDENCY_VERSION_ENV } from '../../src/runtime/dependency-versions.js';
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
test('setup usa versoes gerenciadas do ambiente no plano e no prompt do iii-engine', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-versions-'));
  directories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const versions = { agentMemory: '0.9.30', codeReviewGraph: '2.4.1', iiiEngine: '0.11.4' };
  const install = vi.fn(async (_plan: SetupPlan) => undefined);
  const prompts = new ScriptedPrompts({
    repository: [''], hosts: ['codex'], agentMemoryMode: ['managed'], advanced: [false], iiiEngine: [true], confirm: [true],
  });

  await runSetupWizard({
    prompts,
    currentDirectory: root,
    environment: {
      [MANAGED_DEPENDENCY_VERSION_ENV.agentMemory]: versions.agentMemory,
      [MANAGED_DEPENDENCY_VERSION_ENV.codeReviewGraph]: versions.codeReviewGraph,
      [MANAGED_DEPENDENCY_VERSION_ENV.iiiEngine]: versions.iiiEngine,
    },
    defaultDataDir: path.join(root, '.data-root'),
    preflight: async () => preflight('win32'),
    discoverIdentity: async () => identity,
    probeRemote: async () => undefined,
    install,
  });

  expect(install.mock.calls[0]![0].dependencyVersions).toEqual(versions);
  expect(prompts.messages.join('\n')).toContain(`Resolving managed dependency versions`);
  expect(prompts.prompts).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'iiiEngine', message: expect.stringContaining(versions.iiiEngine) }),
  ]));
});

test('setup oferece git init quando o diretorio ainda nao e repositorio Git', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-git-init-'));
  directories.push(root);
  const directoryIdentity = deriveProjectIdentity({
    root,
    gitDir: '.mega-brain/non-git-project',
    commonGitDir: '.mega-brain/non-git-project',
    gitBacked: false,
  });
  const gitIdentity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const discoverIdentity = vi.fn()
    .mockResolvedValueOnce(directoryIdentity)
    .mockResolvedValueOnce(gitIdentity);
  const initializeGit = vi.fn(async () => undefined);
  const install = vi.fn(async () => undefined);
  const prompts = new ScriptedPrompts({
    repository: [root],
    nonGitRepositoryAction: ['init'],
    hosts: ['codex'],
    agentMemoryMode: ['managed'],
    advanced: [false],
    confirm: [true],
  });

  await runSetupWizard({
    prompts,
    currentDirectory: root,
    environment: {},
    defaultDataDir: path.join(root, '.data-root'),
    preflight: async () => preflight(),
    discoverIdentity,
    initializeGit,
    probeRemote: async () => undefined,
    install,
  });

  expect(initializeGit).toHaveBeenCalledWith(root);
  expect(discoverIdentity).toHaveBeenCalledTimes(2);
  expect(install.mock.calls[0]![0].identity).toBe(gitIdentity);
  expect(prompts.messages.join('\n')).toContain('Git repository initialized. Rechecking project identity.');
});

test('setup permite tentar novamente quando o usuario inicializa Git manualmente', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-git-retry-'));
  directories.push(root);
  const directoryIdentity = deriveProjectIdentity({
    root,
    gitDir: '.mega-brain/non-git-project',
    commonGitDir: '.mega-brain/non-git-project',
    gitBacked: false,
  });
  const gitIdentity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const initializeGit = vi.fn(async () => undefined);
  const install = vi.fn(async () => undefined);
  const prompts = new ScriptedPrompts({
    repository: [root],
    nonGitRepositoryAction: ['retry'],
    hosts: ['codex'],
    agentMemoryMode: ['managed'],
    advanced: [false],
    confirm: [true],
  });

  await runSetupWizard({
    prompts,
    currentDirectory: root,
    environment: {},
    defaultDataDir: path.join(root, '.data-root'),
    preflight: async () => preflight(),
    discoverIdentity: vi.fn()
      .mockResolvedValueOnce(directoryIdentity)
      .mockResolvedValueOnce(gitIdentity),
    initializeGit,
    probeRemote: async () => undefined,
    install,
  });

  expect(initializeGit).not.toHaveBeenCalled();
  expect(install.mock.calls[0]![0].identity).toBe(gitIdentity);
});

test('AC-049: remoto inválido permanece na etapa e pode trocar para managed sem mutação @spec:AC-049', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-retry-'));
  directories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const install = vi.fn(async () => undefined);
  const probeRemote = vi.fn(async () => { throw new Error('namespace isolation unavailable'); });
  const prompts = new ScriptedPrompts({
    repository: [root], hosts: ['codex'], agentMemoryMode: ['remote', 'managed'],
    remoteUrl: ['https://memory.example.test'], remoteAuthToken: ['runtime-only-secret'],
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

  expect(probeRemote).toHaveBeenCalledOnce();
  expect(prompts.messages.join('\n')).toContain('namespace isolation unavailable');
  expect(install.mock.calls[0]![0].config.agentMemory.mode).toBe('managed');
  expect(JSON.stringify(install.mock.calls[0]![0])).not.toContain('runtime-only-secret');
});

test('AC-049: token remoto vazio recebe erro acionavel @spec:AC-049', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-secret-value-'));
  directories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const install = vi.fn(async () => undefined);
  const probeRemote = vi.fn(async () => undefined);
  const prompts = new ScriptedPrompts({
    repository: [root], hosts: ['codex'], agentMemoryMode: ['remote', 'managed'],
    remoteUrl: ['https://memory.example.test'],
    remoteAuthToken: ['   '],
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
  expect(prompts.messages.join('\n')).toContain('secret token cannot be empty');
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

test('AC-043: configuração local persiste token remoto somente no repo @spec:AC-043', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-config-'));
  directories.push(root);
  const target = await writeProjectConfig(root, {
    dataDir: path.join(root, '.data'),
    allowEgress: false,
    allowLlm: false,
    agentMemory: {
      mode: 'remote', baseUrl: 'https://memory.example.test', authToken: 'runtime-only-secret',
      ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 49134 }, environment: {},
    },
    codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
  });
  const serialized = await readFile(target, 'utf8');
  expect(serialized).toContain('runtime-only-secret');
  const loaded = await loadConfig({ repoPath: root, env: {} });
  expect(loaded.agentMemory).toMatchObject({
    mode: 'remote',
    baseUrl: 'https://memory.example.test',
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
  })).rejects.toThrow(/interactive terminal/i);
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
  expect(artifact.sourceUrl).toContain(`${encodeURIComponent(`iii/v${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.iiiEngine}`)}/iii-x86_64-pc-windows-msvc.zip`);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('setup em modo managed permite configurar variaveis de ambiente de AgentMemory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-setup-env-'));
  directories.push(root);
  const identity = deriveProjectIdentity({ root, gitDir: '.git', commonGitDir: '.git' });
  const install = vi.fn(async () => undefined);
  const prompts = new ScriptedPrompts({
    repository: [root],
    hosts: ['codex'],
    agentMemoryMode: ['managed'],
    advanced: [false],
    configureMemory: [true],
    llmProvider: ['anthropic'],
    anthropicApiKey: ['sk-ant-test-123'],
    embeddingProvider: ['openai'],
    openaiApiKey: ['sk-openai-embed-456'],
    graphExtraction: [true],
    consolidation: [true],
    autoCompress: [false],
    reflect: [true],
    injectContext: [true],
    snapshots: [false],
    advancedMemory: [true],
    graphWeight: ['0.5'],
    dropStaleIndex: [true],
    imageEmbeddings: [false],
    debugMode: [true],
    projectName: ['my-project'],
    agentScope: ['developer'],
    bridges: [true],
    claudeBridge: [true],
    cursorBridge: [true],
    windsurfBridge: [false],
    clineBridge: [false],
    confirm: [true],
  });

  const result = await runSetupWizard({
    prompts,
    currentDirectory: root,
    environment: {},
    defaultDataDir: path.join(root, '.data-root'),
    preflight: async () => preflight(),
    discoverIdentity: async () => identity,
    probeRemote: async () => undefined,
    install,
  });

  expect(result.status).toBe('installed');
  const plan = install.mock.calls[0]![0];
  expect(plan.envFileEntries).toEqual({
    ANTHROPIC_API_KEY: 'sk-ant-test-123',
    AGENTMEMORY_PROVIDER: 'anthropic',
    EMBEDDING_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-openai-embed-456',
    GRAPH_EXTRACTION_ENABLED: 'true',
    CONSOLIDATION_ENABLED: 'true',
    AGENTMEMORY_REFLECT: 'true',
    AGENTMEMORY_INJECT_CONTEXT: 'true',
    AGENTMEMORY_GRAPH_WEIGHT: '0.5',
    AGENTMEMORY_DROP_STALE_INDEX: 'true',
    AGENTMEMORY_DEBUG: 'true',
    AGENTMEMORY_PROJECT_NAME: 'my-project',
    AGENTMEMORY_AGENT_SCOPE: 'developer',
    AGENTMEMORY_CLAUDE_CODE_BRIDGE: 'true',
    AGENTMEMORY_CURSOR_BRIDGE: 'true',
  });
  expect(plan.config.agentMemory.environment).toEqual({
    AGENTMEMORY_PROVIDER: 'anthropic',
    EMBEDDING_PROVIDER: 'openai',
    GRAPH_EXTRACTION_ENABLED: 'true',
    CONSOLIDATION_ENABLED: 'true',
    AGENTMEMORY_REFLECT: 'true',
    AGENTMEMORY_INJECT_CONTEXT: 'true',
    AGENTMEMORY_GRAPH_WEIGHT: '0.5',
    AGENTMEMORY_DROP_STALE_INDEX: 'true',
    AGENTMEMORY_DEBUG: 'true',
    AGENTMEMORY_PROJECT_NAME: 'my-project',
    AGENTMEMORY_AGENT_SCOPE: 'developer',
    AGENTMEMORY_CLAUDE_CODE_BRIDGE: 'true',
    AGENTMEMORY_CURSOR_BRIDGE: 'true',
  });
  expect(plan.config.allowEgress).toBe(true);
  expect(plan.config.allowLlm).toBe(true);
});

test('mergeEnvFile escreve e preserva entradas no arquivo .env', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-envfile-'));
  directories.push(root);
  const envPath = path.join(root, '.env');

  await mergeEnvFile(envPath, {
    ANTHROPIC_API_KEY: 'sk-ant-key',
    GRAPH_EXTRACTION_ENABLED: 'true',
  });

  let content = await readFile(envPath, 'utf8');
  expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-key');
  expect(content).toContain('GRAPH_EXTRACTION_ENABLED=true');

  await mergeEnvFile(envPath, {
    ANTHROPIC_API_KEY: 'sk-ant-updated',
    CONSOLIDATION_ENABLED: 'true',
  });

  content = await readFile(envPath, 'utf8');
  expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-updated');
  expect(content).toContain('GRAPH_EXTRACTION_ENABLED=true');
  expect(content).toContain('CONSOLIDATION_ENABLED=true');
});
