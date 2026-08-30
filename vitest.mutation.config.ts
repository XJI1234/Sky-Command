import { defineConfig } from "vitest/config";

// Mutation tests exercise production modules through their normal unit and
// module-contract interfaces. The two end-to-end suites boot Gradle and a
// Kotlin harness; they remain mandatory in test:cross-runtime-e2e, where one
// verified build is meaningful. Re-running them for every TypeScript mutant
// would turn a deterministic code-quality gate into a multi-hour process
// without increasing mutation sensitivity.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/modules/cross-runtime-e2e/**/*.test.ts"],
    exclude: [
      "tests/cross-runtime-e2e-contract.test.ts",
      "tests/cross-runtime-resource-recovery.test.ts",
    ],
  },
});
