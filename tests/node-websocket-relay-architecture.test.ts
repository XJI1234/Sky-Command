import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("node websocket relay architecture contract", () => {
  it("keeps protocol and product concerns outside the transport adapter", async () => {
    const source = await readFile(new URL("../src/adapters/node-websocket-relay/index.ts", import.meta.url), "utf8");
    expect(source).toContain("RelayTransport");
    expect(source).not.toMatch(/android|dji|electron|route-library|desktop-settings|protocol-core|JSON\.parse|readFile|writeFile|BrowserWindow/iu);
  });
});
