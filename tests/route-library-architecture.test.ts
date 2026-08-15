import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("D3 route-library first-level architecture", () => {
  it("is the only composition layer allowed to import route child public seams", async () => {
    const source = await readFile(new URL("../src/modules/route-library/index.ts", import.meta.url), "utf8");
    expect(source).toMatch(/from ["']\.\/catalog\/index\.js["']/u);
    expect(source).toMatch(/from ["']\.\/importer\/index\.js["']/u);
    expect(source).not.toMatch(/\/internal\//u);
    expect(source).not.toMatch(/from ["'][^"']*(?:vue|electron|cesium|tian|dji|node:fs|node:path)[^"']*["']/iu);
  });
});
