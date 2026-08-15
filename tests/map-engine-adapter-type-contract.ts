import { MapEngineAdapter, type GeoBounds, type MapEngineFactory } from "../src/modules/geo-map/map-engine-adapter/index.js";

const factory: MapEngineFactory = { create: () => ({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined }) };
const adapter = MapEngineAdapter.create({ factory });
const bounds: GeoBounds = { minLongitude: 0, maxLongitude: 1, minLatitude: 0, maxLatitude: 1, minAltitude: null, maxAltitude: null };
void adapter.focus(bounds);
// @ts-expect-error 引擎对象不得穿过公开接口
adapter.initialize(document.body);
