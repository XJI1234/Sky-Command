import { RouteLibrary, type MissionPayload, type RouteLibraryInstance } from "../src/modules/route-library/index.js";

const created = RouteLibrary.create();
if (created.ok) {
  const library: RouteLibraryInstance = created.value;
  void library;
}
declare const payload: MissionPayload;
// @ts-expect-error Mission payload metadata is immutable.
payload.routeId = "different";
