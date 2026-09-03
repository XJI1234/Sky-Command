import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SourceFiniteInventory } from "../src/modules/cross-runtime-e2e/source-finite-inventory/index.js";
import baseline from "../src/modules/cross-runtime-e2e/source-finite-inventory/baseline.json";

describe("生产源码有限状态与枚举盘点", () => {
  it("两端生产源码的公开有限集合必须与审阅基线完全一致", () => {
    const inventory = SourceFiniteInventory.collect({
      desktopRoot: resolve(process.cwd(), "src"),
      mobileRoot: resolve(process.cwd(), "../MSDK-relay/src"),
    });

    expect(inventory.entries.length).toBe(baseline.count);
    expect(inventory.digest).toBe(baseline.digest);
  }, 30_000);

  it("盘点必须包含协议帧、航线阶段和手机会话状态", () => {
    const inventory = SourceFiniteInventory.collect({
      desktopRoot: resolve(process.cwd(), "src"),
      mobileRoot: resolve(process.cwd(), "../MSDK-relay/src"),
    });
    const names = inventory.entries.map((entry) => `${entry.runtime}:${entry.name}`);
    expect(names).toContain("desktop:RelayFrame");
    expect(names).toContain("desktop:MissionPhase");
    expect(names).toContain("mobile:MissionPhase");
    expect(names).toContain("mobile:SessionState");
  }, 30_000);
});
