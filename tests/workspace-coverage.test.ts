import { describe, expect, it } from "vitest";
import { RouteWorkspace, type GeoMapPort, type RouteFilePickerPort, type RouteLibraryPort, type RoutePreview, type RouteSummary } from "../src/modules/route-library/route-workspace/index.js";

const route: RouteSummary = { routeId: "route-1", displayName: "route.kmz", format: "kmz", classification: "upload-candidate", waypointCount: 2, sha256: "a", sizeBytes: 2, importedAt: "2026-08-10T00:00:00.000Z" };
const preview: RoutePreview = {
  routeId: "route-1",
  polyline: [{ longitude: 120, latitude: 30, altitude: 10 }, { longitude: 121, latitude: 31, altitude: 20 }],
  startMarker: { longitude: 120, latitude: 30, altitude: 10 },
  endMarker: { longitude: 121, latitude: 31, altitude: 20 },
  cameraBounds: { minLongitude: 120, maxLongitude: 121, minLatitude: 30, maxLatitude: 31, minAltitude: 10, maxAltitude: 20 }
};

function ports() {
  let selected = false;
  let pickerError = false;
  let importError = false;
  let mapError: "show" | "clear" | "locate" | null = null;
  let previewError = false;
  let selectionBytes: Uint8Array | undefined;
  const pickerBytes = new Uint8Array([1, 2]);
  const picker: RouteFilePickerPort = { pick: async () => {
    if (pickerError) throw new Error("picker");
    return { fileName: "route.kmz", bytes: pickerBytes };
  } };
  const library: RouteLibraryPort = {
    importFile: async (input) => {
      selectionBytes = input.bytes;
      if (importError) throw new Error("import");
      selected = true;
      return { ok: true, routeId: route.routeId };
    },
    list: () => selected ? [route] : [],
    getSelected: () => selected ? route : null,
    select: () => { selected = true; return { ok: true, selectedRouteId: route.routeId }; },
    remove: () => { selected = false; return { ok: true, selectedRouteId: null }; },
    getPreview: () => previewError ? { ok: false, error: { code: "ROUTE_NOT_FOUND", message: "Preview disappeared." } } : { ok: true, value: preview }
  };
  const map: GeoMapPort = {
    showPreview: () => { if (mapError === "show") throw new Error("show"); },
    clearPreview: () => { if (mapError === "clear") throw new Error("clear"); },
    locate: () => { if (mapError === "locate") throw new Error("locate"); }
  };
  return { workspace: RouteWorkspace.create({ library, picker, map }), setPickerError: () => { pickerError = true; }, setImportError: () => { importError = true; }, setMapError: (value: "show" | "clear" | "locate") => { mapError = value; }, setPreviewError: () => { previewError = true; }, selectedBytes: () => selectionBytes, pickerBytes: () => pickerBytes };
}

