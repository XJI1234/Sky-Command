import { describe, expect, it } from "vitest";
import {
  RouteWorkspace,
  type GeoMapPort,
  type RouteFilePickerPort,
  type RouteLibraryPort,
  type RoutePreview,
  type RouteSummary,
  type WorkspaceSnapshot
} from "../src/modules/route-library/route-workspace/index.js";

const routeA: RouteSummary = Object.freeze({ routeId: "route-a", displayName: "A.kmz", format: "kmz", classification: "upload-candidate", waypointCount: 2, sha256: "a", sizeBytes: 10, importedAt: "2026-08-10T00:00:00.000Z" });
const routeB: RouteSummary = Object.freeze({ routeId: "route-b", displayName: "B.kml", format: "kml", classification: "preview-only", waypointCount: 3, sha256: "b", sizeBytes: 20, importedAt: "2026-08-10T00:01:00.000Z" });
const previewA: RoutePreview = Object.freeze({
  routeId: "route-a",
  polyline: Object.freeze([{ longitude: 120, latitude: 30, altitude: 1 }, { longitude: 121, latitude: 31, altitude: 2 }]),
  startMarker: Object.freeze({ longitude: 120, latitude: 30, altitude: 1 }),
  endMarker: Object.freeze({ longitude: 121, latitude: 31, altitude: 2 }),
  cameraBounds: Object.freeze({ minLongitude: 120, maxLongitude: 121, minLatitude: 30, maxLatitude: 31, minAltitude: 1, maxAltitude: 2 })
});
const previewB: RoutePreview = Object.freeze({ ...previewA, routeId: "route-b" });

function setup() {
  let routes: readonly RouteSummary[] = [];
  let selectedRouteId: string | null = null;
  let nextImport: "success" | "failure" = "success";
  let pickerValue: { fileName: string; bytes: Uint8Array } | null = { fileName: "A.kmz", bytes: new Uint8Array([1]) };
  let pickerDelay: Promise<void> | null = null;
  let resolvePickerDelay: (() => void) | undefined;
  const calls = { pick: 0, importFile: 0, select: 0, remove: 0, show: 0, clear: 0, locate: 0 };
  const shown: RoutePreview[] = [];
  const located: RoutePreview["cameraBounds"][] = [];

  const picker: RouteFilePickerPort = {
    pick: async () => {
      calls.pick += 1;
      if (pickerDelay) await pickerDelay;
      return pickerValue;
    }
  };
  const library: RouteLibraryPort = {
    importFile: async () => {
      calls.importFile += 1;
      if (nextImport === "failure") return { ok: false as const, error: { code: "INVALID_XML" } };
      routes = [routeA];
      selectedRouteId = routeA.routeId;
      return { ok: true as const, routeId: routeA.routeId };
    },
    list: () => routes,
    getSelected: () => selectedRouteId === routeA.routeId ? routeA : selectedRouteId === routeB.routeId ? routeB : null,
    select: (routeId) => {
      calls.select += 1;
      const found = routes.some((route) => route.routeId === routeId);
      if (!found) return { ok: false as const, error: { code: "ROUTE_NOT_FOUND" } };
      selectedRouteId = routeId;
      return { ok: true as const, selectedRouteId };
    },
    remove: (routeId) => {
      calls.remove += 1;
      const index = routes.findIndex((route) => route.routeId === routeId);
      if (index < 0) return { ok: false as const, error: { code: "ROUTE_NOT_FOUND" } };
      routes = routes.filter((route) => route.routeId !== routeId);
      selectedRouteId = routes[0]?.routeId ?? null;
      return { ok: true as const, selectedRouteId };
    },
    getPreview: (routeId) => routeId === routeA.routeId ? { ok: true as const, value: previewA } : routeId === routeB.routeId ? { ok: true as const, value: previewB } : { ok: false as const, error: { code: "ROUTE_NOT_FOUND" } }
  };
  const map: GeoMapPort = {
    showPreview: (preview) => { calls.show += 1; shown.push(preview); },
    clearPreview: () => { calls.clear += 1; },
    locate: (bounds) => { calls.locate += 1; located.push(bounds); }
  };
  const workspace = RouteWorkspace.create({ library, picker, map });
  return { workspace, calls, shown, located, setRoutes: (value: readonly RouteSummary[]) => { routes = value; selectedRouteId = value[0]?.routeId ?? null; }, setImport: (value: "success" | "failure") => { nextImport = value; }, setPicker: (value: { fileName: string; bytes: Uint8Array } | null) => { pickerValue = value; }, startPickerDelay: () => { pickerDelay = new Promise<void>((resolve) => { resolvePickerDelay = resolve; }); }, finishPicker: () => { resolvePickerDelay?.(); pickerDelay = null; } };
}

