import { expect, test } from 'vitest';

import { createLocalLogger } from '../../src/observability/logger.js';
import { redactText, redactValue } from '../../src/security/redaction.js';

test('P-002: segredos nunca são persistidos nem expostos @principle:P-002', () => {
  const privateKey = '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----';
  const entropyToken = 'M7pQ2vN9xL4kR8sT1wY6zA3bC5dE0fGh';
  const input = {
    authToken: 'direct-secret',
    nested: {
      text: `Authorization: Bearer top.secret.token password=hunter2 Cookie: sid=raw ${privateKey} ${entropyToken}`,
      commitHash: '0123456789abcdef0123456789abcdef01234567',
    },
  };
  const redacted = redactValue(input);
  const serialized = JSON.stringify(redacted);
  for (const secret of ['direct-secret', 'top.secret.token', 'hunter2', 'abc123', entropyToken, 'sid=raw']) {
    expect(serialized).not.toContain(secret);
  }
  expect(serialized).toContain('0123456789abcdef0123456789abcdef01234567');
  const infoLines: string[] = [];
  createLocalLogger((line) => infoLines.push(line), { environment: { MEGA_BRAIN_LOG_LEVEL: 'info' } }).log('info', 'request', input);
  expect(infoLines).toEqual([]);

  const debugLines: string[] = [];
  createLocalLogger((line) => debugLines.push(line), { environment: { MEGA_BRAIN_LOG_LEVEL: 'debug' } }).log('info', 'request', input);
  expect(debugLines[0]).not.toContain('direct-secret');
  expect(redactText('API_KEY=very-secret-value')).toBe('API_KEY=[REDACTED]');
});
