import { expect, it } from "vitest";
import { MissionPhaseDomain } from "../src/modules/mission-control/mission-phase-domain/index.js";

it("mission phase domain processes a large bounded event sequence in constant space", () => {
  const machine = MissionPhaseDomain.create();
  const startedAt = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    const missionId = `mission-${index}`;
    machine.transition({ type: "stage-requested", missionId });
    machine.transition({ type: "stage-succeeded", missionId });
    machine.transition({ type: "upload-requested" });
    machine.transition({ type: "upload-succeeded" });
    machine.transition({ type: "start-requested" });
    machine.transition({ type: "start-succeeded" });
    machine.transition({ type: "mission-completed" });
  }

  expect(machine.state()).toEqual({ missionId: "mission-9999", phase: "completed", failureCode: null });
  expect(performance.now() - startedAt).toBeLessThan(500);
});
