import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

// Mutation tests exercise production modules through their normal unit and
// module-contract interfaces. The two end-to-end suites boot Gradle and a
// Kotlin harness; they remain mandatory in test:cross-runtime-e2e, where one
// verified build is meaningful. Re-running them for every TypeScript mutant
// would turn a deterministic code-quality gate into a multi-hour process
// without increasing mutation sensitivity.
export default mergeConfig(baseConfig, defineConfig({
  test: {
    exclude: [
      "tests/cross-runtime-e2e-contract.test.ts",
      "tests/cross-runtime-resource-recovery.test.ts",
    ],
  },
}));
