import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, test } from 'vitest';

import { handleGitHook } from '../../src/cli/hook.js';
import type { MegaBrainConfig } from '../../src/config/schema.js';
import type { ProjectIdentity } from '../../src/projects/identity.js';

const execFileAsync = promisify(execFile);

describe('git hook redaction', () => {
  test('AC-062: handleGitHook sanitiza payload antes de enfileirar falha @spec:AC-062', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mega-brain-git-redact-'));
    await execFileAsync('git', ['init', root]);

    const config = {
      dataDir: root,
      port: 3000,
      logLevel: 'info',
      allowEgress: false,
      allowLlm: false,
      agentMemory: { mode: 'managed', baseUrl: 'http://127.0.0.1:3111' },
      codeReviewGraph: { command: 'code-review-graph', args: [] },
      environment: {},
      projects: {},
    } as unknown as MegaBrainConfig;

    const identity: ProjectIdentity = {
      root,
      gitDir: join(root, '.git'),
      commonGitDir: join(root, '.git'),
      repositoryId: 'repo-1',
      checkoutId: 'checkout-1',
      worktreeId: 'worktree-1',
    };

    const secretToken = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    const secretAuth = 'Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890';

    const result = await handleGitHook({
      event: 'post-commit',
      config,
      identity,
      hookArgs: ['--token', secretToken],
      stdin: `commit message with ${secretAuth}`,
    });

    expect(result.duplicate).toBe(false);
    expect(result.queued).toBe(true);

    const queueFile = join(root, 'projects', 'worktree-1', 'hook-queue.json');
    const content = await readFile(queueFile, 'utf8');
    const queue = JSON.parse(content) as Array<{ event: { payload: { hookArgs: string[]; stdin: string } } }>;

    expect(queue).toHaveLength(1);
    const queuedPayload = queue[0].event.payload;
    expect(queuedPayload.hookArgs.join(' ')).not.toContain(secretToken);
    expect(queuedPayload.hookArgs.join(' ')).toContain('[REDACTED]');
    expect(queuedPayload.stdin).not.toContain('sk-ant-api03');
    expect(queuedPayload.stdin).toContain('[REDACTED]');
  });
});
