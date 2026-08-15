import { MissionPhaseDomain, type MissionPhaseEvent, type MissionPhaseState, type TransitionResult } from "../src/modules/mission-control/mission-phase-domain/index.js";

declare const state: MissionPhaseState;
declare const event: MissionPhaseEvent;
const machine = MissionPhaseDomain.create(state);
const result: TransitionResult = machine.transition(event);
void result;
void machine.state();
void machine.reset();

// @ts-expect-error Phase values are a closed domain.
MissionPhaseDomain.create({ missionId: "mission-1", phase: "flying", failureCode: null });
// @ts-expect-error Events cannot carry route bytes or transport objects.
machine.transition({ type: "stage-requested", missionId: "mission-1", bytes: new Uint8Array() });
