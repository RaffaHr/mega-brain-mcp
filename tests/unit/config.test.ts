import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import {
  filterBackendEnvironment,
  loadConfig,
  redactConfig,
  UnsafeEnvironmentVariableError,
} from '../../src/config/load.js';

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

  expect(config.dataDir).toBe('from-env');
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
    'AGENTMEMORY_III_VERSION=0.11.2',
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
    environment: {
      AGENTMEMORY_VERBOSE: 'true',
      AGENTMEMORY_TOOLS: 'all',
      SNAPSHOT_ENABLED: 'false',
      AGENTMEMORY_SECRET: 'managed-local-secret',
      AGENTMEMORY_III_VERSION: '0.11.2',
      AGENTMEMORY_DEBUG: 'true',
    },
  });
  expect(config.agentMemory.environment).not.toHaveProperty('AGENTMEMORY_UNKNOWN_OPTION');
  expect(JSON.stringify(redactConfig(config))).not.toContain('managed-local-secret');
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
