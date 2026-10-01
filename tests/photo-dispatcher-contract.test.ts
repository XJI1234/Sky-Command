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
const none = () => ({
  status: "succeeded",
  result: {
    kind: "object",
      fields: {
        domain: { kind: "string", value: "photo" },
        outcome: { kind: "string", value: "NONE" },
        count: { kind: "number", value: "0" },
    },
  },
});
const delivered = (fileName = "DJI_0001.jpg", sha256 = "a".repeat(64), count = 1) => ({
  status: "succeeded",
  result: {
    kind: "object",
    fields: {
      domain: { kind: "string", value: "photo" },
      outcome: { kind: "string", value: "DELIVERED" },
      fileName: { kind: "string", value: fileName },
      size: { kind: "number", value: "3" },
      sha256: { kind: "string", value: sha256 },
      count: { kind: "number", value: String(count) },
    },
  },
});

describe("photo-dispatcher", () => {
  it("把当前电脑清单带给 fetch，并在最终命令结果前等待收件箱确认", async () => {
    const sent: unknown[] = [];
    let releaseFetch: (() => void) | undefined;
    const dispatcher = PhotoDispatcher.create({
      knownPhotos: () => [{ fileName: "DJI_0000.jpg", sha256: "0".repeat(64) }],
      relay: {
        latestTelemetry: () => ready(),
        sendCommand: async (_deviceId, request) => {
          sent.push(request);
          if (request.name === "camera.photo.fetch" && sent.filter((item) => (item as { name?: string }).name === "camera.photo.fetch").length === 1) return none();
          if (request.name === "camera.photo.fetch") await new Promise<void>((resolve) => { releaseFetch = resolve; });
          return request.name === "camera.photo.capture" ? captured() : delivered();
        },
      },
    });

    await expect(dispatcher.fetch("phone-1")).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_FETCH" });
    await expect(dispatcher.capture("phone-1")).resolves.toMatchObject({ ok: true, code: "CAPTURED", fileName: "DJI_0001.jpg" });
    expect(sent).toEqual([
      { name: "camera.photo.fetch", fields: { knownPhotos: [{ fileName: "DJI_0000.jpg", sha256: "0".repeat(64) }] } },
      { name: "camera.photo.capture", fields: {} },
    ]);
    expect(Object.isFrozen(sent[0])).toBe(true);
    expect(Object.keys((sent[0] as { fields: object }).fields)).toEqual(["knownPhotos"]);

    const fetching = dispatcher.fetch("phone-1");
    for (let step = 0; step < 10 && releaseFetch === undefined; step += 1) await Promise.resolve();
    await expect(dispatcher.capture("phone-1")).resolves.toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    expect(dispatcher.get("phone-1").phase).toBe("fetching");
    expect(dispatcher.recordStored("phone-1", "DJI_0001.jpg", "a".repeat(64))).toMatchObject({ phase: "fetching", code: null });
    releaseFetch?.();
    await expect(fetching).resolves.toMatchObject({ ok: true, code: "SUCCEEDED", fileName: "DJI_0001.jpg", count: 1 });
    expect(dispatcher.get("phone-1")).toMatchObject({ phase: "stored", code: "SUCCEEDED" });
    expect(sent[2]).toEqual({ name: "camera.photo.fetch", fields: { knownPhotos: [{ fileName: "DJI_0000.jpg", sha256: "0".repeat(64) }] } });
  });

  it("fetch 命令成功但收件箱一直不确认时到期失败，不得永远等待", async () => {
    let fire: (() => void) | undefined;
    const dispatcher = PhotoDispatcher.create({
      relay: {
        latestTelemetry: () => ready(),
        sendCommand: async (_deviceId, request) => request.name === "camera.photo.capture" ? captured() : delivered("DJI_0001.jpg", "a".repeat(64), 3),
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
        sendCommand: async (_deviceId, request) => request.name === "camera.photo.capture" ? captured() : delivered("DJI_0001.jpg", "a".repeat(64), 1),
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

  it("同名但摘要不一致的收件箱文件不能完成 fetch", async () => {
    let fire: (() => void) | undefined;
    const dispatcher = PhotoDispatcher.create({
      relay: {
        latestTelemetry: () => ready(),
        sendCommand: async (_deviceId, request) => request.name === "camera.photo.capture" ? captured() : delivered(),
      },
      clock: {
        setTimeout: (callback) => { fire = callback; return 1; },
        clearTimeout: () => undefined,
      },
    });

    await expect(dispatcher.capture("phone-1")).resolves.toMatchObject({ ok: true, code: "CAPTURED" });
    const fetching = dispatcher.fetch("phone-1");
    for (let step = 0; step < 10 && fire === undefined; step += 1) await Promise.resolve();
    dispatcher.recordStored("phone-1", "DJI_0001.jpg", "b".repeat(64));
    fire?.();

    await expect(fetching).resolves.toMatchObject({ ok: false, code: "TRANSFER_FAILED", fileName: "DJI_0001.jpg" });
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
