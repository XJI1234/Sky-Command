import { describe, expect, it } from "vitest";
import { operationFeedback } from "../src/production/operator-console/renderer/operation-feedback.js";

describe("操作回调展示", () => {
  it("将 DJI onFailure 原样显示为逐行回执", () => {
    const feedback = operationFeedback("mission-upload", {
      ok: true,
      value: {
        ok: false,
        operation: "upload",
        code: "WAYLINE_ACTION_REJECTED",
        platformError: {
          code: "REQUEST_HANDLER_NOT_FOUND",
          description: "DJI did not provide an error description",
        },
      },
    });

    expect(feedback.source).toBe("dji");
    expect(feedback.outcome).toBe("rejected");
    expect(feedback.message).toBe([
      "MSDK 回调：失败",
      "原始类型：onFailure",
      "错误码：REQUEST_HANDLER_NOT_FOUND",
      "错误说明：DJI did not provide an error description",
    ].join("\n"));
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
    expect(feedback.message).toBe([
      "MSDK 回调：失败",
      "原始类型：onFailure",
      "错误码：COMMON_SYSTEM_BUSY",
      "错误说明：The live stream manager is busy",
    ].join("\n"));
  });

  it("将 DJI onSuccess 原样显示为逐行回执", () => {
    const feedback = operationFeedback("flight-land", {
      ok: true,
      value: { ok: true, action: "land", code: "SUCCEEDED" },
    });

    expect(feedback.source).toBe("dji");
    expect(feedback.outcome).toBe("accepted");
    expect(feedback.message).toBe([
      "MSDK 回调：成功",
      "原始类型：onSuccess",
    ].join("\n"));
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

  it("未收到 DJI 最终回调时如实显示未确认", () => {
    const feedback = operationFeedback("mission-upload", {
      ok: true,
      value: { ok: false, operation: "upload", code: "WAYLINE_UPLOAD_FAILED" },
    });

    expect(feedback.source).toBe("relay");
    expect(feedback.outcome).toBe("unconfirmed");
    expect(feedback.message).toBe([
      "MSDK 回调：未确认",
      "原始类型：无最终回调",
      "说明：未收到 DJI MSDK 上传至飞机的可判定结果",
    ].join("\n"));
  });

  it("拍照成功与原图落盘使用独立回执，不覆盖图传启停", () => {
    expect(operationFeedback("photo-capture", { ok: true, code: "CAPTURED" })).toMatchObject({
      source: "dji",
      outcome: "accepted",
    });
    expect(operationFeedback("photo-capture", { ok: true, code: "CAPTURED" }).message).toContain("已拍下原图");
    expect(operationFeedback("photo-fetch", { ok: true, code: "SUCCEEDED" }).message).toContain("原图已保存");
    expect(operationFeedback("photo-fetch", { ok: true, value: { code: "SUCCEEDED", count: 3, fileName: "DJI_1.jpg" } }).message).toContain("已回传 3 张原图");
    expect(operationFeedback("photo-capture", { ok: false, code: "PHOTO_ACTION_REJECTED", errorCode: "CAMERA_BUSY", errorDescription: "inner=Camera/StartShootPhoto:-1" }).message).toContain("错误码：CAMERA_BUSY");
    expect(operationFeedback("photo-capture", { ok: false, code: "PHOTO_ACTION_REJECTED", errorCode: "CAMERA_BUSY", errorDescription: "inner=Camera/StartShootPhoto:-1" }).message).toContain("错误说明：inner=Camera/StartShootPhoto:-1");
    expect(operationFeedback("photo-capture", {
      ok: false,
      code: "PHOTO_ACTION_REJECTED",
      value: {
        ok: false,
        code: "PHOTO_ACTION_REJECTED",
        platformError: { code: "CANNOT_START_TASK_ON_WEAK_GPS", description: "errorType=CORE; inner=CAMERA.StartShootPhoto:-472" },
      },
    }).message).toContain("错误码：CANNOT_START_TASK_ON_WEAK_GPS");
    expect(operationFeedback("photo-capture", {
      ok: false,
      code: "PHOTO_ACTION_REJECTED",
      platformError: { code: "CAMERA_MODE_NOT_PHOTO", description: "相机没有进入拍照模式" },
    })).toEqual({
      source: "relay",
      outcome: "rejected",
      message: "相机没有进入拍照模式，画面会恢复。图传没有停止。",
    });
  });
});
