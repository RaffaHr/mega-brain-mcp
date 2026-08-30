import { expect, test } from 'vitest';

import { renderMegaBrainLogoFrame } from '../../src/cli/brand.js';
import { cliIcons, formatSetupSummary } from '../../src/cli/ui.js';

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/gu, '');
}

test('setup summary renders as a native terminal table instead of a markdown pipe table', () => {
  const summary = stripAnsi(formatSetupSummary({
    repository: 'C:/repo',
    hosts: ['codex', 'claude'],
    agentMemory: 'managed',
    codeReviewGraphMode: 'managed',
    dataDir: 'C:/data',
    strictIsolation: true,
    allowEgress: false,
    allowLlm: false,
  }));

  expect(summary).toContain('┌');
  expect(summary).toContain('│ Repository');
  expect(summary).toContain('│ Hosts');
  expect(summary).not.toContain('| Setting | Value |');
});

test('setup summary mostra source, status, consumers e motivos de skip sem segredo', () => {
  const configured = stripAnsi(formatSetupSummary({
    repository: 'C:/repo',
    hosts: ['codex'],
    allowEgress: true,
    allowLlm: true,
    effective: {
      allowEgress: true,
      allowLlm: true,
      agentMemory: {
        mode: 'managed',
        baseUrl: 'http://127.0.0.1:3111',
        ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 },
        environment: { OPENAI_API_KEY: '[REDACTED]' },
      },
      codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
    },
    sources: { 'agentMemory.environment.OPENAI_API_KEY': 'user' },
    status: { 'agentMemory.environment.OPENAI_API_KEY': 'configured' },
  }));
  expect(configured).toContain('Effective value');
  expect(configured).toContain('Consumers');
  expect(configured).toContain('[REDACTED]');
  expect(configured).not.toContain('raw-openai-secret');

  const local = stripAnsi(formatSetupSummary({
    repository: 'C:/repo',
    hosts: ['codex'],
    allowEgress: false,
    allowLlm: false,
    effective: {
      allowEgress: false,
      allowLlm: false,
      agentMemory: { mode: 'managed', environment: {} },
      codeReviewGraph: { command: 'code-review-graph', args: [], environment: {} },
    },
  }));
  expect(local).toContain('skipped: requires allowEgress=true and allowLlm=true');
});

test('setup glyphs avoid private-use font icons', () => {
  expect(Object.values(cliIcons).join('')).not.toMatch(/[\uE000-\uF8FF]/u);
});

test('mega brain logo uses foreground color only and remains compact', () => {
  const frame = renderMegaBrainLogoFrame(0, { width: 38, height: 14 });
  expect(frame).not.toContain('\x1b[48;');
  expect(stripAnsi(frame).split('\n')).toHaveLength(16);
  expect(stripAnsi(frame)).toMatch(/[01]/u);
});
