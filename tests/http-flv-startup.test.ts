import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createMediaPorts } from "../src/production/electron-host/media-ports.js";

it("HTTP-FLV waits for decoder configuration and a retry joins the same publisher", async () => {
  const context = createRequire(import.meta.url)("node-media-server/src/node_core_ctx.js");
  const allocator = createServer();
  await new Promise<void>(resolve => allocator.listen(0, "127.0.0.1", resolve));
  const port = (allocator.address() as { port: number }).port;
  await new Promise<void>(resolve => allocator.close(() => resolve()));
  const rootDirectory = mkdtempSync(join(tmpdir(), "sky-flv-startup-"));
  const media = createMediaPorts();
  const path = "/live/startup-fixture";
  const publisher = { videoCodec: 0, players: new Set(), avcSequenceHeader: Buffer.alloc(0), flvGopCacheQueue: new Set() };
  const abort = new AbortController();
  context.publishers.set(path, "startup-fixture-publisher");
  context.sessions.set("startup-fixture-publisher", publisher);
  try {
    await media.httpFlv.listen({ host: "127.0.0.1", port, rootDirectory });
    const url = `http://127.0.0.1:${port}${path}.flv`;
    const early = await fetch(url);
    expect(early.status).toBe(503);
    expect(early.headers.get("retry-after")).toBe("1");
    expect(publisher.players.size).toBe(0);
    publisher.videoCodec = 7;
    expect((await fetch(url)).status).toBe(503);
    expect(publisher.players.size).toBe(0);
    publisher.avcSequenceHeader = Buffer.from([0x17, 0, 0, 0, 0, 1, 0x64, 0, 0x1f]);
    const ready = await fetch(url, { signal: abort.signal });
    expect(ready.status).toBe(200);
    const chunk = await ready.body!.getReader().read();
    expect(Buffer.from(chunk.value!).subarray(0, 3).toString()).toBe("FLV");
    expect(chunk.value![4] & 1).toBe(1);
    expect(publisher.players.size).toBe(1);
    // A completed GET request does not mean its streaming response has closed.
    await new Promise(resolve => setTimeout(resolve, 20));
    media.httpFlv.close();
    expect(publisher.players.size).toBe(0);
  } finally {
    abort.abort();
    media.httpFlv.close();
    context.publishers.delete(path);
    context.sessions.delete("startup-fixture-publisher");
    rmdirSync(rootDirectory);
  }
});
