import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { installManagedRuntime, inspectManagedRuntime, type CommandRunner } from '../../src/cli/install.js';
import { deriveProjectIdentity } from '../../src/projects/identity.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('AC-001: instalação cria runtime isolado e verificável @spec:AC-001', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mega-brain-runtime-'));
  temporaryDirectories.push(dataDir);
  const identity = deriveProjectIdentity({
    root: path.join(dataDir, 'repo'),
    gitDir: '.git',
    commonGitDir: '.git',
    remote: 'https://github.com/example/project.git',
  });
  const commands: Array<{ command: string; args: string[] }> = [];
  const runner: CommandRunner = {
    async run(command, args) {
      commands.push({ command, args });
    },
  };

  const manifest = await installManagedRuntime({
    dataDir,
    identity,
    runner,
    now: new Date('2026-08-24T12:00:00.000Z'),
  });
  const inspection = await inspectManagedRuntime(dataDir, identity);

  expect(commands).toHaveLength(3);
  expect(commands[0]?.args).toContain('@agentmemory/agentmemory@0.9.29');
  expect(commands[2]?.args).toContain('code-review-graph==2.3.7');
  expect(manifest.versions).toEqual({ megaBrain: '0.1.0', agentMemory: '0.9.29', codeReviewGraph: '2.3.7' });
  expect(inspection.healthy).toBe(true);
  expect(inspection.checks).toEqual({ project: true, agentMemory: true, codeReviewGraph: true });
  expect(manifest.backends.codeReviewGraph.lifecycle).toBe('on-demand');
});
