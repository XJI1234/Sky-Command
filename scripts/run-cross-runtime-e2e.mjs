import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = process.cwd();
const mobileRoot = resolve(process.env.MSDK_RELAY_PROJECT_ROOT ?? resolve(root, "..", "MSDK-relay"));
const environment = { ...process.env, MSDK_RELAY_PROJECT_ROOT: mobileRoot };
const finalEnvironment = {
  ...environment,
  CROSS_RUNTIME_VERIFICATION_STARTED_AT: `${Date.now()}`,
};

const run = (command, arguments_, options = {}) => {
  execFileSync(command, arguments_, {
    cwd: root,
    env: options.env ?? environment,
    stdio: "inherit",
    ...options,
  });
};

const nodeModules = resolve(root, "node_modules");
const tsc = resolve(nodeModules, "typescript", "bin", "tsc");
const vitest = resolve(nodeModules, "vitest", "vitest.mjs");
const stryker = resolve(nodeModules, "@stryker-mutator", "core", "bin", "stryker.js");
const java = process.env.JAVA_HOME === undefined
  ? "java"
  : join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
const gradleWrapper = resolve(mobileRoot, "gradle", "wrapper", "gradle-wrapper.jar");

run(process.execPath, [tsc, "--noEmit", "-p", "tsconfig.type-tests.json"]);
run(process.execPath, [vitest, "run", "--coverage"]);
run(process.execPath, [vitest, "run", "--config", "vitest.performance.config.ts"]);
run(process.execPath, [stryker, "run", "stryker/stryker.cross-runtime-verification.config.json"]);
run(java, ["-classpath", gradleWrapper, "org.gradle.wrapper.GradleWrapperMain", "check", ":app:assembleDebug", "--console=plain", "--quiet"], { cwd: mobileRoot });
run(process.execPath, [vitest, "run",
  "tests/cross-runtime-e2e-contract.test.ts",
  "tests/cross-runtime-workflow-model.test.ts",
  "tests/cross-runtime-protocol-verification.test.ts",
  "tests/cross-runtime-source-inventory.test.ts",
  "tests/cross-runtime-mission-ordering.test.ts",
  "tests/cross-runtime-resource-recovery.test.ts",
  "src/modules/cross-runtime-e2e/verification-evidence.test.ts",
  "--reporter=default",
  "--reporter=./src/modules/cross-runtime-e2e/vitest-reporter.ts",
], { env: finalEnvironment });
