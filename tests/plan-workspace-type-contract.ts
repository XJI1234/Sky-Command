import { PlanWorkspace, type PlanWorkspaceDependencies, type PlanWorkspaceSnapshot } from "../src/modules/route-planning/plan-workspace/index.js";

declare const dependencies: PlanWorkspaceDependencies;
const workspace = PlanWorkspace.create(dependencies);
const snapshot: PlanWorkspaceSnapshot = workspace.snapshot();
void workspace;
void snapshot;

// @ts-expect-error 工作区快照不可变。
snapshot.altitudeMeters = 1;
// @ts-expect-error 工作区计划不可变。
snapshot.plan = null;
