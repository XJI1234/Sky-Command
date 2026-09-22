import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
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
type NmsPublisher = {
  readonly videoCodec?: number;
  readonly videoCodecName?: string;
  readonly flvGopCacheQueue?: { readonly size: number };
};
type RtmpVideoHost = { parserPacket?: { payload?: Buffer; header?: { length?: number } } };
const NodeRtmpSession = require("node-media-server/src/node_rtmp_session.js") as {
  prototype: { rtmpVideoHandler: (this: RtmpVideoHost) => void };
};
const mediaContext = require("node-media-server/src/node_core_ctx.js") as {
  readonly nodeEvent: NodeEvent;
  readonly publishers: ReadonlyMap<string, string>;
  readonly sessions: { get: (id: string) => NmsPublisher | undefined };
};
const originalRtmpVideoHandler = NodeRtmpSession.prototype.rtmpVideoHandler;
let rtmpVideoLog: ((detail: string) => void) | null = null;
let rtmpVideoLogged = 0;
NodeRtmpSession.prototype.rtmpVideoHandler = function patchedRtmpVideoHandler(this: RtmpVideoHost) {
  const raw = this.parserPacket?.payload;
  const length = this.parserPacket?.header?.length;
  if (rtmpVideoLogged < 3) {
    rtmpVideoLogged += 1;
    const hex = Buffer.isBuffer(raw) && typeof length === "number"
      ? raw.subarray(0, Math.min(8, Math.max(0, length))).toString("hex")
      : "none";
    const fourcc = Buffer.isBuffer(raw) && typeof length === "number" && length >= 5
      ? raw.subarray(1, 5).toString("ascii")
      : "";
    rtmpVideoLog?.(`videoPacket n=${rtmpVideoLogged} len=${length ?? "n"} hex=${hex} fourcc=${fourcc}`);
  }
  if (Buffer.isBuffer(raw) && typeof length === "number" && length >= 5 && ((raw[0]! >> 4) & 0b1000) !== 0) {
    const fourcc = raw.subarray(1, 5).toString("ascii");
    if (fourcc === "hev1" || fourcc === "HEV1" || fourcc === "HVC1") {
      raw[1] = 0x68;
      raw[2] = 0x76;
      raw[3] = 0x63;
      raw[4] = 0x31;
    }
  }
  return originalRtmpVideoHandler.call(this);
};
// Bounds one local browser's queued video without changing the RTMP publisher's frame flow.
const MAX_FLV_PENDING_BYTES = 16_777_216;

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
  return payload.length > 64;
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

let cachedFfmpeg: string | null | undefined;

function resolveFfmpegExecutable(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  try {
    const line = execFileSync("where", ["ffmpeg"], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.toLowerCase().endsWith(".exe"));
    cachedFfmpeg = line !== undefined && existsSync(line) ? line : null;
  } catch {
    cachedFfmpeg = null;
  }
  return cachedFfmpeg;
}

function startHevcTranscode(
  write: ServerResponse["write"],
  onLog?: (kind: string, detail: string) => void,
): ChildProcessWithoutNullStreams | null {
  const ffmpeg = resolveFfmpegExecutable();
  if (ffmpeg === null) {
    onLog?.("http-flv-hevc-transcode-error", "ffmpeg not found; HEVC would stay on Chromium MSE");
    return null;
  }
  const child = spawn(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-fflags",
    "nobuffer+discardcorrupt",
    "-flags",
    "low_delay",
    "-f",
    "flv",
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "30",
    "-bf",
    "0",
    "-f",
    "flv",
    "pipe:1",
  ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdout.on("data", (data: Buffer) => {
    markFlvHeaderHasVideo(data);
    write(data);
  });
  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString("utf8").trim();
    if (text.length > 0) onLog?.("http-flv-hevc-transcode-error", text.slice(0, 200));
  });
  child.on("error", (error) => {
    onLog?.("http-flv-hevc-transcode-error", error instanceof Error ? error.message : "ffmpeg spawn failed");
  });
  child.on("exit", (code) => {
    onLog?.("http-flv-hevc-transcode-error", `ffmpeg exited ${code ?? "null"}`);
  });
  onLog?.("http-flv-hevc-transcode-error", "started libx264 transcode for HEVC live FLV");
  return child;
}

function isHevcFlvPayload(payload: Buffer): boolean {
  if (payload.length < 1) return false;
  if (((payload[0]! >> 4) & 0b1000) !== 0) return true;
  return (payload[0]! & 0x0f) === 12;
}

