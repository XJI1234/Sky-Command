import type { OrbitPlan, PlanningPoint, PlanningResult } from "../planning-domain/index.js";

export interface PlanWorkspacePoint {
  readonly longitude: number;
  readonly latitude: number;
}

export interface PlanWorkspaceParameters {
  readonly altitudeMeters: number;
  readonly waypointCount: number;
}

export interface PlanWorkspaceBounds {
  readonly minLongitude: number;
  readonly maxLongitude: number;
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly minAltitude: number;
  readonly maxAltitude: number;
}

export interface PlanWorkspacePlannerPort {
  readonly planOrbit: (input: unknown) => PlanningResult<OrbitPlan>;
}

export interface PlanWorkspaceMapPort {
  readonly showPlan: (plan: OrbitPlan) => void;
  readonly clearPlan: () => void;
  readonly locate: (bounds: PlanWorkspaceBounds) => void;
}

export interface PlanWorkspaceDependencies {
  readonly planner: PlanWorkspacePlannerPort;
  readonly map: PlanWorkspaceMapPort;
}

export interface PlanWorkspaceNotice {
  readonly code: "PLANNING_FAILED" | "ADAPTER_FAILED";
  readonly message: string;
}

export interface PlanWorkspaceSnapshot {
  readonly center: PlanWorkspacePoint | null;
  readonly edge: PlanWorkspacePoint | null;
  readonly altitudeMeters: number;
  readonly waypointCount: number;
  readonly plan: OrbitPlan | null;
  readonly notice: PlanWorkspaceNotice | null;
}

export type PlanWorkspaceCommandResult =
  | Readonly<{ readonly ok: true }>
  | Readonly<{ readonly ok: false; readonly reason: "invalid-point" | "invalid-parameters" | "incomplete-input" | "planning-failed" | "no-plan" | "adapter-failed" }>;

export type PlanWorkspaceListener = (snapshot: PlanWorkspaceSnapshot) => void;

