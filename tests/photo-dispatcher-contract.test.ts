import { describe, expect, it } from "vitest";
import { PhotoDispatcher } from "../src/modules/camera-photo-control/photo-dispatcher/index.js";

const ready = () => ({ payload: { sdkAvailability: "READY", camera: "CONNECTED" } });
const captured = (fileName = "DJI_0001.jpg", index = 1) => ({
  status: "succeeded",
  result: {
    kind: "object",
    fields: {
      domain: { kind: "string", value: "photo" },
      outcome: { kind: "string", value: "CAPTURED" },
      fileName: { kind: "string", value: fileName },
      index: { kind: "number", value: String(index) },
    },
  },
});
const succeeded = () => ({ status: "succeeded", result: { kind: "object", fields: { domain: { kind: "string", value: "photo" }, outcome: { kind: "string", value: "DELIVERED" } } } });

describe("photo-dispatcher", () => {
  it("只发送空字段命令，记下拍照身份，并在 fetch 等到收件箱确认后才成功", async () => {
    const sent: unknown[] = [];
    let releaseFetch: (() => void) | undefined;
    const dispatcher = PhotoDispatcher.create({
      relay: {
        latestTelemetry: () => ready(),
        sendCommand: async (_deviceId, request) => {
          sent.push(request);
          if (request.name === "camera.photo.fetch") await new Promise<void>((resolve) => { releaseFetch = resolve; });
          return request.name === "camera.photo.capture" ? captured() : succeeded();
        },
      },
    });

    await expect(dispatcher.fetch("phone-1")).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_FETCH" });
    await expect(dispatcher.capture("phone-1")).resolves.toMatchObject({ ok: true, code: "CAPTURED", fileName: "DJI_0001.jpg" });
    expect(sent).toEqual([{ name: "camera.photo.capture", fields: {} }]);
    expect(Object.isFrozen(sent[0])).toBe(true);
    expect(Object.keys((sent[0] as { fields: object }).fields)).toEqual([]);

    const fetching = dispatcher.fetch("phone-1");
    for (let step = 0; step < 10 && releaseFetch === undefined; step += 1) await Promise.resolve();
    await expect(dispatcher.capture("phone-1")).resolves.toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    expect(dispatcher.get("phone-1").phase).toBe("fetching");
    expect(dispatcher.recordStored("phone-1", "DJI_0001.jpg", "a".repeat(64))).toMatchObject({ phase: "stored", code: "SUCCEEDED" });
    releaseFetch?.();
    await expect(fetching).resolves.toMatchObject({ ok: true, code: "SUCCEEDED", fileName: "DJI_0001.jpg" });
    expect(sent[1]).toEqual({ name: "camera.photo.fetch", fields: {} });
  });

  it("fetch 命令成功但收件箱一直不确认时到期失败，不得永远等待", async () => {
    let fire: (() => void) | undefined;
    const dispatcher = PhotoDispatcher.create({
      relay: {
        latestTelemetry: () => ready(),
        sendCommand: async (_deviceId, request) => request.name === "camera.photo.capture" ? captured() : succeeded(),
      },
      clock: {
        setTimeout: (callback) => { fire = callback; return 1; },
        clearTimeout: () => undefined,
      },
    });
    await expect(dispatcher.capture("phone-1")).resolves.toMatchObject({ ok: true, code: "CAPTURED" });
    const fetching = dispatcher.fetch("phone-1");
    for (let step = 0; step < 10 && fire === undefined; step += 1) await Promise.resolve();
    expect(fire).toBeTypeOf("function");
    fire?.();
    await expect(fetching).resolves.toMatchObject({ ok: false, code: "TRANSFER_FAILED", fileName: "DJI_0001.jpg" });
  }, 1_000);

  it("默认 clock 也会在收件箱确认截止后结束 fetch", async () => {
    const dispatcher = PhotoDispatcher.create({
      relay: {
        latestTelemetry: () => ready(),
        sendCommand: async (_deviceId, request) => request.name === "camera.photo.capture" ? captured() : succeeded(),
      },
      storedTimeoutMs: 1,
    });
    await expect(dispatcher.capture("phone-1")).resolves.toMatchObject({ ok: true, code: "CAPTURED" });
    await expect(dispatcher.fetch("phone-1")).resolves.toMatchObject({ ok: false, code: "TRANSFER_FAILED" });
  });

  it("把手机 ACTION_REJECTED 的 DJI 错误码原样带回", async () => {
    const dispatcher = PhotoDispatcher.create({
      relay: {
        latestTelemetry: () => ready(),
        sendCommand: async () => ({
          status: "rejected",
          result: {
            kind: "object",
            fields: {
              domain: { kind: "string", value: "photo" },
              outcome: { kind: "string", value: "ACTION_REJECTED" },
              errorCode: { kind: "string", value: "CANNOT_START_TASK_ON_WEAK_GPS" },
              errorDescription: { kind: "string", value: "errorType=CORE; inner=CAMERA.StartShootPhoto:-472" },
            },
          },
        }),
      },
    });
    await expect(dispatcher.capture("phone-1")).resolves.toMatchObject({
      ok: false,
      code: "PHOTO_ACTION_REJECTED",
      platformError: {
        code: "CANNOT_START_TASK_ON_WEAK_GPS",
        description: "errorType=CORE; inner=CAMERA.StartShootPhoto:-472",
      },
    });
  });

  it("主相机未连接时本地拒绝，且不同设备互不阻塞", async () => {
    const sent: string[] = [];
    const dispatcher = PhotoDispatcher.create({
      relay: {
        latestTelemetry: (deviceId) => deviceId === "phone-offline"
          ? { payload: { sdkAvailability: "READY", camera: "DISCONNECTED" } }
          : ready(),
        sendCommand: async (deviceId, request) => {
          sent.push(`${deviceId}:${request.name}`);
          return captured(`${deviceId}.jpg`, 2);
        },
      },
    });
    await expect(dispatcher.capture("phone-offline")).resolves.toMatchObject({ ok: false, code: "CAMERA_OFFLINE" });
    const first = dispatcher.capture("phone-a");
    const second = dispatcher.capture("phone-b");
    await expect(first).resolves.toMatchObject({ ok: true, fileName: "phone-a.jpg" });
    await expect(second).resolves.toMatchObject({ ok: true, fileName: "phone-b.jpg" });
    expect(sent).toEqual(["phone-a:camera.photo.capture", "phone-b:camera.photo.capture"]);
  });
});
