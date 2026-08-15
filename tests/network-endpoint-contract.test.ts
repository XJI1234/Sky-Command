import { describe, expect, it } from "vitest";
import { NetworkEndpoint } from "../src/modules/media-pipeline/network-endpoint/index.js";

const cards = [
  { name: "Ethernet", enabled: true, internal: false, kind: "physical", ipv4: "192.168.2.9" },
  { name: "Wi-Fi", enabled: true, internal: false, kind: "wifi", ipv4: "10.0.0.4" },
  { name: "VPN", enabled: true, internal: false, kind: "vpn", ipv4: "10.0.0.1" },
  { name: "Docker", enabled: true, internal: false, kind: "virtual", ipv4: "172.20.0.1" },
  { name: "Loopback", enabled: true, internal: true, kind: "physical", ipv4: "127.0.0.1" },
  { name: "Public", enabled: true, internal: false, kind: "physical", ipv4: "8.8.8.8" }
];

describe("媒体管线 network-endpoint 契约", () => {
  it("优先使用已校验的人工地址，否则稳定选择最小的安全局域网地址", () => {
    const endpoint = NetworkEndpoint.create(19500);
    const manual = endpoint.resolve(cards, "192.168.1.8");
    expect(manual).toMatchObject({ ok: true, value: { host: "192.168.1.8", port: 19500, source: "manual" } });
    if (manual.ok) {
      expect(manual.value.rtmpUrlFor("phone/1?preview")).toEqual({ ok: true, value: { rtmpUrl: "rtmp://192.168.1.8:19500/live/phone%2F1%3Fpreview" } });
      expect(manual.value.rtmpUrlFor(" ")).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
      expect(manual.value.rtmpUrlFor({ toString: () => "phone-1" })).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
      expect(manual.value.rtmpUrlFor("a".repeat(128))).toMatchObject({ ok: true });
      expect(manual.value.rtmpUrlFor("a".repeat(129))).toEqual({ ok: false, code: "INVALID_DEVICE_ID" });
    }
    expect(endpoint.resolve(cards, null)).toMatchObject({ ok: true, value: { host: "10.0.0.4" } });
    expect(endpoint.resolve([...cards].reverse(), null)).toMatchObject({ ok: true, value: { host: "10.0.0.4", port: 19500, source: "automatic" } });
    expect(endpoint.resolve([
      { name: "late", enabled: true, internal: false, kind: "physical", ipv4: "192.168.2.10" },
      { name: "early", enabled: true, internal: false, kind: "physical", ipv4: "192.168.2.9" }
    ], null)).toMatchObject({ ok: true, value: { host: "192.168.2.9" } });
    expect(endpoint.resolve([
      { name: "larger-second", enabled: true, internal: false, kind: "physical", ipv4: "172.31.0.1" },
      { name: "smaller-second", enabled: true, internal: false, kind: "physical", ipv4: "172.16.255.255" }
    ], null)).toMatchObject({ ok: true, value: { host: "172.16.255.255" } });
    expect(endpoint.resolve([
      { name: "larger-third", enabled: true, internal: false, kind: "physical", ipv4: "192.168.3.1" },
      { name: "smaller-third", enabled: true, internal: false, kind: "physical", ipv4: "192.168.2.255" }
    ], null)).toMatchObject({ ok: true, value: { host: "192.168.2.255" } });
    expect(endpoint.resolve([
      { name: "larger-first", enabled: true, internal: false, kind: "physical", ipv4: "192.168.0.1" },
      { name: "smaller-first", enabled: true, internal: false, kind: "physical", ipv4: "10.255.255.255" }
    ], null)).toMatchObject({ ok: true, value: { host: "10.255.255.255" } });
  });

  it("拒绝非法输入，并在没有安全网卡时返回稳定错误和冻结副本", () => {
    expect(() => NetworkEndpoint.create(1023)).toThrow();
    const endpoint = NetworkEndpoint.create(19500);
    expect(endpoint.resolve(cards, 7)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(endpoint.resolve(cards, "x192.168.1.2")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(endpoint.resolve(cards, "192.168.1.2x")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(endpoint.resolve(cards, " 192.168.1.2")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(endpoint.resolve(cards, "192.168.255.255")).toMatchObject({ ok: true });
    expect(endpoint.resolve(cards, "8.8.8.8")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(endpoint.resolve([{ name: "vpn", enabled: true, internal: false, kind: "vpn", ipv4: "10.0.0.1" }], null)).toEqual({ ok: false, code: "NO_LOCAL_ENDPOINT" });
    const result = endpoint.resolve(cards, null);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("拒绝禁用、内部、隧道、畸形和非私网候选，且不被异常条目破坏", () => {
    expect(() => NetworkEndpoint.create(1024)).not.toThrow();
    expect(() => NetworkEndpoint.create(65536)).toThrow();
    const endpoint = NetworkEndpoint.create(65535);
    expect(endpoint.resolve([
      { name: "off", enabled: false, internal: false, kind: "physical", ipv4: "10.0.0.1" },
      { name: "inner", enabled: true, internal: true, kind: "wifi", ipv4: "192.168.1.2" },
      { name: "tunnel", enabled: true, internal: false, kind: "tunnel", ipv4: "172.16.0.1" },
      { name: "bad", enabled: true, internal: false, kind: "physical", ipv4: "999.1.1.1" },
      { name: "wrong-172", enabled: true, internal: false, kind: "physical", ipv4: "172.15.0.1" },
      { name: "wrong-192", enabled: true, internal: false, kind: "physical", ipv4: "192.167.0.1" },
      null
    ], null)).toEqual({ ok: false, code: "NO_LOCAL_ENDPOINT" });
    expect(endpoint.resolve("not-an-array", null)).toEqual({ ok: false, code: "NO_LOCAL_ENDPOINT" });
    expect(endpoint.resolve([{ name: "a", enabled: true, internal: false, kind: "wifi", ipv4: "172.31.0.2" }], null)).toMatchObject({ ok: true, value: { host: "172.31.0.2", port: 65535 } });
  });
  it("仅从启用的物理或 Wi-Fi 网卡中选择私网 IPv4，并忽略非对象候选项", () => {
    const endpoint = NetworkEndpoint.create(19500);
    expect(endpoint.resolve([
      7,
      "bad",
      () => undefined,
      { name: "Ethernet", enabled: true, internal: false, kind: "physical", ipv4: "192.168.10.8" }
    ], null)).toMatchObject({ ok: true, value: { host: "192.168.10.8", port: 19500, source: "automatic" } });
    expect(endpoint.resolve([
      { name: "Ethernet A", enabled: true, internal: false, kind: "physical", ipv4: "192.168.10.8" },
      { name: "Ethernet B", enabled: true, internal: false, kind: "physical", ipv4: "192.168.10.8" }
    ], null)).toMatchObject({ ok: true, value: { host: "192.168.10.8" } });
  });

  it("精确校验端口、IPv4 数值和私网边界", () => {
    expect(() => NetworkEndpoint.create("19500")).toThrow();
    expect(() => NetworkEndpoint.create(19500.5)).toThrow();
    expect(() => NetworkEndpoint.create(65535)).not.toThrow();
    const endpoint = NetworkEndpoint.create(19500);
    for (const host of ["10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1"]) {
      expect(endpoint.resolve([], host)).toMatchObject({ ok: true, value: { host } });
    }
    for (const host of ["172.15.255.255", "172.32.0.0", "192.167.255.255", "193.168.0.0", "999.1.1.1", "192.168.1"]) {
      expect(endpoint.resolve([], host)).toEqual({ ok: false, code: "INVALID_INPUT" });
    }
    expect(endpoint.resolve([], "192.168.999.1")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(endpoint.resolve([], "192.168.01.1")).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("拒绝任何貌似 IPv4 的非字符串，并保持自动模式的缺失依据", () => {
    const endpoint = NetworkEndpoint.create(19500);
    expect(endpoint.resolve([], { toString: () => "192.168.1.2" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(endpoint.resolve([{ name: "public", enabled: true, internal: false, kind: "physical", ipv4: "8.8.8.8" }], null)).toEqual({ ok: false, code: "NO_LOCAL_ENDPOINT" });
  });
});
