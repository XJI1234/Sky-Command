import { PreflightCheck, type PreflightInput, type PreflightPolicy, type PreflightResult } from "../src/modules/mission-control/preflight-check/index.js";

declare const input: PreflightInput;
declare const policy: PreflightPolicy;
const result: PreflightResult = PreflightCheck.evaluate(input, policy);
void result;

// @ts-expect-error The threshold must be numeric.
PreflightCheck.evaluate(input, { minimumBatteryPercent: "20" });
// @ts-expect-error Waypoint support is a closed telemetry value.
PreflightCheck.evaluate({ ...input, capabilities: { waypointMissionSupport: "maybe" } });
