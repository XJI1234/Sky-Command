import { CommandTracker, type CommandBegin, type TimerScheduler } from "../src/modules/relay-link/command-tracker/index.js";

declare const scheduler: TimerScheduler;
declare const command: CommandBegin;
const tracker = CommandTracker.create({ scheduler, timeoutMs: 100 });
tracker.begin(command);
tracker.resolve({ ...command, ok: true, detail: "done" });
tracker.cancelConnection(command.connectionId, "closed");
tracker.subscribe((outcome) => void outcome);
void tracker.snapshot();

// @ts-expect-error Command result requires a boolean ok field.
tracker.resolve({ ...command, ok: "yes", detail: "done" });
