import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

describe("cross-runtime verification portability", () => {
  it("does not bind tests to an absolute Windows project path", () => {
    const sources = [
      "tests/cross-runtime-e2e-contract.test.ts",
      "tests/cross-runtime-resource-recovery.test.ts",
      "tests/cross-runtime-source-inventory.test.ts",
    ].map(read);

    for (const source of sources) {
      expect(source).not.toMatch(/[A-Z]:\\\\(?:[^\r\n"']+\\\\)*MSDK-relay/iu);
    }
  });

  it("does not launch verification commands through a shell", () => {
    expect(read("scripts/run-cross-runtime-e2e.mjs")).not.toMatch(/\bshell\s*:/u);
  });

  it("keeps route planning and WPMZ generation outside production composition", () => {
    const desktopProduction = [
      "src/production/desktop-application/index.ts",
      "src/production/desktop-runtime/index.ts",
      "src/production/operation-workflow/index.ts",
    ].map(read).join("\n");
    expect(desktopProduction).not.toMatch(/route-planning/u);

    const mobileRoot = resolve(process.env.MSDK_RELAY_PROJECT_ROOT ?? resolve(process.cwd(), "..", "MSDK-relay"));
    const mobileProduction = [
      "settings.gradle.kts",
      "src/modules/wayline-mission/build.gradle.kts",
      "src/modules/wayline-mission/wayline-command-handler/build.gradle.kts",
      "src/modules/relay-gateway/command-dispatcher/src/main/kotlin/com/skycommand/relay/gateway/command/CommandDispatcher.kt",
      "src/modules/wayline-mission/wayline-command-handler/src/main/kotlin/com/skycommand/relay/wayline/command/WaylineCommandHandler.kt",
      "src/app/src/main/kotlin/com/skycommand/relay/app/MobileRelayGraph.kt",
    ].map((path) => readFileSync(resolve(mobileRoot, path), "utf8")).join("\n");
    expect(mobileProduction).not.toMatch(/wpmz-generator|wayline\.generate/u);
  });

  it("does not advertise removed WPMZ generation as a mobile capability", () => {
    const desktopContracts = [
      "CONTRACT.md",
      "src/modules/cross-runtime-e2e/CONTRACT.md",
    ].map(read).join("\n");
    expect(desktopContracts).not.toMatch(/wayline\.generate[^\r\n]*(?:兼容能力|保留)|wpmz-generator[^\r\n]*兼容能力/u);

    const mobileRoot = resolve(process.env.MSDK_RELAY_PROJECT_ROOT ?? resolve(process.cwd(), "..", "MSDK-relay"));
    const mobileContracts = [
      "CONTRACT.md",
      "src/modules/wayline-mission/CONTRACT.md",
      "src/modules/wayline-mission/wayline-command-handler/CONTRACT.md",
      "src/modules/relay-gateway/CONTRACT.md",
      "src/modules/relay-gateway/command-dispatcher/CONTRACT.md",
    ].map((path) => readFileSync(resolve(mobileRoot, path), "utf8")).join("\n");
    expect(mobileContracts).not.toMatch(/作为兼容能力保留|根据航点生成航线|支持[^\r\n]*wayline\.generate|^wayline\.generate$/mu);
  });
});
