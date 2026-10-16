import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit/contract regression checks need no external Android Gradle test harness.
// The original npm test remains the gate for the separate cross-runtime project.
export default defineConfig({
  test: { root: fileURLToPath(new URL('../', import.meta.url)), include: ['tests/**/*.test.ts'], exclude: ['tests/cross-runtime-*.test.ts'], maxWorkers: 4 }
});
