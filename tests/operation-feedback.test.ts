import { describe, expect, it } from "vitest";
import { operationFeedback } from "../src/production/operator-console/renderer/operation-feedback.js";

describe("操作回调展示", () => {
  it("保留 DJI 飞行动作拒绝的原始错误码和说明", () => {
    const feedback = operationFeedback("flight-land", {
      ok: true,
      value: {
        ok: false,
        action: "land",
        code: "FLIGHT_ACTION_REJECTED",
        platformError: { code: "COMMON_SYSTEM_BUSY", description: "The aircraft is busy" },
      },
    });

    expect(feedback.source).toBe("dji");
    expect(feedback.outcome).toBe("rejected");
    expect(feedback.message).toContain("COMMON_SYSTEM_BUSY");
    expect(feedback.message).toContain("The aircraft is busy");
  });

  it("保留 DJI 图传动作拒绝的原始错误码和说明", () => {
    const feedback = operationFeedback("stream-start", {
      ok: false,
      operation: "start",
      code: "STREAM_ACTION_REJECTED",
      platformError: { code: "COMMON_SYSTEM_BUSY", description: "The live stream manager is busy" },
    });

    expect(feedback.source).toBe("dji");
    expect(feedback.outcome).toBe("rejected");
    expect(feedback.message).toContain("启动图传");
    expect(feedback.message).toContain("COMMON_SYSTEM_BUSY");
    expect(feedback.message).toContain("The live stream manager is busy");
  });

  it("将 DJI 成功回调与物理动作完成明确分开", () => {
    const feedback = operationFeedback("flight-land", {
      ok: true,
      value: { ok: true, action: "land", code: "SUCCEEDED" },
    });

    expect(feedback.source).toBe("dji");
    expect(feedback.outcome).toBe("accepted");
    expect(feedback.message).toContain("SUCCEEDED");
    expect(feedback.message).toContain("不代表飞机已经完成降落");
  });

  it("本地门禁拒绝时明确说明没有调用 DJI MSDK", () => {
    const feedback = operationFeedback("mission-upload", {
      ok: false,
      code: "DEVICE_OFFLINE",
    });

    expect(feedback.source).toBe("desktop");
    expect(feedback.outcome).toBe("not-called");
    expect(feedback.message).toContain("未调用 DJI MSDK");
  });

  it("图传源门禁拒绝时明确显示原始 MSDK Key 的原因", () => {
    const feedback = operationFeedback("stream-start", {
      ok: false,
      code: "CAPABILITY_BLOCKED",
      reason: "CAMERA_OFFLINE",
    });

    expect(feedback.source).toBe("desktop");
    expect(feedback.outcome).toBe("not-called");
    expect(feedback.message).toBe("未调用 DJI MSDK：主相机未连接");
  });

  it("飞行动作等待人工确认时明确说明尚未调用 DJI MSDK", () => {
    const feedback = operationFeedback("flight-land", {
      ok: true,
      value: {
        ok: true,
        code: "CONFIRMATION_REQUIRED",
        confirmation: { deviceId: "phone-1", action: "land", confirmationId: "confirm-1" },
      },
    });

    expect(feedback.source).toBe("desktop");
    expect(feedback.outcome).toBe("pending");
    expect(feedback.message).toContain("尚未调用 DJI MSDK");
    expect(feedback.message).toContain("降落");
  });

  it("取消人工确认时把结果归为本地取消而不是 DJI 回调", () => {
    const feedback = operationFeedback("flight-cancel", {
      ok: true,
      value: {
        ok: true,
        code: "CANCELLED",
        confirmation: { deviceId: "phone-1", action: "return-home", confirmationId: "confirm-2" },
      },
    });

    expect(feedback.source).toBe("desktop");
    expect(feedback.outcome).toBe("completed");
    expect(feedback.message).toContain("已取消");
    expect(feedback.message).toContain("未调用 DJI MSDK");
  });

  it("航线命令只得到中继失败时不虚构为本地没有调用 DJI", () => {
    const feedback = operationFeedback("mission-upload", {
      ok: true,
      value: { ok: false, operation: "upload", code: "WAYLINE_UPLOAD_FAILED" },
    });

    expect(feedback.source).toBe("relay");
    expect(feedback.outcome).toBe("unconfirmed");
    expect(feedback.message).toContain("结果未确认");
    expect(feedback.message).not.toContain("未调用 DJI MSDK");
  });

  it("依赖调用异常时不把 DJI 调用状态伪装成确定未发出", () => {
    const feedback = operationFeedback("flight-return-home", {
      ok: false,
      code: "DEPENDENCY_FAILURE",
    });

    expect(feedback.source).toBe("relay");
    expect(feedback.outcome).toBe("unconfirmed");
    expect(feedback.message).toContain("结果未确认");
  });
});
