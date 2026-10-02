import { describe, expect, it } from "vitest";
import { CameraPhotoControl } from "../src/modules/camera-photo-control/index.js";
import { PhotoInbox } from "../src/modules/camera-photo-control/photo-inbox/index.js";

const file = (fileName = "DJI_0001.jpg", bytes = new Uint8Array([1, 2, 3]), sha256 = "a".repeat(64)) => ({
  fileName,
  size: bytes.byteLength,
  sha256,
  bytes,
});

describe("photo-inbox", () => {
  it("按设备收下原图、按文件名和摘要去重，且不泄漏路径", () => {
    const inbox = PhotoInbox.create({ now: () => 1_700_000_000_000 });
    expect(inbox.accept("phone-1", file())).toBe("accepted");
    expect(inbox.accept("phone-1", file())).toBe("duplicate");
    expect(inbox.accept("phone-1", file("DJI_0002.jpg", new Uint8Array([4]), "a".repeat(64)))).toBe("duplicate");
    expect(inbox.accept("phone-2", file())).toBe("accepted");
    expect(inbox.accept("phone-1", file("..\\escape.jpg"))).toBe("rejected");
    expect(JSON.stringify(inbox.list("phone-1"))).not.toMatch(/[\\/]/u);
    expect(inbox.list("phone-1")).toEqual([{ fileName: "DJI_0001.jpg", size: 3, sha256: "a".repeat(64), receivedAtMs: 1_700_000_000_000 }]);
    expect(inbox.list("phone-2")).toHaveLength(1);
    expect(inbox.forget("phone-1")).toBe(true);
    expect(inbox.list("phone-1")).toEqual([]);
  });

  it("登记磁盘上已有的照片时不重写文件", () => {
    const writes: string[] = [];
    const inbox = PhotoInbox.create({
      now: () => 5,
      fs: { writeAtomic: (_deviceId, fileName) => { writes.push(fileName); return true; } },
    });
    expect(inbox.remember("phone-1", { fileName: "DJI_0001.jpg", size: 3, sha256: "a".repeat(64) })).toBe("accepted");
    expect(inbox.remember("phone-1", { fileName: "DJI_0001.jpg", size: 3, sha256: "b".repeat(64) })).toBe("duplicate");
    expect(inbox.accept("phone-1", file())).toBe("duplicate");
    expect(writes).toEqual([]);
    expect(inbox.list("phone-1")).toEqual([{ fileName: "DJI_0001.jpg", size: 3, sha256: "a".repeat(64), receivedAtMs: 5 }]);
    expect(inbox.remember("phone-1", { fileName: "../DJI_0002.jpg", size: 3, sha256: "c".repeat(64) })).toBe("rejected");
  });

  it("磁盘写入失败时不登记清单", () => {
    const inbox = PhotoInbox.create({
      now: () => 1,
      fs: { writeAtomic: () => false },
    });
    expect(inbox.accept("phone-1", file())).toBe("rejected");
    expect(inbox.list("phone-1")).toEqual([]);
  });

  it("回传前先记入电脑上已有的照片，手机只收到缺失清单", async () => {
    const sent: unknown[] = [];
    const control = CameraPhotoControl.create({
      now: () => 9,
      storedPhotos: async () => [{ fileName: "DJI_20260928_0001.jpg", size: 4, sha256: "d".repeat(64) }],
      relay: {
        latestTelemetry: () => ({ payload: { sdkAvailability: "READY", camera: "CONNECTED" } }),
        sendCommand: async (_deviceId, request) => {
          sent.push(request);
          return {
            status: "succeeded",
            result: {
              kind: "object",
              fields: {
                domain: { kind: "string", value: "photo" },
                outcome: { kind: "string", value: "NONE" },
                count: { kind: "number", value: "0" },
              },
            },
          };
        },
      },
    });
    await expect(control.fetch("phone-1")).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_FETCH" });
    expect(sent).toEqual([{
      name: "camera.photo.fetch",
      fields: { knownPhotos: [{ fileName: "DJI_20260928_0001.jpg", sha256: "d".repeat(64) }] },
    }]);
    expect(control.inbox.accept("phone-1", file("DJI_20260928_0001.jpg", new Uint8Array([1, 2, 3, 4]), "d".repeat(64)))).toBe("duplicate");
  });
});
