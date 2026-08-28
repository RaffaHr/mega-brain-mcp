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

test('setup glyphs avoid private-use font icons', () => {
  expect(Object.values(cliIcons).join('')).not.toMatch(/[\uE000-\uF8FF]/u);
});

test('mega brain logo uses foreground color only and remains compact', () => {
  const frame = renderMegaBrainLogoFrame(0, { width: 38, height: 14 });
  expect(frame).not.toContain('\x1b[48;');
  expect(stripAnsi(frame).split('\n')).toHaveLength(16);
  expect(stripAnsi(frame)).toMatch(/[01]/u);
});
