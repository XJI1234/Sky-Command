import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { PlanWorkspace } from "../src/modules/route-planning/plan-workspace/index.js";
import { RoutePlanningDomain } from "../src/modules/route-planning/planning-domain/index.js";

it("航线规划工作区可在界面交互预算内连续生成一千份环绕草案", () => {
  const workspace = PlanWorkspace.create({
    planner: { planOrbit: RoutePlanningDomain.planOrbit },
    map: { showPlan: () => undefined, clearPlan: () => undefined, locate: () => undefined }
  });
  const started = performance.now();
  for (let index = 0; index < 1_000; index += 1) {
    workspace.setCenter({ longitude: 120, latitude: 30 });
    workspace.setEdge({ longitude: 120, latitude: 30.001 + index / 1_000_000_000 });
    expect(workspace.buildOrbit()).toEqual({ ok: true });
  }
  expect(performance.now() - started).toBeLessThan(1_000);
});
