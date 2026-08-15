import { describe, expect, it } from "vitest";
import { DesktopSettings } from "../src/modules/desktop-settings/index.js";

describe("desktop-settings root public seam", () => {
  it("exposes the settings instance without requiring callers to know its internal modules", () => {
    const storage = {
      read: async () => null,
      writeAtomically: async () => undefined
    };

    const instance = DesktopSettings.create(storage);

    expect(instance.snapshot()).toMatchObject({
      version: 1,
      network: { listenPort: 19500, relayPort: 8080, manualHost: null },
      map: { basemap: "tianditu-vector", credential: null }
    });
  });
});
