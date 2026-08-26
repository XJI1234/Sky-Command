import { createServer, type Server, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FfmpegCandidate, FileFacts } from "../../modules/media-pipeline/ffmpeg-locator/index.js";
import type { HlsServerPort } from "../../modules/media-pipeline/hls-server/index.js";
import type { RtmpIngressPort } from "../../modules/media-pipeline/rtmp-ingest/index.js";
import type { ProcessExit, TranscoderProcessPort } from "../../modules/media-pipeline/transcode-runner/index.js";

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
  readonly fileFacts: FileFacts;
  readonly processFactory: () => TranscoderProcessPort;
}

function deviceIdFromInputUrl(inputUrl: string): string | null {
  try {
    const parsed = new URL(inputUrl.replace(/^rtmp:/i, "http:"));
    const match = /^\/live\/([^/]+)$/.exec(parsed.pathname);
    if (match === null) return null;
    const decoded = decodeURIComponent(match[1] ?? "");
    return encodeURIComponent(decoded) === match[1] ? decoded : null;
  } catch {
    return null;
  }
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

function findFile(directory: string, fileName: string, depth = 4): string | null {
  if (depth < 0 || !existsSync(directory)) return null;
  let entries: ReturnType<typeof readdirSync>;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName) return entryPath;
    if (entry.isDirectory()) {
      const found = findFile(entryPath, fileName, depth - 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function findWingetFfmpeg(): string | null {
  const root = process.env.LOCALAPPDATA;
  const packagesRoot = root === undefined ? null : join(root, "Microsoft", "WinGet", "Packages");
  if (packagesRoot === null || !existsSync(packagesRoot)) return null;
  let names: string[];
  try { names = readdirSync(packagesRoot); } catch { return null; }
  const packageName = names.find((name) => name.startsWith("Gyan.FFmpeg."));
  return packageName === undefined ? null : findFile(join(packagesRoot, packageName), "ffmpeg.exe");
}

function findPathFfmpeg(): string | null {
  try {
    const detected = execFileSync("where.exe", ["ffmpeg.exe"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0);
    return detected !== undefined && existsSync(detected.trim()) ? detected.trim() : null;
  } catch {
    return null;
  }
}

export function discoverFfmpegCandidates(projectRoot: string): readonly FfmpegCandidate[] {
  const seen = new Set<string>();
  const candidates: FfmpegCandidate[] = [];
  const add = (source: FfmpegCandidate["source"], executablePath: string | null | undefined): void => {
    if (executablePath === null || executablePath === undefined || executablePath.trim().length === 0 || seen.has(executablePath)) return;
    seen.add(executablePath);
    candidates.push({ source, executablePath });
  };
  add("configured", process.env.SKY_COMMAND_FFMPEG);
  add("bundled", join(projectRoot, "tools", "ffmpeg", "bin", "ffmpeg.exe"));
  add("bundled", join(projectRoot, "ffmpeg.exe"));
  add("system", "C:\\ffmpeg\\bin\\ffmpeg.exe");
  add("system", findWingetFfmpeg());
  add("system", findPathFfmpeg());
  return candidates;
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

function writeFlvHeader(res: ServerResponse): void {
  const header = Buffer.alloc(13);
  header.write("FLV");
  header[3] = 1;
  header[4] = 1;
  header.writeUInt32BE(9, 5);
  header.writeUInt32BE(0, 9);
  res.write(header);
}

function writeFlvTag(res: ServerResponse, type: number, timestamp: number, payload: Buffer): void {
  const size = payload.length;
  const header = Buffer.alloc(11);
  header[0] = type;
  header.writeUIntBE(size, 1, 3);
  header.writeUIntBE(timestamp & 0xffffff, 4, 3);
  header[7] = (timestamp / 0x1000000) & 0xff;
  header.writeUIntBE(0, 8, 3);
  const previous = Buffer.alloc(4);
  previous.writeUInt32BE(11 + size, 0);
  res.write(Buffer.concat([header, payload, previous]));
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
        const onVideo = (payload: unknown, timestamp: unknown): void => {
          if (!Buffer.isBuffer(payload) || typeof timestamp !== "number" || !keepAvcVideoTag(payload) || res.writableEnded) return;
          try { writeFlvTag(res, 9, timestamp >>> 0, payload); } catch { /* client gone */ }
        };
        const onClose = (): void => {
          clients.delete(pull);
          if (!res.writableEnded) try { res.end(); } catch { /* ignore */ }
        };
        pull.on("video", onVideo);
        pull.on("close", onClose);
        req.on("close", () => {
          clients.delete(pull);
          try { pull.stop(); } catch { /* ignore */ }
        });
        try { pull.startPull(); } catch {
          clients.delete(pull);
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

function createProcessFactory(onPlaylistReady: (deviceId: string) => void, log?: (event: MediaPortLogEvent) => void): () => TranscoderProcessPort {
  return () => ({
    launch: (job, onExit) => {
      const deviceId = deviceIdFromInputUrl(job.inputUrl) ?? undefined;
      let finished = false;
      const finish = (kind: ProcessExit["kind"]): void => {
        if (finished) return;
        finished = true;
        onExit({ kind });
      };
      if (deviceId === undefined) {
        finish("failed");
        return { terminate: () => undefined };
      }
      log?.({ kind: "http-flv-ready", deviceId, detail: "HTTP-FLV playback URL is ready" });
      setImmediate(() => {
        if (finished) return;
        onPlaylistReady(deviceId);
      });
      return {
        terminate: () => finish("exited"),
      };
    },
  });
}

export function createMediaPorts(onPlaylistReady: (deviceId: string) => void, log?: (event: MediaPortLogEvent) => void): MediaPorts {
  const shared = { rtmpPort: 19_500 };
  return {
    rtmp: createRtmpPort(shared, log),
    hls: createFlvHttpPort(shared, log),
    fileFacts: {
      isExecutableFile: (path) => {
        try { return existsSync(path) && statSync(path).isFile(); } catch { return false; }
      },
    },
    processFactory: createProcessFactory(onPlaylistReady, log),
  };
}
