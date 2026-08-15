import { DeviceGuidance, type DeviceGuidanceResult, type DeviceGuidanceSnapshot } from "../src/modules/device-console/device-guidance/index.js";

declare const result: DeviceGuidanceResult<DeviceGuidanceSnapshot>;
const evaluated: DeviceGuidanceResult<DeviceGuidanceSnapshot> = DeviceGuidance.evaluate({
  link: {
    deviceId: "phone-1",
    overall: "ready",
    computerToPhone: "connected",
    phoneToRemoteController: "connected",
    remoteControllerToAircraft: "connected"
  }
});
void evaluated;

if (result.ok) {
  const guidance: DeviceGuidanceSnapshot = result.value;
  void guidance;
  // @ts-expect-error 引导快照不可变。
  result.value.code = "READY";
} else {
  // @ts-expect-error 错误详情不可变。
  result.error.details.field = "other";
}
