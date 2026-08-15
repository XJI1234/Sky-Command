import { RouteCatalog, type CatalogSnapshot, type RouteCatalogInstance } from "../src/modules/route-library/catalog/index.js";

const catalog: RouteCatalogInstance = RouteCatalog.create();
const snapshot: CatalogSnapshot = catalog.snapshot();
void snapshot;
void catalog;

// @ts-expect-error Catalog snapshots cannot be constructed with mutable route ids.
const invalid: CatalogSnapshot = { routes: [], selectedRouteId: "arbitrary" };
void invalid;
