import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'test/**/*.test.js'],
    environment: 'node',
    passWithNoTests: false,
    fileParallelism: false,
  },
});
