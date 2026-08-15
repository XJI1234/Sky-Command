import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("relay-server architecture contract", () => {
  it("keeps transport and protocol details behind injected seams", async () => {
    const source = await readFile(new URL("../src/modules/relay-link/relay-server/index.ts", import.meta.url), "utf8");
    expect(source).toContain("RelayTransport");
    expect(source).toContain("RelayFrameCodec");
    expect(source).not.toMatch(/from ["'][^"']*(?:electron|websocket|ws|node:net|node:http|dji|android|route-library|desktop-settings)[^"']*["']/iu);
    expect(source).not.toMatch(/WebSocket|BrowserWindow|fs\.|readFile|writeFile/iu);
  });
});
