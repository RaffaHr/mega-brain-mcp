import path from 'node:path';

import { expect, test } from 'vitest';

import { DEFAULT_MANAGED_DEPENDENCY_VERSIONS } from '../../src/runtime/dependency-versions.js';

import {
  assertProgressTableHasReasonableWidth,
  createOperationProgress,
  formatInstallFailureReport,
  formatInstallReport,
  formatUninstallFailureReport,
  formatUninstallReport,
  formatUpgradeFailureReport,
  formatUpgradeReport,
  installSteps,
  uninstallSteps,
  upgradeLogMatches,
  upgradeSteps,
} from '../../src/cli/operation-progress.js';
import type { RuntimeInspection } from '../../src/cli/install.js';
import type { ProjectIdentity } from '../../src/projects/identity.js';

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/gu, '');
}

const identity: ProjectIdentity = {
  root: path.resolve('repo'),
  repositoryId: 'repo-id',
  checkoutId: 'checkout-id',
  worktreeId: 'worktree-id',
  gitBacked: true,
};

const inspection: RuntimeInspection = {
  healthy: true,
  checks: { project: true, isolation: true, agentMemory: true, codeReviewGraph: true },
  manifest: {
    schemaVersion: 1,
    installedAt: '2026-08-28T00:00:00.000Z',
    agentMemoryMode: 'managed',
    project: { repositoryId: 'repo-id', checkoutId: 'checkout-id', worktreeId: 'worktree-id' },
    versions: { megaBrain: '0.1.7', agentMemory: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory, codeReviewGraph: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.codeReviewGraph, iiiEngine: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.iiiEngine },
    backends: {
      agentMemory: { command: 'node', args: [], cwd: '.', lifecycle: 'daemon' },
      codeReviewGraph: { command: 'python', args: [], cwd: '.', lifecycle: 'on-demand' },
    },
    isolation: {
      worktreeId: 'worktree-id',
      ports: { rest: 3010, streams: 3011, viewer: 3012, engine: 3013 },
      paths: {
        agentMemory: path.resolve('runtime/agentmemory'),
        iiiEngine: path.resolve('runtime/iii-engine'),
        codeReviewGraph: path.resolve('runtime/code-review-graph'),
        provenance: path.resolve('runtime/provenance.sqlite'),
      },
    },
  },
};

test('upgrade report renders progress and summary tables', () => {
  const steps = upgradeSteps({
    agentMemoryMode: 'managed',
    managedIiiEngineRequired: true,
    managedCodeReviewGraph: true,
  }).map((step) => ({ ...step, status: step.status ?? 'success' as const }));

  const report = stripAnsi(formatUpgradeReport({ identity, inspection, steps }));

  expect(report).toContain('Upgrade progress');
  expect(report).toContain('Upgrade summary');
  expect(report).toContain('│ Mega Brain runtime');
  expect(report).toContain('✓ Updated');
  expect(report).toContain('iii-engine');
  expect(report).not.toContain('{"schemaVersion"');
  expect(assertProgressTableHasReasonableWidth(report)).toBe(true);
});

test('uninstall report renders removed components and preserved data', () => {
  const steps = uninstallSteps({ repository: true, purge: false }).map((step) => ({
    ...step,
    status: step.status ?? 'success' as const,
  }));

  const report = stripAnsi(formatUninstallReport({
    hosts: ['codex', 'claude'],
    purge: false,
    result: { dataPreserved: true },
    steps,
  }));

  expect(report).toContain('Uninstall progress');
  expect(report).toContain('Uninstall summary');
  expect(report).toContain('│ Runtime');
  expect(report).toContain('✓ Removed');
  expect(report).toContain('Preserved');
  expect(report).not.toContain('{"dataPreserved"');
});

test('install report renders installed components and connection details', () => {
  const steps = installSteps({
    agentMemoryMode: 'managed',
    managedIiiEngineRequired: true,
    managedCodeReviewGraph: true,
    repository: true,
    preflightDetail: 'Node 24.18.0; Python 3.12.10; Git 2.54.0; win32',
  }).map((step) => ({ ...step, status: step.status ?? 'success' as const }));

  const report = stripAnsi(formatInstallReport({
    identity,
    inspection,
    manifest: inspection.manifest,
    hosts: ['codex', 'claude'],
    connection: { transport: 'stdio', command: 'node', args: ['mega-brain', 'mcp', '--repo', identity.root] },
    hooksInstalled: true,
    mcpConfigured: true,
    steps,
  }));

  expect(report).toContain('Install progress');
  expect(report).toContain('Install summary');
  expect(report).toContain('│ Mega Brain runtime');
  expect(report).toContain('✓ Installed');
  expect(report).toContain('│ MCP files');
  expect(report).toContain('✓ Configured');
  expect(report).toContain('node mega-brain mcp --repo');
  expect(report).not.toContain('{"manifest"');
});

