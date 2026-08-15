import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("preflight check architecture contract", () => {
  it("keeps platform, transport, and mission effects outside the pure decision module", async () => {
    const source = await readFile(new URL("../src/modules/mission-control/preflight-check/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:relay-link|route-library|desktop-settings|electron|websocket|android|dji|vue|react|node:)[^"']*["']/iu);
    expect(source).not.toMatch(/(?:fetch|setTimeout|setInterval|JSON\.parse|console\.)/u);
  });
});
