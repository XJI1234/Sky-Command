import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeDataPaths } from "../src/production/electron-host/runtime-paths.js";

describe("Electron runtime writable paths", () => {
  it("keeps HTTP-FLV scratch data and launch logs outside packaged app resources", () => {
    const userData = "C:\\Users\\operator\\AppData\\Roaming\\Sky Command";
    const paths = runtimeDataPaths(userData);

    expect(paths.httpFlvRoot).toBe(join(userData, "tmp-http-flv"));
    expect(paths.logPath).toBe(join(userData, "tmp", "desktop-launch.log"));
    expect(paths.httpFlvRoot).not.toContain("app.asar");
    expect(paths.logPath).not.toContain("app.asar");
  });
});
