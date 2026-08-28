import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import {
  filterBackendEnvironment,
  loadConfig,
  loadManagedDependencyVersions,
  redactConfig,
  UnsafeEnvironmentVariableError,
} from '../../src/config/load.js';
import { resolveProjectConfig } from '../../src/config/project-config.js';
import {
  DEFAULT_MANAGED_DEPENDENCY_VERSIONS,
  LEGACY_III_ENGINE_VERSION_ENV,
  MANAGED_DEPENDENCY_VERSION_ENV,
} from '../../src/runtime/dependency-versions.js';

test('AC-003: configuração dos backends é encaminhada com segurança @spec:AC-003', async () => {
  const config = await loadConfig({
    envFilePath: false,
    fileConfig: {
      dataDir: 'from-file',
      agentMemory: { baseUrl: 'http://127.0.0.1:9000', authToken: 'file-token', environment: {} },
    },
    env: {
      MEGA_BRAIN_DATA_DIR: 'from-env',
      MEGA_BRAIN_ALLOW_EGRESS: 'true',
      MEGA_BRAIN_ALLOW_LLM: 'true',
      MEGA_BRAIN_AGENTMEMORY_TOKEN: 'top-secret',
      MEGA_BRAIN_AGENTMEMORY_ENV_JSON: JSON.stringify({
        EMBEDDING_PROVIDER: 'local',
        AGENTMEMORY_REFLECT: 'true',
      }),
      MEGA_BRAIN_CRG_ENV_JSON: JSON.stringify({ CRG_EMBEDDINGS: 'local' }),
    },
  });

  expect(config.dataDir).toBe(path.resolve('from-env'));
  expect(config.agentMemory.environment).toEqual({
    EMBEDDING_PROVIDER: 'local',
    AGENTMEMORY_REFLECT: 'true',
  });
  expect(config.codeReviewGraph.environment).toEqual({ CRG_EMBEDDINGS: 'local' });
  expect(JSON.stringify(redactConfig(config))).not.toContain('top-secret');
  expect(redactConfig(config)).toMatchObject({ agentMemory: { authToken: '[REDACTED]' } });

  expect(() => filterBackendEnvironment('agentMemory', { NODE_OPTIONS: '--require malware.js' })).toThrow(
    UnsafeEnvironmentVariableError,
  );
  expect(() => filterBackendEnvironment('codeReviewGraph', { PATH: 'C:\\untrusted' })).toThrow(
    UnsafeEnvironmentVariableError,
  );
});

test('AC-026: modo remoto usa somente URL e token e ignora configuração local @spec:AC-026', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'mega-brain-remote-'));
  await writeFile(path.join(repoPath, '.env'), [
    'MEGA_BRAIN_AGENTMEMORY_MODE=managed',
    'MEGA_BRAIN_AGENTMEMORY_URL=http://env-file.invalid:3111',
    'AGENTMEMORY_SECRET=local-secret-must-not-leak',
    'AGENTMEMORY_AUTO_COMPRESS=true',
    'OPENAI_API_KEY=provider-secret-must-not-leak',
    'MEGA_BRAIN_AGENTMEMORY_ENV_JSON={"NODE_OPTIONS":"--require untrusted.js"}',
  ].join('\n'));

  const config = await loadConfig({
    repoPath,
    fileConfig: {
      dataDir: 'from-config',
      agentMemory: {
        mode: 'managed',
        baseUrl: 'http://config.invalid:3111',
        environment: { AGENTMEMORY_REFLECT: 'true' },
      },
    },
    env: {
      MEGA_BRAIN_AGENTMEMORY_MODE: 'remote',
      MEGA_BRAIN_AGENTMEMORY_URL: 'https://memory.example.test',
      MEGA_BRAIN_AGENTMEMORY_TOKEN: 'remote-token',
    },
  });

  expect(config.agentMemory).toEqual({
    mode: 'remote',
    baseUrl: 'https://memory.example.test',
    authToken: 'remote-token',
    ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
    environment: {},
  });
  expect(JSON.stringify(redactConfig(config))).not.toContain('remote-token');
  expect(JSON.stringify(redactConfig(config))).not.toContain('local-secret-must-not-leak');
});

