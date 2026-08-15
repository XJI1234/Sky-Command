import { GeoMap, type GeoMapSnapshot } from "../src/modules/geo-map/index.js";

const map = GeoMap.create({ factory: { create: () => ({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined }) } });
declare const snapshot: GeoMapSnapshot;

// @ts-expect-error Public map snapshots cannot be mutated.
snapshot.basemap = "tianditu-image";
// @ts-expect-error Basemap identifiers remain closed to declared providers.
map.applyBasemap({ basemap: "open-street-map", credential: "key" });
