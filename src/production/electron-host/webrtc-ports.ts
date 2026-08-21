import { spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import type { ProcessPort } from "../../modules/webrtc-media/mediamtx-process/index.js";
import type { MediaPathPort } from "../../modules/webrtc-media/media-path-monitor/index.js";
import type { WhepPlaybackPort } from "../../modules/webrtc-media/whep-playback/index.js";

interface ChildProcessPort {
  readonly killed?: boolean;
  readonly on: (event: "exit" | "error", listener: (...args: unknown[]) => void) => unknown;
  readonly kill: () => boolean;
}

export interface MediaMtxProcessPortOptions {
  readonly spawn?: (executablePath: string, args: readonly string[], options: Readonly<Record<string, unknown>>) => ChildProcessPort;
}

export interface MediaPathPortOptions {
  readonly apiPort: number;
  readonly timeoutMs?: number;
}

export interface RendererWhepEventSender {
  readonly send: (channel: string, payload: unknown) => void;
}

export interface WhepPlaybackBridge {
  readonly port: WhepPlaybackPort;
  readonly ready: (input: unknown) => void;
  readonly fatal: (input: unknown) => void;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const validPort = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1_024 && value <= 65_535;
const validTimeout = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 250 && value <= 10_000;

function cleanup(directory: string): void {
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* temporary cleanup is best effort */ }
}

function defaultSpawn(executablePath: string, args: readonly string[], options: Readonly<Record<string, unknown>>): ChildProcessPort {
  return nodeSpawn(executablePath, [...args], options as never) as unknown as ChildProcessPort;
}

export function createMediaMtxProcessPort(options: MediaMtxProcessPortOptions = {}): ProcessPort {
  const spawn = options.spawn ?? defaultSpawn;
  return freeze({
    launch: (input, onExit) => {
      const directory = mkdtempSync(join(tmpdir(), "sky-command-mediamtx-"));
      const configPath = join(directory, "mediamtx.yml");
      try {
        writeFileSync(configPath, input.config, { encoding: "utf8", mode: 0o600 });
        const child = spawn(input.executablePath, [configPath], freeze({ windowsHide: true, stdio: ["ignore", "ignore", "ignore"] }));
        let finished = false;
        const finish = (kind: "exited" | "failed"): void => {
          if (finished) return;
          finished = true;
          cleanup(directory);
          try { onExit(freeze({ kind })); } catch { /* process observers are isolated by the domain module */ }
        };
        child.on("exit", (code) => finish(code === 0 ? "exited" : "failed"));
        child.on("error", () => finish("failed"));
        return freeze({
          terminate: () => {
            if (finished || child.killed === true) return;
            child.kill();
          },
        });
      } catch (error) {
        cleanup(directory);
        throw error;
      }
    },
  });
}

function devicePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.startsWith("/") ? value : `/${value}`;
  const match = /^\/live\/([^/]+)$/u.exec(normalized);
  if (match === null) return null;
  try {
    const encoded = match[1] ?? "";
    const deviceId = decodeURIComponent(encoded);
    if (deviceId.length === 0 || deviceId === "." || deviceId === ".." || /[\\/\p{Cc}]/u.test(deviceId) || Array.from(deviceId).length > 128) return null;
    return `/live/${encodeURIComponent(deviceId)}`;
  } catch {
    return null;
  }
}

function pathNames(value: unknown): readonly string[] {
  const source = record(value);
  const items = source?.items;
  if (!Array.isArray(items)) throw new Error("Invalid MediaMTX path response");
  const paths = new Set<string>();
  for (const item of items) {
    const name = record(item)?.name;
    const path = devicePath(name);
    if (path !== null) paths.add(path);
  }
  return freeze([...paths].sort((left, right) => left.localeCompare(right)));
}

export function createMediaPathPort(options: MediaPathPortOptions): MediaPathPort {
  if (!validPort(options?.apiPort) || (options.timeoutMs !== undefined && !validTimeout(options.timeoutMs))) throw new TypeError("Invalid MediaMTX API options");
  const timeoutMs = options.timeoutMs ?? 1_000;
  return freeze({
    listPaths: () => new Promise<readonly string[]>((resolve, reject) => {
      const request = httpRequest({ hostname: "127.0.0.1", port: options.apiPort, path: "/v3/paths/list", method: "GET", headers: { accept: "application/json" } }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += data.length;
          if (size <= 1_048_576) chunks.push(data);
        });
        response.on("end", () => {
          if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300 || size > 1_048_576) {
            reject(new Error("MediaMTX API request failed"));
            return;
          }
          try { resolve(pathNames(JSON.parse(Buffer.concat(chunks).toString("utf8")))); } catch { reject(new Error("Invalid MediaMTX API response")); }
        });
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error("MediaMTX API timeout")));
      request.on("error", () => reject(new Error("MediaMTX API unavailable")));
      request.end();
    }),
  });
}

function generationOf(value: unknown): number | null {
  const generation = record(value)?.generation;
  return typeof generation === "number" && Number.isSafeInteger(generation) && generation > 0 ? generation : null;
}

export function createWhepPlaybackBridge(sender: RendererWhepEventSender["send"]): WhepPlaybackBridge {
  if (typeof sender !== "function") throw new TypeError("Invalid renderer event sender");
  let generation = 0;
  let ready: (() => void) | null = null;
  let fatal: (() => void) | null = null;
  const notify = (channel: string, payload: unknown): void => sender(channel, payload);
  const call = (callback: (() => void) | null): void => { try { callback?.(); } catch { /* renderer callback failures stay inside the bridge */ } };
  const bridge: WhepPlaybackBridge = {
    port: freeze({
      setTarget: (input, onReady, onFatalError) => {
        generation += 1;
        ready = onReady;
        fatal = () => onFatalError(undefined);
        try {
          notify("webrtc-player-select", freeze({ generation, deviceId: input.deviceId, url: input.url }));
        } catch (error) {
          ready = null;
          fatal = null;
          throw error;
        }
      },
      clear: () => {
        generation += 1;
        ready = null;
        fatal = null;
        notify("webrtc-player-clear", freeze({ generation }));
      },
    }),
    ready: (input) => {
      if (generationOf(input) !== generation) return;
      call(ready);
    },
    fatal: (input) => {
      if (generationOf(input) !== generation) return;
      call(fatal);
    },
  };
  return freeze(bridge);
}
