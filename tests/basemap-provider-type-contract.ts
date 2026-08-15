import { BasemapProvider, type BasemapDescriptor, type BasemapKind } from "../src/modules/geo-map/basemap-provider/index.js";

const kind: BasemapKind = "tianditu-vector";
const result = BasemapProvider.resolve({ basemap: kind, credential: "key" });
declare const descriptor: BasemapDescriptor;

// @ts-expect-error Unsupported providers are not valid basemap kinds.
const unsupported: BasemapKind = "open-street-map";
// @ts-expect-error Descriptors always have exactly two declared layer roles.
const invalidLayerId: typeof descriptor.layers[number]["id"] = "terrain";

void result;
void unsupported;
void invalidLayerId;
