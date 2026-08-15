import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../src/modules/route-library/qualification/", import.meta.url);

describe("D3.3 architecture contract", () => {
  it("keeps one public seam and only depends on public D3.1/D3.2 interfaces", async () => {
    const publicSource = await readFile(new URL("index.ts", root), "utf8");
    const internalSources = await Promise.all([
      "internal/types.ts",
      "internal/input.ts",
      "internal/number.ts",
      "internal/candidates.ts",
      "internal/classify.ts"
    ].map((file) => readFile(new URL(file, root), "utf8")));
    const allSource = `${publicSource}\n${internalSources.join("\n")}`;

    expect(publicSource).toContain("RouteQualification");
    expect(publicSource.match(/\bqualify\b/gu)?.length).toBeGreaterThanOrEqual(1);
    expect(publicSource).not.toMatch(/export\s+(?!type\b).*internal\//u);
    expect(allSource).not.toMatch(/from ["'][^"']*(?:vue|electron|cesium|android|dji|zip\.js|saxes|noble|node:fs|node:path|node:crypto)[^"']*["']/iu);
    expect(allSource).not.toMatch(/unsafeCreate|fromUnchecked|as unknown as/iu);
  });
});
