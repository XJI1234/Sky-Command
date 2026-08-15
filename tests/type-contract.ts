import {
  createQualifiedRoute,
  createRouteId,
  createWaypoint,
  type QualifiedRoute,
  type RouteAsset,
  type RouteId,
  type RouteWaypoint
} from "../src/modules/route-library/domain/index.js";

const plainString = "route-1";
// @ts-expect-error A plain string is not a RouteId.
const routeId: RouteId = plainString;
// @ts-expect-error Object literals cannot forge opaque waypoints.
const waypoint: RouteWaypoint = { longitude: 1, latitude: 1, altitude: 1, sequence: 0 };
// @ts-expect-error Object literals cannot forge a QualifiedRoute.
const qualified: QualifiedRoute = {};
// @ts-expect-error Object literals cannot forge a RouteAsset.
const asset: RouteAsset = {};

void routeId;
void waypoint;
void qualified;
void asset;
void createRouteId;
void createWaypoint;
void createQualifiedRoute;
