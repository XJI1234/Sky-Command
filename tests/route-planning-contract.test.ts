import { expect, it } from "vitest";
import { RoutePlanning } from "../src/modules/route-planning/index.js";
import { RoutePlanningBuildingFootprint } from "../src/modules/route-planning/building-footprint-planner/index.js";
import { RoutePlanningObstacleAnalysis } from "../src/modules/route-planning/obstacle-analysis/index.js";
import { PlanWorkspace } from "../src/modules/route-planning/plan-workspace/index.js";
import { RoutePlanningDomain } from "../src/modules/route-planning/planning-domain/index.js";

it("通过一个冻结门面公开航线规划能力和工作区工厂", () => {
  expect(Object.isFrozen(RoutePlanning)).toBe(true);
  expect(typeof RoutePlanning.planOrbit).toBe("function");
  expect(typeof RoutePlanning.planBuildingFootprint).toBe("function");
  expect(typeof RoutePlanning.analyzeObstacles).toBe("function");
  expect(typeof RoutePlanning.createWorkspace).toBe("function");
  expect(Object.getPrototypeOf(RoutePlanning)).toBe(Object.prototype);
  expect(RoutePlanning.planOrbit).toBe(RoutePlanningDomain.planOrbit);
  expect(RoutePlanning.planBuildingFootprint).toBe(RoutePlanningBuildingFootprint.plan);
  expect(RoutePlanning.analyzeObstacles).toBe(RoutePlanningObstacleAnalysis.analyze);
  expect(RoutePlanning.createWorkspace).toBe(PlanWorkspace.create);
  expect(Object.getOwnPropertyDescriptor(RoutePlanning, "planOrbit")).toEqual({ value: RoutePlanning.planOrbit, enumerable: true, writable: false, configurable: false });
});
