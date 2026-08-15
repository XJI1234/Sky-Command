import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamProtocolConfig } from "../src/modules/live-stream-control/stream-protocol-config/index.js";

describe("StreamProtocolConfig", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("creates a frozen canonical RTMP target with an encoded device identifier", () => {
    const result = StreamProtocolConfig.createRtmpTarget({
      deviceId: "device 1/alpha",
      endpoint: { host: "192.168.1.20", port: 1935 }
    });

    expect(result).toEqual({ ok: true, value: { protocol: "rtmp", rtmpUrl: "rtmp://192.168.1.20:1935/live/device%201%2Falpha" } });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.rtmpUrl)).toBe(true);
    }
  });

  it("rejects malformed containers, identifiers, hosts and ports with stable reason codes", () => {
    expect(StreamProtocolConfig.createRtmpTarget(null)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: 7 })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: " ", endpoint: { host: "192.168.1.20", port: 1935 } })).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: "host/path", port: 1935 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_HOST" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: "192.168.1.20", port: 80 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_PORT" });
  });

  it("does not throw or leak hostile input values", () => {
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(() => StreamProtocolConfig.createRtmpTarget(hostile)).not.toThrow();
    expect(StreamProtocolConfig.createRtmpTarget(hostile)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "\uD800", endpoint: { host: "192.168.1.20", port: 1935 } })).toEqual({ ok: false, code: "INVALID_TARGET" });
    const hostileEndpoint = new Proxy({}, { get() { throw new Error("endpoint"); } });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: hostileEndpoint })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("enforces every RTMP target boundary without accepting an arbitrary URL", () => {
    const longDeviceId = "x".repeat(129);
    const maximumDeviceId = "x".repeat(128);
    const longHost = "a".repeat(254);
    const invalidHosts = ["", "computer name", "computer:1935", "computer/live", "computer?token=1", "computer#fragment", "user@computer"];
    for (const host of invalidHosts) expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host, port: 1935 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_HOST" });
    expect(StreamProtocolConfig.createRtmpTarget(1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: 1, endpoint: { host: "computer", port: 1935 } })).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: longDeviceId, endpoint: { host: "computer", port: 1935 } })).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: maximumDeviceId, endpoint: { host: "computer", port: 1935 } })).toMatchObject({ ok: true });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device\n1", endpoint: { host: "computer", port: 1935 } })).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: longHost, port: 1935 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_HOST" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: 1, port: 1935 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_HOST" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: ["computer"], port: 1935 } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_HOST" });
    for (const port of [1023, 65_536, 1935.5, Number.NaN, "1935"]) expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: "computer", port } })).toEqual({ ok: false, code: "INVALID_ENDPOINT_PORT" });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "x", endpoint: { host: "a", port: 1024 } })).toMatchObject({ ok: true, value: { rtmpUrl: "rtmp://a:1024/live/x" } });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "x", endpoint: { host: "a".repeat(253), port: 65_535 } })).toMatchObject({ ok: true });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "x", endpoint: null })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("converts a platform parser failure into INVALID_TARGET", () => {
    vi.stubGlobal("URL", class { constructor() { throw new Error("platform"); } });
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: "computer", port: 1935 } })).toEqual({ ok: false, code: "INVALID_TARGET" });
  });

  it.each([
    ["protocol", "rtsp:"], ["username", "user"], ["password", "password"], ["hostname", "other"], ["port", "1936"], ["pathname", "/live/other"], ["search", "?token=secret"], ["hash", "#secret"]
  ] as const)("rejects a parser result with a mismatched %s field", (field, value) => {
    class FakeUrl {
      protocol = "rtmp:";
      username = "";
      password = "";
      hostname = "computer";
      port = "1935";
      pathname = "/live/device-1";
      search = "";
      hash = "";
      constructor() { Object.assign(this, { [field]: value }); }
    }
    vi.stubGlobal("URL", FakeUrl);
    expect(StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: "computer", port: 1935 } })).toEqual({ ok: false, code: "INVALID_TARGET" });
  });

  it("uses detached results across later calls", () => {
    const first = StreamProtocolConfig.createRtmpTarget({ deviceId: "device-1", endpoint: { host: "192.168.1.20", port: 1935 } });
    const second = StreamProtocolConfig.createRtmpTarget({ deviceId: "device-2", endpoint: { host: "192.168.1.20", port: 1935 } });
    expect(first).not.toBe(second);
    expect(first).toMatchObject({ ok: true, value: { rtmpUrl: "rtmp://192.168.1.20:1935/live/device-1" } });
    expect(second).toMatchObject({ ok: true, value: { rtmpUrl: "rtmp://192.168.1.20:1935/live/device-2" } });
  });
});
