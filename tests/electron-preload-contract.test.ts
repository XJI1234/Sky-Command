import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopShell } from "../src/production/desktop-shell/index.js";

describe("Electron preload", () => {
  it("只暴露与桌面外壳相同的网关短名", () => {
    const source = readFileSync(join(process.cwd(), "src/production/electron-host/preload.cjs"), "utf8");
    const start = source.indexOf("Object.freeze([");
    const block = source.slice(start, source.indexOf("]);", start) + 2);
    const listed = [...block.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((match) => match[1]);
    expect([...new Set(listed)].sort()).toEqual(Object.keys(DesktopShell.methods).sort());
  });
});
