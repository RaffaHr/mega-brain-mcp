import { expect, test } from 'vitest';

import { LeaseRegistry } from '../../src/runtime/leases.js';

test('AC-041: leases expiram em 30s e shutdown respeita grace de 5s @spec:AC-041', () => {
  let now = 0;
  const leases = new LeaseRegistry({ now: () => now });

  leases.acquire('codex');
  leases.acquire('claude');
  now = 10_000;
  leases.heartbeat('claude');
  now = 30_001;

  expect(leases.pruneExpired()).toEqual(['codex']);
  expect(leases.activeIds()).toEqual(['claude']);
  expect(leases.shouldShutdown()).toBe(false);

  leases.release('claude');
  expect(leases.shouldShutdown()).toBe(false);
  now = 35_001;
  expect(leases.shouldShutdown()).toBe(true);
});

test('AC-041: uma nova lease durante o grace cancela o shutdown @spec:AC-041', () => {
  let now = 100;
  const leases = new LeaseRegistry({ now: () => now });

  leases.acquire('first');
  leases.release('first');
  now += 4_999;
  leases.acquire('replacement');
  now += 10_000;

  expect(leases.shouldShutdown()).toBe(false);
  expect(leases.heartbeatIntervalMs).toBe(10_000);
  expect(leases.leaseTtlMs).toBe(30_000);
  expect(leases.shutdownGraceMs).toBe(5_000);
});