describe("D3.7 route workspace defensive contract", () => {
  it("isolates picker and import exceptions as adapter failures", async () => {
    const pickerFailure = ports();
    pickerFailure.setPickerError();
    const pickerResult = await pickerFailure.workspace.importFromPicker();
    expect(pickerResult).toMatchObject({ ok: false, reason: "adapter-failed" });
    expect(pickerResult).not.toHaveProperty("error");
    expect(pickerFailure.workspace.snapshot()).toMatchObject({ phase: "ready", routes: [], notice: { code: "ADAPTER_FAILED", message: "Route workspace adapter failed." } });

    const importFailure = ports();
    importFailure.setImportError();
    const importResult = await importFailure.workspace.importFromPicker();
    expect(importResult).toMatchObject({ ok: false, reason: "adapter-failed" });
    expect(importResult).not.toHaveProperty("error");
    expect(importFailure.workspace.snapshot().notice).toMatchObject({ code: "ADAPTER_FAILED", message: "Route workspace adapter failed." });
  });

  it("isolates preview and map exceptions without retaining a partial view", () => {
    const previewFailure = ports();
    previewFailure.setPreviewError();
    expect(previewFailure.workspace.select(route.routeId)).toMatchObject({ ok: false, reason: "adapter-failed" });
    expect(previewFailure.workspace.snapshot()).toMatchObject({ routes: [], preview: null, notice: { code: "ADAPTER_FAILED" } });

    const forgedLibrary: RouteLibraryPort = {
      importFile: async () => ({ ok: true, routeId: route.routeId }),
      list: () => [route], getSelected: () => route, select: () => ({ ok: true, selectedRouteId: route.routeId }), remove: () => ({ ok: true, selectedRouteId: null }),
      getPreview: () => ({ ok: false, error: { code: "BROKEN" }, value: preview } as never)
    };
    const forgedWorkspace = RouteWorkspace.create({ library: forgedLibrary, picker: { pick: async () => null }, map: { showPreview: () => undefined, clearPreview: () => undefined, locate: () => undefined } });
    expect(forgedWorkspace.select(route.routeId)).toMatchObject({ ok: false, reason: "adapter-failed" });

    const showFailure = ports();
    showFailure.setMapError("show");
    expect(showFailure.workspace.select(route.routeId)).toMatchObject({ ok: false, reason: "adapter-failed" });
    expect(showFailure.workspace.snapshot().preview).toBeNull();

    const clearFailure = ports();
    clearFailure.setMapError("clear");
    expect(clearFailure.workspace.remove(route.routeId)).toMatchObject({ ok: false, reason: "adapter-failed" });

    const locateFailure = ports();
    expect(locateFailure.workspace.select(route.routeId)).toMatchObject({ ok: true });
    locateFailure.setMapError("locate");
    expect(locateFailure.workspace.locateSelected()).toMatchObject({ ok: false, reason: "adapter-failed" });
  });

  it("copies picker bytes and every nested port result before publishing", async () => {
    const { workspace, selectedBytes, pickerBytes } = ports();
    expect(await workspace.importFromPicker()).toMatchObject({ ok: true });
    expect(selectedBytes()).not.toBeUndefined();
    expect(selectedBytes()).not.toBe(pickerBytes());
    pickerBytes()[0] = 99;
    expect(selectedBytes()?.[0]).toBe(1);
    const snapshot = workspace.snapshot();
    expect(snapshot.routes[0]).toEqual(route);
    expect(snapshot.routes[0]).not.toBe(route);
    expect(snapshot.preview).toEqual(preview);
    expect(snapshot.preview).not.toBe(preview);
    if (snapshot.preview === null) throw new Error("setup");
    expect(Object.isFrozen(snapshot.preview)).toBe(true);
    expect(Object.isFrozen(snapshot.preview.polyline)).toBe(true);
    expect(Object.isFrozen(snapshot.preview.polyline[0])).toBe(true);
    expect(Object.isFrozen(snapshot.preview.endMarker)).toBe(true);
    expect(Object.isFrozen(snapshot.preview.cameraBounds)).toBe(true);
  });

  it("uses a supplied library message in the user-facing notice", () => {
    const library: RouteLibraryPort = {
      importFile: async () => ({ ok: true, routeId: route.routeId }), list: () => [], getSelected: () => null,
      select: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND", message: "Route no longer exists." } }),
      remove: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }), getPreview: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } })
    };
    const picker: RouteFilePickerPort = { pick: async () => null };
    const map: GeoMapPort = { showPreview: () => undefined, clearPreview: () => undefined, locate: () => undefined };
    const workspace = RouteWorkspace.create({ library, picker, map });
    expect(workspace.select("missing")).toMatchObject({ ok: false, reason: "select-failed", error: { code: "ROUTE_NOT_FOUND" } });
    expect(workspace.snapshot().notice).toEqual({ code: "ROUTE_NOT_FOUND", message: "Route no longer exists." });
    expect(workspace.remove("missing")).toMatchObject({ ok: false, reason: "remove-failed", error: { code: "ROUTE_NOT_FOUND" } });
    expect(workspace.snapshot().notice?.message).toContain("ROUTE_NOT_FOUND");
  });
});
