import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import type { Server as NetServer } from "node:net";
import type { HttpFlvServerPort } from "../../modules/media-pipeline/http-flv-server/index.js";
import type { RtmpIngressPort } from "../../modules/media-pipeline/rtmp-ingest/index.js";

const require = createRequire(import.meta.url);
type PublishListener = (id: string, streamPath: string) => void;
type NodeEvent = { on: (name: string, listener: PublishListener) => void; removeListener: (name: string, listener: PublishListener) => void };
type RtmpServer = { readonly tcpServer: NetServer; readonly run: () => void; readonly stop: () => void };
type FlvSession = { readonly run: () => void; readonly stop: () => void };
type FlvSessionCtor = new (config: object, req: IncomingMessage, res: ServerResponse) => FlvSession;
const NodeRtmpServer = require("node-media-server/src/node_rtmp_server.js") as new (config: { rtmp: { port: number; chunk_size: number; gop_cache: boolean; ping: number; ping_timeout: number } }) => RtmpServer;
const NodeFlvSession = require("node-media-server/src/node_flv_session.js") as FlvSessionCtor;
const mediaContext = require("node-media-server/src/node_core_ctx.js") as {
  readonly nodeEvent: NodeEvent;
  readonly publishers: ReadonlyMap<string, string>;
};
// Bounds one local browser's queued video without changing the RTMP publisher's frame flow.
const MAX_FLV_PENDING_BYTES = 2 * 1024 * 1024;

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

/** NMS HTTP-FLV 头与 flv.js 约定 bit0=视频；无音轨推流时 NMS 常写出 flags=0，播放器会当成空轨。 */
function markFlvHeaderHasVideo(chunk: Buffer): void {
  if (chunk.length < 9 || chunk[0] !== 0x46 || chunk[1] !== 0x4c || chunk[2] !== 0x56) return;
  chunk[4] |= 0x01;
}

function isAvcSyncTag(payload: Buffer): boolean {
  if (payload.length < 2) return false;
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
    if (nalType === 5) return true;
    offset += nalSize;
  }
  return false;
}

function finishWrite(encoding?: unknown, cb?: unknown): true {
  if (typeof encoding === "function") (encoding as () => void)();
  else if (typeof cb === "function") (cb as () => void)();
  return true;
}

/** 只过滤 SEI-only 等无图像 AVC 包；播放器积压时丢掉直到下一关键帧，不断开会话。 */
function filterSeiOnlyWrites(res: ServerResponse, onBackpressureSkip: () => void): void {
  const write = res.write.bind(res);
  let skipUntilKeyframe = false;
  let reported = false;
  res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    if (Buffer.isBuffer(chunk)) markFlvHeaderHasVideo(chunk);
    if (Buffer.isBuffer(chunk) && chunk.length >= 11 && chunk[0] === 9) {
      const size = chunk.readUIntBE(1, 3);
      if (Number.isFinite(size) && size >= 0 && 11 + size <= chunk.length) {
        const payload = chunk.subarray(11, 11 + size);
        if (!keepAvcVideoTag(payload)) return finishWrite(encoding, cb);
        if (skipUntilKeyframe && !isAvcSyncTag(payload)) return finishWrite(encoding, cb);
        if (skipUntilKeyframe && isAvcSyncTag(payload)) skipUntilKeyframe = false;
      }
    }
    const accepted = (write as (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean)(chunk, encoding, cb);
    if (res.writableLength >= MAX_FLV_PENDING_BYTES) {
      skipUntilKeyframe = true;
      if (!reported) {
        reported = true;
        try { onBackpressureSkip(); } catch { /* diagnostics must not make a video write fail */ }
      }
    } else if (res.writableLength < MAX_FLV_PENDING_BYTES / 2) {
      reported = false;
    }
    return accepted;
  }) as typeof res.write;
}

function createRtmpPort(shared: { rtmpPort: number }, log?: (event: MediaPortLogEvent) => void): RtmpIngressPort {
  let server: RtmpServer | null = null;
  let published: PublishListener | null = null;
  let unpublished: PublishListener | null = null;
  return {
    listen: async (port, events) => {
      if (server !== null) throw new Error("rtmp already listening");
      shared.rtmpPort = port;
      const candidate = new NodeRtmpServer({ rtmp: { port, chunk_size: 60_000, gop_cache: true, ping: 30, ping_timeout: 60 } });
      server = candidate;
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = (): void => {
            candidate.tcpServer.removeListener("listening", onListening);
            candidate.tcpServer.removeListener("error", onError);
          };
          const onListening = (): void => { cleanup(); resolve(); };
          const onError = (error: Error): void => { cleanup(); reject(error); };
          candidate.tcpServer.once("listening", onListening);
          candidate.tcpServer.once("error", onError);
          try { candidate.run(); } catch (error) { cleanup(); reject(error); }
        });
      } catch (error) {
        if (server === candidate) server = null;
        try { candidate.stop(); } catch { /* bind failure cleanup is best effort */ }
        throw error;
      }
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
    listen: async (input) => {
      if (server !== null) throw new Error("http-flv already listening");
      mkdirSync(input.rootDirectory, { recursive: true });
      const candidate = createServer((req, res) => {
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
        const streamPath = `/live/${encodeURIComponent(deviceId)}`;
        // HTTP-FLV source is unavailable; do not create an NMS idle player.
        if (!mediaContext.publishers.has(streamPath)) {
          res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
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
        (req as IncomingMessage & { nmsConnectionType?: string }).nmsConnectionType = "http";
        const session = new NodeFlvSession({}, req, res);
        sessions.set(deviceId, session);
        filterSeiOnlyWrites(res, () => {
          try { log?.({ kind: "http-flv-client-backpressure", deviceId, detail: "HTTP-FLV player queue reached the limit; skipped until the next keyframe" }); } catch { /* diagnostics must not affect media */ }
        });
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
      server = candidate;
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = (): void => {
            candidate.removeListener("listening", onListening);
            candidate.removeListener("error", onError);
          };
          const onListening = (): void => { cleanup(); resolve(); };
          const onError = (error: Error): void => { cleanup(); reject(error); };
          candidate.once("listening", onListening);
          candidate.once("error", onError);
          try { candidate.listen(input.port, input.host); } catch (error) { cleanup(); reject(error); }
        });
      } catch (error) {
        if (server === candidate) server = null;
        try { candidate.close(); } catch { /* bind failure cleanup is best effort */ }
        throw error;
      }
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
