import { BasemapProvider, type BasemapKind, type BasemapRequest } from "./basemap-provider/index.js";
import { CityModelCatalog, type CityModelCatalogInstance } from "./city-model/index.js";
import { MapEngineAdapter, type GeoBounds, type MapEngineErrorCode, type MapEngineFactory, type MapRenderTarget } from "./map-engine-adapter/index.js";

export type GeoMapErrorCode = MapEngineErrorCode | "INVALID_BASEMAP" | "CREDENTIAL_REQUIRED" | "INVALID_MODEL_ID" | "MODEL_NOT_FOUND";
export type GeoMapResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly code: GeoMapErrorCode }>;

export interface GeoMapSnapshot {
  readonly phase: "new" | "ready" | "disposed";
  readonly layerIds: readonly string[];
  readonly basemap: BasemapKind | null;
  readonly cityModelId: string | null;
}

export interface GeoMapInstance {
  readonly initialize: (target: MapRenderTarget) => GeoMapResult<void>;
  readonly applyBasemap: (request: BasemapRequest) => GeoMapResult<void>;
  readonly showCityModel: (id: unknown) => GeoMapResult<void>;
  readonly hideCityModel: () => GeoMapResult<void>;
  readonly focus: (bounds: GeoBounds) => GeoMapResult<void>;
  readonly snapshot: () => GeoMapSnapshot;
  readonly dispose: () => void;
}

export interface GeoMapOptions {
  readonly factory: MapEngineFactory;
  readonly cityModels?: CityModelCatalogInstance;
}

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success<T>(value: T): GeoMapResult<T> { return freeze({ ok: true as const, value }); }
function failure(code: GeoMapErrorCode): GeoMapResult<never> { return freeze({ ok: false as const, code }); }
function create(options: GeoMapOptions): GeoMapInstance {
  const engine = MapEngineAdapter.create({ factory: options.factory });
  const cityModels = options.cityModels ?? CityModelCatalog.createHangzhou();
  let basemap: BasemapKind | null = null;
  let cityModelId: string | null = null;
  const lifecycle = (): GeoMapResult<void> | null => {
    const phase = engine.snapshot().phase;
    if (phase === "new") return failure("NOT_INITIALIZED");
    if (phase === "disposed") return failure("DISPOSED");
    return null;
  };
  const snapshot = (): GeoMapSnapshot => {
    const state = engine.snapshot();
    return freeze({ phase: state.phase, layerIds: freeze([...state.layerIds]), basemap, cityModelId });
  };
  return freeze({
    initialize: (target) => {
      const result = engine.initialize(target);
      return result.ok ? success(undefined) : failure(result.code);
    },
    applyBasemap: (request) => {
      const state = lifecycle();
      if (state !== null) return state;
      const descriptor = BasemapProvider.resolve(request);
      if (!descriptor.ok) return descriptor.error.code === "CREDENTIAL_REQUIRED" ? failure("CREDENTIAL_REQUIRED") : failure("INVALID_BASEMAP");
      const result = engine.replaceLayer({ id: "basemap", payload: descriptor.value });
      if (!result.ok) return failure(result.code);
      basemap = descriptor.value.basemap;
      return success(undefined);
    },
    showCityModel: (id) => {
      const state = lifecycle();
      if (state !== null) return state;
      const descriptor = cityModels.resolve(id);
      if (!descriptor.ok) {
        if (descriptor.error.code === "INVALID_MODEL_ID") return failure("INVALID_MODEL_ID");
        return failure("MODEL_NOT_FOUND");
      }
      const result = engine.replaceLayer({ id: "city-model", payload: descriptor.value });
      if (!result.ok) return failure(result.code);
      cityModelId = descriptor.value.id;
      return success(undefined);
    },
    hideCityModel: () => {
      const result = engine.removeLayer("city-model");
      if (!result.ok) return failure(result.code);
      cityModelId = null;
      return success(undefined);
    },
    focus: (bounds) => {
      const result = engine.focus(bounds);
      return result.ok ? success(undefined) : failure(result.code);
    },
    snapshot,
    dispose: () => {
      engine.dispose();
      basemap = null;
      cityModelId = null;
    }
  });
}

const publicApi = Object.create(null) as { create: typeof create };
publicApi.create = create;
export const GeoMap = Object.freeze(publicApi);