/** AVC 直出并丢掉 SEI-only；仅 HEVC 才转 H.264。首个视频标签前先攒报文，避免空转 ffmpeg 把已有画面吃掉。 */
function filterSeiOnlyWrites(
  res: ServerResponse,
  onBackpressureSkip: () => void,
  onLog?: (kind: string, detail: string) => void,
): void {
  const write = res.write.bind(res);
  let skipUntilKeyframe = false;
  let deliveredSync = false;
  let reported = false;
  let loggedFirst = false;
  let route: "pending" | "avc" | "hevc" = "pending";
  let prelude: Buffer[] = [];
  let transcode: ChildProcessWithoutNullStreams | null = null;
  const stopTranscode = (): void => {
    if (transcode === null) return;
    try { transcode.stdin.end(); } catch { /* ignore */ }
    try { transcode.kill(); } catch { /* ignore */ }
    transcode = null;
  };
  res.on("close", stopTranscode);
  const writeAvc = (chunk: Buffer, encoding?: unknown, cb?: unknown): boolean => {
    if (chunk.length >= 11 && chunk[0] === 9) {
      const size = chunk.readUIntBE(1, 3);
      if (Number.isFinite(size) && size >= 0 && 11 + size <= chunk.length) {
        const payload = chunk.subarray(11, 11 + size);
        if (!keepAvcVideoTag(payload)) return finishWrite(encoding, cb);
        if (skipUntilKeyframe && !isAvcSyncTag(payload)) return finishWrite(encoding, cb);
        if (isAvcSyncTag(payload)) {
          skipUntilKeyframe = false;
          deliveredSync = true;
        }
      }
    }
    const accepted = (write as (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean)(chunk, encoding, cb);
    if (deliveredSync && res.writableLength >= MAX_FLV_PENDING_BYTES) {
      skipUntilKeyframe = true;
      if (!reported) {
        reported = true;
        try { onBackpressureSkip(); } catch { /* diagnostics must not make a video write fail */ }
      }
    } else if (res.writableLength < MAX_FLV_PENDING_BYTES / 2) {
      reported = false;
    }
    return accepted;
  };
  const startHevcRoute = (chunk: Buffer): boolean => {
    route = "hevc";
    transcode = startHevcTranscode(write, onLog);
    for (const prior of prelude) {
      if (transcode?.stdin.writable === true) transcode.stdin.write(prior);
    }
    prelude = [];
    if (transcode?.stdin.writable === true) transcode.stdin.write(chunk);
    return finishWrite();
  };
  const startAvcRoute = (chunk: Buffer, encoding?: unknown, cb?: unknown): boolean => {
    route = "avc";
    for (const prior of prelude) writeAvc(prior);
    prelude = [];
    return writeAvc(chunk, encoding, cb);
  };
  res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    if (Buffer.isBuffer(chunk)) markFlvHeaderHasVideo(chunk);
    if (Buffer.isBuffer(chunk) && chunk.length >= 11 && chunk[0] === 9) {
      const size = chunk.readUIntBE(1, 3);
      if (Number.isFinite(size) && size >= 0 && 11 + size <= chunk.length && !loggedFirst) {
        loggedFirst = true;
        const payload = chunk.subarray(11, 11 + size);
        onLog?.("http-flv-first-video-tag-error", `codec=${payload[0]! & 0x0f} packetType=${payload[1] ?? "n"} bytes=${payload.length} transcode=${transcode !== null}`);
      }
    }
    if (!Buffer.isBuffer(chunk)) {
      return (write as (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean)(chunk, encoding, cb);
    }
    if (route === "pending") {
      if (chunk.length >= 11 && chunk[0] === 9) {
        const size = chunk.readUIntBE(1, 3);
        if (Number.isFinite(size) && size >= 0 && 11 + size <= chunk.length) {
          const payload = chunk.subarray(11, 11 + size);
          if (isHevcFlvPayload(payload)) return startHevcRoute(chunk);
          return startAvcRoute(chunk, encoding, cb);
        }
      }
      prelude.push(chunk);
      return finishWrite(encoding, cb);
    }
    if (route === "hevc" && transcode?.stdin.writable === true) {
      transcode.stdin.write(chunk);
      return finishWrite(encoding, cb);
    }
    return writeAvc(chunk, encoding, cb);
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
        rtmpVideoLogged = 0;
        rtmpVideoLog = (detail) => log?.({ kind: "rtmp-video-error", ...(deviceId === undefined ? {} : { deviceId }), detail });
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
        const publisherId = mediaContext.publishers.get(streamPath);
        const publisher = publisherId === undefined ? undefined : mediaContext.sessions.get(publisherId);
        try {
          log?.({
            kind: "http-flv-publisher-error",
            deviceId,
            detail: `videoCodec=${publisher?.videoCodec ?? "n"} name=${publisher?.videoCodecName ?? "n"} gop=${publisher?.flvGopCacheQueue?.size ?? "n"}`,
          });
        } catch { /* diagnostics must not affect media */ }
        try { req.socket.setNoDelay(true); } catch { /* ignore */ }
        (req as IncomingMessage & { nmsConnectionType?: string }).nmsConnectionType = "http";
        const session = new NodeFlvSession({}, req, res);
        sessions.set(deviceId, session);
        filterSeiOnlyWrites(res, () => {
          try { log?.({ kind: "http-flv-client-backpressure", deviceId, detail: "HTTP-FLV player queue reached the limit; skipped until the next keyframe" }); } catch { /* diagnostics must not affect media */ }
        }, (kind, detail) => {
          try { log?.({ kind, deviceId, detail }); } catch { /* diagnostics must not affect media */ }
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
