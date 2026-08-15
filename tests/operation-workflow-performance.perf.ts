import { expect, it } from "vitest";
import { OperationWorkflow } from "../src/production/operation-workflow/index.js";

it("在大量独立设备下保持线性快照与分配开销", () => {
  const devices = Array.from({ length: 1_000 }, (_, index) => ({ deviceId: `device-${index}` }));
  const workflow = OperationWorkflow.create({
    relayOperations: { devices: () => devices, telemetry: () => null, subscribe: () => () => undefined },
    routeLibrary: { list: () => [{ routeId: "route", classification: "upload-candidate" }], importFile: async () => ({ status: "cancelled" }), getPreview: () => ({ ok: false }), remove: () => ({ ok: false }), select: () => ({ ok: false }), get: () => ({ ok: false }), getMissionPayload: () => ({ ok: false }), getSelected: () => null, clear: () => undefined },
    missionControl: { stage: async () => ({ ok: false }), upload: async () => ({ ok: false }), start: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: (deviceId: string) => ({ deviceId, phase: "idle" }), list: () => [], forget: () => false, subscribe: () => () => undefined, dispose: () => undefined },
    liveStreamControl: { start: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined },
    mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => ({ ok: true }), selectPlayer: () => ({ ok: true }), clearPlayer: () => ({ ok: true }) },
    flightControl: { request: () => ({ ok: false }), confirm: async () => ({ ok: false }), cancel: () => ({ ok: false }), get: () => null, subscribe: () => () => undefined, dispose: () => undefined },
    deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({}), writeTransmission: async () => ({}), readCamera: async () => ({}), writeCamera: async () => ({}) }, now: () => 1,
  });
  for (const device of devices) expect(workflow.assignRoute(device.deviceId, "route")).toMatchObject({ ok: true });
  const snapshot = workflow.snapshot();
  expect(snapshot.devices).toHaveLength(1_000);
  expect(snapshot.devices[0]).toMatchObject({ deviceId: "device-0", assignment: { routeId: "route" } });
});
