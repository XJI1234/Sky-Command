import { describe, expect, it } from "vitest";
import { BasemapProvider } from "../src/modules/geo-map/basemap-provider/index.js";

const wmts = (layer: string, credential: string) => `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${credential}`;

describe("底图提供者模块契约", () => {
  it("将矢量底图解析为不可变且顺序稳定的 WMTS 图层", () => {
    const result = BasemapProvider.resolve({ basemap: "tianditu-vector", credential: "key&+/杭州" });

    expect(result).toEqual({
      ok: true,
      value: {
        basemap: "tianditu-vector",
        layers: [
          { id: "base", urlTemplate: wmts("vec", "key%26%2B%2F%E6%9D%AD%E5%B7%9E"), subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"], minimumZoom: 1, maximumZoom: 18, tilingScheme: "web-mercator" },
          { id: "annotation", urlTemplate: wmts("cva", "key%26%2B%2F%E6%9D%AD%E5%B7%9E"), subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"], minimumZoom: 1, maximumZoom: 18, tilingScheme: "web-mercator" }
        ]
      }
    });
    if (!result.ok) throw result.error;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.layers)).toBe(true);
    expect(Object.isFrozen(result.value.layers[0])).toBe(true);
    expect(Object.isFrozen(result.value.layers[0].subdomains)).toBe(true);
  });

  it("为影像底图选择影像和影像注记图层", () => {
    const result = BasemapProvider.resolve({ basemap: "tianditu-image", credential: "key" });

    expect(result).toEqual({
      ok: true,
      value: {
        basemap: "tianditu-image",
        layers: [
          expect.objectContaining({ id: "base", urlTemplate: wmts("img", "key") }),
          expect.objectContaining({ id: "annotation", urlTemplate: wmts("cia", "key") })
        ]
      }
    });
  });

  it.each([
    [null, { code: "INVALID_REQUEST", details: { field: "input", reason: "invalid-container" } }],
    ["map", { code: "INVALID_REQUEST", details: { field: "input", reason: "invalid-container" } }],
    [{ basemap: "other", credential: "key" }, { code: "INVALID_REQUEST", details: { field: "basemap", reason: "unsupported-basemap" } }],
    [{ basemap: 7, credential: "key" }, { code: "INVALID_REQUEST", details: { field: "basemap", reason: "invalid-type" } }],
    [{ basemap: "tianditu-vector", credential: 7 }, { code: "INVALID_REQUEST", details: { field: "credential", reason: "invalid-type" } }],
    [{ basemap: "tianditu-vector", credential: "" }, { code: "INVALID_REQUEST", details: { field: "credential", reason: "credential-empty" } }],
    [{ basemap: "tianditu-vector", credential: " key" }, { code: "INVALID_REQUEST", details: { field: "credential", reason: "credential-unsafe-text" } }],
    [{ basemap: "tianditu-vector", credential: "key value" }, { code: "INVALID_REQUEST", details: { field: "credential", reason: "credential-unsafe-text" } }],
    [{ basemap: "tianditu-vector", credential: "a".repeat(257) }, { code: "INVALID_REQUEST", details: { field: "credential", reason: "credential-too-long" } }]
  ])("拒绝无效请求而不产生 URL", (input, error) => {
    expect(BasemapProvider.resolve(input)).toEqual({ ok: false, error });
  });

  it("将缺少凭据表达为可恢复的稳定状态", () => {
    expect(BasemapProvider.resolve({ basemap: "tianditu-vector", credential: null })).toEqual({ ok: false, error: { code: "CREDENTIAL_REQUIRED" } });
  });

  it("接受 256 个 Unicode 码点的凭据上界", () => {
    expect(BasemapProvider.resolve({ basemap: "tianditu-vector", credential: "a".repeat(256) })).toMatchObject({ ok: true });
  });

  it("隔离恶意 getter 和敏感异常文本", () => {
    const input = new Proxy({}, { get() { throw new Error("secret-token"); } });
    const result = BasemapProvider.resolve(input);

    expect(result).toEqual({ ok: false, error: { code: "INVALID_REQUEST", details: { field: "input", reason: "unreadable" } } });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
