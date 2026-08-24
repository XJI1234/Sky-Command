import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("航线地图显示契约", () => {
  it("为折线中的每个内部航点创建独立点标记，同时保留首尾标记", async () => {
    const source = await readFile(new URL("../src/production/operator-console/renderer/route-map.ts", import.meta.url), "utf8");

    expect(source).toContain("preview.polyline.slice(1, -1)");
    expect(source).toContain("viewer.entities.add({");
    expect(source).toContain('name: `航点${index + 2}`');
    expect(source).toContain("point:");
  });
});
