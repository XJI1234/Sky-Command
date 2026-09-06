import { expect, it } from "vitest";
import { WorkflowSnapshot } from "../src/production/operation-workflow/workflow-snapshot/index.js";

it("将手机端编码帧观察作为图传源事实保留，而不覆盖 LiveStreamStatus", () => {
  const snapshot = WorkflowSnapshot.create({
    devices: [{
      deviceId: "phone-1",
      connectionEpoch: 3,
      telemetry: {
        receivedAtMs: 100,
        payload: {
          liveStreaming: true,
          cameraFrameGeneration: 4,
          cameraFrameState: "RECEIVING",
          cameraFrameCount: 120,
          cameraFrameLastAgeMillis: 8,
          cameraFrameCodec: "H265",
          cameraFrameWidth: 1920,
          cameraFrameHeight: 1080,
          cameraFrameRate: 30,
        },
        capabilities: {},
      },
      assignment: {},
      mission: {},
      stream: {},
      settings: {},
      pendingFlightAction: null,
    }],
    routes: [],
    selectedRouteId: null,
    selectedVideoDeviceId: null,
    revision: 1,
    media: { streams: [] },
    disposed: false,
  });

  expect(snapshot.devices[0]?.connection).toMatchObject({
    live: { streaming: true },
    cameraFrames: {
      generation: 4,
      state: "receiving",
      receivedFrameCount: 120,
      lastFrameAgeMillis: 8,
      codec: "H265",
      width: 1920,
      height: 1080,
      frameRate: 30,
    },
  });
});
