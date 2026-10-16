import { validate, type JsonObject } from '../../src/modules/relay-link/protocol-core/index.js';
import type { CommandOutcome, LinkProbeReport, MissionOutcome, RelayLinkSnapshot, RelayPhotoProgress } from '../../src/modules/relay-link/index.js';

export type SdkErrorCode = 'INVALID_INPUT' | 'NOT_CONNECTED' | 'DISCONNECTED' | 'DISPOSED' | 'TIMED_OUT' | 'PROTOCOL_ERROR' | 'SESSION_CHANGED' | 'FORBIDDEN' | 'BUSY' | 'DEPENDENCY_FAILURE';
export class SkyCommandError extends Error {
  constructor(readonly code: SdkErrorCode, message: string = code) { super(message); this.name = 'SkyCommandError'; }
}
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
const reject = (): never => { throw new SkyCommandError('PROTOCOL_ERROR'); };
const list = (value: unknown): unknown[] => Array.isArray(value) && value.length <= 4096 ? value : reject();
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Checks gateway data before it becomes observable framework state. */
export function readRelaySnapshot(value: unknown): RelayLinkSnapshot {
  if (!isRecord(value) || !['stopped', 'starting', 'listening', 'stopping'].includes(String(value.state))) return reject();
  if (value.endpoint !== null && (!isRecord(value.endpoint) || typeof value.endpoint.host !== 'string' || !integer(value.endpoint.port))) return reject();
  const devices = list(value.devices);
  const sessions = new Map<string, string>();
  for (const item of devices) {
    if (!isRecord(item) || !validId(item.deviceId) || !validId(item.sessionId) || sessions.has(item.deviceId)) return reject();
    sessions.set(item.deviceId, item.sessionId);
  }
  for (const item of list(value.telemetry)) {
    if (!isRecord(item) || !validId(item.deviceId) || !validId(item.sessionId) || !sessions.has(item.deviceId) || sessions.get(item.deviceId) !== item.sessionId ||
        (item.receivedAtMs !== null && !integer(item.receivedAtMs))) return reject();
    if (!validate({ type: 'telemetry', payload: item.payload as JsonObject, capabilities: item.capabilities as JsonObject }).ok) return reject();
  }
  for (const item of list(value.missionPhases)) {
    if (!isRecord(item) || !validId(item.deviceId) || !sessions.has(item.deviceId) || !validate({ ...item, type: 'mission-phase' } as never).ok) return reject();
  }
  for (const [field, id] of [['pendingCommands', 'commandId'], ['pendingMissions', 'missionId']] as const) {
    for (const item of list(value[field])) if (!isRecord(item) || !validId(item.deviceId) || !sessions.has(item.deviceId) || !validId(item[id])) return reject();
  }
  if (value.lastDisconnect !== null && (!isRecord(value.lastDisconnect) || !validId(value.lastDisconnect.deviceId) || typeof value.lastDisconnect.reason !== 'string')) return reject();
  return deepFreeze(structuredClone(value)) as unknown as RelayLinkSnapshot;
}

export function readCommandOutcome(value: unknown): CommandOutcome {
  if (!isRecord(value) || !validId(value.deviceId) || !validId(value.commandId) || !['succeeded', 'rejected', 'timed-out', 'disconnected'].includes(String(value.status))) return reject();
  const frame = { type: 'command-result', id: value.commandId, ok: value.status === 'succeeded', detail: value.detail, ...(value.result === undefined ? {} : { result: value.result }) };
  if (!validate(frame as never).ok) return reject();
  return deepFreeze(value) as unknown as CommandOutcome;
}
export function readMissionOutcome(value: unknown): MissionOutcome {
  if (!isRecord(value) || !validId(value.deviceId) || !validId(value.missionId) || !['succeeded', 'rejected', 'timed-out', 'disconnected', 'transport-failed'].includes(String(value.status))) return reject();
  if (!validate({ type: 'mission-result', id: value.missionId, ok: value.status === 'succeeded', detail: value.detail } as never).ok) return reject();
  return deepFreeze(value) as unknown as MissionOutcome;
}
const photoStages = new Set(['listing', 'downloading', 'receiving', 'verifying', 'saving', 'saved']);
const maxPhotoBytes = 100 * 1024 * 1024;
export function readPhotoProgress(value: unknown): RelayPhotoProgress {
  if (!isRecord(value) || !photoStages.has(String(value.stage)) || !integer(value.photoIndex) || !integer(value.completedCount)) return reject();
  if (value.fileName !== null && (typeof value.fileName !== 'string' || value.fileName.length === 0 || value.fileName.length > 255 || /[\p{Cc}]/u.test(value.fileName))) return reject();
  if (!integer(value.transferredBytes) || (value.transferredBytes as number) > maxPhotoBytes) return reject();
  if (value.totalBytes !== null && (!integer(value.totalBytes) || (value.totalBytes as number) < 1 || (value.totalBytes as number) > maxPhotoBytes || (value.transferredBytes as number) > (value.totalBytes as number))) return reject();
  if (value.stage === 'listing' && ((value.photoIndex as number) !== 0 || value.fileName !== null || (value.transferredBytes as number) !== 0 || value.totalBytes !== null)) return reject();
  return deepFreeze({ stage: value.stage, photoIndex: value.photoIndex, completedCount: value.completedCount, fileName: value.fileName, transferredBytes: value.transferredBytes, totalBytes: value.totalBytes }) as RelayPhotoProgress;
}
export function readProbe(value: unknown): LinkProbeReport {
  if (!isRecord(value) || !integer(value.sampleCount)) return reject();
  if (value.status === 'measured') {
    for (const field of ['currentRttMs', 'medianRttMs', 'maximumRttMs', 'jitterMs']) if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || (value[field] as number) < 0) return reject();
  } else if (!['unavailable', 'timed-out', 'disconnected'].includes(String(value.status))) return reject();
  return deepFreeze(value) as unknown as LinkProbeReport;
}
export const emptyRelaySnapshot: RelayLinkSnapshot = deepFreeze({ state: 'stopped', endpoint: null, devices: [], telemetry: [], missionPhases: [], pendingCommands: [], pendingMissions: [], lastDisconnect: null });
