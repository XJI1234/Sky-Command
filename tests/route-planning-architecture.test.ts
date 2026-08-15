import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("航线规划一级模块架构契约", () => {
  it("只组合本一级模块的公开二级模块，不引入文件、网络、地图引擎或任务实现", async () => {
    const source = await readFile(new URL("../src/modules/route-planning/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|ws|cesium|tian|dji|route-library|relay-link|mission-control|geo-map)[^"']*["']/iu);
    expect(source).toContain("RoutePlanningDomain");
    expect(source).toContain("RoutePlanningBuildingFootprint");
    expect(source).toContain("RoutePlanningObstacleAnalysis");
    expect(source).toContain("PlanWorkspace");
  });
});
