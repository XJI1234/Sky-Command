import type { DeviceSettingsPort, FlightControlPort, LiveStreamControlPort, MissionControlPort } from "../ports.js";

export type WorkflowActionResult = Readonly<{ readonly ok: true; readonly value?: unknown }>
  | Readonly<{ readonly ok: false; readonly code: string }>;

export interface WorkflowActionsDependencies {
  readonly online: (deviceId: string) => boolean;
  readonly assignedRoute: (deviceId: string) => string | null;
  readonly missionControl: MissionControlPort;
  readonly liveStreamControl: LiveStreamControlPort;
  readonly deviceSettings: DeviceSettingsPort;
  readonly flightControl: FlightControlPort;
  readonly settingsAllowed: (deviceId: string, operation: "transmission-settings" | "camera-settings") => boolean;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const success = (value?: unknown): WorkflowActionResult => freeze({ ok: true as const, ...(value === undefined ? {} : { value }) });
const failure = (code: string): WorkflowActionResult => freeze({ ok: false as const, code });
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
type MissionOperation = "upload" | "start" | "pause" | "resume" | "stop";
type SettingsMethod = "readTransmission" | "writeTransmission" | "readCamera" | "writeCamera";

const create = (dependencies: WorkflowActionsDependencies) => {
  const validateOnline = (deviceId: unknown): WorkflowActionResult | null => {
    if (!validId(deviceId)) return failure("INVALID_INPUT");
    try { return dependencies.online(deviceId) ? null : failure("DEVICE_OFFLINE"); } catch { return failure("DEVICE_OFFLINE"); }
  };
  const mission = async (operation: MissionOperation, deviceId: string): Promise<WorkflowActionResult> => {
    const invalid = validateOnline(deviceId);
    if (invalid !== null) return invalid;
    try {
      switch (operation) {
        case "upload": return success(await dependencies.missionControl.upload(deviceId));
        case "start": return success(await dependencies.missionControl.start(deviceId));
        case "pause": return success(await dependencies.missionControl.pause(deviceId));
        case "resume": return success(await dependencies.missionControl.resume(deviceId));
        case "stop": return success(await dependencies.missionControl.stop(deviceId));
      }
    } catch { return failure("DEPENDENCY_FAILURE"); }
  };
  const settings = async (operation: "transmission-settings" | "camera-settings", method: SettingsMethod, deviceId: string, patch?: unknown): Promise<WorkflowActionResult> => {
    const invalid = validateOnline(deviceId);
    if (invalid !== null) return invalid;
    try { if (!dependencies.settingsAllowed(deviceId, operation)) return failure("CAPABILITY_BLOCKED"); } catch { return failure("CAPABILITY_BLOCKED"); }
    try {
      switch (method) {
        case "readTransmission": return success(await dependencies.deviceSettings.readTransmission(deviceId));
        case "writeTransmission": {
          const writeTransmission = dependencies.deviceSettings.writeTransmission;
          return success(await Reflect.apply(writeTransmission, undefined, patch === undefined ? [deviceId] : [deviceId, patch]));
        }
        case "readCamera": return success(await dependencies.deviceSettings.readCamera(deviceId));
        case "writeCamera": {
          const writeCamera = dependencies.deviceSettings.writeCamera;
          return success(await Reflect.apply(writeCamera, undefined, patch === undefined ? [deviceId] : [deviceId, patch]));
        }
      }
    } catch { return failure("DEPENDENCY_FAILURE"); }
  };
  return freeze({
    stage: async (deviceId: string): Promise<WorkflowActionResult> => {
      const invalid = validateOnline(deviceId);
      if (invalid !== null) return invalid;
      let routeId: string | null;
      try { routeId = dependencies.assignedRoute(deviceId); } catch { return failure("ROUTE_NOT_ASSIGNED"); }
      if (!validId(routeId)) return failure("ROUTE_NOT_ASSIGNED");
      try { return success(await dependencies.missionControl.stage(deviceId, routeId)); } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    mission,
    startStream: async (deviceId: string): Promise<WorkflowActionResult> => {
      const invalid = validateOnline(deviceId);
      if (invalid !== null) return invalid;
      try { return success(await dependencies.liveStreamControl.start(deviceId)); } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    stopStream: async (deviceId: string): Promise<WorkflowActionResult> => {
      const invalid = validateOnline(deviceId);
      if (invalid !== null) return invalid;
      try { return success(await dependencies.liveStreamControl.stop(deviceId)); } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    readTransmission: (deviceId: string) => settings("transmission-settings", "readTransmission", deviceId),
    writeTransmission: (deviceId: string, patch: unknown) => settings("transmission-settings", "writeTransmission", deviceId, patch),
    readCamera: (deviceId: string) => settings("camera-settings", "readCamera", deviceId),
    writeCamera: (deviceId: string, patch: unknown) => settings("camera-settings", "writeCamera", deviceId, patch),
    requestFlight: (deviceId: string, action: string): WorkflowActionResult => {
      const invalid = validateOnline(deviceId);
      if (invalid !== null) return invalid;
      try { return success(dependencies.flightControl.request(deviceId, action as Parameters<FlightControlPort["request"]>[1])); } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    confirmFlight: async (deviceId: string, confirmationId: string): Promise<WorkflowActionResult> => {
      const invalid = validateOnline(deviceId);
      if (invalid !== null) return invalid;
      if (!validId(confirmationId)) return failure("INVALID_INPUT");
      try { return success(await dependencies.flightControl.confirm(deviceId, confirmationId)); } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    cancelFlight: (deviceId: string, confirmationId: string): WorkflowActionResult => {
      if (!validId(deviceId) || !validId(confirmationId)) return failure("INVALID_INPUT");
      try { return success(dependencies.flightControl.cancel(deviceId, confirmationId)); } catch { return failure("DEPENDENCY_FAILURE"); }
    },
  });
};

export const WorkflowActions = freeze({ create });
