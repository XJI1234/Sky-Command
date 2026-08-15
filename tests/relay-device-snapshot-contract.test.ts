import { describe, expect, it } from "vitest";
import { RelayDeviceSnapshotReader } from "../src/modules/mission-control/relay-device-snapshot/index.js";

describe("中继设备快照解析模块契约", () => {
  it("从合法多设备快照创建独立的在线设备集合", () => {
    const source = { devices: [{ deviceId: "phone-1" }, { deviceId: "phone-2" }] };

    const result = RelayDeviceSnapshotReader.read(source);

    expect(result).not.toBeNull();
    expect([...result!]).toEqual(["phone-1", "phone-2"]);
    source.devices[0]!.deviceId = "changed-after-read";
    expect(result!.has("phone-1")).toBe(true);
    expect(result!.has("changed-after-read")).toBe(false);
  });

  it("合并重复的设备标识", () => {
    expect([...RelayDeviceSnapshotReader.read({ devices: [{ deviceId: "phone-1" }, { deviceId: "phone-1" }] })!]).toEqual(["phone-1"]);
  });

  it("接受空设备列表", () => {
    expect([...RelayDeviceSnapshotReader.read({ devices: [] })!]).toEqual([]);
  });

  it("接受恰好 128 个 Unicode 码点的设备标识", () => {
    const deviceId = "a".repeat(128);

    expect([...RelayDeviceSnapshotReader.read({ devices: [{ deviceId }] })!]).toEqual([deviceId]);
  });

  it("只暴露读取快照的单一接口", () => {
    expect(RelayDeviceSnapshotReader).toEqual({ read: expect.any(Function) });
  });

  it.each([
    null,
    undefined,
    1,
    "snapshot",
    [],
    {},
    { devices: null },
    { devices: {} },
    { devices: new Set([{ deviceId: "phone-1" }]) },
    { devices: [null] },
    { devices: [{}] },
    { devices: [{ deviceId: 1 }] },
    { devices: [{ deviceId: "" }] },
    { devices: [{ deviceId: "  " }] },
    { devices: [{ deviceId: "phone\u0000" }] },
    { devices: [{ deviceId: "a".repeat(129) }] }
  ])("拒绝不可信快照 %#", (snapshot) => {
    expect(RelayDeviceSnapshotReader.read(snapshot)).toBeNull();
  });

  it("把访问器异常转换为无效快照", () => {
    const snapshot = { get devices(): never { throw new Error("unavailable"); } };

    expect(RelayDeviceSnapshotReader.read(snapshot)).toBeNull();
  });

  it("把设备标识访问器异常转换为无效快照", () => {
    const snapshot = { devices: [{ get deviceId(): never { throw new Error("unavailable"); } }] };

    expect(RelayDeviceSnapshotReader.read(snapshot)).toBeNull();
  });
});
