import { RoutePreviewModel, type GeoBounds3D, type GeoPoint3D, type RoutePreview } from "../src/modules/route-library/preview/index.js";
import { type RouteDetail } from "../src/modules/route-library/domain/index.js";

declare const detail: RouteDetail;
const result = RoutePreviewModel.createPreview(detail);
void result;

declare const point: GeoPoint3D;
declare const bounds: GeoBounds3D;
declare const preview: RoutePreview;
void point;
void bounds;
void preview;

// @ts-expect-error Preview points are immutable.
point.longitude = 1;
// @ts-expect-error Preview bounds are immutable.
bounds.minAltitude = 1;
// @ts-expect-error Route previews are immutable.
preview.routeId = "another-route";
