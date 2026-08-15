import { createError, toSummary, type DomainResult, type RouteAsset, type RouteId } from "../domain/index.js";

export interface CatalogSnapshot {
  readonly routes: readonly RouteAsset[];
  readonly selectedRouteId: RouteId | null;
}

export interface RouteCatalogInstance {
  snapshot(): CatalogSnapshot;
  findBySha256(sha256: string): RouteAsset | null;
  get(routeId: RouteId): RouteAsset | null;
  getSelected(): RouteAsset | null;
  add(asset: RouteAsset): DomainResult<CatalogAddResult>;
  select(routeId: RouteId): DomainResult<CatalogSnapshot>;
  remove(routeId: RouteId): DomainResult<CatalogSnapshot>;
  clear(): CatalogSnapshot;
  subscribe(listener: (snapshot: CatalogSnapshot) => void): () => void;
}

export interface CatalogAddResult {
  readonly kind: "added" | "duplicate";
  readonly asset: RouteAsset;
  readonly snapshot: CatalogSnapshot;
}

function create(): RouteCatalogInstance {
  const routes: RouteAsset[] = [];
  const byId = new Map<RouteId, RouteAsset>();
  const bySha256 = new Map<string, RouteAsset>();
  const listeners = new Set<(snapshot: CatalogSnapshot) => void>();
  let selectedRouteId: RouteId | null = null;
  let currentSnapshot: CatalogSnapshot = Object.freeze({ routes: Object.freeze([]), selectedRouteId: null });

  const snapshot = (): CatalogSnapshot => currentSnapshot;
  const commitSnapshot = (): CatalogSnapshot => currentSnapshot = Object.freeze({
    routes: Object.freeze([...routes]),
    selectedRouteId
  });
  const notify = (): void => {
    const committed = currentSnapshot;
    for (const listener of [...listeners]) {
      try {
        listener(committed);
      } catch {
        // Listener failures cannot roll back a committed catalog mutation.
      }
    }
  };
  const add = (asset: RouteAsset): DomainResult<CatalogAddResult> => {
    let summary: ReturnType<typeof toSummary>;
    try {
      summary = toSummary(asset);
    } catch {
      return Object.freeze({ ok: false as const, error: createError("DOMAIN_INVARIANT_VIOLATION", { field: "asset", reason: "untrusted-asset" }) });
    }
    const duplicate = bySha256.get(summary.sha256);
    if (duplicate !== undefined) {
      const duplicateId = toSummary(duplicate).routeId as RouteId;
      const changed = selectedRouteId !== duplicateId;
      selectedRouteId = duplicateId;
      if (changed) {
        commitSnapshot();
        notify();
      }
      return Object.freeze({ ok: true as const, value: Object.freeze({ kind: "duplicate" as const, asset: duplicate, snapshot: snapshot() }) });
    }
    if (byId.has(summary.routeId as RouteId)) {
      return Object.freeze({ ok: false as const, error: createError("DOMAIN_INVARIANT_VIOLATION", { field: "routeId", reason: "duplicate-id" }) });
    }
    const routeId = summary.routeId as RouteId;
    routes.push(asset);
    byId.set(routeId, asset);
    bySha256.set(summary.sha256, asset);
    selectedRouteId = routeId;
    commitSnapshot();
    notify();
    return Object.freeze({ ok: true as const, value: Object.freeze({ kind: "added" as const, asset, snapshot: snapshot() }) });
  };
  const select = (routeId: RouteId): DomainResult<CatalogSnapshot> => {
    if (!byId.has(routeId)) {
      return Object.freeze({ ok: false as const, error: createError("ROUTE_NOT_FOUND", { routeId }) });
    }
    if (selectedRouteId === routeId) return Object.freeze({ ok: true as const, value: snapshot() });
    selectedRouteId = routeId;
    commitSnapshot();
    notify();
    return Object.freeze({ ok: true as const, value: snapshot() });
  };
  const remove = (routeId: RouteId): DomainResult<CatalogSnapshot> => {
    const target = byId.get(routeId);
    if (target === undefined) {
      return Object.freeze({ ok: false as const, error: createError("ROUTE_NOT_FOUND", { routeId }) });
    }
    const index = routes.indexOf(target);
    routes.splice(index, 1);
    byId.delete(routeId);
    bySha256.delete(toSummary(target).sha256);
    if (selectedRouteId === routeId) {
      const replacement = routes[index] ?? routes[index - 1] ?? null;
      selectedRouteId = replacement === null ? null : toSummary(replacement).routeId as RouteId;
    }
    commitSnapshot();
    notify();
    return Object.freeze({ ok: true as const, value: snapshot() });
  };
  const clear = (): CatalogSnapshot => {
    if (routes.length === 0) return snapshot();
    routes.length = 0;
    byId.clear();
    bySha256.clear();
    selectedRouteId = null;
    commitSnapshot();
    notify();
    return snapshot();
  };
  const subscribe = (listener: (snapshot: CatalogSnapshot) => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  return Object.freeze({
    snapshot,
    findBySha256: (sha256: string) => bySha256.get(sha256) ?? null,
    get: (routeId: RouteId) => byId.get(routeId) ?? null,
    getSelected: () => byId.get(selectedRouteId as RouteId) ?? null,
    add,
    select,
    remove,
    clear,
    subscribe
  });
}

export const RouteCatalog = Object.freeze({ create });
