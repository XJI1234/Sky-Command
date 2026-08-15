import { MissionDispatcher, type MissionDispatcherDependencies, type MissionRelayGateway, type MissionRouteSource, type WaylineCommand } from "../src/modules/mission-control/mission-dispatcher/index.js";

const source: MissionRouteSource = { getMissionPayload: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }) };
const relay: MissionRelayGateway = {
  sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded", detail: "ok" }),
  sendCommand: async (_deviceId, request) => ({ deviceId: "phone-1", commandId: request.name, status: "succeeded", detail: "ok" }),
  latestTelemetry: () => null
};
const dependencies: MissionDispatcherDependencies = { routeSource: source, relay };
const dispatcher = MissionDispatcher.create(dependencies, { createMissionId: () => "mission-1" });
void dispatcher.stage("phone-1", "route-1");
void dispatcher.upload("phone-1");

const command: WaylineCommand = { name: "wayline.start", fields: { confirm: true } };
void command;

// @ts-expect-error command names are a closed, business-level union
const invalidName: WaylineCommand = { name: "raw.command", fields: { confirm: true } };
void invalidName;
// @ts-expect-error every dispatcher command must explicitly confirm
const invalidConfirmation: WaylineCommand = { name: "wayline.start", fields: {} };
void invalidConfirmation;
// @ts-expect-error raw relay frame fields are not accepted as a dispatcher command
const rawFrame: WaylineCommand = { type: "command", id: "x", command: { name: "wayline.start", fields: { confirm: true } } };
void rawFrame;
