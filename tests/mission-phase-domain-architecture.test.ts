import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mission phase domain architecture contract", () => {
  it("is a pure state machine with no product or platform dependencies", async () => {
    const source = await readFile(new URL("../src/modules/mission-control/mission-phase-domain/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:relay-link|route-library|desktop-settings|electron|websocket|android|dji|vue|react|node:)[^"']*["']/iu);
    expect(source).not.toMatch(/(?:readFile|writeFile|fetch|setTimeout|setInterval|JSON\.parse|console\.)/u);
  });
});
