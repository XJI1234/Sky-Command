import { MissionSender, type MissionPayload, type MissionSink, type TimerScheduler } from "../src/modules/relay-link/mission-sender/index.js";

declare const scheduler: TimerScheduler;
declare const mission: MissionPayload;
declare const sink: MissionSink;
const sender = MissionSender.create({ scheduler, timeoutMs: 100 });
void sender.send("connection", mission, sink);
sender.acceptResult("connection", { missionId: mission.missionId, ok: true, detail: "done" });
sender.cancelConnection("connection", "closed");
sender.subscribe((outcome) => void outcome);
void sender.snapshot();

// @ts-expect-error Mission sinks receive protocol frames, not raw strings.
void sender.send("connection", mission, { send: async (_frame: string) => undefined });
