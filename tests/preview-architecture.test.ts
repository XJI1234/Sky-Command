import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("D3.5 architecture contract", () => {
  it("has no map, UI, transport, or file dependencies", async () => {
    const source = await readFile(new URL("../src/modules/route-library/preview/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:vue|electron|cesium|tian|dji|android|node:fs|node:path|zip|xml|ws)[^"']*["']/iu);
    expect(source).not.toMatch(/unsafeCreate|fromUnchecked|as unknown as/iu);
  });
});
