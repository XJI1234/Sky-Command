import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RelayDiagnosticSink } from "../../modules/relay-link/index.js";
import type { DesktopUiGatewayInstance, GatewayResult } from "../desktop-ui-gateway/index.js";

type IncidentLink = "phone-pc" | "uplink" | "downlink" | "phone";
type IncidentLevel = "INFO" | "WARN" | "ERROR";

interface IncidentRecord {
  readonly link: IncidentLink;
  readonly level: IncidentLevel;
  readonly event: string;
  readonly deviceId?: string;
  readonly operationId?: string;
  readonly detail: string;
}

export interface IncidentJournal {
  readonly ndjsonPath: string;
  readonly logPath: string;
  readonly record: (input: IncidentRecord) => void;
}

const MAX_DETAIL = 512;
const quietMethods = new Set(["state.snapshot", "network.hint", "stream.refresh", "webrtc.refresh", "diagnostics.record"]);

function defaultDirectory(): string {
  const localAppData = process.env.LOCALAPPDATA;
  return typeof localAppData === "string" && localAppData.trim().length > 0
    ? join(localAppData, "Sky Command", "diagnostics")
    : join(process.cwd(), "diagnostics");
}

export function sanitizeDetail(value: string): string {
  const redacted = value
    .replace(/[A-Za-z]:\\[^\s]+/g, "[REDACTED]")
    .replace(/\/(?:Users|home|var|tmp)\/[^\s]+/g, "[REDACTED]")
    .replace(/\b(?:token|secret|password|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, "[REDACTED]")
    .replace(/:\/\/[^/@\s]+@/g, "://[REDACTED]@")
    .replace(/[?&#][^\s]*/g, "")
    .replace(/[\p{Cc}]/gu, " ");
  return Array.from(redacted).slice(0, MAX_DETAIL).join("").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function create(directory = defaultDirectory()): IncidentJournal {
  const ndjsonPath = join(directory, "incident.ndjson");
  const logPath = join(directory, "incident.log");
  const write = (line: string, jsonLine: string): void => {
    try {
      mkdirSync(dirname(ndjsonPath), { recursive: true });
      appendFileSync(ndjsonPath, `${jsonLine}\n`, "utf8");
      appendFileSync(logPath, `${line}\n`, "utf8");
    } catch { /* 日志失败不得挡住指挥链路 */ }
  };
  const record = (input: IncidentRecord): void => {
    const ts = new Date().toISOString();
    const event = sanitizeDetail(input.event).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "UNKNOWN";
    const detail = sanitizeDetail(input.detail);
    const deviceId = input.deviceId === undefined ? undefined : sanitizeDetail(input.deviceId).slice(0, 128);
    const operationId = input.operationId === undefined ? undefined : sanitizeDetail(input.operationId).slice(0, 128);
    const payload = {
      ts,
      link: input.link,
      level: input.level,
      event,
      ...(deviceId === undefined || deviceId.length === 0 ? {} : { deviceId }),
      ...(operationId === undefined || operationId.length === 0 ? {} : { operationId }),
      detail,
    };
    const line = [ts, input.level, input.link, event, deviceId ?? "-", operationId ?? "-", detail].join(" ");
    write(line, JSON.stringify(payload));
  };
  return Object.freeze({ ndjsonPath, logPath, record });
}

function linkForMethod(method: string): IncidentLink {
  if (method.startsWith("stream.") || method.startsWith("video.") || method.startsWith("webrtc.")) return "downlink";
  if (method.startsWith("network.") || method.startsWith("pairing.")) return "phone-pc";
  return "uplink";
}

function invokeLevel(result: GatewayResult): IncidentLevel {
  if (!result.ok) return "ERROR";
  const value = asRecord(result.value);
  if (value?.ok === false) return "WARN";
  const nested = asRecord(value?.value);
  const status = nested?.status ?? value?.status;
  if (status === "timed-out" || status === "rejected" || status === "disconnected" || status === "transport-failed") return "WARN";
  return "INFO";
}

function invokeEvent(method: string, result: GatewayResult): string {
  const name = method.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!result.ok) return `${name}_GATEWAY_${result.code}`;
  const value = asRecord(result.value);
  if (value?.ok === false && typeof value.code === "string") return `${name}_${sanitizeDetail(value.code).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const nested = asRecord(value?.value);
  const status = nested?.status ?? value?.status;
  if (typeof status === "string") return `${name}_${status.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  return `${name}_OK`;
}

function invokeDetail(method: string, input: unknown, result: GatewayResult): string {
  const source = asRecord(input);
  const parts = [method];
  if (source !== null) {
    for (const key of ["deviceId", "routeId", "action", "fileName", "confirmationId"]) {
      const value = text(source[key]);
      if (value !== null) parts.push(`${key}=${value}`);
    }
  }
  if (!result.ok) parts.push(result.code);
  else {
    const value = asRecord(result.value);
    if (typeof value?.code === "string") parts.push(value.code);
    const nested = asRecord(value?.value);
    const status = nested?.status ?? value?.status;
    if (typeof status === "string") parts.push(status);
    const detail = text(nested?.detail) ?? text(value?.detail);
    if (detail !== null) parts.push(detail);
  }
  return parts.join(" ");
}

export function wrapGateway(gateway: DesktopUiGatewayInstance, journal: IncidentJournal): DesktopUiGatewayInstance {
  return Object.freeze({
    invoke: async (method: unknown, input: unknown) => {
      if (method === "diagnostics.record") {
        const source = asRecord(input);
        const action = text(source?.action);
        const reason = text(source?.reason);
        if (action === null || reason === null || source === null || Object.keys(source).length !== 2) {
          return Object.freeze({ ok: false as const, code: "INVALID_INPUT" as const });
        }
        journal.record({
          link: action.startsWith("stream") || action.startsWith("video") || action.startsWith("webrtc") ? "downlink" : action.startsWith("pairing") ? "phone-pc" : "uplink",
          level: "WARN",
          event: "CONSOLE_BLOCKED",
          detail: `${action} ${reason}`,
        });
        return Object.freeze({ ok: true as const, value: true });
      }
      const result = await gateway.invoke(method, input);
      if (typeof method === "string" && !quietMethods.has(method)) {
        const deviceId = text(asRecord(input)?.deviceId) ?? undefined;
        journal.record({
          link: linkForMethod(method),
          level: invokeLevel(result),
          event: invokeEvent(method, result),
          ...(deviceId === undefined ? {} : { deviceId }),
          detail: invokeDetail(method, input, result),
        });
      }
      return result;
    },
    snapshot: gateway.snapshot,
    subscribe: gateway.subscribe,
    dispose: gateway.dispose,
  });
}

export function wrapPhoneDiagnostics(store: RelayDiagnosticSink, journal: IncidentJournal): RelayDiagnosticSink {
  return Object.freeze({
    persist(input: Parameters<RelayDiagnosticSink["persist"]>[0]): boolean {
      for (const event of input.events) {
        journal.record({
          link: "phone",
          level: event.level === "ERROR" || event.level === "WARN" ? event.level : "INFO",
          event: event.eventCode,
          deviceId: input.deviceId,
          ...(event.operationId === null ? {} : { operationId: event.operationId }),
          detail: `${event.module} ${event.safeDetail}`,
        });
      }
      return store.persist(input);
    },
  });
}

function deviceIds(value: unknown): readonly string[] {
  const devices = asRecord(value)?.devices;
  if (!Array.isArray(devices)) return [];
  return devices.flatMap((item) => {
    const deviceId = text(asRecord(item)?.deviceId);
    return deviceId === null ? [] : [deviceId];
  });
}

function deviceMap(value: unknown): Map<string, Record<string, unknown>> {
  const devices = asRecord(value)?.devices;
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(devices)) return map;
  for (const item of devices) {
    const source = asRecord(item);
    const deviceId = text(source?.deviceId);
    if (source !== null && deviceId !== null) map.set(deviceId, source);
  }
  return map;
}

function phaseOf(value: unknown, key: string): string | null {
  const source = asRecord(value);
  if (source === null) return null;
  const nested = asRecord(source[key]) ?? source;
  const phase = nested.phase ?? nested.state;
  return typeof phase === "string" ? phase : null;
}

function connectionFacts(value: unknown): Readonly<Record<string, string>> {
  const connection = asRecord(asRecord(value)?.connection);
  if (connection === null) return {};
  const facts: Record<string, string> = {};
  for (const key of ["sdk", "remoteController", "flightController", "aircraft", "pairingState"]) {
    const current = connection[key];
    if (typeof current === "string") facts[key] = current;
  }
  return facts;
}

export function watchApplication(application: { snapshot: () => unknown; subscribe: (listener: (snapshot: unknown) => void) => () => void }, journal: IncidentJournal): () => void {
  let previousDevices = new Set<string>();
  let previousFacts = new Map<string, Record<string, string>>();
  /** 连接类事实需连续两次快照一致才落盘，压制遥测闪断刷屏。 */
  const pendingConnection = new Map<string, Record<string, string>>();
  const connectionKeys = new Set(["sdk", "remoteController", "flightController", "aircraft", "pairingState"]);
  const apply = (snapshot: unknown): void => {
    try {
    const root = asRecord(snapshot);
    const workflow = asRecord(root?.workflow);
    const runtime = asRecord(root?.runtime);
    const relay = asRecord(runtime?.relay);
    const media = asRecord(runtime?.media);
    const workflowDevices = deviceMap(workflow);
    const ids = new Set([...deviceIds(relay), ...workflowDevices.keys()]);
    for (const deviceId of ids) {
      if (!previousDevices.has(deviceId)) {
        journal.record({ link: "phone-pc", level: "INFO", event: "DEVICE_PAIRED", deviceId, detail: "Android relay is paired" });
      }
      const device = workflowDevices.get(deviceId);
      const facts: Record<string, string> = { ...connectionFacts(device) };
      const mission = phaseOf(device, "mission");
      const stream = phaseOf(device, "stream");
      const video = phaseOf(device, "video");
      if (mission !== null) facts.mission = mission;
      if (stream !== null) facts.stream = stream;
      if (video !== null) facts.video = video;
      const mediaStreams = asRecord(media)?.streams;
      if (Array.isArray(mediaStreams)) {
        const mediaStream = mediaStreams.find((item) => text(asRecord(item)?.deviceId) === deviceId);
        const mediaPhase = text(asRecord(mediaStream)?.phase);
        if (mediaPhase !== null) facts.media = mediaPhase;
      }
      const last = previousFacts.get(deviceId) ?? {};
      const pending = pendingConnection.get(deviceId) ?? {};
      const nextPending: Record<string, string> = { ...pending };
      const nextLogged: Record<string, string> = { ...last };
      for (const [key, value] of Object.entries(facts)) {
        if (last[key] === value) {
          delete nextPending[key];
          continue;
        }
        if (connectionKeys.has(key)) {
          if (value === "unknown") {
            nextLogged[key] = value;
            delete nextPending[key];
            continue;
          }
          if (pending[key] !== value) {
            nextPending[key] = value;
            continue;
          }
          delete nextPending[key];
        }
        const link: IncidentLink = key === "mission" ? "uplink" : key === "stream" || key === "video" || key === "media" ? "downlink" : "phone-pc";
        const level: IncidentLevel = value === "failed" || value === "disconnected" || value === "not-ready" ? "WARN" : "INFO";
        journal.record({
          link,
          level,
          event: `${key.toUpperCase()}_${value.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
          deviceId,
          detail: `${key} is ${value}`,
        });
        nextLogged[key] = value;
      }
      if (Object.keys(nextPending).length === 0) pendingConnection.delete(deviceId);
      else pendingConnection.set(deviceId, nextPending);
      previousFacts.set(deviceId, nextLogged);
    }
    for (const deviceId of previousDevices) {
      if (ids.has(deviceId)) continue;
      journal.record({ link: "phone-pc", level: "WARN", event: "DEVICE_UNPAIRED", deviceId, detail: "Android relay disconnected" });
      previousFacts.delete(deviceId);
      pendingConnection.delete(deviceId);
    }
    previousDevices = ids;
    } catch { /* 快照观察失败不得挡住业务 */ }
  };
  apply(application.snapshot());
  return application.subscribe(apply);
}

export function mediaLogger(journal: IncidentJournal): (event: { readonly kind: string; readonly deviceId?: string; readonly detail: string }) => void {
  return (event) => {
    const failed = /fail|error|stderr/i.test(event.kind);
    journal.record({
      link: "downlink",
      level: failed ? "WARN" : "INFO",
      event: event.kind.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
      ...(event.deviceId === undefined ? {} : { deviceId: event.deviceId }),
      detail: event.detail,
    });
  };
}

export const IncidentJournal = Object.freeze({ create });