test('AC-027: modo gerenciado combina .env e processo por allowlist e reutiliza o secret local @spec:AC-027', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'mega-brain-managed-'));
  await writeFile(path.join(repoPath, '.env'), [
    'MEGA_BRAIN_AGENTMEMORY_MODE=managed',
    'MEGA_BRAIN_AGENTMEMORY_URL=http://127.0.0.1:4111',
    'AGENTMEMORY_SECRET=managed-local-secret',
    'AGENTMEMORY_TOOLS=core',
    `${LEGACY_III_ENGINE_VERSION_ENV}=${DEFAULT_MANAGED_DEPENDENCY_VERSIONS.iiiEngine}`,
    'AGENTMEMORY_UNKNOWN_OPTION=not-forwarded',
    'MEGA_BRAIN_AGENTMEMORY_ENV_JSON={"AGENTMEMORY_TOOLS":"all","SNAPSHOT_ENABLED":"false"}',
  ].join('\n'));

  const config = await loadConfig({
    repoPath,
    fileConfig: {
      dataDir: 'from-config',
      agentMemory: {
        baseUrl: 'http://127.0.0.1:3111',
        environment: { AGENTMEMORY_VERBOSE: 'true' },
      },
    },
    env: {
      AGENTMEMORY_TOOLS: 'all',
      AGENTMEMORY_DEBUG: 'true',
    },
  });

  expect(config.agentMemory).toEqual({
    mode: 'managed',
    baseUrl: 'http://127.0.0.1:4111',
    authToken: 'managed-local-secret',
    ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
    environment: {
      AGENTMEMORY_VERBOSE: 'true',
      AGENTMEMORY_TOOLS: 'all',
      SNAPSHOT_ENABLED: 'false',
      AGENTMEMORY_SECRET: 'managed-local-secret',
      AGENTMEMORY_DEBUG: 'true',
    },
  });
  expect(config.agentMemory.environment).not.toHaveProperty('AGENTMEMORY_UNKNOWN_OPTION');
  expect(JSON.stringify(redactConfig(config))).not.toContain('managed-local-secret');
});

test('versoes gerenciadas usam default e permitem override por env e .env', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'mega-brain-managed-versions-'));
  await writeFile(path.join(repoPath, '.env'), [
    `${MANAGED_DEPENDENCY_VERSION_ENV.agentMemory}=0.9.30`,
    `${MANAGED_DEPENDENCY_VERSION_ENV.codeReviewGraph}=2.4.0`,
    `${LEGACY_III_ENGINE_VERSION_ENV}=0.11.3`,
  ].join('\n'));

  const fromDotEnv = await loadManagedDependencyVersions({ repoPath, env: {} });
  expect(fromDotEnv.versions).toEqual({
    agentMemory: '0.9.30',
    codeReviewGraph: '2.4.0',
    iiiEngine: '0.11.3',
  });
  expect(fromDotEnv.sources).toEqual({ agentMemory: 'dotenv', codeReviewGraph: 'dotenv', iiiEngine: 'dotenv' });

  const fromProcess = await loadManagedDependencyVersions({
    repoPath,
    env: {
      [MANAGED_DEPENDENCY_VERSION_ENV.codeReviewGraph]: '2.4.1',
      [MANAGED_DEPENDENCY_VERSION_ENV.iiiEngine]: '0.11.4',
    },
  });
  expect(fromProcess.versions).toEqual({
    agentMemory: '0.9.30',
    codeReviewGraph: '2.4.1',
    iiiEngine: '0.11.4',
  });
  expect(fromProcess.sources).toEqual({ agentMemory: 'dotenv', codeReviewGraph: 'process', iiiEngine: 'process' });

  await expect(loadManagedDependencyVersions({
    repoPath,
    envFilePath: false,
    env: { [MANAGED_DEPENDENCY_VERSION_ENV.agentMemory]: 'latest' },
  })).rejects.toThrow(/exact semver/);

  await expect(loadManagedDependencyVersions({ envFilePath: false, env: {} })).resolves.toMatchObject({
    versions: DEFAULT_MANAGED_DEPENDENCY_VERSIONS,
  });
});

test('AC-028: credenciais e recursos remotos ou LLM exigem opt-ins e permanecem redigidos @spec:AC-028', async () => {
  await expect(loadConfig({
    envFilePath: false,
    env: { ANTHROPIC_API_KEY: 'provider-secret', AGENTMEMORY_AUTO_COMPRESS: 'true' },
  })).rejects.toThrow(/ANTHROPIC_API_KEY.*MEGA_BRAIN_ALLOW_EGRESS=true.*MEGA_BRAIN_ALLOW_LLM=true/);

  await expect(loadConfig({
    envFilePath: false,
    env: { VOYAGE_API_KEY: 'embedding-secret' },
  })).rejects.toThrow(/VOYAGE_API_KEY.*MEGA_BRAIN_ALLOW_EGRESS=true/);

  await expect(loadConfig({
    envFilePath: false,
    env: {
      MEGA_BRAIN_ALLOW_EGRESS: 'true',
      AGENTMEMORY_INJECT_CONTEXT: 'true',
    },
  })).rejects.toThrow(/AGENTMEMORY_INJECT_CONTEXT.*MEGA_BRAIN_ALLOW_LLM=true/);

  const config = await loadConfig({
    envFilePath: false,
    env: {
      MEGA_BRAIN_ALLOW_EGRESS: 'true',
      MEGA_BRAIN_ALLOW_LLM: 'true',
      ANTHROPIC_API_KEY: 'provider-secret',
      VOYAGE_API_KEY: 'embedding-secret',
      AGENTMEMORY_AUTO_COMPRESS: 'true',
    },
  });

  expect(config.agentMemory.environment).toMatchObject({
    ANTHROPIC_API_KEY: 'provider-secret',
    VOYAGE_API_KEY: 'embedding-secret',
    AGENTMEMORY_AUTO_COMPRESS: 'true',
  });
  const redacted = JSON.stringify(redactConfig(config));
  expect(redacted).not.toContain('provider-secret');
  expect(redacted).not.toContain('embedding-secret');
});

