import { describe, expect, it } from "vitest";
import { WhipTarget } from "../src/modules/whip-stream-control/whip-target/index.js";

describe("whip-target 契约", () => {
  it("生成冻结的 WHIP 地址并编码设备标识", () => {
    const result = WhipTarget.create({ deviceId: "device 1/alpha", endpoint: { host: "192.168.1.20", port: 18_889 } });
    expect(result).toEqual({ ok: true, value: { protocol: "whip", whipUrl: "http://192.168.1.20:18889/live/device%201%2Falpha/whip" } });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("拒绝畸形输入、非法设备标识、主机和端口", () => {
    expect(WhipTarget.create(null)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(WhipTarget.create({ deviceId: "device-1", endpoint: null })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(WhipTarget.create({ deviceId: " ", endpoint: { host: "computer", port: 18_889 } })).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
    expect(WhipTarget.create({ deviceId: "device-1", endpoint: { host: "computer/path", port: 18_889 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_HOST" });
    expect(WhipTarget.create({ deviceId: "device-1", endpoint: { host: "computer", port: 80 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_PORT" });
  });

  it("不接受控制字符、代理对象和会改变语义的 URL 解析结果", () => {
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(WhipTarget.create(hostile)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(WhipTarget.create({ deviceId: "device\n1", endpoint: { host: "computer", port: 18_889 } })).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
    expect(WhipTarget.create({ deviceId: "device-1", endpoint: { host: "computer", port: 18_889 } })).toMatchObject({ ok: true });
  });

  it("覆盖设备标识和端点边界", () => {
    expect(WhipTarget.create({ deviceId: "x".repeat(128), endpoint: { host: "a".repeat(253), port: 65_535 } })).toMatchObject({ ok: true });
    expect(WhipTarget.create({ deviceId: "x".repeat(129), endpoint: { host: "computer", port: 18_889 } })).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
    for (const host of ["", "computer name", "computer:18889", "computer?x=1", "computer#x", "user@computer"]) {
      expect(WhipTarget.create({ deviceId: "device-1", endpoint: { host, port: 18_889 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_HOST" });
    }
    for (const port of [1023, 65_536, 18_889.5, Number.NaN, "18889"]) {
      expect(WhipTarget.create({ deviceId: "device-1", endpoint: { host: "computer", port } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_PORT" });
    }
  });
});
