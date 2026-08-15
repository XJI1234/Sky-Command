import { RouteCatalog } from "./catalog/index.js";
import {
  copyOriginalBytes,
  createError,
  createRouteAsset,
  toDetail,
  toSummary,
  type DomainResult,
  type RouteDetail,
  type RouteAsset,
  type RouteLibraryError,
  type RouteSummary
} from "./domain/index.js";
import { RouteImporter, type RouteImportCancellation, type RouteImportLimits } from "./importer/index.js";
import { RoutePreviewModel, type RoutePreview } from "./preview/index.js";
import { RouteQualification } from "./qualification/index.js";

const DEFAULT_LIMITS: RouteImportLimits = Object.freeze({
  maxFileBytes: 104_857_600,
  maxArchiveEntries: 1_000,
  maxExpandedBytes: 209_715_200,
  maxWaypoints: 100_000
});

export interface RouteLibraryCreateOptions extends Partial<RouteImportLimits> {
  readonly idProvider?: () => string;
  readonly clock?: () => string;
}

export interface ImportRouteInput {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export type ImportRouteResult =
  | Readonly<{ status: "imported"; duplicate: boolean; route: RouteSummary }>
  | Readonly<{ status: "rejected"; error: RouteLibraryError }>
  | Readonly<{ status: "cancelled" }>;

export interface MissionPayload {
  readonly routeId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface RouteLibraryInstance {
  readonly importFile: (input: ImportRouteInput, cancellation?: RouteImportCancellation) => Promise<ImportRouteResult>;
  readonly list: () => readonly RouteSummary[];
  readonly get: (routeId: string) => DomainResult<RouteDetail>;
  readonly getSelected: () => RouteDetail | null;
  readonly select: (routeId: string) => DomainResult<RouteDetail>;
  readonly remove: (routeId: string) => DomainResult<RouteDetail | null>;
  readonly getPreview: (routeId: string) => DomainResult<RoutePreview>;
  readonly getMissionPayload: (routeId: string) => DomainResult<MissionPayload>;
  readonly clear: () => void;
}

function success<T>(value: T): DomainResult<T> {
  return Object.freeze({ ok: true as const, value });
}

function failure<T>(error: RouteLibraryError): DomainResult<T> {
  return Object.freeze({ ok: false as const, error });
}

function readLimits(value: unknown): DomainResult<RouteImportLimits> {
  if (value === null || typeof value !== "object") return failure(createError("INVALID_CONFIGURATION"));
  const options = value as Partial<RouteImportLimits>;
  const limits: RouteImportLimits = {
    maxFileBytes: options.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes,
    maxArchiveEntries: options.maxArchiveEntries ?? DEFAULT_LIMITS.maxArchiveEntries,
    maxExpandedBytes: options.maxExpandedBytes ?? DEFAULT_LIMITS.maxExpandedBytes,
    maxWaypoints: options.maxWaypoints ?? DEFAULT_LIMITS.maxWaypoints
  };
  if (!Number.isSafeInteger(limits.maxFileBytes) || limits.maxFileBytes <= 0) return failure(createError("INVALID_CONFIGURATION"));
  if (!Number.isSafeInteger(limits.maxArchiveEntries) || limits.maxArchiveEntries <= 0) return failure(createError("INVALID_CONFIGURATION"));
  if (!Number.isSafeInteger(limits.maxExpandedBytes) || limits.maxExpandedBytes < limits.maxFileBytes) return failure(createError("INVALID_CONFIGURATION"));
  if (!Number.isSafeInteger(limits.maxWaypoints) || limits.maxWaypoints <= 0) return failure(createError("INVALID_CONFIGURATION"));
  return success(Object.freeze(limits));
}

function create(options: RouteLibraryCreateOptions = {}): DomainResult<RouteLibraryInstance> {
  const limits = readLimits(options);
  if (!limits.ok) return limits;
  const runtime = options as RouteLibraryCreateOptions;
  let nextId = 0;
  const idProvider = runtime.idProvider ?? (() => `route-${++nextId}`);
  const clock = runtime.clock ?? (() => new Date().toISOString());
  const catalog = RouteCatalog.create();

  const getAsset = (routeId: string): DomainResult<RouteAsset> => {
    const asset = catalog.get(routeId as Parameters<typeof catalog.get>[0]);
    return asset === null ? failure<RouteAsset>(createError("ROUTE_NOT_FOUND", { routeId })) : success(asset);
  };

  const importFile = async (input: ImportRouteInput, cancellation?: RouteImportCancellation): Promise<ImportRouteResult> => {
    let fileName: unknown;
    let bytes: unknown;
    try {
      fileName = input.fileName;
      bytes = input.bytes;
    } catch {
      return Object.freeze({ status: "rejected" as const, error: createError("DOMAIN_INVARIANT_VIOLATION", { field: "input" }) });
    }
    const ingested = await RouteImporter.ingest(fileName, bytes, limits.value, cancellation);
    if (ingested.status !== "parsed") return ingested;
    const duplicate = catalog.findBySha256(ingested.document.sha256);
    if (duplicate !== null) {
      // The asset originated from this catalog, so its duplicate insertion is infallible by catalog contract.
      void catalog.add(duplicate);
      return Object.freeze({ status: "imported" as const, duplicate: true, route: toSummary(duplicate) });
    }
    const qualified = RouteQualification.qualify(ingested.document, { maxWaypoints: limits.value.maxWaypoints });
    if (!qualified.ok) return Object.freeze({ status: "rejected" as const, error: qualified.error });
    let routeId: string;
    let importedAt: string;
    try {
      routeId = idProvider();
      importedAt = clock();
    } catch {
      return Object.freeze({ status: "rejected" as const, error: createError("DOMAIN_INVARIANT_VIOLATION", { phase: "identity" }) });
    }
    const asset = createRouteAsset({
      qualifiedRoute: qualified.value,
      routeId: routeId as Parameters<typeof createRouteAsset>[0]["routeId"],
      importedAt
    });
    if (!asset.ok) return Object.freeze({ status: "rejected" as const, error: asset.error });
    const added = catalog.add(asset.value);
    if (!added.ok) return Object.freeze({ status: "rejected" as const, error: added.error });
    return Object.freeze({ status: "imported" as const, duplicate: false, route: toSummary(asset.value) });
  };

  return success(Object.freeze({
    importFile,
    list: () => Object.freeze(catalog.snapshot().routes.map(toSummary)),
    get: (routeId: string) => {
      const asset = getAsset(routeId);
      return asset.ok ? success<RouteDetail>(toDetail(asset.value)) : asset;
    },
    getSelected: () => {
      const asset = catalog.getSelected();
      return asset === null ? null : toDetail(asset);
    },
    select: (routeId: string) => {
      const selected = catalog.select(routeId as Parameters<typeof catalog.select>[0]);
      if (!selected.ok) return failure<RouteDetail>(selected.error);
      return success<RouteDetail>(toDetail(catalog.getSelected()!));
    },
    remove: (routeId: string) => {
      const removed = catalog.remove(routeId as Parameters<typeof catalog.remove>[0]);
      if (!removed.ok) return failure<RouteDetail | null>(removed.error);
      const selected = catalog.getSelected();
      return success<RouteDetail | null>(selected === null ? null : toDetail(selected));
    },
    getPreview: (routeId: string) => {
      const asset = getAsset(routeId);
      return asset.ok ? RoutePreviewModel.createPreview(toDetail(asset.value)) : failure<RoutePreview>(asset.error);
    },
    getMissionPayload: (routeId: string) => {
      const asset = getAsset(routeId);
      if (!asset.ok) return failure<MissionPayload>(asset.error);
      const summary = toSummary(asset.value);
      if (summary.classification !== "upload-candidate") return failure<MissionPayload>(createError("ROUTE_NOT_UPLOADABLE", { routeId }));
      return success<MissionPayload>(Object.freeze({ routeId: summary.routeId, fileName: summary.displayName, sizeBytes: summary.sizeBytes, sha256: summary.sha256, bytes: copyOriginalBytes(asset.value) }));
    },
    clear: () => { catalog.clear(); }
  }));
}

export const RouteLibrary = Object.freeze({ create });