test('operation progress logger updates matching upgrade steps', () => {
  const progress = createOperationProgress({
    title: 'Mega Brain upgrade',
    steps: upgradeSteps({
      agentMemoryMode: 'managed',
      managedIiiEngineRequired: false,
      managedCodeReviewGraph: true,
    }),
    enabled: false,
  });
  const logger = progress.logger(upgradeLogMatches);

  logger.log('info', 'install: installing AgentMemory packages', { version: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory });
  logger.log('info', 'install: building Code Review Graph index');
  logger.log('info', 'install: runtime installation complete');

  const snapshot = progress.snapshot();
  expect(snapshot.find((step) => step.id === 'agentmemory')).toMatchObject({ status: 'success', detail: DEFAULT_MANAGED_DEPENDENCY_VERSIONS.agentMemory });
  expect(snapshot.find((step) => step.id === 'crg-index')).toMatchObject({ status: 'success' });
  expect(snapshot.find((step) => step.id === 'inspect-runtime')).toMatchObject({ status: 'success' });
});

test('failure reports include the failed step and error message', () => {
  const installFailure = stripAnsi(formatInstallFailureReport({
    error: new Error('iii-engine confirmation is required for managed AgentMemory on Windows'),
    steps: [{ id: 'iii-engine', label: 'iii-engine', status: 'error', error: 'iii-engine confirmation is required for managed AgentMemory on Windows' }],
  }));
  const upgradeFailure = stripAnsi(formatUpgradeFailureReport({
    error: new Error('iii-engine confirmation is required for managed AgentMemory on Windows'),
    steps: [{ id: 'iii-engine', label: 'iii-engine', status: 'error', error: 'iii-engine confirmation is required for managed AgentMemory on Windows' }],
  }));
  const uninstallFailure = stripAnsi(formatUninstallFailureReport({
    error: new Error('backup missing'),
    steps: [{ id: 'mcp-files', label: 'Restore MCP files', status: 'error', error: 'backup missing' }],
  }));

  expect(installFailure).toContain('Install failed');
  expect(installFailure).toContain('iii-engine confirmation is required');
  expect(upgradeFailure).toContain('Upgrade failed');
  expect(upgradeFailure).toContain('× Error');
  expect(upgradeFailure).toContain('iii-engine confirmation is required');
  expect(uninstallFailure).toContain('Uninstall failed');
  expect(uninstallFailure).toContain('backup missing');
});

test('operation progress redige segredos em erros', () => {
  const progress = createOperationProgress({
    title: 'Secure progress',
    steps: [{ id: 'config', label: 'Write config' }],
    enabled: false,
  });
  progress.fail('config', new Error('OPENAI_API_KEY=sk-secret-value'));
  const serialized = JSON.stringify(progress.snapshot());
  expect(serialized).not.toContain('sk-secret-value');
  expect(serialized).toContain('[REDACTED]');
});


test("formatVersionTransition renders explicit version comparisons and downgrade markers", async () => {
  const { formatVersionTransition } = await import("../../src/cli/operation-progress.js");

  expect(formatVersionTransition({ current: "2.3.7", target: "2.3.8", catalogDefault: "2.3.8" }))
    .toBe("2.3.7 (current) -> 2.3.8 (latest)");

  expect(formatVersionTransition({ current: "2.3.8", target: "2.3.7", catalogDefault: "2.3.8" }))
    .toBe("2.3.8 (current) -> 2.3.7 (target, downgrade)");

  expect(formatVersionTransition({ current: "2.3.7", target: "2.3.7", catalogDefault: "2.3.7" }))
    .toBe("2.3.7 (current, up-to-date)");

  expect(formatVersionTransition({ current: undefined, target: "2.3.8", catalogDefault: "2.3.8" }))
    .toBe("n/a -> 2.3.8 (latest)");
});

test("upgradeSteps populates version transition details when versions are provided", () => {
  const steps = upgradeSteps({
    agentMemoryMode: "managed",
    managedIiiEngineRequired: true,
    managedCodeReviewGraph: true,
    currentVersions: {
      agentMemory: "0.9.28",
      codeReviewGraph: "2.3.7",
      iiiEngine: "0.11.1",
    },
    targetVersions: {
      agentMemory: "0.9.29",
      codeReviewGraph: "2.3.6",
      iiiEngine: "0.11.2",
    },
  });

  const amStep = steps.find((s) => s.id === "agentmemory");
  const crgStep = steps.find((s) => s.id === "crg-package");
  const iiiStep = steps.find((s) => s.id === "iii-engine");

  expect(amStep?.detail).toBe("0.9.28 (current) -> 0.9.29 (latest)");
  expect(crgStep?.detail).toBe("2.3.7 (current) -> 2.3.6 (target, downgrade)");
  expect(iiiStep?.detail).toBe("0.11.1 (current) -> 0.11.2 (latest)");
});
