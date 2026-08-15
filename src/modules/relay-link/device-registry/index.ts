export interface DeviceRegistration {
  readonly connectionId: string;
  readonly deviceId: string;
  readonly sessionId: string;
}

export interface DeviceSnapshot extends DeviceRegistration {}
export interface DeviceRegistrySnapshot { readonly devices: readonly DeviceSnapshot[]; }
export type RegistryErrorCode = "INVALID_DEVICE" | "DUPLICATE_DEVICE" | "DEVICE_NOT_FOUND";
export interface RegistryError { readonly code: RegistryErrorCode; readonly message: string; }
export type RegistryResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: RegistryError }>;
export interface DeviceRegistryInstance {
  snapshot(): DeviceRegistrySnapshot;
  register(input: DeviceRegistration): RegistryResult<DeviceSnapshot>;
  removeByConnection(connectionId: string): RegistryResult<DeviceRegistrySnapshot>;
  removeByDevice(deviceId: string): RegistryResult<DeviceRegistrySnapshot>;
  getByConnection(connectionId: string): DeviceSnapshot | null;
  getByDevice(deviceId: string): DeviceSnapshot | null;
  subscribe(listener: (snapshot: DeviceRegistrySnapshot) => void): () => void;
}

const error = (code: RegistryErrorCode, message: string): RegistryError => Object.freeze({ code, message });
const accepted = <T>(value: T): RegistryResult<T> => Object.freeze({ ok: true as const, value });
const rejected = <T = never>(code: RegistryErrorCode, message: string): RegistryResult<T> => Object.freeze({ ok: false as const, error: error(code, message) });

function validId(value: string): boolean {
  return value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
}

function readRegistration(input: unknown): readonly [unknown, unknown, unknown] | null {
  try {
    const candidate = input as Record<string, unknown>;
    return Object.freeze([candidate.connectionId, candidate.deviceId, candidate.sessionId]);
  } catch { return null; }
}

function create(): DeviceRegistryInstance {
  let current: DeviceRegistrySnapshot = Object.freeze({ devices: Object.freeze([]) });
  const listeners = new Set<(snapshot: DeviceRegistrySnapshot) => void>();

  const notify = (snapshot: DeviceRegistrySnapshot): void => {
    for (const listener of [...listeners]) {
      try { listener(snapshot); } catch { /* listener isolation is part of the interface */ }
    }
  };
  const commit = (devices: readonly DeviceSnapshot[]): DeviceRegistrySnapshot => {
    current = Object.freeze({ devices: Object.freeze([...devices]) });
    notify(current);
    return current;
  };
  const readIdentity = (input: unknown): RegistryResult<DeviceRegistration> => {
    const fields = readRegistration(input);
    if (fields === null) return rejected("INVALID_DEVICE", "Device registration is invalid");
    const [connectionId, deviceId, sessionId] = fields;
    if (typeof connectionId !== "string" || typeof deviceId !== "string" || typeof sessionId !== "string") return rejected("INVALID_DEVICE", "Device registration is invalid");
    if (!validId(connectionId) || !validId(deviceId) || !validId(sessionId)) return rejected("INVALID_DEVICE", "Device registration is invalid");
    return accepted(Object.freeze({ connectionId, deviceId, sessionId }));
  };
  const find = (key: keyof DeviceRegistration, value: string): DeviceSnapshot | null => current.devices.find((device) => device[key] === value) ?? null;

  const register = (input: DeviceRegistration): RegistryResult<DeviceSnapshot> => {
    const checked = readIdentity(input);
    if (!checked.ok) return checked;
    if (find("connectionId", checked.value.connectionId) || find("deviceId", checked.value.deviceId)) return rejected("DUPLICATE_DEVICE", "Device identity is already registered");
    const device = Object.freeze({ ...checked.value });
    commit([...current.devices, device]);
    return accepted(device);
  };
  const remove = (key: keyof DeviceRegistration, value: string): RegistryResult<DeviceRegistrySnapshot> => {
    const index = current.devices.findIndex((device) => device[key] === value);
    if (index < 0) return rejected("DEVICE_NOT_FOUND", "Device is not registered");
    return accepted(commit([...current.devices.slice(0, index), ...current.devices.slice(index + 1)]));
  };

  return Object.freeze({
    snapshot: () => current,
    register,
    removeByConnection: (connectionId: string) => remove("connectionId", connectionId),
    removeByDevice: (deviceId: string) => remove("deviceId", deviceId),
    getByConnection: (connectionId: string) => validId(connectionId) ? find("connectionId", connectionId) : null,
    getByDevice: (deviceId: string) => validId(deviceId) ? find("deviceId", deviceId) : null,
    subscribe: (listener: (snapshot: DeviceRegistrySnapshot) => void): (() => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  });
}

export const DeviceRegistry = Object.freeze({ create });
