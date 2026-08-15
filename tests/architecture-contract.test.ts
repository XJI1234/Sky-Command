import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOMAIN = join(process.cwd(), "src/modules/route-library/domain");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("domain architecture", () => {
  it("has one public entry and no forbidden production dependencies or bypasses", () => {
    const files = sourceFiles(DOMAIN);
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(files.filter((file) => !file.includes(`${join("domain", "internal")}`))).toEqual([join(DOMAIN, "index.ts")]);
    expect(source).not.toMatch(/from\s+["'](?:vue|electron|cesium|node:|jszip)/i);
    expect(source).not.toMatch(/Date\.now|randomUUID|unsafeCreate|fromUnchecked|as unknown as/);
    expect(readFileSync(join(DOMAIN, "index.ts"), "utf8")).not.toMatch(/export\s+.*(?:brand|token)(?:\W|$)/i);

    const productionSource = sourceFiles(join(process.cwd(), "src"))
      .filter((file) => !file.includes(join("domain", "internal")))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(productionSource).not.toMatch(/domain\/internal|domain\\internal/);
  });
});
