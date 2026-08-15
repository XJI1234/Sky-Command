export type BasemapKind = "tianditu-vector" | "tianditu-image";

export interface BasemapRequest {
  readonly basemap: BasemapKind;
  readonly credential: string | null;
}

export interface BasemapTileLayer {
  readonly id: "base" | "annotation";
  readonly urlTemplate: string;
  readonly subdomains: readonly string[];
  readonly minimumZoom: 1;
  readonly maximumZoom: 18;
  readonly tilingScheme: "web-mercator";
}

export interface BasemapDescriptor {
  readonly basemap: BasemapKind;
  readonly layers: readonly [BasemapTileLayer, BasemapTileLayer];
}

export type BasemapProviderError =
  | Readonly<{ readonly code: "CREDENTIAL_REQUIRED" }>
  | Readonly<{ readonly code: "INVALID_REQUEST"; readonly details: Readonly<{ readonly field: "input" | "basemap" | "credential"; readonly reason: "invalid-container" | "unreadable" | "invalid-type" | "unsupported-basemap" | "credential-empty" | "credential-too-long" | "credential-unsafe-text" }> }>;

export type BasemapProviderResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly error: BasemapProviderError }>;

type InputSnapshot = Readonly<{ readonly basemap: unknown; readonly credential: unknown }>;
type ValidCredential = Readonly<{ readonly value: string }>;
type LayerNames = Readonly<{ readonly base: "vec" | "img"; readonly annotation: "cva" | "cia" }>;

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success<T>(value: T): BasemapProviderResult<T> { return freeze({ ok: true as const, value }); }
function failure(field: "input" | "basemap" | "credential", reason: "invalid-container" | "unreadable" | "invalid-type" | "unsupported-basemap" | "credential-empty" | "credential-too-long" | "credential-unsafe-text"): BasemapProviderResult<never> {
  return freeze({ ok: false as const, error: freeze({ code: "INVALID_REQUEST" as const, details: freeze({ field, reason }) }) });
}
function snapshotInput(value: unknown): InputSnapshot | "invalid-container" | "unreadable" {
  if (value === null || typeof value !== "object") return "invalid-container";
  try {
    return freeze({ basemap: (value as Record<string, unknown>).basemap, credential: (value as Record<string, unknown>).credential });
  } catch {
    return "unreadable";
  }
}
function readBasemap(value: unknown): BasemapProviderResult<BasemapKind> {
  if (typeof value !== "string") return failure("basemap", "invalid-type");
  if (value === "tianditu-vector" || value === "tianditu-image") return success(value);
  return failure("basemap", "unsupported-basemap");
}
function readCredential(value: unknown): BasemapProviderResult<ValidCredential> {
  if (value === null) return freeze({ ok: false as const, error: freeze({ code: "CREDENTIAL_REQUIRED" as const }) });
  if (typeof value !== "string") return failure("credential", "invalid-type");
  if (value.length === 0) return failure("credential", "credential-empty");
  if (Array.from(value).length > 256) return failure("credential", "credential-too-long");
  if (/[\s\p{Cc}]/u.test(value)) return failure("credential", "credential-unsafe-text");
  return success(freeze({ value }));
}
function layerNames(basemap: BasemapKind): LayerNames {
  return basemap === "tianditu-vector" ? freeze({ base: "vec", annotation: "cva" }) : freeze({ base: "img", annotation: "cia" });
}
function createUrl(layer: LayerNames["base"] | LayerNames["annotation"], credential: string): string {
  return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(credential)}`;
}
function createSubdomains(): readonly string[] { return freeze(Array.from({ length: 8 }, (_, index) => String(index))); }
function createLayer(id: BasemapTileLayer["id"], name: LayerNames["base"] | LayerNames["annotation"], credential: string): BasemapTileLayer {
  return freeze({ id, urlTemplate: createUrl(name, credential), subdomains: createSubdomains(), minimumZoom: 1 as const, maximumZoom: 18 as const, tilingScheme: "web-mercator" as const });
}
function resolve(input: unknown): BasemapProviderResult<BasemapDescriptor> {
  const snapshot = snapshotInput(input);
  if (snapshot === "invalid-container" || snapshot === "unreadable") return failure("input", snapshot);
  const basemap = readBasemap(snapshot.basemap);
  if (!basemap.ok) return basemap;
  const credential = readCredential(snapshot.credential);
  if (!credential.ok) return credential;
  const names = layerNames(basemap.value);
  const layers = freeze([createLayer("base", names.base, credential.value.value), createLayer("annotation", names.annotation, credential.value.value)]) as BasemapDescriptor["layers"];
  return success(freeze({ basemap: basemap.value, layers }));
}

const publicApi = Object.create(null) as { resolve: typeof resolve };
publicApi.resolve = resolve;
export const BasemapProvider = Object.freeze(publicApi);