test('AC-050: resolver canônico aplica precedência e expõe somente a origem redigida @spec:AC-050', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'mega-brain-config-origin-'));
  await writeFile(path.join(repoPath, '.env'), [
    'MEGA_BRAIN_DATA_DIR=from-dotenv',
    'MEGA_BRAIN_PORT=4100',
    'MEGA_BRAIN_AGENTMEMORY_MODE=remote',
    'MEGA_BRAIN_AGENTMEMORY_URL=https://dotenv.invalid',
    'MEGA_BRAIN_AGENTMEMORY_TOKEN=dotenv-token',
  ].join('\n'));

  const resolved = await resolveProjectConfig({
    repoPath,
    fileConfig: {
      dataDir: 'from-config',
      port: 3200,
      agentMemory: {
        mode: 'remote',
        baseUrl: 'https://config.invalid',
        authToken: 'config-token',
        environment: {},
      },
    },
    env: {
      MEGA_BRAIN_DATA_DIR: 'from-process',
      MEGA_BRAIN_PORT: '4200',
      MEGA_BRAIN_AGENTMEMORY_URL: 'https://process.invalid',
      MEGA_BRAIN_AGENTMEMORY_TOKEN: 'must-never-appear-in-diagnostics',
    },
    flags: {
      dataDir: 'from-flags',
      port: 4300,
      agentMemoryBaseUrl: 'https://flags.example.test',
    },
  });

  expect(resolved.config).toMatchObject({
    dataDir: path.resolve(repoPath, 'from-flags'),
    port: 4300,
      agentMemory: {
        mode: 'remote',
        baseUrl: 'https://flags.example.test',
        authToken: 'must-never-appear-in-diagnostics',
      },
  });
  expect(resolved.sources).toMatchObject({
    dataDir: 'flag',
    port: 'flag',
    'agentMemory.baseUrl': 'flag',
    'agentMemory.authToken': 'process',
  });
  expect(Object.isFrozen(resolved.config)).toBe(true);
  expect(Object.isFrozen(resolved.config.agentMemory)).toBe(true);
  expect(JSON.stringify(resolved.diagnostic)).not.toContain('must-never-appear-in-diagnostics');
  expect(resolved.diagnostic).toMatchObject({
    config: { agentMemory: { authToken: '[REDACTED]' } },
    sources: { dataDir: 'flag', port: 'flag' },
  });
});

test('AC-051: porta e diretórios relativos do .env são resolvidos contra o repositório @spec:AC-051', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'mega-brain-config-repo-'));
  await writeFile(path.join(repoPath, '.env'), [
    'MEGA_BRAIN_DATA_DIR=.runtime-data',
    'MEGA_BRAIN_PORT=4567',
    'MEGA_BRAIN_CRG_DATA_DIR=.runtime-data/crg',
  ].join('\n'));

  const resolved = await resolveProjectConfig({ repoPath, env: {} });

  expect(resolved.config.dataDir).toBe(path.resolve(repoPath, '.runtime-data'));
  expect(resolved.config.port).toBe(4567);
  expect(resolved.config.codeReviewGraph.dataDir).toBe(path.resolve(repoPath, '.runtime-data/crg'));
  expect(resolved.sources).toMatchObject({
    dataDir: 'dotenv',
    port: 'dotenv',
    'codeReviewGraph.dataDir': 'dotenv',
  });
});

test('AC-053: segredo remoto vem do config local e é omitido do diagnóstico @spec:AC-053', async () => {
  const resolved = await resolveProjectConfig({
    envFilePath: false,
    fileConfig: {
      dataDir: '.data',
      agentMemory: {
        mode: 'remote',
        baseUrl: 'https://memory.example.test',
        authToken: 'runtime-only-secret',
        environment: {},
      },
    },
    env: {},
  });

  expect(resolved.config.agentMemory.authToken).toBe('runtime-only-secret');
  expect(JSON.stringify(resolved.diagnostic)).not.toContain('runtime-only-secret');
  expect(JSON.stringify(resolved.diagnostic)).not.toContain('authToken":"runtime-only-secret');
});
