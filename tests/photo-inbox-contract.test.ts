import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  it("外部删除部分或全部照片后重新回传，保留文件仍去重且其它设备不受影响", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sky-photo-refetch-"));
    const first = file();
    const second = file("DJI_0002.jpg", new Uint8Array([4, 5, 6]), "b".repeat(64));
    const originals = [first, second].map((photo) => ({ ...photo, sha256: createHash("sha256").update(photo.bytes).digest("hex") }));
    const downloaded: string[] = [];
    const writes: string[] = [];
    const control = CameraPhotoControl.create({
      now: () => 10,
      fs: { writeAtomic: async (_deviceId, fileName, bytes) => {
        writes.push(fileName);
        await writeFile(join(directory, fileName), bytes);
        return true;
      } },
      storedPhotos: async () => Promise.all((await readdir(directory)).map(async (fileName) => {
        const bytes = await readFile(join(directory, fileName));
        return { fileName, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      })),
      relay: {
        latestTelemetry: () => ({ payload: { sdkAvailability: "READY", camera: "CONNECTED" } }),
        sendCommand: async (deviceId, request) => {
          const known = "knownPhotos" in request.fields ? request.fields.knownPhotos : [];
          const missing = originals.filter((photo) => !known.some((entry) => entry.fileName === photo.fileName && entry.sha256 === photo.sha256));
          for (const photo of missing) {
            downloaded.push(photo.fileName);
            expect(await control.inbox.accept(deviceId, photo)).toBe("accepted");
            control.recordStored(deviceId, photo.fileName, photo.sha256);
          }
          const last = missing.at(-1);
          return { status: "succeeded", result: { kind: "object", fields: {
            domain: { kind: "string", value: "photo" },
            outcome: { kind: "string", value: last ? "DELIVERED" : "NONE" },
            ...(last ? { fileName: { kind: "string", value: last.fileName }, sha256: { kind: "string", value: last.sha256 } } : {}),
            count: { kind: "number", value: String(missing.length) },
          } } };
        },
      },
    });
    try {
      control.inbox.remember("phone-2", { fileName: first.fileName, size: first.size, sha256: first.sha256 });
      await expect(control.fetch("phone-1")).resolves.toMatchObject({ ok: true, count: 2 });
      downloaded.length = 0;
      writes.length = 0;
      await unlink(join(directory, first.fileName));
      await expect(control.fetch("phone-1")).resolves.toMatchObject({ ok: true, count: 1 });
      expect(downloaded).toEqual([first.fileName]);
      expect(writes).toEqual([first.fileName]);
      await unlink(join(directory, first.fileName));
      await unlink(join(directory, second.fileName));
      await expect(control.fetch("phone-1")).resolves.toMatchObject({ ok: true, count: 2 });
      expect(await readdir(directory)).toEqual(originals.map((photo) => photo.fileName));
      await expect(control.fetch("phone-1")).resolves.toMatchObject({ code: "NOTHING_TO_FETCH" });
      expect(control.list("phone-2")).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("磁盘清单读取失败时不发送过期去重记录，并保留原有收件箱", async () => {
    const sent: unknown[] = [];
    const control = CameraPhotoControl.create({
      now: () => 10,
      storedPhotos: async () => { throw new Error("directory unavailable"); },
      relay: {
        latestTelemetry: () => ({ payload: { sdkAvailability: "READY", camera: "CONNECTED" } }),
        sendCommand: async (_deviceId, request) => { sent.push(request); return { status: "succeeded" }; },
      },
    });
    control.inbox.remember("phone-1", file());
    await expect(control.fetch("phone-1")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(sent).toEqual([]);
    expect(control.list("phone-1")).toHaveLength(1);
  });

  it("异步保存时重连重复交付复用同一写入，同名不同摘要不得覆盖", async () => {
    let writes = 0;
    let finish: (stored: boolean) => void = () => undefined;
    const inbox = PhotoInbox.create({ now: () => 1, fs: {
      writeAtomic: () => { writes++; return new Promise<boolean>((resolve) => { finish = resolve; }); },
    } });
    const first = inbox.accept("phone-1", file());
    const duplicate = inbox.accept("phone-1", file());
    expect(inbox.accept("phone-1", file("DJI_0001.jpg", new Uint8Array([4]), "b".repeat(64)))).toBe("rejected");
    expect(writes).toBe(1);
    finish(true);
    await expect(first).resolves.toBe("accepted");
    await expect(duplicate).resolves.toBe("duplicate");
    expect(inbox.list("phone-1")).toHaveLength(1);
  });

  it("异步落盘完成前不登记照片，失败后仍允许重试", async () => {
    let finish: (stored: boolean) => void = () => undefined;
    const inbox = PhotoInbox.create({ now: () => 1, fs: {
      writeAtomic: () => new Promise<boolean>((resolve) => { finish = resolve; }),
    } });
    const failed = inbox.accept("phone-1", file());
    expect(inbox.list("phone-1")).toEqual([]);
    finish(false);
    await expect(failed).resolves.toBe("rejected");
    expect(inbox.list("phone-1")).toEqual([]);
    const stored = inbox.accept("phone-1", file());
    expect(inbox.list("phone-1")).toEqual([]);
    finish(true);
    await expect(stored).resolves.toBe("accepted");
    expect(inbox.list("phone-1")).toHaveLength(1);
  });

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
