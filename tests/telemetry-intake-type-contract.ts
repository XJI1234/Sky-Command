import { TelemetryIntake, type TelemetryInput } from "../src/modules/relay-link/telemetry-intake/index.js";

declare const input: TelemetryInput;
const intake = TelemetryIntake.create();
intake.accept(input);
intake.get(input.connectionId);
intake.removeConnection(input.connectionId);
intake.subscribe((snapshot) => void snapshot);
void intake.snapshot();

// @ts-expect-error Telemetry requires protocol JSON objects.
intake.accept({ connectionId: "connection", payload: null, capabilities: null });
