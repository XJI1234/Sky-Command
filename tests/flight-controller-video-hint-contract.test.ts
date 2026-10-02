import { describe, expect, it } from "vitest";
import { FLIGHT_CONTROLLER_VIDEO_HINT, FlightControllerVideoHint } from "../src/production/operation-workflow/flight-controller-video-hint/index.js";

describe("飞控图传提示", () => {
  it("进程里飞控还没连过时，图传页顶部固定提示转动摇杆或重启飞机", () => {
    expect(FlightControllerVideoHint.evaluate({
      hasConnectedOnce: false,
      streaming: false,
      fps: null,
    })).toEqual({
      banner: FLIGHT_CONTROLLER_VIDEO_HINT,
      afterStart: null,
    });
    expect(FLIGHT_CONTROLLER_VIDEO_HINT).toContain("摇杆");
    expect(FLIGHT_CONTROLLER_VIDEO_HINT).toContain("重启飞机");
    expect(FLIGHT_CONTROLLER_VIDEO_HINT).toContain("再点一次开始");
  });

  it("点开图传后若仍未连过飞控且 fps 为 0，再给出同一句提示", () => {
    expect(FlightControllerVideoHint.evaluate({
      hasConnectedOnce: false,
      streaming: true,
      fps: 0,
    })).toEqual({
      banner: FLIGHT_CONTROLLER_VIDEO_HINT,
      afterStart: FLIGHT_CONTROLLER_VIDEO_HINT,
    });
  });

  it("飞控连过一次后即使当前断开或 fps 为 0 也不再提示", () => {
    expect(FlightControllerVideoHint.evaluate({
      hasConnectedOnce: true,
      streaming: true,
      fps: 0,
    })).toEqual({ banner: null, afterStart: null });
  });

  it("缺少连过一次的事实、尚未取得 fps、或 fps 不是 0 时，不开第二次提示", () => {
    expect(FlightControllerVideoHint.evaluate({
      hasConnectedOnce: null,
      streaming: true,
      fps: 0,
    })).toEqual({ banner: null, afterStart: null });
    expect(FlightControllerVideoHint.evaluate({
      hasConnectedOnce: false,
      streaming: true,
      fps: null,
    }).afterStart).toBeNull();
    expect(FlightControllerVideoHint.evaluate({
      hasConnectedOnce: false,
      streaming: true,
      fps: 15,
    }).afterStart).toBeNull();
  });
});