describe("D3.7 route workspace contract", () => {
  it("starts ready with an immutable empty snapshot", () => {
    const { workspace } = setup();
    const snapshot = workspace.snapshot();
    expect(snapshot).toMatchObject({ phase: "ready", routes: [], selectedRouteId: null, preview: null, notice: null });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.routes)).toBe(true);
  });

  it("imports a picked file, refreshes selection, and shows its preview", async () => {
    const { workspace, calls, shown } = setup();
    const result = await workspace.importFromPicker();
    expect(result).toMatchObject({ ok: true, cancelled: false });
    expect(calls).toMatchObject({ pick: 1, importFile: 1, show: 1 });
    expect(shown[0]).toEqual(previewA);
    expect(shown[0]).not.toBe(previewA);
    expect(workspace.snapshot()).toMatchObject({ phase: "ready", selectedRouteId: "route-a", routes: [routeA], preview: previewA, notice: null });
  });

  it("treats picker cancellation as a successful no-op", async () => {
    const { workspace, calls, setPicker } = setup();
    setPicker(null);
    expect(await workspace.importFromPicker()).toMatchObject({ ok: true, cancelled: true });
    expect(calls.importFile).toBe(0);
    expect(workspace.snapshot()).toMatchObject({ phase: "ready", routes: [], notice: null });
  });

  it("rejects a second import while the first picker operation is busy", async () => {
    const { workspace, calls, startPickerDelay, finishPicker } = setup();
    startPickerDelay();
    const first = workspace.importFromPicker();
    expect(workspace.snapshot().phase).toBe("picking");
    expect(await workspace.importFromPicker()).toMatchObject({ ok: false, reason: "busy" });
    finishPicker();
    await first;
    expect(calls.pick).toBe(1);
  });

  it("rejects selection and deletion while an import is in progress", async () => {
    const { workspace, calls, startPickerDelay, finishPicker } = setup();
    startPickerDelay();
    const pending = workspace.importFromPicker();
    expect(workspace.select(routeA.routeId)).toMatchObject({ ok: false, reason: "busy" });
    expect(workspace.remove(routeA.routeId)).toMatchObject({ ok: false, reason: "busy" });
    expect(calls).toMatchObject({ select: 0, remove: 0 });
    finishPicker();
    await pending;
  });

  it("preserves existing data when import is rejected", async () => {
    const { workspace, setRoutes, setImport } = setup();
    setRoutes([routeA]);
    expect(await workspace.select(routeA.routeId)).toMatchObject({ ok: true });
    setImport("failure");
    expect(await workspace.importFromPicker()).toMatchObject({ ok: false, reason: "import-failed" });
    expect(workspace.snapshot()).toMatchObject({ phase: "ready", selectedRouteId: "route-a", routes: [routeA], preview: previewA });
  });

  it("selects a route and delegates its preview to the map", async () => {
    const { workspace, calls, setRoutes, shown } = setup();
    setRoutes([routeA, routeB]);
    expect(await workspace.select(routeB.routeId)).toMatchObject({ ok: true });
    expect(workspace.snapshot()).toMatchObject({ phase: "ready", selectedRouteId: "route-b", preview: previewB, notice: null });
    expect(shown.at(-1)).toEqual(previewB);
    expect(calls.select).toBe(1);
  });

  it("keeps the view unchanged when selecting an unknown route", async () => {
    const { workspace, calls } = setup();
    const before = workspace.snapshot();
    expect(await workspace.select("unknown")).toMatchObject({ ok: false, reason: "select-failed", error: { code: "ROUTE_NOT_FOUND" } });
    expect(workspace.snapshot()).toMatchObject({ ...before, notice: { code: "ROUTE_NOT_FOUND" } });
    expect(calls.show).toBe(0);
  });

  it("removes a route and clears the map when none remains", async () => {
    const { workspace, calls, setRoutes } = setup();
    setRoutes([routeA]);
    await workspace.select(routeA.routeId);
    expect(await workspace.remove(routeA.routeId)).toMatchObject({ ok: true });
    expect(workspace.snapshot()).toMatchObject({ phase: "ready", routes: [], selectedRouteId: null, preview: null, notice: null });
    expect(calls.clear).toBe(1);
  });

  it("removes a route and displays the library's replacement selection", async () => {
    const { workspace, calls, setRoutes, shown } = setup();
    setRoutes([routeA, routeB]);
    await workspace.select(routeA.routeId);
    expect(await workspace.remove(routeA.routeId)).toMatchObject({ ok: true });
    expect(workspace.snapshot()).toMatchObject({ phase: "ready", routes: [routeB], selectedRouteId: "route-b", preview: previewB, notice: null });
    expect(shown.at(-1)).toEqual(previewB);
    expect(calls.clear).toBe(0);
  });

  it("locates the selected route and rejects locating an empty workspace", async () => {
    const { workspace, located, calls, setRoutes } = setup();
    expect(await workspace.locateSelected()).toMatchObject({ ok: false, reason: "no-selection" });
    setRoutes([routeA]);
    await workspace.select(routeA.routeId);
    expect(await workspace.locateSelected()).toMatchObject({ ok: true });
    expect(calls.locate).toBe(1);
    expect(located[0]).toEqual(previewA.cameraBounds);
  });

  it("isolates listener exceptions and supports idempotent unsubscribe", async () => {
    const { workspace, setRoutes } = setup();
    const events: WorkspaceSnapshot[] = [];
    const unsubscribe = workspace.subscribe(() => { throw new Error("listener failure"); });
    const secondUnsubscribe = workspace.subscribe((snapshot) => { events.push(snapshot); });
    setRoutes([routeA]);
    await workspace.select(routeA.routeId);
    unsubscribe();
    unsubscribe();
    await workspace.remove(routeA.routeId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)?.selectedRouteId).toBeNull();
    const eventCount = events.length;
    secondUnsubscribe();
    expect(await workspace.select("missing")).toMatchObject({ ok: false });
    expect(events).toHaveLength(eventCount);
  });

  it("exposes the importing phase while the library operation is pending", async () => {
    let resolveImport: (() => void) | undefined;
    const pendingImport = new Promise<void>((resolve) => { resolveImport = resolve; });
    const library = {
      importFile: async () => { await pendingImport; return { ok: true as const, routeId: routeA.routeId }; },
      list: () => [routeA], getSelected: () => routeA,
      select: () => ({ ok: true as const, selectedRouteId: routeA.routeId }),
      remove: () => ({ ok: true as const, selectedRouteId: null }),
      getPreview: () => ({ ok: true as const, value: previewA })
    };
    const workspace = RouteWorkspace.create({ library, picker: { pick: async () => ({ fileName: "a.kmz", bytes: new Uint8Array([1]) }) }, map: { showPreview: () => undefined, clearPreview: () => undefined, locate: () => undefined } });
    const pending = workspace.importFromPicker();
    await Promise.resolve();
    expect(workspace.snapshot().phase).toBe("importing");
    resolveImport?.();
    await pending;
    expect(workspace.snapshot().phase).toBe("ready");
  });
});
