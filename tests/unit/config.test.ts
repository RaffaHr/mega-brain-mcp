import { expect, test } from 'vitest';

import {
  filterBackendEnvironment,
  loadConfig,
  redactConfig,
  UnsafeEnvironmentVariableError,
} from '../../src/config/load.js';

test('AC-003: configuração dos backends é encaminhada com segurança @spec:AC-003', async () => {
  const config = await loadConfig({
    fileConfig: {
      dataDir: 'from-file',
      agentMemory: { baseUrl: 'http://127.0.0.1:9000', authToken: 'file-token', environment: {} },
    },
    env: {
      MEGA_BRAIN_DATA_DIR: 'from-env',
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
