export interface CityModelRegistration {
  readonly id: string;
  readonly displayName: string;
  readonly tilesetUrl: string;
}

export interface CityModelDescriptor extends CityModelRegistration {
  readonly format: "3d-tiles";
}

type CatalogDetail = Readonly<{
  readonly field: "input" | "model" | "id" | "displayName" | "tilesetUrl";
  readonly reason: "invalid-container" | "empty" | "too-many" | "unreadable" | "invalid-id" | "duplicate-id" | "invalid-type" | "name-too-long" | "unsafe-text" | "invalid-path";
}>;

export type CityModelCatalogError =
  | Readonly<{ readonly code: "INVALID_CATALOG"; readonly details: CatalogDetail }>
  | Readonly<{ readonly code: "INVALID_MODEL_ID" }>
  | Readonly<{ readonly code: "MODEL_NOT_FOUND" }>;

export type CityModelCatalogResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly error: CityModelCatalogError }>;

export interface CityModelCatalogInstance {
  readonly list: () => readonly CityModelDescriptor[];
  readonly resolve: (id: unknown) => CityModelCatalogResult<CityModelDescriptor>;
}

type RegistrationSnapshot = Readonly<{ readonly id: unknown; readonly displayName: unknown; readonly tilesetUrl: unknown }>;

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success<T>(value: T): CityModelCatalogResult<T> { return freeze({ ok: true as const, value }); }
function catalogFailure(field: CatalogDetail["field"], reason: CatalogDetail["reason"]): CityModelCatalogResult<never> {
  return freeze({ ok: false as const, error: freeze({ code: "INVALID_CATALOG" as const, details: freeze({ field, reason }) }) });
}
function modelIdFailure(): CityModelCatalogResult<never> { return freeze({ ok: false as const, error: freeze({ code: "INVALID_MODEL_ID" as const }) }); }
function notFoundFailure(): CityModelCatalogResult<never> { return freeze({ ok: false as const, error: freeze({ code: "MODEL_NOT_FOUND" as const }) }); }
function validId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const length = Array.from(value).length;
  if (length > 64) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}
function snapshotRegistration(value: unknown): RegistrationSnapshot | "invalid-type" | "unreadable" {
  if (typeof value !== "object") return "invalid-type";
  if (value === null) return "invalid-type";
  try {
    return freeze({ id: (value as Record<string, unknown>).id, displayName: (value as Record<string, unknown>).displayName, tilesetUrl: (value as Record<string, unknown>).tilesetUrl });
  } catch {
    return "unreadable";
  }
}
function normalizeName(value: unknown): CityModelCatalogResult<string> {
  if (typeof value !== "string") return catalogFailure("displayName", "invalid-type");
  const normalized = value.trim();
  if (normalized.length === 0) return catalogFailure("displayName", "empty");
  if (Array.from(normalized).length > 80) return catalogFailure("displayName", "name-too-long");
  if (/[\p{Cc}]/u.test(normalized)) return catalogFailure("displayName", "unsafe-text");
  return success(normalized);
}
function validTilesetUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (Array.from(value).length > 512) return false;
  if (!value.startsWith("/")) return false;
  if (/[\\\s\p{Cc}?#]/u.test(value)) return false;
  if (!value.endsWith("/tileset.json")) return false;
  return value.split("/").every((segment, index) => index === 0 || (segment.length > 0 && segment !== "." && segment !== ".."));
}
function descriptorFrom(value: unknown): CityModelCatalogResult<CityModelDescriptor> {
  const snapshot = snapshotRegistration(value);
  if (snapshot === "invalid-type") return catalogFailure("model", snapshot);
  if (snapshot === "unreadable") return catalogFailure("model", snapshot);
  if (!validId(snapshot.id)) return catalogFailure("id", "invalid-id");
  const displayName = normalizeName(snapshot.displayName);
  if (!displayName.ok) return displayName;
  if (!validTilesetUrl(snapshot.tilesetUrl)) return catalogFailure("tilesetUrl", "invalid-path");
  return success(freeze({ id: snapshot.id, displayName: displayName.value, tilesetUrl: snapshot.tilesetUrl, format: "3d-tiles" as const }));
}
function copyDescriptor(value: CityModelDescriptor): CityModelDescriptor {
  return freeze({ id: value.id, displayName: value.displayName, tilesetUrl: value.tilesetUrl, format: value.format });
}
function snapshotCatalog(value: unknown): readonly unknown[] | "invalid-container" | "empty" | "too-many" | "unreadable" {
  if (!Array.isArray(value)) return "invalid-container";
  try {
    if (value.length === 0) return "empty";
    if (value.length > 32) return "too-many";
    return freeze(Array.from({ length: value.length }, (_, index) => value[index]));
  } catch {
    return "unreadable";
  }
}
function catalogFromDescriptors(models: readonly CityModelDescriptor[]): CityModelCatalogInstance {
  const frozenModels = freeze([...models]) as readonly CityModelDescriptor[];
  const byId = new Map(frozenModels.map((model) => [model.id, model]));
  return freeze({
    list: (): readonly CityModelDescriptor[] => freeze(frozenModels.map(copyDescriptor)),
    resolve: (id: unknown): CityModelCatalogResult<CityModelDescriptor> => {
      if (!validId(id)) return modelIdFailure();
      const model = byId.get(id);
      return model === undefined ? notFoundFailure() : success(copyDescriptor(model));
    }
  });
}
function create(input: unknown): CityModelCatalogResult<CityModelCatalogInstance> {
  const registrations = snapshotCatalog(input);
  if (typeof registrations === "string") return catalogFailure("input", registrations);
  const models: CityModelDescriptor[] = [];
  const ids = new Set<string>();
  for (const registration of registrations) {
    const descriptor = descriptorFrom(registration);
    if (!descriptor.ok) return descriptor;
    if (ids.has(descriptor.value.id)) return catalogFailure("id", "duplicate-id");
    ids.add(descriptor.value.id);
    models.push(descriptor.value);
  }
  return success(catalogFromDescriptors(models));
}

function createHangzhou(): CityModelCatalogInstance {
  return catalogFromDescriptors([freeze({ id: "hangzhou-white-model", displayName: "杭州建筑白模", tilesetUrl: "/hangzhou-3dtiles/tileset.json", format: "3d-tiles" as const })]);
}

const publicApi = Object.create(null) as { create: typeof create; createHangzhou: typeof createHangzhou };
publicApi.create = create;
publicApi.createHangzhou = createHangzhou;
export const CityModelCatalog = Object.freeze(publicApi);
