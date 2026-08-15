import { describe, expect, it } from "vitest";
import { MapEngineAdapter } from "../src/modules/geo-map/map-engine-adapter/index.js";

const createAdapter = (scene: {
  readonly replaceLayer: (id: string, payload: unknown) => void;
  readonly removeLayer: (id: string) => void;
  readonly focus: (bounds: unknown) => void;
  readonly dispose: () => void;
}) => MapEngineAdapter.create({ factory: { create: () => scene } });

describe("地图引擎适配器模块契约", () => {
  it("初始化后以稳定标识替换图层且不增加图层数量", () => {
    const calls: string[] = [];
    let receivedTarget: unknown;
    const adapter = MapEngineAdapter.create({ factory: { create: (target) => { receivedTarget = target; return { replaceLayer: (id) => calls.push(`replace:${id}`), removeLayer: (id) => calls.push(`remove:${id}`), focus: () => undefined, dispose: () => calls.push("dispose") }; } } });

    expect(adapter.initialize({ identity: "map-host" })).toEqual({ ok: true, value: undefined });
    expect(receivedTarget).toEqual({ identity: "map-host" });
    expect(Object.isFrozen(receivedTarget)).toBe(true);
    expect(adapter.replaceLayer({ id: "route-preview", payload: { color: "cyan" } })).toEqual({ ok: true, value: undefined });
    expect(adapter.replaceLayer({ id: "route-preview", payload: { color: "orange" } })).toEqual({ ok: true, value: undefined });
    expect(adapter.snapshot()).toEqual({ phase: "ready", layerIds: ["route-preview"] });
    expect(calls).toEqual(["replace:route-preview", "replace:route-preview"]);
  });

  it("初始化失败后允许重试，并隔离引擎异常", () => {
    let attempts = 0;
    const adapter = MapEngineAdapter.create({ factory: { create: () => { attempts += 1; if (attempts === 1) throw new Error("unavailable"); return { replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined }; } } });
    expect(adapter.initialize({ identity: "host" })).toEqual({ ok: false, code: "ENGINE_FAILURE" });
    expect(adapter.snapshot()).toEqual({ phase: "new", layerIds: [] });
    expect(adapter.initialize({ identity: "host" })).toEqual({ ok: true, value: undefined });
  });

  it("拒绝未初始化、无效输入和已释放实例的操作", () => {
    let disposed = 0;
    const adapter = MapEngineAdapter.create({ factory: { create: () => ({ replaceLayer: () => { throw new Error("layer error"); }, removeLayer: () => undefined, focus: () => undefined, dispose: () => { disposed += 1; } }) } });
    expect(adapter.replaceLayer({ id: "route", payload: null })).toEqual({ ok: false, code: "NOT_INITIALIZED" });
    expect(adapter.removeLayer("route")).toEqual({ ok: false, code: "NOT_INITIALIZED" });
    expect(adapter.focus({ minLongitude: 0, maxLongitude: 1, minLatitude: 0, maxLatitude: 1, minAltitude: null, maxAltitude: null })).toEqual({ ok: false, code: "NOT_INITIALIZED" });
    expect(adapter.initialize({ identity: " " })).toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(adapter.initialize({ identity: "host" })).toEqual({ ok: true, value: undefined });
    expect(adapter.initialize({ identity: "host" })).toEqual({ ok: false, code: "ALREADY_INITIALIZED" });
    expect(adapter.replaceLayer({ id: "", payload: null })).toEqual({ ok: false, code: "INVALID_LAYER" });
    expect(adapter.replaceLayer({ id: "route", payload: null })).toEqual({ ok: false, code: "ENGINE_FAILURE" });
    expect(adapter.focus({ minLongitude: 2, maxLongitude: 1, minLatitude: 0, maxLatitude: 1, minAltitude: null, maxAltitude: null })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    adapter.dispose(); adapter.dispose();
    expect(disposed).toBe(1);
    expect(adapter.snapshot()).toEqual({ phase: "disposed", layerIds: [] });
    expect(adapter.removeLayer("route")).toEqual({ ok: false, code: "DISPOSED" });
    expect(adapter.initialize({ identity: "host" })).toEqual({ ok: false, code: "DISPOSED" });
    expect(adapter.replaceLayer({ id: "route", payload: null })).toEqual({ ok: false, code: "DISPOSED" });
    expect(adapter.focus({ minLongitude: 0, maxLongitude: 1, minLatitude: 0, maxLatitude: 1, minAltitude: null, maxAltitude: null })).toEqual({ ok: false, code: "DISPOSED" });
  });

  it("按边界定位并在删除图层后更新快照", () => {
    const focused: unknown[] = [];
    const adapter = MapEngineAdapter.create({ factory: { create: () => ({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: (bounds) => focused.push(bounds), dispose: () => undefined }) } });
    adapter.initialize({ identity: "host" });
    adapter.replaceLayer({ id: "route", payload: null });
    expect(adapter.removeLayer("route")).toEqual({ ok: true, value: undefined });
    expect(adapter.focus({ minLongitude: 0, maxLongitude: 1, minLatitude: 2, maxLatitude: 3, minAltitude: 10, maxAltitude: 20 })).toEqual({ ok: true, value: undefined });
    expect(focused).toEqual([{ minLongitude: 0, maxLongitude: 1, minLatitude: 2, maxLatitude: 3, minAltitude: 10, maxAltitude: 20 }]);
    expect(adapter.snapshot()).toEqual({ phase: "ready", layerIds: [] });
  });

  it("exposes only the stable create entry point", () => {
    expect(MapEngineAdapter).toEqual({ create: expect.any(Function) });
  });

  it("allows disposal before initialization and contains teardown exceptions", () => {
    const cold = createAdapter({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined });
    expect(() => cold.dispose()).not.toThrow();
    expect(cold.snapshot()).toEqual({ phase: "disposed", layerIds: [] });

    const failing = createAdapter({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => { throw new Error("teardown"); } });
    failing.initialize({ identity: "host" });
    expect(() => failing.dispose()).not.toThrow();
    expect(failing.snapshot()).toEqual({ phase: "disposed", layerIds: [] });
  });

  it("rejects invalid identifiers while accepting the inclusive identity boundary", () => {
    const adapter = createAdapter({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined });
    expect(adapter.initialize(null as never)).toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(adapter.initialize({ identity: null as never })).toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(adapter.initialize({ identity: 42 as never })).toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(adapter.initialize({ identity: "a\u0000b" })).toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(adapter.initialize({ identity: "a".repeat(128) })).toEqual({ ok: true, value: undefined });

    expect(adapter.replaceLayer(null as never)).toEqual({ ok: false, code: "INVALID_LAYER" });
    expect(adapter.replaceLayer({ id: null as never, payload: null })).toEqual({ ok: false, code: "INVALID_LAYER" });
    expect(adapter.replaceLayer({ id: 1 as never, payload: null })).toEqual({ ok: false, code: "INVALID_LAYER" });
    expect(adapter.replaceLayer({ id: "a".repeat(129), payload: null })).toEqual({ ok: false, code: "INVALID_LAYER" });
    expect(adapter.replaceLayer({ id: "a".repeat(128), payload: null })).toEqual({ ok: true, value: undefined });
    expect(adapter.removeLayer(null as never)).toEqual({ ok: false, code: "INVALID_LAYER" });
    expect(adapter.removeLayer(1 as never)).toEqual({ ok: false, code: "INVALID_LAYER" });
    expect(adapter.removeLayer("a\u0001b")).toEqual({ ok: false, code: "INVALID_LAYER" });
  });

  it("rejects malformed geographic bounds while accepting coincident boundaries", () => {
    const adapter = createAdapter({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined });
    adapter.initialize({ identity: "host" });
    const valid = { minLongitude: 1, maxLongitude: 1, minLatitude: 2, maxLatitude: 2, minAltitude: 3, maxAltitude: 3 };
    expect(adapter.focus(valid)).toEqual({ ok: true, value: undefined });
    expect(adapter.focus(null as never)).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus("bounds" as never)).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, minLongitude: Number.NaN })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, maxLongitude: Number.NaN })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, minLatitude: Number.NaN })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, minLatitude: 3 })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, maxLatitude: Number.POSITIVE_INFINITY })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, minAltitude: null, maxAltitude: 1 })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, minAltitude: 1, maxAltitude: null })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, minAltitude: Number.NaN })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, maxAltitude: Number.POSITIVE_INFINITY })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    expect(adapter.focus({ ...valid, minAltitude: 4, maxAltitude: 3 })).toEqual({ ok: false, code: "INVALID_BOUNDS" });
    const malformed = { ...valid };
    Object.defineProperty(malformed, "minLongitude", { get: () => { throw new Error("getter"); } });
    expect(adapter.focus(malformed as never)).toEqual({ ok: false, code: "INVALID_BOUNDS" });
  });

  it("converts engine failures without corrupting layer state", () => {
    const adapter = createAdapter({
      replaceLayer: () => undefined,
      removeLayer: () => { throw new Error("remove"); },
      focus: () => { throw new Error("focus"); },
      dispose: () => undefined
    });
    adapter.initialize({ identity: "host" });
    adapter.replaceLayer({ id: "route", payload: null });
    expect(adapter.removeLayer("route")).toEqual({ ok: false, code: "ENGINE_FAILURE" });
    expect(adapter.snapshot()).toEqual({ phase: "ready", layerIds: ["route"] });
    expect(adapter.focus({ minLongitude: 0, maxLongitude: 1, minLatitude: 0, maxLatitude: 1, minAltitude: null, maxAltitude: null })).toEqual({ ok: false, code: "ENGINE_FAILURE" });
    expect(adapter.snapshot()).toEqual({ phase: "ready", layerIds: ["route"] });
  });
});
