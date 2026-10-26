import { defineConfig } from "vitest/config";

// Focused display/projection regressions do not require the unrelated JVM flight harness.
export default defineConfig({
  test: {
    include: [
      "tests/operator-aircraft-position.test.ts",
      "tests/operation-workflow-contract.test.ts",
      "tests/operation-workflow-internals.test.ts",
      "tests/workflow-snapshot-camera-frame-contract.test.ts",
      "tests/telemetry-intake-contract.test.ts",
      "tests/renderer-render-scheduler.test.ts",
    ],
  },
});
