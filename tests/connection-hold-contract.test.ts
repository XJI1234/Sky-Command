import { describe, expect, it } from "vitest";
import { createConnectionHold } from "../src/production/operation-workflow/connection-hold.js";

describe("connection-hold", () => {
  it("true→false 需要滞回，false→true 立即恢复，unknown 立即显示", () => {
    const hold = createConnectionHold(1_000);
    expect(hold.hold("phone-1", "connected", true, 0)).toBe(true);
    expect(hold.hold("phone-1", "connected", false, 100)).toBe(true);
    expect(hold.hold("phone-1", "connected", false, 500)).toBe(true);
    expect(hold.hold("phone-1", "connected", false, 1_100)).toBe(false);
    expect(hold.hold("phone-1", "connected", true, 1_200)).toBe(true);
    expect(hold.hold("phone-1", "connected", undefined, 1_300)).toBeUndefined();
    expect(hold.hold("phone-1", "connected", false, 1_400)).toBe(false);
  });

  it("forget 清除设备滞回状态", () => {
    const hold = createConnectionHold(1_000);
    hold.hold("phone-1", "connected", true, 0);
    hold.hold("phone-1", "connected", false, 10);
    hold.forget("phone-1");
    expect(hold.hold("phone-1", "connected", false, 20)).toBe(false);
  });
});
