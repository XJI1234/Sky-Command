import { describe, expect, it } from "vitest";
import { MapSettings } from "../src/modules/desktop-settings/map-settings/index.js";

describe("desktop-settings map-settings defensive coverage", () => {
  it.each([
    ["tab", "key\tvalue"],
    ["newline", "key\nvalue"],
    ["control", "key\u0000value"],
    ["non-breaking space", "key\u00a0value"]
  ])("rejects %s inside a credential", (_, credential) => {
    expect(MapSettings.create({ basemap: "tianditu-vector", credential })).toMatchObject({
      ok: false,
      error: { details: { field: "credential", reason: "credential-unsafe-text" } }
    });
  });

  it("accepts a 256-code-point credential containing astral characters", () => {
    const credential = "𠮷".repeat(256);
    expect(MapSettings.create({ basemap: "tianditu-vector", credential })).toMatchObject({ ok: true });
  });

  it("rejects a credential with 257 Unicode code points", () => {
    const credential = "𠮷".repeat(257);
    expect(MapSettings.create({ basemap: "tianditu-vector", credential })).toMatchObject({
      ok: false,
      error: { details: { field: "credential", reason: "credential-too-long" } }
    });
  });

  it("returns a frozen error tree", () => {
    const result = MapSettings.create({ basemap: "invalid", credential: null });
    if (result.ok) throw new Error("expected rejection");
    expect(Object.isFrozen(result.error)).toBe(true);
    expect(Object.isFrozen(result.error.details)).toBe(true);
  });

  it("rejects a primitive patch container", () => {
    const current = MapSettings.create({ basemap: "tianditu-vector", credential: null });
    if (!current.ok) throw current.error;
    expect(MapSettings.patch(current.value, 4)).toMatchObject({
      ok: false,
      error: { details: { field: "input", reason: "invalid-container" } }
    });
  });
});
