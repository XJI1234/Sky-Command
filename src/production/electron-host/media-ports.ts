import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import type { HttpFlvServerPort } from "../../modules/media-pipeline/http-flv-server/index.js";
import type { RtmpIngressPort } from "../../modules/media-pipeline/rtmp-ingest/index.js";

const require = createRequire(import.meta.url);
type PublishListener = (id: string, streamPath: string) => void;
type NodeEvent = { on: (name: string, listener: PublishListener) => void; removeListener: (name: string, listener: PublishListener) => void };
type RtmpServer = { run: () => void; stop: () => void };
type FlvSession = { readonly run: () => void; readonly stop: () => void };
type FlvSessionCtor = new (config: object, req: IncomingMessage, res: ServerResponse) => FlvSession;
const NodeRtmpServer = require("node-media-server/src/node_rtmp_server.js") as new (config: { rtmp: { port: number; chunk_size: number; gop_cache: boolean; ping: number; ping_timeout: number } }) => RtmpServer;
const NodeFlvSession = require("node-media-server/src/node_flv_session.js") as FlvSessionCtor;
const mediaContext = require("node-media-server/src/node_core_ctx.js") as { nodeEvent: NodeEvent };

export interface MediaPortLogEvent {
  readonly kind: string;
  readonly deviceId?: string;
  readonly detail: string;
}

export interface MediaPorts {
  readonly rtmp: RtmpIngressPort;
  readonly httpFlv: HttpFlvServerPort;
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

/** 只过滤 SEI-only 等无图像 AVC 包；绝不因背压丢 P 帧（本机回环丢帧会直接造成卡顿花屏）。 */
function filterSeiOnlyWrites(res: ServerResponse): void {
  const write = res.write.bind(res);
  res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    if (Buffer.isBuffer(chunk) && chunk.length >= 11 && chunk[0] === 9) {
      const size = chunk.readUIntBE(1, 3);
      if (Number.isFinite(size) && size >= 0 && 11 + size <= chunk.length) {
        const payload = chunk.subarray(11, 11 + size);
        if (!keepAvcVideoTag(payload)) {
          if (typeof encoding === "function") (encoding as () => void)();
          else if (typeof cb === "function") (cb as () => void)();
          return true;
        }
      }
    }
    return (write as (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean)(chunk, encoding, cb);
  }) as typeof res.write;
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

function createFlvHttpPort(log?: (event: MediaPortLogEvent) => void): HttpFlvServerPort {
  let server: Server | null = null;
  const sessions = new Map<string, FlvSession>();
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
        if (req.method === "HEAD") {
          res.writeHead(200, {
            "Content-Type": "video/x-flv",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store",
          });
          res.end();
          return;
        }
        // 直连 NMS 发布会话播放器槽位，禁止再 RTMP 回环拉流（回环+丢帧曾把有效码率打到几十 kbps）。
        const previous = sessions.get(deviceId);
        if (previous !== undefined) {
          try { previous.stop(); } catch { /* ignore */ }
          sessions.delete(deviceId);
        }
        res.writeHead(200, {
          "Content-Type": "video/x-flv",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store",
          Connection: "close",
        });
        try { req.socket.setNoDelay(true); } catch { /* ignore */ }
        filterSeiOnlyWrites(res);
        (req as IncomingMessage & { nmsConnectionType?: string }).nmsConnectionType = "http";
        const session = new NodeFlvSession({}, req, res);
        sessions.set(deviceId, session);
        const clear = (): void => {
          if (sessions.get(deviceId) === session) sessions.delete(deviceId);
        };
        req.on("close", clear);
        res.on("close", clear);
        try { session.run(); } catch {
          clear();
          if (!res.writableEnded) try { res.end(); } catch { /* ignore */ }
        }
      });
      server.listen(input.port, input.host);
      log?.({ kind: "http-flv-listening", detail: `filtered HTTP-FLV listening on ${input.port}` });
    },
    close: () => {
      for (const session of sessions.values()) {
        try { session.stop(); } catch { /* ignore */ }
      }
      sessions.clear();
      server?.close();
      server = null;
    },
  };
}

export function createMediaPorts(log?: (event: MediaPortLogEvent) => void): MediaPorts {
  const shared = { rtmpPort: 19_500 };
  return {
    rtmp: createRtmpPort(shared, log),
    httpFlv: createFlvHttpPort(log),
  };
}
