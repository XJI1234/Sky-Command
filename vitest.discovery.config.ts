import { defineConfig } from "vitest/config";

// Discovery and host regressions run without the unrelated Android harness build.
export default defineConfig({
  test: {
    include: [
      "tests/relay-discovery.test.ts",
      "tests/electron-host-shutdown.test.ts",
      "tests/electron-launch-webrtc-contract.test.ts",
      "tests/electron-runtime-paths.test.ts",
    ],
  },
});
