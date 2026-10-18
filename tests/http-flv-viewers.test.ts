import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createMediaPorts } from "../src/production/electron-host/media-ports.js";

it("keeps two viewers of the same aircraft independent, including disconnect and service shutdown", async () => {
  const context = createRequire(import.meta.url)("node-media-server/src/node_core_ctx.js");
  const upstreamLogs: string[] = [];
  const captureLog = (...parts: unknown[]): void => { upstreamLogs.push(parts.join(" ")); };
  context.nodeEvent.on("logMessage", captureLog);
  const allocator = createServer();
  await new Promise<void>(resolve => allocator.listen(0, "127.0.0.1", resolve));
  const port = (allocator.address() as { port: number }).port;
  await new Promise<void>(resolve => allocator.close(() => resolve()));
  const rootDirectory = mkdtempSync(join(tmpdir(), "sky-flv-viewers-"));
  const events: { kind: string; detail: string }[] = [];
  const media = createMediaPorts(event => events.push(event));
  const path = "/live/viewer-fixture";
  const publisher = { videoCodec: 7, players: new Set<string>(), avcSequenceHeader: Buffer.from([0x17, 0, 0, 0, 0, 1, 0x64, 0, 0x1f]), flvGopCacheQueue: new Set() };
  const firstAbort = new AbortController(), secondAbort = new AbortController();
  context.publishers.set(path, "viewer-publisher");
  context.sessions.set("viewer-publisher", publisher);
  try {
    await media.httpFlv.listen({ host: "127.0.0.1", port, rootDirectory });
    const url = `http://127.0.0.1:${port}${path}.flv`;
    const first = await fetch(`${url}?viewer=page-fixture&token=private-unknown-value`, { signal: firstAbort.signal });
    const firstReader = first.body!.getReader();
    await firstReader.read();
    const second = await fetch(`${url}?viewer=http%3A%2F%2Fprivate.invalid%2Ftoken`, { signal: secondAbort.signal });
    await second.body!.getReader().read();
    expect(publisher.players.size).toBe(2);
    secondAbort.abort();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(publisher.players.size).toBe(1);
    // Drive NMS's real remaining response, rather than checking only a session map.
    const session = context.sessions.get([...publisher.players][0]);
    session.res.write(Buffer.from([9, 0, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0x27, 1, 0, 0, 0, 0, 0, 0, 2, 0x41, 1]));
    const next = await firstReader.read();
    expect(next.done).toBe(false);
    expect(next.value!.byteLength).toBeGreaterThan(0);
    media.httpFlv.close();
    expect(publisher.players.size).toBe(0);
    expect(context.publishers.get(path)).toBe("viewer-publisher");
    expect(events.filter(event => event.kind === "http-flv-viewer-open")).toHaveLength(2);
    expect(events.filter(event => event.kind === "http-flv-viewer-close")).toHaveLength(2);
    expect(events.filter(event => event.kind === "http-flv-viewer-open").map(event => event.detail)).toEqual([
      expect.stringContaining("page=page-fixture"), expect.stringContaining("page=unmarked"),
    ]);
    expect(JSON.stringify(events)).not.toMatch(/private|token/);
    expect(upstreamLogs.some(line => line.includes("page-fixture"))).toBe(true);
    expect(upstreamLogs.join("\n")).not.toMatch(/private|token/);
  } finally {
    firstAbort.abort(); secondAbort.abort();
    media.httpFlv.close();
    context.nodeEvent.removeListener("logMessage", captureLog);
    context.publishers.delete(path); context.sessions.delete("viewer-publisher");
    rmdirSync(rootDirectory);
  }
});
