import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forgetRouteFile, importedRouteSha256, loadRouteFiles, rememberRouteFile, routeSha256 } from "../src/production/electron-host/route-files.js";

const sha = "a".repeat(64);
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const directory = (): string => {
  const created = mkdtempSync(join(tmpdir(), "sky-routes-"));
  directories.push(created);
  return created;
};

describe("saved route files", () => {
  it("writes an imported route and reads the original name back", () => {
    const root = directory();
    rememberRouteFile(root, "采集.kmz", new Uint8Array([1, 2, 3]), sha);
    expect(loadRouteFiles(root)).toEqual([{ fileName: "采集.kmz", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(readFileSync(join(root, `${sha}.name`), "utf8")).toBe("采集.kmz");
  });

  it("removes the saved copy when the route is deleted", () => {
    const root = directory();
    rememberRouteFile(root, "采集.kmz", new Uint8Array([9]), sha);
    forgetRouteFile(root, sha);
    expect(loadRouteFiles(root)).toEqual([]);
  });

  it("reads the hash from a successful import and from the current route list", () => {
    expect(importedRouteSha256({ ok: true, value: { status: "imported", route: { sha256: sha } } })).toBe(sha);
    expect(importedRouteSha256({ ok: true, value: { status: "rejected" } })).toBeNull();
    expect(routeSha256([{ routeId: "route-1", sha256: sha }], "route-1")).toBe(sha);
    expect(routeSha256([{ routeId: "route-1", sha256: sha }], "route-2")).toBeNull();
  });
});
