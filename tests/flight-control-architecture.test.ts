import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("flight-control 架构契约", () => {
  const root = join(process.cwd(), "src/modules/flight-control");
  const source = (name: string) => readFileSync(join(root, name), "utf8");

  it("建立了一级和两个职责单一的二级中文契约", () => {
    for (const file of ["CONTRACT.md", "dangerous-action-confirm/CONTRACT.md", "flight-command-dispatcher/CONTRACT.md"]) {
      const contract = source(file);
      expect(contract).toMatch(/[\u4e00-\u9fff]/u);
      expect(contract).not.toMatch(/TODO|TBD/i);
    }
  });

  it("组合根只组合公开二级模块，不导入平台或其他一级模块", () => {
    const rootSource = source("index.ts");
    expect(rootSource).toContain("DangerousActionConfirm");
    expect(rootSource).toContain("FlightCommandDispatcher");
    expect(rootSource).not.toMatch(/from\s+["'](?:electron|ws|node:|\.\.\/mission-control|\.\.\/relay-link|\.\.\/device-console)/i);
    expect(rootSource).not.toMatch(/WebSocket|Dji|DJI|document|window|fetch/i);
  });

  it("二级模块只依赖注入端口和确认类型，不反向导入业务实现", () => {
    const confirm = source("dangerous-action-confirm/index.ts");
    const dispatcher = source("flight-command-dispatcher/index.ts");
    expect(confirm).not.toMatch(/import |WebSocket|Dji|DJI|document|window|setTimeout/i);
    expect(dispatcher).toMatch(/import type \{ FlightAction \}/);
    expect(dispatcher).not.toMatch(/relay-link|mission-control|device-console|WebSocket|Dji|DJI|document|window/i);
  });
});
