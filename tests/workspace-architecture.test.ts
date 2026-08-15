import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("D3.7 route workspace architecture contract", () => {
  it("depends only on injected first-level ports and has no UI, map-engine, or child-module imports", async () => {
    const source = await readFile(new URL("../src/modules/route-library/route-workspace/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:vue|electron|cesium|tian|dji|node:fs|node:path|catalog|importer|qualification|preview|domain)[^"']*["']/iu);
    expect(source).not.toMatch(/unsafeCreate|fromUnchecked|as unknown as/iu);
  });
});
