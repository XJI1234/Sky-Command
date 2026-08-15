import { sha256 } from "@noble/hashes/sha2.js";
import { ProtocolLimits, validate, type RelayFrame } from "../protocol-core/index.js";

export interface TimerScheduler { setTimeout(callback: () => void, milliseconds: number): unknown; clearTimeout(handle: unknown): void; }
export interface MissionPayload { readonly missionId: string; readonly fileName: string; readonly bytes: Uint8Array; readonly size: number; readonly sha256: string; }
export interface MissionSink { send(frame: RelayFrame): Promise<void>; }
export interface MissionResultInput { readonly missionId: string; readonly ok: boolean; readonly detail: string; }
export type MissionStatus = "succeeded" | "rejected" | "timed-out" | "disconnected" | "transport-failed";
export interface MissionOutcome { readonly connectionId: string; readonly missionId: string; readonly status: MissionStatus; readonly detail: string; }
export interface MissionPending { readonly connectionId: string; readonly missionId: string; }
export interface MissionSenderOptions { readonly scheduler: TimerScheduler; readonly timeoutMs: number; }
export interface MissionSenderInstance {
  send(connectionId: string, mission: MissionPayload, sink: MissionSink): Promise<MissionOutcome>;
  acceptResult(connectionId: string, result: MissionResultInput): void;
  cancelConnection(connectionId: string, reason: string): void;
  snapshot(): readonly MissionPending[];
  subscribe(listener: (outcome: MissionOutcome) => void): () => void;
}

const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validDetail = (value: unknown): value is string => typeof value === "string" && Array.from(value).length <= 1024 && !/[\p{Cc}]/u.test(value);
const hex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const immediate = (connectionId: string, missionId: string, status: MissionStatus, detail: string): MissionOutcome => Object.freeze({ connectionId, missionId, status, detail });

function create(options: MissionSenderOptions): MissionSenderInstance {
  const pending = new Map<string, { value: MissionPending; timer: unknown; resolve: (outcome: MissionOutcome) => void }>();
  let current: readonly MissionPending[] = Object.freeze([]);
  const listeners = new Set<(outcome: MissionOutcome) => void>();
  const key = (connectionId: string, missionId: string): string => `${connectionId}\u0000${missionId}`;
  const rebuild = (): void => { current = Object.freeze([...pending.values()].map((entry) => Object.freeze({ ...entry.value }))); };
  const publish = (outcome: MissionOutcome): void => { for (const listener of [...listeners]) { try { listener(outcome); } catch { /* listener isolation */ } } };
  const finish = (value: MissionPending, status: MissionStatus, detail: string): void => {
    const entry = pending.get(key(value.connectionId, value.missionId));
    if (!entry) return;
    pending.delete(key(value.connectionId, value.missionId)); options.scheduler.clearTimeout(entry.timer); rebuild();
    const outcome = immediate(value.connectionId, value.missionId, status, detail); entry.resolve(outcome); publish(outcome);
  };
  const invalidMission = (connectionId: string, missionId: string, detail: string): Promise<MissionOutcome> => Promise.resolve(immediate(connectionId, missionId, "rejected", detail));
  const send = async (connectionId: string, mission: MissionPayload, sink: MissionSink): Promise<MissionOutcome> => {
    const missionId = typeof mission?.missionId === "string" ? mission.missionId : "invalid";
    if (mission === null || typeof mission !== "object") return invalidMission(connectionId, missionId, "Mission payload is invalid");
    if (!validId(connectionId) || !validId(missionId) || [...pending.values()].some((entry) => entry.value.connectionId === connectionId)) return invalidMission(connectionId, missionId, "Mission is already active or invalid");
    const beginValid = validate({ type: "mission-begin", id: missionId, fileName: mission.fileName, size: mission.size, sha256: mission.sha256 }).ok;
    if (!(mission.bytes instanceof Uint8Array) || !validId(mission.fileName) || !beginValid || !Number.isSafeInteger(mission.size) || mission.size !== mission.bytes.byteLength || mission.size < 1 || mission.size > ProtocolLimits.maxMissionBytes || !/^[0-9a-f]{64}$/u.test(mission.sha256) || hex(sha256(mission.bytes)) !== mission.sha256) return invalidMission(connectionId, missionId, "Mission payload is invalid");
    const value = Object.freeze({ connectionId, missionId });
    let resolve!: (outcome: MissionOutcome) => void;
    const result = new Promise<MissionOutcome>((done) => { resolve = done; });
    const timer = options.scheduler.setTimeout(() => finish(value, "timed-out", "Mission timed out"), options.timeoutMs);
    pending.set(key(connectionId, missionId), { value, timer, resolve }); rebuild();
    const copy = mission.bytes.slice();
    try {
      const begin: RelayFrame = { type: "mission-begin", id: missionId, fileName: mission.fileName, size: mission.size, sha256: mission.sha256 };
      await sink.send(begin);
      for (let offset = 0; offset < copy.byteLength; offset += ProtocolLimits.maxMissionChunkBytes) {
        const chunk: RelayFrame = { type: "mission-chunk", id: missionId, data: copy.slice(offset, offset + ProtocolLimits.maxMissionChunkBytes) };
        await sink.send(chunk);
      }
      await sink.send({ type: "mission-complete", id: missionId });
    } catch { finish(value, "transport-failed", "Mission frame could not be sent"); }
    return result;
  };
  const acceptResult = (connectionId: string, result: MissionResultInput): void => {
    if (!validId(connectionId) || !validId(result?.missionId) || typeof result.ok !== "boolean" || !validDetail(result.detail)) return;
    const entry = pending.get(key(connectionId, result.missionId)); if (!entry) return;
    finish(entry.value, result.ok ? "succeeded" : "rejected", result.detail);
  };
  const cancelConnection = (connectionId: string, reason: string): void => {
    if (!validId(connectionId)) return;
    const detail = validDetail(reason) && reason.length > 0 ? reason : "Connection disconnected";
    for (const entry of [...pending.values()]) if (entry.value.connectionId === connectionId) finish(entry.value, "disconnected", detail);
  };
  return Object.freeze({ send, acceptResult, cancelConnection, snapshot: () => current, subscribe: (listener: (outcome: MissionOutcome) => void): (() => void) => { listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; } });
}

export const MissionSender = Object.freeze({ create });
