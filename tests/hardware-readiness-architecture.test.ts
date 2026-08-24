import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hardware readiness architecture contract", () => {
  it("keeps the preflight decision module pure and independent of runtime adapters", async () => {
    const source = await readFile(new URL("../src/modules/hardware-readiness/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:relay|electron|node:|websocket|android|dji|media|flight|stream|ui)[^"']*["']/iu);
    expect(source).not.toMatch(/(?:fetch|setTimeout|setInterval|JSON\.parse|console\.)/u);
  });
});
