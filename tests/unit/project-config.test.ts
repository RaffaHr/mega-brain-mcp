import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { ensureGitIgnore, projectConfigSchema, writeProjectConfig } from '../../src/config/project-config.js';

describe('project config and gitignore automation', () => {
  test('ensureGitIgnore cria .gitignore com .mega-brain/ e .env quando arquivo nao existe', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-gitignore-test-'));
    try {
      const gitignore = await ensureGitIgnore(root);
      const content = await readFile(gitignore, 'utf8');
      expect(content).toContain('.mega-brain/');
      expect(content).toContain('.env');
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
      expect(content).toBe('node_modules/\ndist/\n.mega-brain/\n.env\n');
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
});
