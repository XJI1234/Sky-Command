import { describe, expect, it, vi } from "vitest";
import { DeviceSettingsPanel, type DeviceSettingsPort } from "../src/modules/device-console/device-settings-panel/index.js";

const transmission = Object.freeze({ frequencyBand: "BAND_2_DOT_4G", channelSelectionMode: "AUTO", bandwidth: "BANDWIDTH_10MHZ", dynamicDataRateMbps: 12.5 });
const camera = Object.freeze({ autoExposureLockEnabled: false, focusMode: "AF", cameraIndex: "LEFT_OR_MAIN" });

function port(): DeviceSettingsPort {
  return {
    readTransmission: vi.fn(async () => ({ ok: true as const, value: transmission })),
    writeTransmission: vi.fn(async () => ({ ok: true as const, value: transmission })),
    readCamera: vi.fn(async () => ({ ok: true as const, value: camera })),
    writeCamera: vi.fn(async () => ({ ok: true as const, value: camera }))
  };
}

describe("设备设置面板契约", () => {
  it("仅在端口返回完整确认快照后更新对应设备的设置", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    expect(await panel.readTransmission("phone-1")).toEqual({ ok: true, domain: "transmission" });
    expect(await panel.writeCamera("phone-1", { autoExposureLockEnabled: true })).toEqual({ ok: true, domain: "camera" });
    expect(relay.writeCamera).toHaveBeenCalledWith("phone-1", { autoExposureLockEnabled: true });
    expect(panel.snapshot("phone-1")).toMatchObject({ deviceId: "phone-1", transmission, camera, transmissionPending: false, cameraPending: false, lastFailure: null });
  });

  it("按设备和设置域互斥，并拒绝非法标识与空写入补丁", async () => {
    let resolve: ((value: { readonly ok: true; readonly value: typeof transmission }) => void) | undefined;
    const relay = port();
    relay.readTransmission = vi.fn(() => new Promise((next) => { resolve = next; }));
    const panel = DeviceSettingsPanel.create({ port: relay });
    const pending = panel.readTransmission("phone-1");
    expect(await panel.writeTransmission("phone-1", { bandwidth: "BANDWIDTH_10MHZ" })).toEqual({ ok: false, domain: "transmission", reason: "busy" });
    expect(await panel.readCamera("phone-1")).toEqual({ ok: true, domain: "camera" });
    expect(await panel.writeCamera(" ", { focusMode: "AF" })).toEqual({ ok: false, domain: "camera", reason: "invalid-device" });
    expect(await panel.writeTransmission("phone-2", {})).toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    resolve?.({ ok: true, value: transmission });
    await expect(pending).resolves.toEqual({ ok: true, domain: "transmission" });
  });

  it.each(["rejected", "timed-out", "transport-failed"] as const)("端口 %s 时保留已确认快照并记录稳定失败", async (reason) => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    await panel.readTransmission("phone-1");
    relay.writeTransmission = vi.fn(async () => ({ ok: false as const, reason }));
    expect(await panel.writeTransmission("phone-1", { bandwidth: "BANDWIDTH_10MHZ" })).toEqual({ ok: false, domain: "transmission", reason });
    expect(panel.snapshot("phone-1")).toMatchObject({ transmission, transmissionPending: false, lastFailure: reason });
  });

  it("隔离端口异常和畸形结果，并防御所有写入补丁边界", async () => {
    const relay = port();
    relay.readCamera = vi.fn(async () => { throw new Error("secret"); });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: { ...transmission, dynamicDataRateMbps: -1 } }));
    const panel = DeviceSettingsPanel.create({ port: relay });
    expect(await panel.readCamera("phone-1")).toEqual({ ok: false, domain: "camera", reason: "adapter-failed" });
    expect(await panel.readTransmission("phone-1")).toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    expect(await panel.writeTransmission("phone-1", { frequencyBand: "bad" })).toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    expect(await panel.writeTransmission("phone-1", { dynamicDataRateMbps: 1 })).toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    expect(await panel.writeCamera("phone-1", { cameraIndex: "LEFT_OR_MAIN" })).toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
    expect(await panel.writeCamera("phone-1", { focusMode: "af" })).toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
  });

  it("复制端口返回值和快照，避免调用方后续修改污染状态", async () => {
    const mutable = { ...camera };
    const relay = port();
    relay.readCamera = vi.fn(async () => ({ ok: true as const, value: mutable }));
    const panel = DeviceSettingsPanel.create({ port: relay });
    await panel.readCamera("phone-1");
    mutable.focusMode = "MF";
    const snapshot = panel.snapshot("phone-1");
    expect(snapshot.camera).toEqual(camera);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.camera)).toBe(true);
    expect(Object.isFrozen(DeviceSettingsPanel)).toBe(true);
  });

  it.each([
    [{ ...transmission, frequencyBand: "bad" }],
    [{ ...transmission, channelSelectionMode: "" }],
    [{ ...transmission, bandwidth: 1 }],
    [{ ...transmission, dynamicDataRateMbps: Number.NaN }],
    [{ ...transmission, dynamicDataRateMbps: null }],
    [{ ...camera, autoExposureLockEnabled: "false" }],
    [{ ...camera, focusMode: "" }],
    [{ ...camera, cameraIndex: "bad" }]
  ])("只接受完整且平台无关的设置快照 %o", async (value) => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value }));
    const transmissionResult = await panel.readTransmission("phone-1");
    if (value === null || "frequencyBand" in value) expect(transmissionResult).toEqual(value.dynamicDataRateMbps === null && value.frequencyBand === transmission.frequencyBand ? { ok: true, domain: "transmission" } : { ok: false, domain: "transmission", reason: "invalid-result" });
    relay.readCamera = vi.fn(async () => ({ ok: true as const, value }));
    const cameraResult = await panel.readCamera("phone-2");
    if ("autoExposureLockEnabled" in value) expect(cameraResult).toEqual({ ok: false, domain: "camera", reason: "invalid-result" });
  });

  it("隔离读取结果与写入对象的恶意 getter", async () => {
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    const relay = port();
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: hostile }));
    const panel = DeviceSettingsPanel.create({ port: relay });
    expect(await panel.readTransmission("phone-1")).toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    expect(await panel.writeCamera("phone-1", hostile)).toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
  });

  it("对非对象、枚举异常和相机端口失败保持稳定失败", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: 1 }));
    relay.readCamera = vi.fn(async () => ({ ok: true as const, value: 1 }));
    expect(await panel.readTransmission("phone-1")).toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    expect(await panel.readCamera("phone-1")).toEqual({ ok: false, domain: "camera", reason: "invalid-result" });
    const hostileKeys = new Proxy({}, { ownKeys() { throw new Error("secret"); } });
    expect(await panel.writeTransmission("phone-1", hostileKeys)).toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    expect(await panel.writeCamera("phone-1", hostileKeys)).toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
    relay.writeCamera = vi.fn(async () => ({ ok: false as const, reason: "rejected" }));
    expect(await panel.writeCamera("phone-1", { focusMode: "AF" })).toEqual({ ok: false, domain: "camera", reason: "rejected" });
    expect(panel.snapshot("phone-1")).toMatchObject({ cameraPending: false, lastFailure: "rejected" });
  });

  it("完整写入两个域时只传递冻结的白名单补丁", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    const transmissionPatch = { frequencyBand: "BAND_2_DOT_4G", channelSelectionMode: "AUTO", bandwidth: "BANDWIDTH_10MHZ" };
    expect(await panel.writeTransmission("phone-1", transmissionPatch)).toEqual({ ok: true, domain: "transmission" });
    expect(await panel.writeCamera("phone-2", { autoExposureLockEnabled: true, focusMode: "AF" })).toEqual({ ok: true, domain: "camera" });
    expect(Object.isFrozen((relay.writeTransmission as ReturnType<typeof vi.fn>).mock.calls[0][1])).toBe(true);
  });

  it("把空结果、相机末字段错误与另一个域的适配器异常全部隔离", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: null }));
    relay.readCamera = vi.fn(async () => ({ ok: true as const, value: null }));
    expect(await panel.readTransmission("phone-1")).toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    expect(await panel.readCamera("phone-1")).toEqual({ ok: false, domain: "camera", reason: "invalid-result" });
    relay.readCamera = vi.fn(async () => ({ ok: true as const, value: { ...camera, autoExposureLockEnabled: true, focusMode: "AF", cameraIndex: "bad" } }));
    expect(await panel.readCamera("phone-1")).toEqual({ ok: false, domain: "camera", reason: "invalid-result" });
    relay.writeTransmission = vi.fn(async () => { throw new Error("secret"); });
    expect(await panel.writeTransmission("phone-1", { bandwidth: "BANDWIDTH_10MHZ" })).toEqual({ ok: false, domain: "transmission", reason: "adapter-failed" });
    expect(await panel.writeTransmission(" ", { bandwidth: "BANDWIDTH_10MHZ" })).toEqual({ ok: false, domain: "transmission", reason: "invalid-device" });
  });

  it("对相机读取 getter 和两个域的空补丁均不抛异常", async () => {
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    const relay = port();
    relay.readCamera = vi.fn(async () => ({ ok: true as const, value: hostile }));
    const panel = DeviceSettingsPanel.create({ port: relay });
    expect(await panel.readCamera("phone-1")).toEqual({ ok: false, domain: "camera", reason: "invalid-result" });
    expect(await panel.writeTransmission("phone-1", null)).toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    expect(await panel.writeCamera("phone-1", null)).toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
    expect(await panel.writeTransmission(" ", {})).toEqual({ ok: false, domain: "transmission", reason: "invalid-device" });
    expect(await panel.writeCamera(" ", {})).toEqual({ ok: false, domain: "camera", reason: "invalid-device" });
  });

  it("精确校验设备标识、设置令牌和动态码率边界", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: { ...transmission, frequencyBand: "A".repeat(64), channelSelectionMode: "A", bandwidth: "A", dynamicDataRateMbps: 0 } }));
    expect(await panel.readTransmission("x".repeat(128))).toEqual({ ok: true, domain: "transmission" });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: { ...transmission, frequencyBand: "A".repeat(65) } }));
    expect(await panel.readTransmission("phone-2")).toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    expect(await panel.writeTransmission("phone-1", { frequencyBand: "A", channelSelectionMode: "A", bandwidth: "A" })).toEqual({ ok: true, domain: "transmission" });
    expect(await panel.writeTransmission("phone-1", { unsupported: "A" })).toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    expect(await panel.writeCamera("phone-1", { autoExposureLockEnabled: false, focusMode: "AF" })).toEqual({ ok: true, domain: "camera" });
    expect(await panel.writeCamera("phone-1", { unsupported: true })).toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
  });

  it("在尚未确认任何设置时返回完整的空快照", () => {
    const panel = DeviceSettingsPanel.create({ port: port() });
    expect(panel.snapshot("phone-1")).toEqual({
      deviceId: "phone-1",
      transmission: null,
      camera: null,
      transmissionPending: false,
      cameraPending: false,
      lastFailure: null
    });
  });

  it("拒绝所有越过设备标识边界的读取请求且不会调用端口", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    const read = panel.readTransmission as (deviceId: unknown) => Promise<unknown>;
    await expect(read(1)).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-device" });
    await expect(read("x".repeat(129))).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-device" });
    await expect(read("phone\u0000-1")).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-device" });
    expect(relay.readTransmission).not.toHaveBeenCalled();
  });

  it("拒绝读取结果中可被字符串化的非字符串令牌和非法动态码率", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: { ...transmission, frequencyBand: ["A"] } }));
    await expect(panel.readTransmission("phone-1")).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: { ...transmission, dynamicDataRateMbps: "5" } }));
    await expect(panel.readTransmission("phone-1")).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: { ...transmission, dynamicDataRateMbps: Number.POSITIVE_INFINITY } }));
    await expect(panel.readTransmission("phone-1")).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    relay.readCamera = vi.fn(async () => ({ ok: true as const, value: { ...camera, focusMode: ["AF"] } }));
    await expect(panel.readCamera("phone-1")).resolves.toEqual({ ok: false, domain: "camera", reason: "invalid-result" });
  });

  it("将字段白名单和字段值校验应用到每一种写入补丁", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    await expect(panel.writeTransmission("phone-1", { frequencyBand: "A", unsupported: "A" })).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    await expect(panel.writeTransmission("phone-1", { channelSelectionMode: "bad" })).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    await expect(panel.writeTransmission("phone-1", { bandwidth: "bad" })).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-patch" });
    await expect(panel.writeTransmission("phone-1", { frequencyBand: "A" })).resolves.toEqual({ ok: true, domain: "transmission" });
    await expect(panel.writeCamera("phone-1", { autoExposureLockEnabled: "true" })).resolves.toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
    await expect(panel.writeCamera("phone-1", { focusMode: "bad" })).resolves.toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
  });

  it("在请求期间显式标记对应域，并在失败后恢复该标记且保留已确认快照", async () => {
    let resolve: ((value: { readonly ok: true; readonly value: typeof transmission }) => void) | undefined;
    const relay = port();
    relay.readTransmission = vi.fn(() => new Promise((next) => { resolve = next; }));
    const panel = DeviceSettingsPanel.create({ port: relay });
    const pending = panel.readTransmission("phone-1");
    expect(panel.snapshot("phone-1")).toMatchObject({ transmissionPending: true, cameraPending: false, lastFailure: null });
    resolve?.({ ok: true, value: transmission });
    await pending;
    relay.writeTransmission = vi.fn(async () => { throw new Error("port unavailable"); });
    await expect(panel.writeTransmission("phone-1", { bandwidth: "BANDWIDTH_10MHZ" })).resolves.toEqual({ ok: false, domain: "transmission", reason: "adapter-failed" });
    expect(panel.snapshot("phone-1")).toEqual({
      deviceId: "phone-1",
      transmission,
      camera: null,
      transmissionPending: false,
      cameraPending: false,
      lastFailure: "adapter-failed"
    });
  });

  it("将冻结且未经调用方对象污染的完整补丁交给端口", async () => {
    const relay = port();
    const panel = DeviceSettingsPanel.create({ port: relay });
    const patch = { frequencyBand: "BAND_2_DOT_4G", channelSelectionMode: "AUTO", bandwidth: "BANDWIDTH_10MHZ" };
    await expect(panel.writeTransmission("phone-1", patch)).resolves.toEqual({ ok: true, domain: "transmission" });
    patch.frequencyBand = "MUTATED";
    expect((relay.writeTransmission as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({
      frequencyBand: "BAND_2_DOT_4G",
      channelSelectionMode: "AUTO",
      bandwidth: "BANDWIDTH_10MHZ"
    });
    expect(Object.isFrozen((relay.writeTransmission as ReturnType<typeof vi.fn>).mock.calls[0][1])).toBe(true);
  });

  it("相机域请求期间独立标记 pending，并在端口异常后恢复完整快照", async () => {
    let reject: ((reason?: unknown) => void) | undefined;
    const relay = port();
    relay.readCamera = vi.fn(() => new Promise<never>((_resolve, next) => { reject = next; }));
    const panel = DeviceSettingsPanel.create({ port: relay });
    const pending = panel.readCamera("phone-1");
    expect(panel.snapshot("phone-1")).toEqual({
      deviceId: "phone-1",
      transmission: null,
      camera: null,
      transmissionPending: false,
      cameraPending: true,
      lastFailure: null
    });
    reject?.(new Error("camera port unavailable"));
    await expect(pending).resolves.toEqual({ ok: false, domain: "camera", reason: "adapter-failed" });
    expect(panel.snapshot("phone-1")).toEqual({
      deviceId: "phone-1",
      transmission: null,
      camera: null,
      transmissionPending: false,
      cameraPending: false,
      lastFailure: "adapter-failed"
    });
  });

  it("在无效读取结果和空相机补丁后仍保留合法且可重试的设备状态", async () => {
    const relay = port();
    relay.readTransmission = vi.fn(async () => ({ ok: true as const, value: { ...transmission, bandwidth: "bad" } }));
    const panel = DeviceSettingsPanel.create({ port: relay });
    await expect(panel.readTransmission("phone-1")).resolves.toEqual({ ok: false, domain: "transmission", reason: "invalid-result" });
    expect(panel.snapshot("phone-1")).toEqual({
      deviceId: "phone-1",
      transmission: null,
      camera: null,
      transmissionPending: false,
      cameraPending: false,
      lastFailure: "invalid-result"
    });
    await expect(panel.writeCamera("phone-1", {})).resolves.toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
    await expect(panel.writeCamera("phone-1", { focusMode: "AF", unsupported: true })).resolves.toEqual({ ok: false, domain: "camera", reason: "invalid-patch" });
    await expect(panel.readCamera("phone-1")).resolves.toEqual({ ok: true, domain: "camera" });
  });
});
