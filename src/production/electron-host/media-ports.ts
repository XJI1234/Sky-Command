import { createServer, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import type { HlsServerPort } from "../../modules/media-pipeline/hls-server/index.js";
import type { RtmpIngressPort } from "../../modules/media-pipeline/rtmp-ingest/index.js";

const require = createRequire(import.meta.url);
type PublishListener = (id: string, streamPath: string) => void;
type NodeEvent = { on: (name: string, listener: PublishListener) => void; removeListener: (name: string, listener: PublishListener) => void };
type RtmpServer = { run: () => void; stop: () => void };
type RtmpPullClient = {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  startPull: () => void;
  stop: () => void;
};
const NodeRtmpServer = require("node-media-server/src/node_rtmp_server.js") as new (config: { rtmp: { port: number; chunk_size: number; gop_cache: boolean; ping: number; ping_timeout: number } }) => RtmpServer;
const NodeRtmpClient = require("node-media-server/src/node_rtmp_client.js") as new (url: string) => RtmpPullClient;
const mediaContext = require("node-media-server/src/node_core_ctx.js") as { nodeEvent: NodeEvent };

export interface MediaPortLogEvent {
  readonly kind: string;
  readonly deviceId?: string;
  readonly detail: string;
}

export interface MediaPorts {
  readonly rtmp: RtmpIngressPort;
  readonly hls: HlsServerPort;
}

function publishPath(streamPath: string): string {
  return streamPath.startsWith("/") ? streamPath : `/${streamPath}`;
}

function deviceIdFromPublishPath(streamPath: string): string | null {
  const match = /^\/live\/([^/]+)$/.exec(publishPath(streamPath));
  if (match === null) return null;
  try {
    const decoded = decodeURIComponent(match[1] ?? "");
    return encodeURIComponent(decoded) === match[1] ? decoded : null;
  } catch {
    return null;
  }
}

function keepAvcVideoTag(payload: Buffer): boolean {
  if (payload.length < 5) return false;
  if ((payload[0] & 0x0f) !== 7) return true;
  const packetType = payload[1];
  if (packetType === 0) return true;
  if (packetType !== 1) return false;
  let offset = 5;
  while (offset + 4 <= payload.length) {
    const nalSize = payload.readUInt32BE(offset);
    offset += 4;
    if (nalSize <= 0 || offset + nalSize > payload.length) break;
    const nalType = payload[offset]! & 0x1f;
    if (nalType === 1 || nalType === 5) return true;
    offset += nalSize;
  }
  return false;
}

function writeFlvHeader(res: ServerResponse): boolean {
  const header = Buffer.alloc(13);
  header.write("FLV");
  header[3] = 1;
  header[4] = 1;
  header.writeUInt32BE(9, 5);
  header.writeUInt32BE(0, 9);
  return res.write(header);
}

function writeFlvTag(res: ServerResponse, type: number, timestamp: number, payload: Buffer): boolean {
  const size = payload.length;
  const header = Buffer.alloc(11);
  header[0] = type;
  header.writeUIntBE(size, 1, 3);
  header.writeUIntBE(timestamp & 0xffffff, 4, 3);
  header[7] = (timestamp / 0x1000000) & 0xff;
  header.writeUIntBE(0, 8, 3);
  const previous = Buffer.alloc(4);
  previous.writeUInt32BE(11 + size, 0);
  return res.write(Buffer.concat([header, payload, previous]));
}

function deviceIdFromFlvPath(pathname: string): string | null {
  const match = /^\/live\/([^/]+)\.flv$/i.exec(pathname);
  if (match === null) return null;
  try {
    const decoded = decodeURIComponent(match[1] ?? "");
    return encodeURIComponent(decoded) === match[1] ? decoded : null;
  } catch {
    return null;
  }
}

function createRtmpPort(shared: { rtmpPort: number }, log?: (event: MediaPortLogEvent) => void): RtmpIngressPort {
  let server: RtmpServer | null = null;
  let published: PublishListener | null = null;
  let unpublished: PublishListener | null = null;
  return {
    listen: (port, events) => {
      if (server !== null) throw new Error("rtmp already listening");
      shared.rtmpPort = port;
      published = (_id, streamPath) => {
        const path = publishPath(String(streamPath));
        const deviceId = deviceIdFromPublishPath(path) ?? undefined;
        log?.({ kind: "rtmp-published", ...(deviceId === undefined ? {} : { deviceId }), detail: "RTMP publish started" });
        events.onPublished(path);
      };
      unpublished = (_id, streamPath) => {
        const path = publishPath(String(streamPath));
        const deviceId = deviceIdFromPublishPath(path) ?? undefined;
        log?.({ kind: "rtmp-unpublished", ...(deviceId === undefined ? {} : { deviceId }), detail: "RTMP publish ended" });
        events.onUnpublished(path);
      };
      mediaContext.nodeEvent.on("postPublish", published);
      mediaContext.nodeEvent.on("donePublish", unpublished);
      server = new NodeRtmpServer({ rtmp: { port, chunk_size: 60_000, gop_cache: true, ping: 30, ping_timeout: 60 } });
      server.run();
    },
    close: () => {
      if (published !== null) mediaContext.nodeEvent.removeListener("postPublish", published);
      if (unpublished !== null) mediaContext.nodeEvent.removeListener("donePublish", unpublished);
      published = null;
      unpublished = null;
      server?.stop();
      server = null;
    },
  };
}

function createFlvHttpPort(shared: { rtmpPort: number }, log?: (event: MediaPortLogEvent) => void): HlsServerPort {
  let server: Server | null = null;
  const clients = new Set<RtmpPullClient>();
  return {
    listen: (input) => {
      if (server !== null) throw new Error("http-flv already listening");
      mkdirSync(input.rootDirectory, { recursive: true });
      server = createServer((req, res) => {
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Range",
          });
          res.end();
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, { "Access-Control-Allow-Origin": "*" });
          res.end();
          return;
        }
        let pathname = "/";
        try { pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname; } catch { /* keep / */ }
        const deviceId = deviceIdFromFlvPath(pathname);
        if (deviceId === null) {
          res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "video/x-flv",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store",
          Connection: "close",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        writeFlvHeader(res);
        const pull = new NodeRtmpClient(`rtmp://127.0.0.1:${shared.rtmpPort}/live/${encodeURIComponent(deviceId)}`);
        clients.add(pull);
        let waitingDrain = false;
        const onDrain = (): void => { waitingDrain = false; };
        res.on("drain", onDrain);
        const onVideo = (payload: unknown, timestamp: unknown): void => {
          if (waitingDrain || !Buffer.isBuffer(payload) || typeof timestamp !== "number" || !keepAvcVideoTag(payload) || res.writableEnded) return;
          try {
            const ok = writeFlvTag(res, 9, timestamp >>> 0, payload);
            if (!ok) waitingDrain = true;
          } catch { /* client gone */ }
        };
        const onClose = (): void => {
          clients.delete(pull);
          res.off("drain", onDrain);
          if (!res.writableEnded) try { res.end(); } catch { /* ignore */ }
        };
        pull.on("video", onVideo);
        pull.on("close", onClose);
        req.on("close", () => {
          clients.delete(pull);
          res.off("drain", onDrain);
          try { pull.stop(); } catch { /* ignore */ }
        });
        try { pull.startPull(); } catch {
          clients.delete(pull);
          res.off("drain", onDrain);
          if (!res.writableEnded) res.end();
        }
      });
      server.listen(input.port, input.host);
      log?.({ kind: "http-flv-listening", detail: `filtered HTTP-FLV listening on ${input.port}` });
    },
    close: () => {
      for (const client of clients) {
        try { client.stop(); } catch { /* ignore */ }
      }
      clients.clear();
      server?.close();
      server = null;
    },
  };
}

export function createMediaPorts(log?: (event: MediaPortLogEvent) => void): MediaPorts {
  const shared = { rtmpPort: 19_500 };
  return {
    rtmp: createRtmpPort(shared, log),
    hls: createFlvHttpPort(shared, log),
  };
}
