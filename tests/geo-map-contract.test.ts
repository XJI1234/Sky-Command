import { describe, expect, it } from "vitest";
import { CityModelCatalog } from "../src/modules/geo-map/city-model/index.js";
import { GeoMap } from "../src/modules/geo-map/index.js";

function createMap(events: string[] = []) {
  return GeoMap.create({ factory: { create: () => ({
    replaceLayer: (id, payload) => events.push(`replace:${id}:${JSON.stringify(payload)}`),
    removeLayer: (id) => events.push(`remove:${id}`),
    focus: () => events.push("focus"),
    dispose: () => events.push("dispose")
  }) } });
}

describe("地图模块契约", () => {
  it("在初始化后以稳定图层标识应用底图和杭州白模", () => {
    const events: string[] = [];
    const map = createMap(events);

    expect(map.initialize({ identity: "map-host" })).toEqual({ ok: true, value: undefined });
    expect(map.applyBasemap({ basemap: "tianditu-vector", credential: "key" })).toEqual({ ok: true, value: undefined });
    expect(map.showCityModel("hangzhou-white-model")).toEqual({ ok: true, value: undefined });
    expect(events).toHaveLength(2);
    expect(events[0]).toContain("replace:basemap:");
    expect(events[0]).toContain("tianditu-vector");
    expect(events[1]).toContain("replace:city-model:");
    expect(events[1]).toContain("hangzhou-white-model");
    expect(map.snapshot()).toEqual({ phase: "ready", layerIds: ["basemap", "city-model"], basemap: "tianditu-vector", cityModelId: "hangzhou-white-model" });
  });

  it("在底图缺少凭据或模型不可用时保持已提交状态", () => {
    const map = createMap();
    map.initialize({ identity: "map-host" });
    map.applyBasemap({ basemap: "tianditu-image", credential: "key" });

    expect(map.applyBasemap({ basemap: "tianditu-vector", credential: null })).toEqual({ ok: false, code: "CREDENTIAL_REQUIRED" });
    expect(map.showCityModel("unknown-model")).toEqual({ ok: false, code: "MODEL_NOT_FOUND" });
    expect(map.snapshot()).toEqual({ phase: "ready", layerIds: ["basemap"], basemap: "tianditu-image", cityModelId: null });
  });

  it("支持隐藏模型、定位，并在非法生命周期中返回稳定错误", () => {
    const events: string[] = [];
    const map = createMap(events);
    expect(map.applyBasemap({ basemap: "tianditu-vector", credential: "key" })).toEqual({ ok: false, code: "NOT_INITIALIZED" });
    expect(map.applyBasemap({ basemap: "invalid" as never, credential: null })).toEqual({ ok: false, code: "NOT_INITIALIZED" });
    expect(map.showCityModel("Bad")).toEqual({ ok: false, code: "NOT_INITIALIZED" });
    expect(map.hideCityModel()).toEqual({ ok: false, code: "NOT_INITIALIZED" });
    expect(map.focus({ minLongitude: 2, maxLongitude: 1, minLatitude: 0, maxLatitude: 1, minAltitude: null, maxAltitude: null })).toEqual({ ok: false, code: "NOT_INITIALIZED" });
    map.initialize({ identity: "map-host" });
    map.showCityModel("hangzhou-white-model");
    expect(map.hideCityModel()).toEqual({ ok: true, value: undefined });
    expect(map.focus({ minLongitude: 0, maxLongitude: 1, minLatitude: 0, maxLatitude: 1, minAltitude: null, maxAltitude: null })).toEqual({ ok: true, value: undefined });
    expect(events).toContain("remove:city-model");
    expect(events).toContain("focus");
    expect(map.snapshot()).toEqual({ phase: "ready", layerIds: [], basemap: null, cityModelId: null });
    map.dispose();
    expect(events).toContain("dispose");
    expect(map.applyBasemap({ basemap: "tianditu-vector", credential: "key" })).toEqual({ ok: false, code: "DISPOSED" });
    expect(map.showCityModel("Bad")).toEqual({ ok: false, code: "DISPOSED" });
  });

  it("允许注入自定义城市模型目录", () => {
    const models = CityModelCatalog.create([{ id: "custom-white-model", displayName: "自定义白模", tilesetUrl: "/models/custom/tileset.json" }]);
    if (!models.ok) throw models.error;
    const map = GeoMap.create({ factory: { create: () => ({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined }) }, cityModels: models.value });
    map.initialize({ identity: "map-host" });

    expect(map.showCityModel("custom-white-model")).toEqual({ ok: true, value: undefined });
    expect(map.showCityModel("hangzhou-white-model")).toEqual({ ok: false, code: "MODEL_NOT_FOUND" });
  });

  it("映射输入与引擎错误且不提交失败操作", () => {
    const map = GeoMap.create({ factory: { create: () => ({ replaceLayer: () => { throw new Error("engine"); }, removeLayer: () => { throw new Error("engine"); }, focus: () => { throw new Error("engine"); }, dispose: () => undefined }) } });
    expect(map.initialize({ identity: " " })).toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(map.initialize({ identity: "host" })).toEqual({ ok: true, value: undefined });
    expect(map.applyBasemap({ basemap: "invalid" as never, credential: "key" })).toEqual({ ok: false, code: "INVALID_BASEMAP" });
    expect(map.applyBasemap({ basemap: "tianditu-vector", credential: "key" })).toEqual({ ok: false, code: "ENGINE_FAILURE" });
    expect(map.showCityModel("Bad")).toEqual({ ok: false, code: "INVALID_MODEL_ID" });
    expect(map.showCityModel("hangzhou-white-model")).toEqual({ ok: false, code: "ENGINE_FAILURE" });
    expect(map.hideCityModel()).toEqual({ ok: false, code: "ENGINE_FAILURE" });
    expect(map.focus({ minLongitude: 0, maxLongitude: 1, minLatitude: 0, maxLatitude: 1, minAltitude: null, maxAltitude: null })).toEqual({ ok: false, code: "ENGINE_FAILURE" });
    expect(map.snapshot()).toEqual({ phase: "ready", layerIds: [], basemap: null, cityModelId: null });
  });
});
