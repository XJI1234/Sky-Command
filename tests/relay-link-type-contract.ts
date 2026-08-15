import { RelayLink, type CommandRequest, type RelayLinkOptions, type MissionPayload, type RelayLinkInstance, type TimerScheduler } from "../src/modules/relay-link/index.js";

declare const options: RelayLinkOptions;
declare const link: RelayLinkInstance;
declare const command: CommandRequest;
declare const mission: MissionPayload;
declare const scheduler: TimerScheduler;
const created: RelayLinkInstance = RelayLink.create(options);
void created.start();
void link.stop();
void link.sendCommand("device", command);
void link.sendMission("device", mission);
void link.latestTelemetry("device");
void scheduler.clearTimeout(scheduler.setTimeout(() => undefined, 1));

// @ts-expect-error The root uses opaque device IDs, never connection IDs.
void link.sendCommand({ connectionId: "internal" }, command);
// @ts-expect-error Command names and fields are structured values.
void link.sendCommand("device", { name: 1, fields: {} });
