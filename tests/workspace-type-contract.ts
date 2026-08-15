import { RouteWorkspace, type GeoMapPort, type RouteFilePickerPort, type RouteLibraryPort, type WorkspaceSnapshot } from "../src/modules/route-library/route-workspace/index.js";

declare const library: RouteLibraryPort;
declare const picker: RouteFilePickerPort;
declare const map: GeoMapPort;
const workspace = RouteWorkspace.create({ library, picker, map });
const snapshot: WorkspaceSnapshot = workspace.snapshot();
void workspace;
void snapshot;

// @ts-expect-error Workspace snapshots are immutable.
snapshot.phase = "picking";
// @ts-expect-error Workspace routes are immutable.
snapshot.routes.push({});
