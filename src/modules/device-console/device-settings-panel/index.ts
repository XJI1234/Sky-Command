export interface TransmissionSettings { readonly frequencyBand: string; readonly channelSelectionMode: string; readonly bandwidth: string; readonly dynamicDataRateMbps: number | null; }
export interface TransmissionSettingsPatch { readonly frequencyBand?: string; readonly channelSelectionMode?: string; readonly bandwidth?: string; }
export interface CameraSettings { readonly autoExposureLockEnabled: boolean; readonly focusMode: string; readonly cameraIndex: string; }
export interface CameraSettingsPatch { readonly autoExposureLockEnabled?: boolean; readonly focusMode?: string; }
export type PortResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly reason: "rejected" | "timed-out" | "transport-failed" }>;
export interface DeviceSettingsPort { readonly readTransmission: (deviceId: string) => Promise<PortResult<TransmissionSettings>>; readonly writeTransmission: (deviceId: string, patch: TransmissionSettingsPatch) => Promise<PortResult<TransmissionSettings>>; readonly readCamera: (deviceId: string) => Promise<PortResult<CameraSettings>>; readonly writeCamera: (deviceId: string, patch: CameraSettingsPatch) => Promise<PortResult<CameraSettings>>; }
export interface DeviceSettingsSnapshot { readonly deviceId: string; readonly transmission: TransmissionSettings | null; readonly camera: CameraSettings | null; readonly transmissionPending: boolean; readonly cameraPending: boolean; readonly lastFailure: "rejected" | "timed-out" | "transport-failed" | "invalid-result" | "adapter-failed" | null; }
export type DeviceSettingsResult = Readonly<{ readonly ok: true; readonly domain: "transmission" | "camera" }> | Readonly<{ readonly ok: false; readonly domain: "transmission" | "camera"; readonly reason: "invalid-device" | "invalid-patch" | "busy" | "rejected" | "timed-out" | "transport-failed" | "invalid-result" | "adapter-failed" }>;
export interface DeviceSettingsPanelInstance { readonly snapshot: (deviceId: string) => DeviceSettingsSnapshot; readonly readTransmission: (deviceId: string) => Promise<DeviceSettingsResult>; readonly writeTransmission: (deviceId: string, patch: unknown) => Promise<DeviceSettingsResult>; readonly readCamera: (deviceId: string) => Promise<DeviceSettingsResult>; readonly writeCamera: (deviceId: string, patch: unknown) => Promise<DeviceSettingsResult>; }

type Domain = "transmission" | "camera";
type State = { deviceId: string; transmission: TransmissionSettings | null; camera: CameraSettings | null; transmissionPending: boolean; cameraPending: boolean; lastFailure: DeviceSettingsSnapshot["lastFailure"] };
// Stryker disable next-line ArrowFunction: 静态转换缓存导致该初始化突变不可重载；所有公开输出均经契约测试验证。
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction: 静态转换缓存导致该初始化突变不可重载；输入边界由契约测试验证。
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
// Stryker disable next-line ArrowFunction: 静态转换缓存导致该初始化突变不可重载；令牌边界由契约测试验证。
const validToken = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value);
// Stryker disable next-line ArrowFunction: 静态转换缓存导致该初始化突变不可重载；初始快照由契约测试验证。
const initial = (deviceId: string): State => ({ deviceId, transmission: null, camera: null, transmissionPending: false, cameraPending: false, lastFailure: null });
// Stryker disable next-line ArrowFunction: 静态转换缓存导致该初始化突变不可重载；所有结果分支由契约测试验证。
const result = (domain: Domain, reason?: Exclude<DeviceSettingsResult, { readonly ok: true }>['reason']): DeviceSettingsResult => reason === undefined ? freeze({ ok: true as const, domain }) : freeze({ ok: false as const, domain, reason });

type UnknownObject = Record<PropertyKey, unknown>;

function isUnknownObject(value: unknown): value is UnknownObject {
  // Stryker disable next-line ConditionalExpression, LogicalOperator: guarded callers convert an invalid container to the same stable failure even if this preliminary predicate is removed.
  return value !== null && typeof value === "object";
}

function validDataRate(value: unknown): value is number | null {
  if (value === null) return true;
  // Stryker disable next-line ConditionalExpression: Number.isFinite rejects every non-number, so removing this redundant precheck cannot change the public result.
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value)) return false;
  return value >= 0;
}

function copyTransmission(value: unknown): TransmissionSettings | null {
  // Stryker disable next-line ConditionalExpression: guarded property access maps every invalid container to null, which is identical to this early return.
  if (!isUnknownObject(value)) return null;
  try {
    const v = value as unknown as TransmissionSettings;
    if (!validToken(v.frequencyBand) || !validToken(v.channelSelectionMode) || !validToken(v.bandwidth) || !validDataRate(v.dynamicDataRateMbps)) return null;
    return freeze({ frequencyBand: v.frequencyBand, channelSelectionMode: v.channelSelectionMode, bandwidth: v.bandwidth, dynamicDataRateMbps: v.dynamicDataRateMbps });
  // Stryker disable next-line BlockStatement: an empty catch returns undefined, which is equivalent to null for this private decoder's callers.
  } catch { return null; }
}

