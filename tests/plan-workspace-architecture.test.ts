import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("航线规划工作区架构契约", () => {
  it("仅依赖规划领域类型与注入端口，不引入平台、地图引擎或任务模块", async () => {
    const source = await readFile(new URL("../src/modules/route-planning/plan-workspace/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:vue|react|electron|cesium|tian|dji|node:|route-library|relay-link|mission-control|geo-map)[^"']*["']/iu);
    expect(source).toContain("PlanWorkspacePlannerPort");
    expect(source).toContain("PlanWorkspaceMapPort");
  });
});
