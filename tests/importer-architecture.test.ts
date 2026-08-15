import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const importerRoot = new URL("../src/modules/route-library/importer/", import.meta.url);

describe("D3.2 architecture contract", () => {
  it("keeps one public seam and no forbidden platform imports", async () => {
    const publicSource = await readFile(new URL("index.ts", importerRoot), "utf8");
    const archiveSource = await readFile(new URL("internal/archive.ts", importerRoot), "utf8");
    const xmlSource = await readFile(new URL("internal/xml.ts", importerRoot), "utf8");
    const internalSource = await Promise.all([
      "internal/types.ts",
      "internal/outcome.ts",
      "internal/cancellation.ts",
      "internal/intake.ts",
      "internal/digest.ts",
      "internal/xml.ts",
      "internal/archive.ts",
      "internal/error-map.ts",
      "internal/encoding.ts"
    ].map((file) => readFile(new URL(file, importerRoot), "utf8")));

    expect(publicSource).toContain("RouteImporter");
    expect(publicSource).not.toMatch(/export .*internal\//u);
    expect(publicSource.match(/\bingest\b/gu)?.length).toBeGreaterThanOrEqual(1);
    expect(internalSource.join("\n")).not.toMatch(/from ["'][^"']*(?:vue|electron|cesium|android|dji|DOMParser)[^"']*["']/iu);
    expect(publicSource).not.toMatch(/from ["'][^"']*(?:zip\.js|saxes|noble)[^"']*["']/iu);
    expect(archiveSource).toContain("getEntriesGenerator(");
    expect(archiveSource).not.toMatch(/\.getEntries\(/u);
    expect(xmlSource).toContain("stream: true");
    expect(xmlSource).not.toMatch(/\.push\(\.\.\./u);
  });
});
