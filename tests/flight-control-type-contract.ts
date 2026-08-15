import { FlightControl, type FlightControlDependencies } from "../src/modules/flight-control/index.js";

const dependencies: FlightControlDependencies = {
  dispatcher: {
    check: () => ({ ok: true }),
    dispatch: async (deviceId, action) => ({ ok: true, code: "SUCCEEDED", deviceId, action }),
    isBusy: () => false
  }
};
const control = FlightControl.create(dependencies, { now: () => 1, confirmation: { ttlMs: 1_000, createConfirmationId: () => "confirm-1" } });
void control.confirm("phone-1", "confirm-1");

// @ts-expect-error 组合根不接收原始协议帧
FlightControl.create({ relayFrame: { type: "command" } }, { now: () => 1, confirmation: { ttlMs: 1, createConfirmationId: () => "id" } });
// @ts-expect-error 确认选项必须提供受控 ID 工厂
FlightControl.create(dependencies, { now: () => 1, confirmation: { ttlMs: 1 } });
