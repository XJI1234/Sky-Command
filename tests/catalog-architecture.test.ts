import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../src/modules/route-library/catalog/", import.meta.url);

describe("D3.4 architecture contract", () => {
  it("keeps the catalog seam isolated from UI, transport, storage, and sibling internals", async () => {
    const source = await readFile(new URL("index.ts", root), "utf8");
    expect(source).toContain("RouteCatalog");
    expect(source).not.toMatch(/from ["'][^"']*(?:qualification|importer|preview|catalog\/internal)[^"']*["']/iu);
    expect(source).not.toMatch(/from ["'][^"']*(?:vue|electron|cesium|android|dji|zip\.js|saxes|node:fs|node:path|node:crypto|ws)[^"']*["']/iu);
    expect(source).not.toMatch(/unsafeCreate|fromUnchecked|as unknown as/iu);
  });
});
