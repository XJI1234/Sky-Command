import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mission dispatcher architecture contract", () => {
  it("keeps orchestration independent from platform, transport, and UI implementations", async () => {
    const source = await readFile(new URL("../src/modules/mission-control/mission-dispatcher/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'](?:electron|ws|node:net|node:fs|@dji|dji)/u);
    expect(source).not.toMatch(/from ["'][^"']*(?:protocol-core|relay-server|mission-sender|android|dji|vue|react)[^"']*["']/iu);
    expect(source).toContain("MissionPhaseDomain");
    expect(source).toContain("PreflightCheck");
  });
});
