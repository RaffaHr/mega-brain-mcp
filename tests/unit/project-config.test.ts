import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

import { ensureGitIgnore, projectConfigSchema, writeProjectConfig } from '../../src/config/project-config.js';

const execFileAsync = promisify(execFile);

describe('project config and gitignore automation', () => {
  test('ensureGitIgnore cria .gitignore somente com proteção local do Mega Brain', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-gitignore-test-'));
    try {
      const gitignore = await ensureGitIgnore(root);
      const content = await readFile(gitignore, 'utf8');
      expect(content).toContain('.mega-brain/');
      expect(content).not.toContain('.env');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('ensureGitIgnore e idempotente e preserva conteudo existente', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-gitignore-test-'));
    try {
      const target = path.join(root, '.gitignore');
      await writeFile(target, 'node_modules/\ndist/\n', 'utf8');
      await ensureGitIgnore(root);
      await ensureGitIgnore(root);
      const content = await readFile(target, 'utf8');
      expect(content).toBe('node_modules/\ndist/\n.mega-brain/\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('projectConfigSchema aceita chaves de provedor nos mapas de backend', () => {
    const parsed = projectConfigSchema.parse({
      dataDir: '.mega-brain',
      agentMemory: {
        mode: 'managed',
        baseUrl: 'http://127.0.0.1:3111',
        ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
        environment: {
          OPENAI_API_KEY: 'sk-test',
          EMBEDDING_PROVIDER: 'openai',
        },
      },
      codeReviewGraph: {
        command: 'code-review-graph',
        args: [],
        environment: {
          CRG_OPENAI_API_KEY: 'sk-crg-test',
          CRG_EMBEDDING_MODEL: 'text-embedding-3-small',
        },
      },
    });

    expect(parsed.agentMemory.environment.OPENAI_API_KEY).toBe('sk-test');
    expect(parsed.codeReviewGraph.environment.CRG_OPENAI_API_KEY).toBe('sk-crg-test');
  });

  test('writeProjectConfig rejeita variáveis ineficazes e valores vazios', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-config-test-'));
    const base = {
      dataDir: '.mega-brain',
      agentMemory: {
        mode: 'managed' as const,
        baseUrl: 'http://127.0.0.1:3111',
        ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
        environment: {},
      },
      codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
    };
    try {
      await expect(writeProjectConfig(root, {
        ...base,
        agentMemory: { ...base.agentMemory, environment: { AGENTMEMORY_PROVIDER: 'openai' } },
      })).rejects.toThrow(/AGENTMEMORY_PROVIDER is not an effective agentMemory setting/);
      await expect(writeProjectConfig(root, {
        ...base,
        agentMemory: { ...base.agentMemory, environment: { EMBEDDING_PROVIDER: '   ' } },
      })).rejects.toThrow(/EMBEDDING_PROVIDER cannot be empty/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('writeProjectConfig restringe permissões do arquivo local', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-project-permissions-'));
    try {
      const target = await writeProjectConfig(root, {
        dataDir: '.mega-brain',
        agentMemory: {
          mode: 'managed',
          baseUrl: 'http://127.0.0.1:3111',
          ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
          environment: { OPENAI_API_KEY: 'local-secret' },
        },
        codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
      });

      if (process.platform === 'win32') {
        const principal = (await execFileAsync('whoami')).stdout.trim();
        const acl = (await execFileAsync('icacls', [target])).stdout;
        expect(acl.toLowerCase()).toContain(`${principal.toLowerCase()}:(f)`);
        expect(acl).not.toMatch(/BUILTIN\\Users|Authenticated Users|Everyone|Todos/iu);
      } else {
        expect((await stat(target)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('writeProjectConfig preserva .env byte por byte', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-env-untouched-'));
    const envPath = path.join(root, '.env');
    const original = 'APP_TOKEN=project-owned\r\nCUSTOM_SETTING=value\r\n';
    try {
      await writeFile(envPath, original, 'utf8');
      await writeProjectConfig(root, {
        dataDir: '.mega-brain',
        agentMemory: {
          mode: 'managed',
          baseUrl: 'http://127.0.0.1:3111',
          ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
          environment: {},
        },
        codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
      });
      expect(await readFile(envPath, 'utf8')).toBe(original);
      expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('.mega-brain/\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('writeProjectConfig bloqueia .mega-brain rastreado sem sobrescrever segredo', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-tracked-config-'));
    const configDirectory = path.join(root, '.mega-brain');
    const target = path.join(configDirectory, 'config.json');
    const original = '{"historicalSecret":"must-remain-unchanged"}\n';
    try {
      await execFileAsync('git', ['init', root]);
      await writeFile(path.join(root, '.gitignore'), '', 'utf8');
      await mkdir(configDirectory, { recursive: true });
      await writeFile(target, original, 'utf8');
      await execFileAsync('git', ['-C', root, 'add', '-f', '.mega-brain/config.json']);

      await expect(writeProjectConfig(root, {
        dataDir: '.mega-brain',
        agentMemory: {
          mode: 'managed',
          baseUrl: 'http://127.0.0.1:3111',
          ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
          environment: { OPENAI_API_KEY: 'new-secret-must-not-write' },
        },
        codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
      })).rejects.toThrow(/git rm --cached -r -- \.mega-brain/);
      expect(await readFile(target, 'utf8')).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
