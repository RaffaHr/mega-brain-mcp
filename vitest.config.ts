import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'test/**/*.test.js'],
    globalSetup: ['tests/global-setup.ts'],
    environment: 'node',
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});