export interface PlanWorkspaceInstance {
  readonly snapshot: () => PlanWorkspaceSnapshot;
  readonly subscribe: (listener: PlanWorkspaceListener) => () => void;
  readonly setCenter: (point: unknown) => PlanWorkspaceCommandResult;
  readonly setEdge: (point: unknown) => PlanWorkspaceCommandResult;
  readonly setParameters: (parameters: unknown) => PlanWorkspaceCommandResult;
  readonly buildOrbit: () => PlanWorkspaceCommandResult;
  readonly locatePlan: () => PlanWorkspaceCommandResult;
  readonly clear: () => PlanWorkspaceCommandResult;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function accepted(): PlanWorkspaceCommandResult {
  return freeze({ ok: true as const });
}

function rejected(reason: Exclude<PlanWorkspaceCommandResult, { readonly ok: true }>['reason']): PlanWorkspaceCommandResult {
  return freeze({ ok: false as const, reason });
}

function point(value: unknown): PlanWorkspacePoint | null {
  // Stryker disable next-line all: removing either primitive/null short-circuit is observationally equivalent because the guarded property read is caught below and returns null.
  if (value === null || typeof value !== "object") return null;
  try {
    const candidate = value as PlanningPoint;
    if (!Number.isFinite(candidate.longitude) || candidate.longitude < -180 || candidate.longitude > 180) return null;
    if (!Number.isFinite(candidate.latitude) || candidate.latitude < -90 || candidate.latitude > 90) return null;
    return freeze({ longitude: candidate.longitude, latitude: candidate.latitude });
  } catch {
    return null;
  }
}

function parameters(value: unknown): PlanWorkspaceParameters | null {
  // Stryker disable next-line all: removing either primitive/null short-circuit is observationally equivalent because the guarded property read is caught below and returns null.
  if (value === null || typeof value !== "object") return null;
  try {
    const candidate = value as PlanWorkspaceParameters;
    if (!Number.isFinite(candidate.altitudeMeters) || candidate.altitudeMeters < 1 || candidate.altitudeMeters > 500) return null;
    if (!Number.isSafeInteger(candidate.waypointCount) || candidate.waypointCount < 4 || candidate.waypointCount > 360) return null;
    return freeze({ altitudeMeters: candidate.altitudeMeters, waypointCount: candidate.waypointCount });
  } catch {
    return null;
  }
}

function copyPoint(value: PlanningPoint): PlanWorkspacePoint {
  return freeze({ longitude: value.longitude, latitude: value.latitude });
}

function copyPlan(value: OrbitPlan): OrbitPlan {
  const center = copyPoint(value.center);
  const waypoints = freeze(value.waypoints.map((waypoint) => freeze({ sequence: waypoint.sequence, longitude: waypoint.longitude, latitude: waypoint.latitude, altitudeMeters: waypoint.altitudeMeters })));
  return freeze({ kind: "orbit", center, radiusMeters: value.radiusMeters, altitudeMeters: value.altitudeMeters, waypoints });
}

function boundsFor(plan: OrbitPlan): PlanWorkspaceBounds {
  const longitudes = plan.waypoints.map((waypoint) => waypoint.longitude);
  const latitudes = plan.waypoints.map((waypoint) => waypoint.latitude);
  return freeze({
    minLongitude: Math.min(...longitudes),
    maxLongitude: Math.max(...longitudes),
    minLatitude: Math.min(...latitudes),
    maxLatitude: Math.max(...latitudes),
    minAltitude: plan.altitudeMeters,
    maxAltitude: plan.altitudeMeters
  });
}

function notice(code: PlanWorkspaceNotice["code"]): PlanWorkspaceNotice {
  return freeze({
    code,
    message: code === "PLANNING_FAILED" ? "当前输入无法生成环绕航线。" : "地图适配器未能完成当前操作。"
  });
}

function freezeSnapshot(value: PlanWorkspaceSnapshot): PlanWorkspaceSnapshot {
  return freeze({
    center: value.center === null ? null : copyPoint(value.center),
    edge: value.edge === null ? null : copyPoint(value.edge),
    altitudeMeters: value.altitudeMeters,
    waypointCount: value.waypointCount,
    plan: value.plan === null ? null : copyPlan(value.plan),
    notice: value.notice === null ? null : freeze({ code: value.notice.code, message: value.notice.message })
  });
}

function create(dependencies: PlanWorkspaceDependencies): PlanWorkspaceInstance {
  let current = freezeSnapshot({ center: null, edge: null, altitudeMeters: 80, waypointCount: 36, plan: null, notice: null });
  const listeners = new Set<PlanWorkspaceListener>();

  const publish = (next: PlanWorkspaceSnapshot): void => {
    current = freezeSnapshot(next);
    for (const listener of listeners) {
      try {
        listener(current);
      } catch {
        // 视图订阅者故障不得阻断其他订阅者或业务命令。
      }
    }
  };

  const setCenter = (value: unknown): PlanWorkspaceCommandResult => {
    const nextPoint = point(value);
    if (nextPoint === null) return rejected("invalid-point");
    publish({ ...current, center: nextPoint, notice: null });
    return accepted();
  };

  const setEdge = (value: unknown): PlanWorkspaceCommandResult => {
    const nextPoint = point(value);
    if (nextPoint === null) return rejected("invalid-point");
    publish({ ...current, edge: nextPoint, notice: null });
    return accepted();
  };

  const setParameters = (value: unknown): PlanWorkspaceCommandResult => {
    const nextParameters = parameters(value);
    if (nextParameters === null) return rejected("invalid-parameters");
    publish({ ...current, ...nextParameters, notice: null });
    return accepted();
  };

  const buildOrbit = (): PlanWorkspaceCommandResult => {
    if (current.center === null || current.edge === null) return rejected("incomplete-input");
    let nextPlan: OrbitPlan;
    try {
      const result = dependencies.planner.planOrbit({
        center: copyPoint(current.center),
        edge: copyPoint(current.edge),
        altitudeMeters: current.altitudeMeters,
        waypointCount: current.waypointCount
      });
      if (!result.ok) {
        publish({ ...current, notice: notice("PLANNING_FAILED") });
        return rejected("planning-failed");
      }
      nextPlan = copyPlan(result.value);
    } catch {
      publish({ ...current, notice: notice("ADAPTER_FAILED") });
      return rejected("adapter-failed");
    }
    try {
      dependencies.map.showPlan(nextPlan);
    } catch {
      publish({ ...current, plan: nextPlan, notice: notice("ADAPTER_FAILED") });
      return rejected("adapter-failed");
    }
    publish({ ...current, plan: nextPlan, notice: null });
    return accepted();
  };

  const locatePlan = (): PlanWorkspaceCommandResult => {
    if (current.plan === null) return rejected("no-plan");
    try {
      dependencies.map.locate(boundsFor(current.plan));
      return accepted();
    } catch {
      publish({ ...current, notice: notice("ADAPTER_FAILED") });
      return rejected("adapter-failed");
    }
  };

  const clear = (): PlanWorkspaceCommandResult => {
    try {
      dependencies.map.clearPlan();
    } catch {
      publish({ ...current, plan: null, notice: notice("ADAPTER_FAILED") });
      return rejected("adapter-failed");
    }
    publish({ ...current, plan: null, notice: null });
    return accepted();
  };

  return freeze({
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setCenter,
    setEdge,
    setParameters,
    buildOrbit,
    locatePlan,
    clear
  });
}

// Stryker disable next-line ObjectLiteral: this module-static facade is verified by descriptor tests; Vitest's transformed static import cannot observe the empty-object mutant.
export const PlanWorkspace = Object.freeze({ create });
