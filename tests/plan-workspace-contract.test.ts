import { describe, expect, it, vi } from "vitest";
import type { OrbitPlan, PlanningResult } from "../src/modules/route-planning/planning-domain/index.js";
import { PlanWorkspace, type PlanWorkspaceDependencies } from "../src/modules/route-planning/plan-workspace/index.js";

const plan: OrbitPlan = Object.freeze({
  kind: "orbit",
  center: Object.freeze({ longitude: 120, latitude: 30 }),
  radiusMeters: 111.319,
  altitudeMeters: 80,
  waypoints: Object.freeze([
    Object.freeze({ sequence: 0, longitude: 120, latitude: 30.001, altitudeMeters: 80 }),
    Object.freeze({ sequence: 1, longitude: 120.001, latitude: 30, altitudeMeters: 80 }),
    Object.freeze({ sequence: 2, longitude: 120, latitude: 29.999, altitudeMeters: 80 }),
    Object.freeze({ sequence: 3, longitude: 119.999, latitude: 30, altitudeMeters: 80 })
  ])
});

function createDependencies(overrides: Partial<PlanWorkspaceDependencies> = {}): PlanWorkspaceDependencies & { readonly shown: OrbitPlan[]; readonly cleared: number[]; readonly located: unknown[] } {
  const shown: OrbitPlan[] = [];
  const cleared: number[] = [];
  const located: unknown[] = [];
  return {
    planner: { planOrbit: vi.fn((): PlanningResult<OrbitPlan> => Object.freeze({ ok: true as const, value: plan })) },
    map: { showPlan: (candidate) => shown.push(candidate), clearPlan: () => cleared.push(1), locate: (bounds) => located.push(bounds) },
    shown,
    cleared,
    located,
    ...overrides
  };
}

