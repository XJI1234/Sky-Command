import { describe, expect, it } from "vitest";
import { FlightControl } from "../src/modules/flight-control/index.js";
import { FlightCommandDispatcher } from "../src/modules/flight-control/flight-command-dispatcher/index.js";
import { PreflightCheck, type FlightActionPreflightInput } from "../src/modules/mission-control/preflight-check/index.js";

function flight(needed: unknown) {
  let confirmationNeeded = needed;
  const sent: unknown[] = [];
  const dispatcher = FlightCommandDispatcher.create({
    relay: {
      latestTelemetry: () => ({
        payload: { sdkAvailability: "READY", flightMode: "CONFIRM_LANDING", landingConfirmationNeeded: confirmationNeeded },
        capabilities: {},
      }),
      sendCommand: async (_deviceId, command) => { sent.push(command); return { status: "succeeded" }; },
    },
    preflight: { evaluateFlightAction: (input) => PreflightCheck.evaluateFlightAction(input as FlightActionPreflightInput) },
  });
  const control = FlightControl.create({ dispatcher }, {
    now: () => 100,
    confirmation: { ttlMs: 1_000, createConfirmationId: () => "confirm-landing-1" },
  });
  return { control, sent, setNeeded: (next: unknown) => { confirmationNeeded = next; } };
}

describe("landing confirmation applicability across request and dispatch", () => {
  it.each([false, null, undefined, "true"])("does not create or send a confirmation when the raw flag is %s", (needed) => {
    const value = flight(needed);
    expect(value.control.request("phone-1", "confirm-landing")).toMatchObject({
      ok: false, code: "PREFLIGHT_BLOCKED", blockers: [{ code: "LANDING_CONFIRMATION_NOT_REQUIRED" }],
    });
    expect(value.control.get("phone-1")).toBeNull();
    expect(value.sent).toEqual([]);
  });

  it("sends exactly one explicit confirmation when DJI requests it, without relying on cached flying or RC state", async () => {
    const value = flight(true);
    expect(value.control.request("phone-1", "confirm-landing")).toMatchObject({ ok: true, code: "CONFIRMATION_REQUIRED" });
    await expect(value.control.confirm("phone-1", "confirm-landing-1")).resolves.toMatchObject({ ok: true, code: "SUCCEEDED" });
    await expect(value.control.confirm("phone-1", "confirm-landing-1")).resolves.toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
    expect(value.sent).toEqual([{ name: "flight.confirm-landing", fields: { confirm: true } }]);
  });

  it.each([false, null, undefined])("rechecks before sending when the flag changes from true to %s", async (needed) => {
    const value = flight(true);
    expect(value.control.request("phone-1", "confirm-landing")).toMatchObject({ ok: true });
    value.setNeeded(needed);
    await expect(value.control.confirm("phone-1", "confirm-landing-1")).resolves.toMatchObject({
      ok: false, code: "PREFLIGHT_BLOCKED", blockers: [{ code: "LANDING_CONFIRMATION_NOT_REQUIRED" }],
    });
    expect(value.sent).toEqual([]);
    expect(value.control.get("phone-1")).toBeNull();
  });

  it("keeps manual re-landing available after auto landing has exited without requesting confirmation", async () => {
    const value = flight(false);
    expect(value.control.request("phone-1", "land")).toMatchObject({ ok: true });
    await expect(value.control.confirm("phone-1", "confirm-landing-1")).resolves.toMatchObject({ ok: true });
    expect(value.sent).toEqual([{ name: "flight.land", fields: { confirm: true } }]);
  });

  it("contains an unreadable confirmation flag without throwing or sending", () => {
    const payload = Object.defineProperty({ sdkAvailability: "READY" }, "landingConfirmationNeeded", {
      get: () => { throw new Error("unreadable landing confirmation flag"); },
    });
    expect(PreflightCheck.evaluateFlightAction({ relayConnected: true, payload, capabilities: {}, action: "confirm-landing" } as FlightActionPreflightInput)).toMatchObject({
      ok: false, blockers: [{ code: "INVALID_INPUT" }],
    });
  });
});