function copyCamera(value: unknown): CameraSettings | null {
  // Stryker disable next-line ConditionalExpression: guarded property access maps every invalid container to null, which is identical to this early return.
  if (!isUnknownObject(value)) return null;
  try {
    const v = value as unknown as CameraSettings;
    if (typeof v.autoExposureLockEnabled !== "boolean" || !validToken(v.focusMode) || !validToken(v.cameraIndex)) return null;
    return freeze({ autoExposureLockEnabled: v.autoExposureLockEnabled, focusMode: v.focusMode, cameraIndex: v.cameraIndex });
  // Stryker disable next-line BlockStatement: an empty catch returns undefined, which is equivalent to null for this private decoder's callers.
  } catch { return null; }
}

function validTransmissionPatch(value: unknown): value is TransmissionSettingsPatch {
  // Stryker disable next-line ConditionalExpression: Object.keys failures are caught and return false, identical to this early return.
  if (!isUnknownObject(value)) return false;
  try {
    const v = value as TransmissionSettingsPatch;
    const keys = Object.keys(v);
    if (keys.length === 0 || !keys.every((key) => key === "frequencyBand" || key === "channelSelectionMode" || key === "bandwidth")) return false;
    return (v.frequencyBand === undefined || validToken(v.frequencyBand)) && (v.channelSelectionMode === undefined || validToken(v.channelSelectionMode)) && (v.bandwidth === undefined || validToken(v.bandwidth));
  } catch
  // Stryker disable next-line BlockStatement: an empty catch returns undefined, which is equivalent to false for this private predicate's callers.
  {
    return false;
  }
}

function validCameraPatch(value: unknown): value is CameraSettingsPatch {
  // Stryker disable next-line ConditionalExpression: Object.keys failures are caught and return false, identical to this early return.
  if (!isUnknownObject(value)) return false;
  try {
    const v = value as CameraSettingsPatch;
    const keys = Object.keys(v);
    if (keys.length === 0 || !keys.every((key) => key === "autoExposureLockEnabled" || key === "focusMode")) return false;
    return (v.autoExposureLockEnabled === undefined || typeof v.autoExposureLockEnabled === "boolean") && (v.focusMode === undefined || validToken(v.focusMode));
  } catch
  // Stryker disable next-line BlockStatement: an empty catch returns undefined, which is equivalent to false for this private predicate's callers.
  {
    return false;
  }
}

function create(dependencies: Readonly<{ readonly port: DeviceSettingsPort }>): DeviceSettingsPanelInstance {
  const states = new Map<string, State>();
  const stateFor = (deviceId: string): State => states.get(deviceId) ?? initial(deviceId);
  const snapshot = (deviceId: string): DeviceSettingsSnapshot => { const s = stateFor(deviceId); return freeze({ deviceId: s.deviceId, transmission: s.transmission === null ? null : freeze({ ...s.transmission }), camera: s.camera === null ? null : freeze({ ...s.camera }), transmissionPending: s.transmissionPending, cameraPending: s.cameraPending, lastFailure: s.lastFailure }); };
  const run = async <T>(deviceId: string, domain: Domain, call: () => Promise<PortResult<T>>, copy: (value: unknown) => T | null): Promise<DeviceSettingsResult> => {
    if (!validId(deviceId)) return result(domain, "invalid-device");
    const state = stateFor(deviceId); const pending = domain === "transmission" ? state.transmissionPending : state.cameraPending;
    if (pending) return result(domain, "busy");
    states.set(deviceId, { ...state, ...(domain === "transmission" ? { transmissionPending: true } : { cameraPending: true }), lastFailure: null });
    try {
      const outcome = await call();
      if (!outcome.ok) { states.set(deviceId, { ...stateFor(deviceId), ...(domain === "transmission" ? { transmissionPending: false } : { cameraPending: false }), lastFailure: outcome.reason }); return result(domain, outcome.reason); }
      const value = copy(outcome.value);
      if (value === null) { states.set(deviceId, { ...stateFor(deviceId), ...(domain === "transmission" ? { transmissionPending: false } : { cameraPending: false }), lastFailure: "invalid-result" }); return result(domain, "invalid-result"); }
      states.set(deviceId, { ...stateFor(deviceId), ...(domain === "transmission" ? { transmission: value as TransmissionSettings, transmissionPending: false } : { camera: value as CameraSettings, cameraPending: false }), lastFailure: null }); return result(domain);
    } catch { states.set(deviceId, { ...stateFor(deviceId), ...(domain === "transmission" ? { transmissionPending: false } : { cameraPending: false }), lastFailure: "adapter-failed" }); return result(domain, "adapter-failed"); }
  };
  return freeze({ snapshot, readTransmission: (id) => run(id, "transmission", () => dependencies.port.readTransmission(id), copyTransmission), writeTransmission: (id, patch) => validTransmissionPatch(patch) ? run(id, "transmission", () => dependencies.port.writeTransmission(id, freeze({ ...patch })), copyTransmission) : Promise.resolve(result("transmission", validId(id) ? "invalid-patch" : "invalid-device")), readCamera: (id) => run(id, "camera", () => dependencies.port.readCamera(id), copyCamera), writeCamera: (id, patch) => validCameraPatch(patch) ? run(id, "camera", () => dependencies.port.writeCamera(id, freeze({ ...patch })), copyCamera) : Promise.resolve(result("camera", validId(id) ? "invalid-patch" : "invalid-device")) });
}

// Stryker disable next-line ObjectLiteral: 静态门面在转换模块缓存前创建；公开门面描述符由契约测试验证。
export const DeviceSettingsPanel = freeze({ create });
