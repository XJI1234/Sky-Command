import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../src/modules/relay-link/protocol-core/", import.meta.url);

describe("relay-link protocol-core architecture contract", () => {
  it("has one pure protocol seam with no platform or business dependency", async () => {
    const source = await readFile(new URL("index.ts", root), "utf8");

    expect(source).toContain("RelayFrameCodec");
    expect(source).toContain("function validate");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|vue|websocket|cesium|dji|route-library|mission-control|desktop-settings)[^"']*["']/iu);
    expect(source).not.toMatch(/unsafeCreate|fromUnchecked|as unknown as/iu);
  });
});
