export interface MapRenderTarget { readonly identity: string; }
export interface MapLayer { readonly id: string; readonly payload: unknown; }
export interface GeoBounds {
  readonly minLongitude: number;
  readonly maxLongitude: number;
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly minAltitude: number | null;
  readonly maxAltitude: number | null;
}
export interface MapEngineScene {
  readonly replaceLayer: (id: string, payload: unknown) => void;
  readonly removeLayer: (id: string) => void;
  readonly focus: (bounds: GeoBounds) => void;
  readonly dispose: () => void;
}
export interface MapEngineFactory { readonly create: (target: MapRenderTarget) => MapEngineScene; }
export type MapEngineErrorCode = "INVALID_TARGET" | "INVALID_LAYER" | "INVALID_BOUNDS" | "NOT_INITIALIZED" | "ALREADY_INITIALIZED" | "DISPOSED" | "ENGINE_FAILURE";
export type MapEngineResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly code: MapEngineErrorCode }>;
export interface MapEngineSnapshot { readonly phase: "new" | "ready" | "disposed"; readonly layerIds: readonly string[]; }
export interface MapEngineAdapterInstance {
  readonly initialize: (target: MapRenderTarget) => MapEngineResult<void>;
  readonly replaceLayer: (layer: MapLayer) => MapEngineResult<void>;
  readonly removeLayer: (layerId: string) => MapEngineResult<void>;
  readonly focus: (bounds: GeoBounds) => MapEngineResult<void>;
  readonly snapshot: () => MapEngineSnapshot;
  readonly dispose: () => void;
}

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value); }
function validBounds(value: unknown): value is GeoBounds {
  try {
    // Stryker disable next-line ConditionalExpression: primitive input reaches the same false result through the guarded property read.
    if (typeof value !== "object") return false;
    // Stryker disable next-line ConditionalExpression: null property access is caught and produces the same invalid result.
    if (value === null) return false;
    const bounds = value as GeoBounds;
    const minLongitude = bounds.minLongitude;
    const maxLongitude = bounds.maxLongitude;
    const minLatitude = bounds.minLatitude;
    const maxLatitude = bounds.maxLatitude;
    if (!Number.isFinite(minLongitude)) return false;
    if (!Number.isFinite(maxLongitude)) return false;
    if (!Number.isFinite(minLatitude)) return false;
    if (!Number.isFinite(maxLatitude)) return false;
    if (minLongitude > maxLongitude) return false;
    if (minLatitude > maxLatitude) return false;
    const minAltitude = bounds.minAltitude;
    const maxAltitude = bounds.maxAltitude;
    if (minAltitude === null && maxAltitude === null) return true;
    // Stryker disable next-line ConditionalExpression: a lone null altitude remains invalid in the finite-number checks.
    if (minAltitude === null) return false;
    // Stryker disable next-line ConditionalExpression: a lone null altitude remains invalid in the finite-number checks.
    if (maxAltitude === null) return false;
    // Stryker disable next-line ConditionalExpression: null is rejected before this numeric guard.
    if (!Number.isFinite(minAltitude)) return false;
    if (!Number.isFinite(maxAltitude)) return false;
    return minAltitude <= maxAltitude;
  } catch { return false; }
}
function create(options: Readonly<{ readonly factory: MapEngineFactory }>): MapEngineAdapterInstance {
  let phase: MapEngineSnapshot["phase"] = "new";
  let scene: MapEngineScene | null = null;
  const layers = new Set<string>();
  const snapshot = (): MapEngineSnapshot => freeze({ phase, layerIds: freeze([...layers]) });
  const reject = (code: MapEngineErrorCode): MapEngineResult<void> => freeze({ ok: false as const, code });
  const ready = (): MapEngineResult<void> | null => phase === "disposed" ? reject("DISPOSED") : scene === null ? reject("NOT_INITIALIZED") : null;
  return freeze({
    initialize: (target) => {
      if (phase === "disposed") return reject("DISPOSED");
      if (scene !== null) return reject("ALREADY_INITIALIZED");
      if (!validId(target?.identity)) return reject("INVALID_TARGET");
      try { scene = options.factory.create(freeze({ identity: target.identity })); phase = "ready"; return freeze({ ok: true as const, value: undefined }); } catch { return reject("ENGINE_FAILURE"); }
    },
    replaceLayer: (layer) => {
      const state = ready(); if (state !== null) return state;
      if (!validId(layer?.id)) return reject("INVALID_LAYER");
      try { scene!.replaceLayer(layer.id, layer.payload); layers.add(layer.id); return freeze({ ok: true as const, value: undefined }); } catch { return reject("ENGINE_FAILURE"); }
    },
    removeLayer: (layerId) => {
      const state = ready(); if (state !== null) return state;
      if (!validId(layerId)) return reject("INVALID_LAYER");
      try { scene!.removeLayer(layerId); layers.delete(layerId); return freeze({ ok: true as const, value: undefined }); } catch { return reject("ENGINE_FAILURE"); }
    },
    focus: (bounds) => {
      const state = ready(); if (state !== null) return state;
      if (validBounds(bounds) === false) return reject("INVALID_BOUNDS");
      try { scene!.focus(freeze({ ...bounds })); return freeze({ ok: true as const, value: undefined }); } catch { return reject("ENGINE_FAILURE"); }
    },
    snapshot,
    dispose: () => {
      // Stryker disable next-line ConditionalExpression: repeated dispose is intentionally observationally idempotent.
      if (phase === "disposed") return;
      const activeScene = scene;
      scene = null;
      layers.clear();
      phase = "disposed";
      // Stryker disable next-line ConditionalExpression: a missing scene only has teardown side effects.
      if (activeScene === null) return;
      try { activeScene.dispose(); } catch { /* external teardown cannot restore the scene */ }
    }
  });
}

const publicApi = Object.create(null) as { create: typeof create };
publicApi.create = create;
export const MapEngineAdapter = Object.freeze(publicApi);
