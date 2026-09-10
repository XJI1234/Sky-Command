import { describe, expect, it } from "vitest";
import {
  ARM_HOLD_MS,
  ARM_SETTLE_MS,
  ActionArm,
  adoptPendingConfirmation,
  buttonLabel,
  confirmationCreatedByRequest,
  confirmationMatchesClick,
  expireArm,
  flightConfirmDispatch,
  flightWorkflowAction,
  interpretArmClick,
  isSameClickFlightConfirm,
  sameClickConfirmDispatch,
} from "../src/production/operator-console/action-arm/index.js";

const takeoff = Object.freeze({
  deviceId: "phone-1",
  action: "takeoff",
  confirmationId: "conf-takeoff",
  expiresAtMs: 20_000,
});
const stopTakeoff = Object.freeze({
  deviceId: "phone-1",
  action: "stop-takeoff",
  confirmationId: "conf-stop",
  expiresAtMs: 20_000,
});

describe("飞行页两下确认", () => {
  it("起飞降落返航和执行航线点一下只武装，连点忽略，过了settle再点才确认", () => {
    const armed = interpretArmClick(null, "flight-takeoff", 1_000);
    expect(armed).toEqual({ kind: "arm", next: { action: "flight-takeoff", armedAtMs: 1_000 } });
    expect(interpretArmClick(armed.next, "flight-takeoff", 1_000 + ARM_SETTLE_MS - 1)).toEqual({
      kind: "ignore",
      next: armed.next,
    });
    expect(interpretArmClick(armed.next, "flight-takeoff", 1_000 + ARM_SETTLE_MS)).toEqual({
      kind: "confirm",
      next: null,
    });
    expect(buttonLabel("flight-takeoff", armed.next)).toBe("确认起飞");
    expect(buttonLabel("mission-start", null)).toBe("执行航线");
    expect(buttonLabel("mission-start", { action: "mission-start", armedAtMs: 1 })).toBe("确认执行航线");
  });

  it("五秒过期后同一键重新武装，点其他键解除武装", () => {
    const armed = { action: "flight-land" as const, armedAtMs: 10_000 };
    expect(expireArm(armed, 10_000 + ARM_HOLD_MS - 1)).toEqual(armed);
    expect(expireArm(armed, 10_000 + ARM_HOLD_MS)).toBeNull();
    expect(interpretArmClick(armed, "flight-land", 10_000 + ARM_HOLD_MS)).toMatchObject({ kind: "arm" });
    expect(interpretArmClick(armed, "flight-return-home", 10_100)).toMatchObject({
      kind: "arm",
      next: { action: "flight-return-home" },
    });
    expect(interpretArmClick(armed, "flight-stop-auto-landing", 10_100)).toEqual({ kind: "disarm", next: null });
    expect(ActionArm.ARM_HOLD_MS).toBe(5_000);
  });

  it("确认降落和停止类不走两下确认", () => {
    expect(isSameClickFlightConfirm("flight-confirm-landing")).toBe(true);
    expect(isSameClickFlightConfirm("flight-stop-takeoff")).toBe(true);
    expect(isSameClickFlightConfirm("flight-stop-auto-landing")).toBe(true);
    expect(isSameClickFlightConfirm("flight-takeoff")).toBe(false);
    expect(isSameClickFlightConfirm("mission-stop")).toBe(false);
  });

  it("待确认只能被同一台手机的同一动作消费，过期或残留起飞不能被停止键发出", () => {
    expect(flightWorkflowAction("flight-stop-takeoff")).toBe("stop-takeoff");
    expect(confirmationMatchesClick(takeoff, { deviceId: "phone-1", uiAction: "flight-takeoff", nowMs: 10_000 })).toBe(true);
    expect(confirmationMatchesClick(takeoff, { deviceId: "phone-1", uiAction: "flight-stop-takeoff", nowMs: 10_000 })).toBe(false);
    expect(confirmationMatchesClick(takeoff, { deviceId: "phone-2", uiAction: "flight-takeoff", nowMs: 10_000 })).toBe(false);
    expect(confirmationMatchesClick(takeoff, { deviceId: "phone-1", uiAction: "flight-takeoff", nowMs: 20_000 })).toBe(false);
    expect(flightConfirmDispatch(null, { deviceId: "phone-1", uiAction: "flight-takeoff", nowMs: 10_000 })).toEqual({ kind: "wait" });
    expect(flightConfirmDispatch(takeoff, { deviceId: "phone-1", uiAction: "flight-land", nowMs: 10_000 })).toEqual({ kind: "wait" });
    expect(flightConfirmDispatch(takeoff, { deviceId: "phone-1", uiAction: "flight-takeoff", nowMs: 10_000 })).toEqual({
      kind: "dispatch",
      confirmation: takeoff,
    });
  });

  it("同一点击内的确认只能消费这次请求新建的意图，失败时不得拿上次残留去调 MSDK", () => {
    expect(confirmationCreatedByRequest(stopTakeoff, "conf-takeoff", {
      deviceId: "phone-1",
      uiAction: "flight-stop-takeoff",
      nowMs: 10_000,
    })).toBe(true);
    expect(confirmationCreatedByRequest(takeoff, "conf-takeoff", {
      deviceId: "phone-1",
      uiAction: "flight-stop-takeoff",
      nowMs: 10_000,
    })).toBe(false);
    expect(sameClickConfirmDispatch(takeoff, "conf-takeoff", {
      deviceId: "phone-1",
      uiAction: "flight-stop-takeoff",
      nowMs: 10_000,
    })).toEqual({ kind: "wait" });
    expect(sameClickConfirmDispatch(stopTakeoff, "conf-takeoff", {
      deviceId: "phone-1",
      uiAction: "flight-stop-takeoff",
      nowMs: 10_000,
    })).toEqual({ kind: "dispatch", confirmation: stopTakeoff });
  });

  it("本地刚拿到的确认不能被过期快照里的另一种动作盖掉", () => {
    expect(adoptPendingConfirmation(stopTakeoff, takeoff, 10_000)).toEqual(stopTakeoff);
    expect(adoptPendingConfirmation(null, takeoff, 10_000)).toEqual(takeoff);
    const laterStop = Object.freeze({ ...stopTakeoff, expiresAtMs: 30_000 });
    expect(adoptPendingConfirmation(takeoff, laterStop, 20_000)).toEqual(laterStop);
    expect(adoptPendingConfirmation(takeoff, null, 20_000)).toBeNull();
  });
});
