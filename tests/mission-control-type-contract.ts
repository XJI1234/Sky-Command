import { MissionControl, type MissionControlDependencies } from "../src/modules/mission-control/index.js";

const dependencies: MissionControlDependencies = {
  routeSource: { getMissionPayload: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }) },
  relay: {
    sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded", detail: "ok" }),
    sendCommand: async (_deviceId, request) => ({ deviceId: "phone-1", commandId: request.name, status: "succeeded", detail: "ok" }),
    latestTelemetry: () => null,
    subscribe: () => () => undefined
  }
};
const control = MissionControl.create(dependencies, { createMissionId: () => "mission-1" });
void control.stage("phone-1", "route-1");
void control.dispose();

// @ts-expect-error 原始协议帧不是中继门面接口
MissionControl.create({ routeSource: dependencies.routeSource, relay: { type: "command" } }, { createMissionId: () => "mission-1" });
// @ts-expect-error 任务 ID 工厂必须存在
MissionControl.create(dependencies, {});
