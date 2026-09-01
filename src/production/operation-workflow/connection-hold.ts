/** 连接位滞回：true→false 需连续保持一段时间，避免遥测闪断导致 UI/门闩抖动。 */

export type HeldBool = boolean | undefined;

interface HoldRecord {
  shown: HeldBool;
  candidate: HeldBool;
  sinceMs: number;
}

const DROP_HOLD_MS = 1_500;
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

function asBit(value: unknown): HeldBool {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

export interface ConnectionHoldInstance {
  readonly hold: (deviceId: string, field: string, raw: unknown, nowMs: number) => HeldBool;
  readonly forget: (deviceId: string) => void;
  readonly clear: () => void;
}

export function createConnectionHold(dropHoldMs: number = DROP_HOLD_MS): ConnectionHoldInstance {
  const records = new Map<string, HoldRecord>();
  const keyOf = (deviceId: string, field: string): string => `${deviceId}\u0000${field}`;
  return freeze({
    hold: (deviceId, field, raw, nowMs) => {
      const next = asBit(raw);
      const key = keyOf(deviceId, field);
      const prev = records.get(key);
      if (prev === undefined) {
        records.set(key, { shown: next, candidate: next, sinceMs: nowMs });
        return next;
      }
      if (next === prev.shown) {
        records.set(key, { shown: next, candidate: next, sinceMs: nowMs });
        return next;
      }
      // unknown 立即显示，不掩盖缺测。
      if (next === undefined) {
        records.set(key, { shown: undefined, candidate: undefined, sinceMs: nowMs });
        return undefined;
      }
      // 任意已知状态恢复为 true：立即显示，避免操作被拖慢。
      if (next === true) {
        records.set(key, { shown: true, candidate: true, sinceMs: nowMs });
        return true;
      }
      // 此处 next 已知为 false；unknown→false 立即采纳。
      if (prev.shown === undefined) {
        records.set(key, { shown: false, candidate: false, sinceMs: nowMs });
        return false;
      }
      // 到这里必为 true→false，应用滞回。
      if (prev.candidate !== false) {
        records.set(key, { shown: true, candidate: false, sinceMs: nowMs });
        return true;
      }
      if (nowMs - prev.sinceMs < dropHoldMs) return true;
      records.set(key, { shown: false, candidate: false, sinceMs: nowMs });
      return false;
    },
    forget: (deviceId) => {
      for (const key of [...records.keys()]) if (key.startsWith(`${deviceId}\u0000`)) records.delete(key);
    },
    clear: () => { records.clear(); },
  });
}
