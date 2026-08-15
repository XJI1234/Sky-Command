export interface RouteSummary {
  readonly routeId: string;
  readonly displayName: string;
  readonly format: "kml" | "kmz";
  readonly classification: "preview-only" | "upload-candidate";
  readonly waypointCount: number;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly importedAt: string;
}

export interface GeoPoint3D {
  readonly longitude: number;
  readonly latitude: number;
  readonly altitude: number | null;
}

export interface GeoBounds3D {
  readonly minLongitude: number;
  readonly maxLongitude: number;
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly minAltitude: number | null;
  readonly maxAltitude: number | null;
}

export interface RoutePreview {
  readonly routeId: string;
  readonly polyline: readonly GeoPoint3D[];
  readonly startMarker: GeoPoint3D;
  readonly endMarker: GeoPoint3D;
  readonly cameraBounds: GeoBounds3D;
}

export interface FileSelection {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface LibraryError {
  readonly code: string;
  readonly message?: string;
}

export type ImportResult =
  | Readonly<{ ok: true; routeId: string }>
  | Readonly<{ ok: false; error: LibraryError }>;

export type SelectionResult =
  | Readonly<{ ok: true; selectedRouteId: string | null }>
  | Readonly<{ ok: false; error: LibraryError }>;

export type PreviewResult =
  | Readonly<{ ok: true; value: RoutePreview }>
  | Readonly<{ ok: false; error: LibraryError }>;

export interface RouteLibraryPort {
  readonly importFile: (input: FileSelection) => Promise<ImportResult>;
  readonly list: () => readonly RouteSummary[];
  readonly getSelected: () => Readonly<{ routeId: string }> | null;
  readonly select: (routeId: string) => SelectionResult;
  readonly remove: (routeId: string) => SelectionResult;
  readonly getPreview: (routeId: string) => PreviewResult;
}

export interface RouteFilePickerPort {
  readonly pick: () => Promise<FileSelection | null>;
}

export interface GeoMapPort {
  readonly showPreview: (preview: RoutePreview) => void;
  readonly clearPreview: () => void;
  readonly locate: (bounds: GeoBounds3D) => void;
}

export type WorkspacePhase = "ready" | "picking" | "importing";

export interface WorkspaceNotice {
  readonly code: string;
  readonly message: string;
}

export interface WorkspaceSnapshot {
  readonly phase: WorkspacePhase;
  readonly routes: readonly RouteSummary[];
  readonly selectedRouteId: string | null;
  readonly preview: RoutePreview | null;
  readonly notice: WorkspaceNotice | null;
}

export type WorkspaceCommandResult =
  | Readonly<{ ok: true; cancelled?: boolean }>
  | Readonly<{ ok: false; reason: "busy" | "import-failed" | "select-failed" | "remove-failed" | "no-selection" | "adapter-failed"; error?: LibraryError }>;

export type WorkspaceListener = (snapshot: WorkspaceSnapshot) => void;

export interface RouteWorkspaceDependencies {
  readonly library: RouteLibraryPort;
  readonly picker: RouteFilePickerPort;
  readonly map: GeoMapPort;
}

export interface RouteWorkspaceInstance {
  readonly snapshot: () => WorkspaceSnapshot;
  readonly subscribe: (listener: WorkspaceListener) => () => void;
  readonly importFromPicker: () => Promise<WorkspaceCommandResult>;
  readonly select: (routeId: string) => WorkspaceCommandResult;
  readonly remove: (routeId: string) => WorkspaceCommandResult;
  readonly locateSelected: () => WorkspaceCommandResult;
}

function freezePoint(point: GeoPoint3D): GeoPoint3D {
  return Object.freeze({ longitude: point.longitude, latitude: point.latitude, altitude: point.altitude });
}

function freezePreview(preview: RoutePreview): RoutePreview {
  const polyline = Object.freeze(preview.polyline.map(freezePoint));
  return Object.freeze({
    routeId: preview.routeId,
    polyline,
    startMarker: freezePoint(preview.startMarker),
    endMarker: freezePoint(preview.endMarker),
    cameraBounds: Object.freeze({ ...preview.cameraBounds })
  });
}

function freezeRoutes(routes: readonly RouteSummary[]): readonly RouteSummary[] {
  return Object.freeze(routes.map((route) => Object.freeze({ ...route })));
}

function freezeNotice(notice: WorkspaceNotice | null): WorkspaceNotice | null {
  return notice === null ? null : Object.freeze({ ...notice });
}

function messageFor(error: LibraryError): string {
  return error.message ?? `Route library operation failed: ${error.code}`;
}

function createWorkspace(dependencies: RouteWorkspaceDependencies): RouteWorkspaceInstance {
  let current: WorkspaceSnapshot = Object.freeze({ phase: "ready", routes: Object.freeze([]), selectedRouteId: null, preview: null, notice: null });
  let listeners = new Set<WorkspaceListener>();

  const publish = (next: Omit<WorkspaceSnapshot, "routes" | "preview" | "notice"> & { routes: readonly RouteSummary[]; preview: RoutePreview | null; notice: WorkspaceNotice | null }): void => {
    current = Object.freeze({
      phase: next.phase,
      routes: freezeRoutes(next.routes),
      selectedRouteId: next.selectedRouteId,
      preview: next.preview === null ? null : freezePreview(next.preview),
      notice: freezeNotice(next.notice)
    });
    for (const listener of listeners) {
      try { listener(current); } catch { /* listeners cannot break the workspace */ }
    }
  };

  const noticeSnapshot = (notice: WorkspaceNotice): void => {
    publish({ ...current, phase: "ready", notice });
  };

  const syncLibrary = (): { routes: readonly RouteSummary[]; selectedRouteId: string | null; preview: RoutePreview | null } => {
    const routes = dependencies.library.list();
    const selected = dependencies.library.getSelected();
    if (selected === null) {
      dependencies.map.clearPreview();
      return { routes, selectedRouteId: null, preview: null };
    }
    const result = dependencies.library.getPreview(selected.routeId);
    if (!result.ok) throw result.error;
    const preview = freezePreview(result.value);
    dependencies.map.showPreview(preview);
    return { routes, selectedRouteId: selected.routeId, preview };
  };

  const failed = (reason: Exclude<WorkspaceCommandResult, { ok: true }>['reason'], error?: LibraryError): WorkspaceCommandResult => {
    const notice: WorkspaceNotice = Object.freeze({ code: error?.code ?? "ADAPTER_FAILED", message: error === undefined ? "Route workspace adapter failed." : messageFor(error) });
    noticeSnapshot(notice);
    return Object.freeze({ ok: false as const, reason, ...(error === undefined ? {} : { error }) });
  };

  const importFromPicker = async (): Promise<WorkspaceCommandResult> => {
    if (current.phase !== "ready") return Object.freeze({ ok: false as const, reason: "busy" as const });
    publish({ ...current, phase: "picking", notice: null });
    try {
      const selection = await dependencies.picker.pick();
      if (selection === null) {
        publish({ ...current, phase: "ready", notice: null });
        return Object.freeze({ ok: true as const, cancelled: true });
      }
      publish({ ...current, phase: "importing", notice: null });
      const result = await dependencies.library.importFile({ fileName: selection.fileName, bytes: new Uint8Array(selection.bytes) });
      if (!result.ok) return failed("import-failed", result.error);
      const synced = syncLibrary();
      publish({ phase: "ready", ...synced, notice: null });
      return Object.freeze({ ok: true as const, cancelled: false });
    } catch {
      return failed("adapter-failed");
    }
  };

  const select = (routeId: string): WorkspaceCommandResult => {
    if (current.phase !== "ready") return Object.freeze({ ok: false as const, reason: "busy" as const });
    try {
      const result = dependencies.library.select(routeId);
      if (!result.ok) return failed("select-failed", result.error);
      const synced = syncLibrary();
      publish({ phase: "ready", ...synced, notice: null });
      return Object.freeze({ ok: true as const });
    } catch {
      return failed("adapter-failed");
    }
  };

  const remove = (routeId: string): WorkspaceCommandResult => {
    if (current.phase !== "ready") return Object.freeze({ ok: false as const, reason: "busy" as const });
    try {
      const result = dependencies.library.remove(routeId);
      if (!result.ok) return failed("remove-failed", result.error);
      const synced = syncLibrary();
      publish({ phase: "ready", ...synced, notice: null });
      return Object.freeze({ ok: true as const });
    } catch {
      return failed("adapter-failed");
    }
  };

  const locateSelected = (): WorkspaceCommandResult => {
    if (current.preview === null) return Object.freeze({ ok: false as const, reason: "no-selection" as const });
    try {
      dependencies.map.locate(current.preview.cameraBounds);
      return Object.freeze({ ok: true as const });
    } catch {
      return failed("adapter-failed");
    }
  };

  return Object.freeze({
    snapshot: () => current,
    subscribe: (listener: WorkspaceListener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    importFromPicker,
    select,
    remove,
    locateSelected
  });
}

export const RouteWorkspace = Object.freeze({ create: createWorkspace });
