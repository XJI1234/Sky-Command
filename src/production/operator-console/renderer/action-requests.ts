export type ActionReservation =
  | Readonly<{ readonly ok: true; readonly release: () => void }>
  | Readonly<{ readonly ok: false; readonly reason: string }>;

const cameraActions = new Set(["stream-start", "stream-stop", "photo-capture", "photo-fetch"]);
const missionActions = new Set(["mission-stage", "mission-upload", "mission-start", "mission-pause", "mission-resume", "mission-stop"]);

/** Tracks outstanding clicks, without queuing commands or changing device facts. */
export function createActionRequests() {
  const devices = new Map<string, Map<string, symbol>>();
  const pending = (deviceId: string | null, action: string): boolean => deviceId !== null && devices.get(deviceId)?.has(action) === true;
  const reason = (deviceId: string | null, action: string): string | null => {
    if (deviceId === null) return null;
    const active = devices.get(deviceId);
    if (active === undefined) return null;
    if (active.has(action)) return "这条命令正在处理，请稍候";
    // A stop remains available while another camera request is awaiting its reply.
    if (cameraActions.has(action) && action !== "stream-stop" && [...active.keys()].some(key => cameraActions.has(key))) {
      return "相机操作正在处理，完成后再执行此操作";
    }
    // Pause and stop must not wait for a long upload or start request.
    if (missionActions.has(action) && action !== "mission-pause" && action !== "mission-stop" && [...active.keys()].some(key => missionActions.has(key))) {
      return "航线命令正在处理，完成后再执行此操作";
    }
    return null;
  };
  const reserve = (deviceId: string | null, action: string): ActionReservation => {
    const blocked = reason(deviceId, action);
    if (blocked !== null) return Object.freeze({ ok: false as const, reason: blocked });
    if (deviceId === null) return Object.freeze({ ok: true as const, release: () => undefined });
    const active = devices.get(deviceId) ?? new Map<string, symbol>();
    const token = Symbol(action);
    active.set(action, token);
    devices.set(deviceId, active);
    return Object.freeze({ ok: true as const, release: () => {
      if (active.get(action) !== token) return;
      active.delete(action);
      if (active.size === 0 && devices.get(deviceId) === active) devices.delete(deviceId);
    } });
  };
  return Object.freeze({ pending, reason, reserve });
}
