import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import type { FfmpegCandidate, FileFacts } from "../../modules/media-pipeline/ffmpeg-locator/index.js";
import type { HlsServerPort } from "../../modules/media-pipeline/hls-server/index.js";
import type { RtmpIngressPort } from "../../modules/media-pipeline/rtmp-ingest/index.js";
import type { ProcessExit, TranscodeJob, TranscoderProcessPort } from "../../modules/media-pipeline/transcode-runner/index.js";

const require = createRequire(import.meta.url);
type PublishListener = (id: string, streamPath: string) => void;
type NodeEvent = { on: (name: string, listener: PublishListener) => void; removeListener: (name: string, listener: PublishListener) => void };
type RtmpServer = { run: () => void; stop: () => void };
const NodeRtmpServer = require("node-media-server/src/node_rtmp_server.js") as new (config: { rtmp: { port: number; chunk_size: number; gop_cache: boolean; ping: number; ping_timeout: number } }) => RtmpServer;
const mediaContext = require("node-media-server/src/node_core_ctx.js") as { nodeEvent: NodeEvent };

const mime: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/MP2T",
  ".m4s": "video/iso.segment",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

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

function createRtmpPort(log?: (event: MediaPortLogEvent) => void): RtmpIngressPort {
  let server: RtmpServer | null = null;
  let published: PublishListener | null = null;
  let unpublished: PublishListener | null = null;
  return {
    listen: (port, events) => {
      if (server !== null) throw new Error("rtmp already listening");
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

function send(response: ServerResponse, status: number, headers: Record<string, string>, body?: Buffer | string): void {
  response.writeHead(status, headers);
  response.end(body);
}

function createHlsPort(): HlsServerPort {
  let server: Server | null = null;
  return {
    listen: (input) => {
      if (server !== null) throw new Error("hls already listening");
      const root = resolve(input.rootDirectory);
      server = createServer((request: IncomingMessage, response: ServerResponse) => {
        if (request.method === "OPTIONS") {
          send(response, 204, cors);
          return;
        }
        const url = new URL(request.url ?? "/", `http://127.0.0.1:${input.port}`);
        const match = /^\/hls\/([^/]+)\/([^/]+)$/.exec(url.pathname);
        if (match === null) {
          send(response, 404, { ...cors, "Content-Type": "text/plain; charset=utf-8" }, "not found");
          return;
        }
        const streamId = decodeURIComponent(match[1] ?? "");
        const fileName = decodeURIComponent(match[2] ?? "");
        const target = resolve(join(root, streamId, fileName));
        const relativePath = relative(root, target);
        if (relativePath.startsWith("..") || relativePath.includes(`..${sep}`) || normalize(relativePath).startsWith("..")) {
          send(response, 404, { ...cors, "Content-Type": "text/plain; charset=utf-8" }, "not found");
          return;
        }
        if (!existsSync(target) || !statSync(target).isFile()) {
          send(response, 404, { ...cors, "Content-Type": "text/plain; charset=utf-8" }, "not found");
          return;
        }
        const type = mime[extname(target).toLowerCase()] ?? "application/octet-stream";
        send(response, 200, { ...cors, "Content-Type": type, "Cache-Control": "no-store" }, readFileSync(target));
      });
      server.listen(input.port, input.host);
    },
    close: () => {
      server?.close();
      server = null;
    },
  };
}

function ffmpegArgs(job: TranscodeJob, playlist: string): readonly string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-fflags", "nobuffer+discardcorrupt",
    "-probesize", "32768",
    "-analyzeduration", "0",
    "-i", job.inputUrl,
    "-c:v", "copy",
    "-an",
    "-f", "hls",
    "-hls_time", "1",
    "-hls_list_size", "3",
    "-hls_flags", "delete_segments+append_list+independent_segments",
    "-flush_packets", "1",
    "-hls_segment_filename", join(job.outputDirectory, "seg-%03d.ts"),
    playlist,
  ];
}

function createProcessFactory(onPlaylistReady: (deviceId: string) => void, log?: (event: MediaPortLogEvent) => void): () => TranscoderProcessPort {
  return () => ({
    launch: (job, onExit) => {
      mkdirSync(job.outputDirectory, { recursive: true });
      const playlist = join(job.outputDirectory, "index.m3u8");
      const deviceId = deviceIdFromInputUrl(job.inputUrl) ?? undefined;
      let child: ChildProcess;
      try {
        child = spawn(job.executablePath, ffmpegArgs(job, playlist), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      } catch {
        log?.({ kind: "ffmpeg-spawn-failed", ...(deviceId === undefined ? {} : { deviceId }), detail: "FFmpeg process could not start" });
        onExit({ kind: "failed" } satisfies ProcessExit);
        return { terminate: () => undefined };
      }
      child.stderr?.on("data", (chunk: unknown) => {
        const text = String(chunk).trim();
        if (text.length === 0) return;
        log?.({ kind: "ffmpeg-stderr", ...(deviceId === undefined ? {} : { deviceId }), detail: text });
      });
      let finished = false;
      let notified = false;
      const finish = (kind: ProcessExit["kind"]): void => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        log?.({ kind: kind === "exited" ? "ffmpeg-exited" : "ffmpeg-failed", ...(deviceId === undefined ? {} : { deviceId }), detail: kind === "exited" ? "FFmpeg exited" : "FFmpeg failed" });
        onExit({ kind });
      };
      const timer = setInterval(() => {
        if (notified || finished) return;
        try {
          if (!existsSync(playlist) || statSync(playlist).size <= 0) return;
          notified = true;
          if (deviceId !== undefined) {
            log?.({ kind: "playlist-ready", deviceId, detail: "HLS playlist is ready" });
            onPlaylistReady(deviceId);
          }
        } catch { /* 播放列表尚未可读取 */ }
      }, 250);
      child.on("exit", (code) => finish(code === 0 ? "exited" : "failed"));
      child.on("error", () => finish("failed"));
      return {
        terminate: () => {
          clearInterval(timer);
          if (!child.killed) child.kill();
        },
      };
    },
  });
}

export function createMediaPorts(onPlaylistReady: (deviceId: string) => void, log?: (event: MediaPortLogEvent) => void): MediaPorts {
  return {
    rtmp: createRtmpPort(log),
    hls: createHlsPort(),
    fileFacts: {
      isExecutableFile: (path) => {
        try { return existsSync(path) && statSync(path).isFile(); } catch { return false; }
      },
    },
    processFactory: createProcessFactory(onPlaylistReady, log),
  };
}
