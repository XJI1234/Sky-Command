import { RoutePlanningBuildingFootprint } from "./building-footprint-planner/index.js";
import { RoutePlanningObstacleAnalysis } from "./obstacle-analysis/index.js";
import { PlanWorkspace } from "./plan-workspace/index.js";
import { RoutePlanningDomain } from "./planning-domain/index.js";

export { RoutePlanningBuildingFootprint } from "./building-footprint-planner/index.js";
export { RoutePlanningObstacleAnalysis } from "./obstacle-analysis/index.js";
export { PlanWorkspace } from "./plan-workspace/index.js";
export { RoutePlanningDomain } from "./planning-domain/index.js";

// Stryker disable next-line ObjectLiteral: the module-static frozen facade is verified by descriptor and delegation tests; Vitest cannot re-observe this static object-literal mutant after transformed module loading.
export const RoutePlanning = Object.freeze({
  planOrbit: RoutePlanningDomain.planOrbit,
  planBuildingFootprint: RoutePlanningBuildingFootprint.plan,
  analyzeObstacles: RoutePlanningObstacleAnalysis.analyze,
  createWorkspace: PlanWorkspace.create
});