describe("航线规划工作区契约", () => {
  it("协调地图取点、参数和环绕计划预览", () => {
    const dependencies = createDependencies();
    const workspace = PlanWorkspace.create(dependencies);

    expect(workspace.snapshot()).toEqual({ center: null, edge: null, altitudeMeters: 80, waypointCount: 36, plan: null, notice: null });
    expect(workspace.setCenter({ longitude: 120, latitude: 30 })).toEqual({ ok: true });
    expect(workspace.setEdge({ longitude: 120, latitude: 30.001 })).toEqual({ ok: true });
    expect(workspace.setParameters({ altitudeMeters: 120, waypointCount: 12 })).toEqual({ ok: true });
    expect(workspace.buildOrbit()).toEqual({ ok: true });
    expect(dependencies.planner.planOrbit).toHaveBeenCalledWith({ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120, latitude: 30.001 }, altitudeMeters: 120, waypointCount: 12 });
    expect(dependencies.shown).toEqual([plan]);
    expect(workspace.snapshot()).toMatchObject({ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120, latitude: 30.001 }, altitudeMeters: 120, waypointCount: 12, plan, notice: null });
  });

  it("拒绝不完整和非法交互输入而不调用端口", () => {
    const dependencies = createDependencies();
    const workspace = PlanWorkspace.create(dependencies);
    expect(workspace.buildOrbit()).toEqual({ ok: false, reason: "incomplete-input" });
    expect(workspace.setCenter({ longitude: 181, latitude: 0 })).toEqual({ ok: false, reason: "invalid-point" });
    expect(workspace.setEdge(null)).toEqual({ ok: false, reason: "invalid-point" });
    expect(workspace.setParameters({ altitudeMeters: 0, waypointCount: 4 })).toEqual({ ok: false, reason: "invalid-parameters" });
    expect(workspace.setParameters({ altitudeMeters: 80, waypointCount: 4.1 })).toEqual({ ok: false, reason: "invalid-parameters" });
    expect(dependencies.planner.planOrbit).not.toHaveBeenCalled();
  });

  it("把取点和参数对象中的异常 getter 作为无效交互输入处理", () => {
    const workspace = PlanWorkspace.create(createDependencies());
    const hostilePoint = new Proxy({}, { get() { throw new Error("point secret"); } });
    const hostileParameters = new Proxy({}, { get() { throw new Error("parameter secret"); } });
    expect(workspace.setCenter(hostilePoint)).toEqual({ ok: false, reason: "invalid-point" });
    expect(workspace.setParameters(hostileParameters)).toEqual({ ok: false, reason: "invalid-parameters" });
  });

  it("验证完整纬度谓词和非对象参数容器", () => {
    const workspace = PlanWorkspace.create(createDependencies());
    expect(workspace.setCenter({ longitude: 120, latitude: 91 })).toEqual({ ok: false, reason: "invalid-point" });
    expect(workspace.setParameters("not-an-object")).toEqual({ ok: false, reason: "invalid-parameters" });
  });

  it.each([
    [{ longitude: Number.NaN, latitude: 0 }],
    [{ longitude: -180.001, latitude: 0 }],
    [{ longitude: 180.001, latitude: 0 }],
    [{ longitude: 0, latitude: Number.NaN }],
    [{ longitude: 0, latitude: -90.001 }],
    ["not-a-point"]
  ])("拒绝每一种非法中心点坐标", (candidate) => {
    const workspace = PlanWorkspace.create(createDependencies());
    expect(workspace.setCenter(candidate)).toEqual({ ok: false, reason: "invalid-point" });
  });

  it("接受经纬度和参数的每个闭区间端点", () => {
    const workspace = PlanWorkspace.create(createDependencies());
    expect(workspace.setCenter({ longitude: -180, latitude: -90 })).toEqual({ ok: true });
    expect(workspace.setEdge({ longitude: 180, latitude: 90 })).toEqual({ ok: true });
    expect(workspace.setParameters({ altitudeMeters: 1, waypointCount: 4 })).toEqual({ ok: true });
    expect(workspace.setParameters({ altitudeMeters: 500, waypointCount: 360 })).toEqual({ ok: true });
  });

  it.each([
    [{ altitudeMeters: Number.NaN, waypointCount: 4 }],
    [{ altitudeMeters: 0, waypointCount: 4 }],
    [{ altitudeMeters: 501, waypointCount: 4 }],
    [{ altitudeMeters: 80, waypointCount: Number.NaN }],
    [{ altitudeMeters: 80, waypointCount: 3 }],
    [{ altitudeMeters: 80, waypointCount: 361 }]
  ])("拒绝每一种非法参数值", (candidate) => {
    const workspace = PlanWorkspace.create(createDependencies());
    expect(workspace.setParameters(candidate)).toEqual({ ok: false, reason: "invalid-parameters" });
  });

  it("隔离领域与地图端口故障，并在预览失败时保留已生成计划", () => {
    const rejected: PlanningResult<OrbitPlan> = Object.freeze({ ok: false as const, error: Object.freeze({ code: "INVALID_RADIUS", details: Object.freeze({ field: "radiusMeters", reason: "out-of-range" }) }) });
    const failedPlanner = createDependencies({ planner: { planOrbit: () => rejected } });
    const plannerWorkspace = PlanWorkspace.create(failedPlanner);
    plannerWorkspace.setCenter({ longitude: 120, latitude: 30 });
    plannerWorkspace.setEdge({ longitude: 120, latitude: 30.001 });
    expect(plannerWorkspace.buildOrbit()).toEqual({ ok: false, reason: "planning-failed" });
    expect(plannerWorkspace.snapshot()).toMatchObject({ plan: null, notice: { code: "PLANNING_FAILED", message: "当前输入无法生成环绕航线。" } });

    const failedMap = createDependencies({ map: { showPlan: () => { throw new Error("map secret"); }, clearPlan: () => undefined, locate: () => undefined } });
    const mapWorkspace = PlanWorkspace.create(failedMap);
    mapWorkspace.setCenter({ longitude: 120, latitude: 30 });
    mapWorkspace.setEdge({ longitude: 120, latitude: 30.001 });
    expect(mapWorkspace.buildOrbit()).toEqual({ ok: false, reason: "adapter-failed" });
    expect(mapWorkspace.snapshot()).toMatchObject({ plan, notice: { code: "ADAPTER_FAILED", message: "地图适配器未能完成当前操作。" } });
    expect(JSON.stringify(mapWorkspace.snapshot())).not.toContain("map secret");
  });

  it("把规划器返回的不可读成功值视为适配器故障且不污染已有状态", () => {
    const hostilePlan = new Proxy({}, { get() { throw new Error("planner secret"); } }) as OrbitPlan;
    const dependencies = createDependencies({ planner: { planOrbit: () => Object.freeze({ ok: true as const, value: hostilePlan }) } });
    const workspace = PlanWorkspace.create(dependencies);
    workspace.setCenter({ longitude: 120, latitude: 30 });
    workspace.setEdge({ longitude: 120, latitude: 30.001 });

    expect(workspace.buildOrbit()).toEqual({ ok: false, reason: "adapter-failed" });
    expect(workspace.snapshot()).toMatchObject({ plan: null, notice: { code: "ADAPTER_FAILED" } });
    expect(JSON.stringify(workspace.snapshot())).not.toContain("planner secret");
  });

  it("把规划器结果对象的异常 getter 隔离为适配器故障", () => {
    const hostileResult = new Proxy({}, { get() { throw new Error("result secret"); } }) as PlanningResult<OrbitPlan>;
    const workspace = PlanWorkspace.create(createDependencies({ planner: { planOrbit: () => hostileResult } }));
    workspace.setCenter({ longitude: 120, latitude: 30 });
    workspace.setEdge({ longitude: 120, latitude: 30.001 });

    expect(workspace.buildOrbit()).toEqual({ ok: false, reason: "adapter-failed" });
    expect(workspace.snapshot()).toMatchObject({ plan: null, notice: { code: "ADAPTER_FAILED" } });
  });

  it("定位、清除、监听器隔离和快照不可变性都遵守契约", () => {
    const dependencies = createDependencies();
    const workspace = PlanWorkspace.create(dependencies);
    const noisy = vi.fn(() => { throw new Error("listener"); });
    const healthy = vi.fn();
    const unsubscribe = workspace.subscribe(noisy);
    workspace.subscribe(healthy);
    expect(workspace.locatePlan()).toEqual({ ok: false, reason: "no-plan" });
    workspace.setCenter({ longitude: 120, latitude: 30 });
    workspace.setEdge({ longitude: 120, latitude: 30.001 });
    workspace.buildOrbit();
    expect(workspace.locatePlan()).toEqual({ ok: true });
    expect(dependencies.located).toEqual([{ minLongitude: 119.999, maxLongitude: 120.001, minLatitude: 29.999, maxLatitude: 30.001, minAltitude: 80, maxAltitude: 80 }]);
    const snapshot = workspace.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.center)).toBe(true);
    expect(Object.isFrozen(snapshot.plan)).toBe(true);
    expect(Object.isFrozen(snapshot.plan!.waypoints)).toBe(true);
    expect(workspace.clear()).toEqual({ ok: true });
    expect(dependencies.cleared).toEqual([1]);
    expect(workspace.snapshot()).toMatchObject({ plan: null, notice: null });
    unsubscribe();
    workspace.setCenter({ longitude: 121, latitude: 31 });
    expect(noisy).toHaveBeenCalled();
    expect(healthy.mock.calls.length).toBeGreaterThan(noisy.mock.calls.length);
  });

  it("每个实例的输入和状态互不共享", () => {
    const first = PlanWorkspace.create(createDependencies());
    const second = PlanWorkspace.create(createDependencies());
    const point = { longitude: 120, latitude: 30 };
    first.setCenter(point);
    point.longitude = 0;
    expect(first.snapshot().center).toEqual({ longitude: 120, latitude: 30 });
    expect(second.snapshot()).toMatchObject({ center: null, edge: null, plan: null });
  });

  it("定位或清除地图失败时返回稳定错误并保留契约规定的本地状态", () => {
    const locateFailure = PlanWorkspace.create(createDependencies({ map: { showPlan: () => undefined, clearPlan: () => undefined, locate: () => { throw new Error("locate secret"); } } }));
    locateFailure.setCenter({ longitude: 120, latitude: 30 });
    locateFailure.setEdge({ longitude: 120, latitude: 30.001 });
    locateFailure.buildOrbit();
    expect(locateFailure.locatePlan()).toEqual({ ok: false, reason: "adapter-failed" });
    expect(locateFailure.snapshot()).toMatchObject({ plan, notice: { code: "ADAPTER_FAILED" } });

    const clearFailure = PlanWorkspace.create(createDependencies({ map: { showPlan: () => undefined, clearPlan: () => { throw new Error("clear secret"); }, locate: () => undefined } }));
    clearFailure.setCenter({ longitude: 120, latitude: 30 });
    clearFailure.setEdge({ longitude: 120, latitude: 30.001 });
    clearFailure.buildOrbit();
    expect(clearFailure.clear()).toEqual({ ok: false, reason: "adapter-failed" });
    expect(clearFailure.snapshot()).toMatchObject({ plan: null, notice: { code: "ADAPTER_FAILED" } });
  });

  it("中心点和边缘点各自缺失都会阻止规划", () => {
    const missingCenter = createDependencies();
    const onlyEdge = PlanWorkspace.create(missingCenter);
    onlyEdge.setEdge({ longitude: 120, latitude: 30.001 });
    expect(onlyEdge.buildOrbit()).toEqual({ ok: false, reason: "incomplete-input" });
    expect(missingCenter.planner.planOrbit).not.toHaveBeenCalled();

    const missingEdge = createDependencies();
    const onlyCenter = PlanWorkspace.create(missingEdge);
    onlyCenter.setCenter({ longitude: 120, latitude: 30 });
    expect(onlyCenter.buildOrbit()).toEqual({ ok: false, reason: "incomplete-input" });
    expect(missingEdge.planner.planOrbit).not.toHaveBeenCalled();
  });

  it("公开门面只暴露不可变的创建入口", () => {
    expect(Object.getPrototypeOf(PlanWorkspace)).toBe(Object.prototype);
    expect(Object.isFrozen(PlanWorkspace)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(PlanWorkspace, "create")).toEqual({ value: PlanWorkspace.create, enumerable: true, writable: false, configurable: false });
  });
});
