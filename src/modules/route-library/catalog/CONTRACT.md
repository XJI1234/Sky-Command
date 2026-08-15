# D3.4 航线目录模块契约

状态：已按项目授权的技术决策批准实施

Module identifier: `route-catalog`

## 1. Purpose

D3.4 owns the in-memory catalog of route assets that were already created by
D3.1. It provides one stable boundary for content de-duplication, import
order, current selection, removal, clearing, and atomic change notification.

It does not parse a file, create a `RouteAsset`, calculate a digest, persist
state, render a map, communicate with a relay, or decide whether a route can
be uploaded. Those responsibilities belong to D3.1, D3.2, D3.3, the D3
orchestrator, `geo-map`, or `mission-control`.

## 2. Public Boundary

The sole public entry point is `catalog/index.ts`.

```text
RouteCatalog.create() -> RouteCatalogInstance

RouteCatalogInstance.snapshot() -> CatalogSnapshot
RouteCatalogInstance.findBySha256(sha256) -> RouteAsset | null
RouteCatalogInstance.get(routeId) -> RouteAsset | null
RouteCatalogInstance.getSelected() -> RouteAsset | null
RouteCatalogInstance.add(asset) -> DomainResult<CatalogAddResult>
RouteCatalogInstance.select(routeId) -> DomainResult<CatalogSnapshot>
RouteCatalogInstance.remove(routeId) -> DomainResult<CatalogSnapshot>
RouteCatalogInstance.clear() -> CatalogSnapshot
RouteCatalogInstance.subscribe(listener) -> unsubscribe
```

`RouteCatalog.create()` creates an independent catalog. There is no module
singleton and no hidden shared state. The D3 top-level orchestrator owns the
catalog instance for one desktop session.

All `RouteAsset`, `RouteId`, `DomainResult`, and `RouteLibraryError` values
are imported only from `../domain/index.ts`. Callers never import D3.4
internal files.

## 3. Public Data

```text
CatalogSnapshot {
  routes: readonly RouteAsset[]
  selectedRouteId: RouteId | null
}

CatalogAddResult {
  kind: "added" | "duplicate"
  asset: RouteAsset
  snapshot: CatalogSnapshot
}

CatalogChangeListener = (snapshot: CatalogSnapshot) => void
```

`routes` is always in first-successful-import order. `selectedRouteId` is
`null` exactly when `routes` is empty; otherwise it identifies exactly one
asset present in `routes`.

The asset values are D3.1 opaque immutable values. D3.4 never exposes raw
file bytes and never reads D3.1 internals. It uses D3.1 public read helpers to
obtain route IDs and SHA-256 values required for catalog indexes.

Every returned snapshot and its `routes` array are frozen defensive views.
The catalog never exposes its mutable array or lookup indexes.

## 4. Operations

### 4.1 Lookup

`findBySha256(sha256)` returns the existing asset with an exactly matching
64-character lowercase SHA-256 value, or `null`. Invalid lookup text is not
an exception and returns `null`. The D3 orchestrator calls this before D3.3
qualification so a repeated import selects the existing asset without doing
unnecessary qualification or creating a second route ID.

`get(routeId)` returns the matching asset or `null`. Invalid or unknown IDs
return `null`; lookup never changes selection or notifies listeners.

`getSelected()` returns the selected asset or `null`; it never returns an
asset whose ID differs from `snapshot().selectedRouteId`.

### 4.2 Add and De-duplicate

`add(asset)` only accepts an authentic D3.1 `RouteAsset`. Forged objects,
unreadable input, and duplicate route IDs from a faulty caller return
`DOMAIN_INVARIANT_VIOLATION` and leave the state unchanged.

Duplicate content is defined solely by SHA-256:

1. If an asset with the same SHA-256 already exists, D3.4 does not append the
   supplied asset. It selects the existing asset and returns
   `{ kind: "duplicate" }`.
2. Otherwise it appends the supplied asset, selects it, and returns
   `{ kind: "added" }`.

The duplicate case emits a change only when it actually changes selection.
Adding a new asset always emits exactly one change. A same-name route with a
different SHA-256 is a distinct asset and remains allowed.

### 4.3 Selection

`select(routeId)` selects an existing asset and returns the resulting frozen
snapshot. An unknown or invalid route ID returns `ROUTE_NOT_FOUND`; no state
or listeners change. Selecting the current route is a successful no-op and
does not emit a change.

### 4.4 Removal

`remove(routeId)` removes exactly one existing asset. Unknown or invalid IDs
return `ROUTE_NOT_FOUND` and leave all state unchanged.

Removing a non-selected asset preserves selection. Removing the selected
asset repairs selection deterministically:

1. Select the route immediately after the removed position when one exists.
2. Otherwise select the route immediately before that position when one
   exists.
3. Otherwise set the selection to `null`.

Every successful removal emits exactly one post-removal snapshot.

### 4.5 Clear and Subscription

`clear()` removes every route and sets selection to `null`. It emits one
snapshot only when the catalog was non-empty; clearing an already empty
catalog is a no-op.

`subscribe(listener)` registers a listener for subsequent committed changes
and returns an idempotent unsubscribe function. It does not call the listener
immediately. Listener failures are contained: every listener is invoked from
a stable committed snapshot, one throwing listener cannot prevent another
listener or roll back the mutation, and listener errors do not escape the
catalog operation.

Reentrant listener calls are permitted. Each public mutation completes its
own atomic commit before a listener can invoke another catalog operation.

## 5. State, Atomicity, and Complexity

D3.4 maintains private ordered assets plus private indexes by route ID and
SHA-256. Its only valid states are:

```text
EMPTY: routes = [], selectedRouteId = null
READY: routes.length > 0 and selectedRouteId names one stored asset
```

For every failed operation, state and listener-visible snapshots are exactly
unchanged. For every successful mutation, D3.4 constructs the complete next
state, validates its selection invariant, commits it once, then notifies from
that committed state. No caller can observe a half-added route or dangling
selection.

Lookup, selection, and duplicate detection are O(1). Appending is amortized
O(1). Removal is O(n) because preserving import order requires one compacted
array; it performs no nested scans, disk I/O, network I/O, or map work.

## 6. Dependencies and Prohibitions

Production code may import only D3.1's public `domain/index.ts`, local D3.4
files, and TypeScript/JavaScript standard capabilities. It must not import
D3.2/D3.3/D3.5 internals, Vue, Electron, DOM APIs, Cesium, TianDiTu, Node
filesystem APIs, WebSocket libraries, DJI/Android code, ZIP/XML libraries,
or UI state.

D3.4 owns catalog state only. It does not retain `RouteDetail`, `RoutePreview`,
mission payloads, map entities, import progress, or telemetry.

## 7. Required Tests and Gates

Tests call only `catalog/index.ts` and create trusted assets only through the
D3.1 public domain entry point. They cover:

1. empty and ready snapshots, import ordering, selection, all removal repair
   cases, and clearing;
2. SHA duplicate selection, duplicate IDs, same name with different content,
   forged and unreadable inputs, and all stable errors;
3. immutable snapshots, isolated catalog instances, listener ordering,
   unsubscribe idempotence, listener exceptions, and reentrancy;
4. random add/select/remove sequences preserving the selection invariant;
5. architecture constraints, linear removal behavior, 100% statements,
   branches, functions, and lines coverage; and 100% mutation score with no
   survivor or no-coverage mutant.

Before D3.4 is declared complete, `npm run check`, `npm audit
--audit-level=high`, D3.4's scoped mutation run, and an independent read-only
contract review must all pass.
