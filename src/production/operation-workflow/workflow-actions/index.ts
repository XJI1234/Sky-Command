type RecordValue = Record<string, unknown>;

export type WorkflowActionResult = Readonly<{ readonly ok: true; readonly value?: unknown }>
  | Readonly<{ readonly ok: false; readonly code: string }>;

export interface WorkflowActionsDependencies {
  readonly online: (deviceId: string) => boolean;
  readonly assignedRoute: (deviceId: string) => string | null;
  readonly missionControl: RecordValue;
  readonly liveStreamControl: RecordValue;
  readonly deviceSettings: RecordValue;
  readonly flightControl: RecordValue;
  readonly settingsAllowed: (deviceId: string, operation: "transmission-settings" | "camera-settings") => boolean;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const success = (value?: unknown): WorkflowActionResult => freeze({ ok: true as const, ...(value === undefined ? {} : { value }) });
const failure = (code: string): WorkflowActionResult => freeze({ ok: false as const, code });
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" ? value as RecordValue : null;
const read = (value: unknown, key: string): unknown => { try { return record(value)?.[key]; } catch { return undefined; } };

const invoke = async (target: unknown, method: string, ...args: unknown[]): Promise<WorkflowActionResult> => {
  const operation = read(target, method);
  if (typeof operation !== "function") return failure("DEPENDENCY_FAILURE");
  try { return success(await operation(...args)); } catch { return failure("DEPENDENCY_FAILURE"); }
};

const invokeSync = (target: unknown, method: string, ...args: unknown[]): WorkflowActionResult => {
  const operation = read(target, method);
  if (typeof operation !== "function") return failure("DEPENDENCY_FAILURE");
  try { return success(operation(...args)); } catch { return failure("DEPENDENCY_FAILURE"); }
};

const create = (dependencies: WorkflowActionsDependencies) => {
  const validateOnline = (deviceId: unknown): WorkflowActionResult | null => {
    if (!validId(deviceId)) return failure("INVALID_INPUT");
    try { return dependencies.online(deviceId) ? null : failure("DEVICE_OFFLINE"); } catch { return failure("DEVICE_OFFLINE"); }
  };
  const mission = async (operation: "upload" | "start" | "pause" | "resume" | "stop", deviceId: string): Promise<WorkflowActionResult> => {
    const invalid = validateOnline(deviceId);
    return invalid ?? invoke(dependencies.missionControl, operation, deviceId);
  };
  const settings = async (operation: "transmission-settings" | "camera-settings", method: string, deviceId: string, patch?: unknown): Promise<WorkflowActionResult> => {
    const invalid = validateOnline(deviceId);
    if (invalid !== null) return invalid;
    try { if (!dependencies.settingsAllowed(deviceId, operation)) return failure("CAPABILITY_BLOCKED"); } catch { return failure("CAPABILITY_BLOCKED"); }
    return patch === undefined ? invoke(dependencies.deviceSettings, method, deviceId) : invoke(dependencies.deviceSettings, method, deviceId, patch);
  };
  return freeze({
    stage: async (deviceId: string): Promise<WorkflowActionResult> => {
      const invalid = validateOnline(deviceId);
      if (invalid !== null) return invalid;
      let routeId: string | null;
      try { routeId = dependencies.assignedRoute(deviceId); } catch { return failure("ROUTE_NOT_ASSIGNED"); }
      return validId(routeId) ? invoke(dependencies.missionControl, "stage", deviceId, routeId) : failure("ROUTE_NOT_ASSIGNED");
    },
    mission,
    startStream: async (deviceId: string): Promise<WorkflowActionResult> => {
      const invalid = validateOnline(deviceId);
      return invalid ?? invoke(dependencies.liveStreamControl, "start", deviceId);
    },
    stopStream: async (deviceId: string): Promise<WorkflowActionResult> => {
      const invalid = validateOnline(deviceId);
      return invalid ?? invoke(dependencies.liveStreamControl, "stop", deviceId);
    },
    readTransmission: (deviceId: string) => settings("transmission-settings", "readTransmission", deviceId),
    writeTransmission: (deviceId: string, patch: unknown) => settings("transmission-settings", "writeTransmission", deviceId, patch),
    readCamera: (deviceId: string) => settings("camera-settings", "readCamera", deviceId),
    writeCamera: (deviceId: string, patch: unknown) => settings("camera-settings", "writeCamera", deviceId, patch),
    requestFlight: (deviceId: string, action: string): WorkflowActionResult => {
      const invalid = validateOnline(deviceId);
      return invalid ?? invokeSync(dependencies.flightControl, "request", deviceId, action);
    },
    confirmFlight: async (deviceId: string, confirmationId: string): Promise<WorkflowActionResult> => {
      const invalid = validateOnline(deviceId);
      if (invalid !== null) return invalid;
      if (!validId(confirmationId)) return failure("INVALID_INPUT");
      return invoke(dependencies.flightControl, "confirm", deviceId, confirmationId);
    },
    cancelFlight: (deviceId: string, confirmationId: string): WorkflowActionResult => {
      if (!validId(deviceId) || !validId(confirmationId)) return failure("INVALID_INPUT");
      return invokeSync(dependencies.flightControl, "cancel", deviceId, confirmationId);
    },
  });
};

export const WorkflowActions = freeze({ create });
