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
    expect(paths.photosRoot).not.toContain("app.asar");
  });

  it("stores original photos next to incident logs instead of Electron's hidden userData", () => {
    const userData = "C:\\Users\\operator\\AppData\\Roaming\\Electron";
    const localAppData = "C:\\Users\\operator\\AppData\\Local";
    const paths = runtimeDataPaths(userData, localAppData);

    expect(paths.photosRoot).toBe(join(localAppData, "Sky Command", "photos"));
    expect(paths.photosRoot).not.toContain("Roaming");
    expect(paths.photosRoot).not.toContain("Electron");
  });
});
