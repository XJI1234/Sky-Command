import { describe, expect, it } from "vitest";
import { DangerousActionConfirm } from "../src/modules/flight-control/dangerous-action-confirm/index.js";

describe("DangerousActionConfirm", () => {
  const create = (overrides: Partial<{ readonly ttlMs: number; readonly createConfirmationId: () => string }> = {}) => DangerousActionConfirm.create({
    ttlMs: overrides.ttlMs ?? 1_000,
    createConfirmationId: overrides.createConfirmationId ?? (() => "confirm-1")
  });

  it("creates one frozen, device-local confirmation that can be consumed exactly once", () => {
    const confirmations = create();
    const begun = confirmations.begin("phone-1", "takeoff", 100);
    expect(begun).toMatchObject({ ok: true, code: "PENDING", confirmation: { deviceId: "phone-1", action: "takeoff", confirmationId: "confirm-1", expiresAtMs: 1_100 } });
    if (!begun.ok) throw new Error("unreachable");
    expect(Object.isFrozen(begun)).toBe(true);
    expect(Object.isFrozen(begun.confirmation)).toBe(true);
    expect(confirmations.get("phone-1", 100)).toEqual(begun.confirmation);
    expect(confirmations.consume("phone-1", "takeoff", "confirm-1", 101)).toMatchObject({ ok: true, code: "CONSUMED" });
    expect(confirmations.get("phone-1", 101)).toBeNull();
    expect(confirmations.consume("phone-1", "takeoff", "confirm-1", 102)).toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
  });

  it("replaces an old request without permitting a mismatched device or action to consume it", () => {
    let next = 0;
    const confirmations = create({ createConfirmationId: () => `confirm-${++next}` });
    const first = confirmations.begin("phone-1", "takeoff", 1);
    const second = confirmations.begin("phone-1", "land", 2);
    expect(first).toMatchObject({ ok: true, confirmation: { confirmationId: "confirm-1" } });
    expect(second).toMatchObject({ ok: true, confirmation: { confirmationId: "confirm-2", action: "land" } });
    expect(confirmations.consume("phone-2", "land", "confirm-2", 3)).toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
    expect(confirmations.consume("phone-1", "takeoff", "confirm-2", 3)).toMatchObject({ ok: false, code: "CONFIRMATION_MISMATCH" });
    expect(confirmations.consume("phone-1", "land", "confirm-1", 3)).toMatchObject({ ok: false, code: "CONFIRMATION_MISMATCH" });
    expect(confirmations.consume("phone-1", "land", "confirm-2", 3)).toMatchObject({ ok: true, code: "CONSUMED" });
  });

  it("expires, cancels and clears pending confirmations without leaking them across devices", () => {
    const confirmations = create({ ttlMs: 10 });
    expect(confirmations.begin("phone-1", "return-home", 20)).toMatchObject({ ok: true, confirmation: { expiresAtMs: 30 } });
    expect(confirmations.consume("phone-1", "return-home", "confirm-1", 30)).toMatchObject({ ok: false, code: "CONFIRMATION_EXPIRED" });
    expect(confirmations.begin("phone-1", "land", 40)).toMatchObject({ ok: true });
    expect(confirmations.begin("phone-2", "takeoff", 40)).toMatchObject({ ok: true });
    expect(confirmations.cancel("phone-1", "confirm-1", 41)).toMatchObject({ ok: true, code: "CANCELLED" });
    expect(confirmations.get("phone-2", 41)).toMatchObject({ deviceId: "phone-2" });
    expect(confirmations.clear("phone-2")).toBe(true);
    expect(confirmations.clear("phone-2")).toBe(false);
    confirmations.clearAll();
  });

  it("rejects invalid configuration, unsafe input and hostile factories without throwing", () => {
    const invalid = DangerousActionConfirm.create({ ttlMs: 0, createConfirmationId: () => "confirm-1" });
    expect(invalid.begin("phone-1", "takeoff", 1)).toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    const confirmations = create({ createConfirmationId: () => { throw new Error("no id"); } });
    expect(confirmations.begin("phone-1", "takeoff", 1)).toMatchObject({ ok: false, code: "ID_UNAVAILABLE" });
    expect(confirmations.begin(" ", "takeoff", 1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.begin("phone-1", "fly" as never, 1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.begin("phone-1", "takeoff", Number.NaN)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.cancel("phone-1", "confirm-1", 1)).toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
  });

  it("defends every consume and cancel boundary without changing unrelated pending requests", () => {
    const confirmations = create({ ttlMs: 20 });
    expect(confirmations.begin("phone-1", "takeoff", 1)).toMatchObject({ ok: true });
    expect(confirmations.consume("phone-1", "takeoff", "confirm-1", 2)).toMatchObject({ ok: true, code: "CONSUMED" });
    expect(confirmations.begin("phone-1", "takeoff", 3)).toMatchObject({ ok: true });
    expect(confirmations.consume("phone-1", "takeoff", "wrong", 4)).toMatchObject({ ok: false, code: "CONFIRMATION_MISMATCH" });
    expect(confirmations.cancel("phone-1", "wrong", 4)).toMatchObject({ ok: false, code: "CONFIRMATION_MISMATCH" });
    expect(confirmations.get("phone-1", 4)).toMatchObject({ confirmationId: "confirm-1" });
    expect(confirmations.cancel("phone-1", "confirm-1", 5)).toMatchObject({ ok: true, code: "CANCELLED" });
    expect(confirmations.consume("phone-1", "takeoff", "confirm-1", 5)).toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
    expect(confirmations.get(" ", 5)).toBeNull();
    expect(confirmations.get("phone-1", -1)).toBeNull();
  });

  it("rejects every invalid input category and invalid generated identifiers", () => {
    const invalidIdentifier = create({ createConfirmationId: () => "\u0000" });
    expect(invalidIdentifier.begin("phone-1", "takeoff", 1)).toMatchObject({ ok: false, code: "ID_UNAVAILABLE" });
    const confirmations = create();
    expect(confirmations.begin("phone-1", "takeoff", 1.5)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.consume("phone-1", "bad" as never, "confirm-1", 1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.consume("phone-1", "takeoff", " ", 1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.cancel(" ", "confirm-1", 1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.cancel("phone-1", " ", 1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.clear(" ")).toBe(false);
  });

  it("reports every configuration, expiration and current-consumption boundary", () => {
    const invalid = DangerousActionConfirm.create({ ttlMs: 70_000, createConfirmationId: () => "confirm" });
    expect(invalid.consume("phone-1", "takeoff", "confirm", 1)).toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    expect(invalid.consumeCurrent("phone-1", "confirm", 1)).toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    expect(invalid.cancel("phone-1", "confirm", 1)).toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    const confirmations = create({ ttlMs: 2 });
    expect(confirmations.begin("phone-1", "takeoff", 1)).toMatchObject({ ok: true });
    expect(confirmations.get("phone-1", 3)).toBeNull();
    expect(confirmations.consumeCurrent("phone-1", "confirm-1", 3)).toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
    expect(confirmations.begin("phone-1", "takeoff", 4)).toMatchObject({ ok: true });
    expect(confirmations.consumeCurrent("phone-1", "wrong", 5)).toMatchObject({ ok: false, code: "CONFIRMATION_MISMATCH" });
    expect(confirmations.consumeCurrent("phone-1", "confirm-1", 6)).toMatchObject({ ok: false, code: "CONFIRMATION_EXPIRED" });
    expect(confirmations.begin("phone-1", "takeoff", 7)).toMatchObject({ ok: true });
    expect(confirmations.cancel("phone-1", "confirm-1", 9)).toMatchObject({ ok: false, code: "CONFIRMATION_EXPIRED" });
    expect(confirmations.begin("phone-1", "takeoff", 10)).toMatchObject({ ok: true });
    confirmations.clearAll();
    expect(confirmations.get("phone-1", 10)).toBeNull();
  });

  it("contains hostile configuration getters and all current-consume input failures", () => {
    const hostileOptions = { get ttlMs(): never { throw new Error("ttl"); }, createConfirmationId: () => "confirm" } as never;
    const invalid = DangerousActionConfirm.create(hostileOptions);
    expect(invalid.begin("phone-1", "takeoff", 1)).toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    const confirmations = create();
    expect(confirmations.consumeCurrent(" ", "confirm", 1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.consumeCurrent("phone-1", " ", 1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(confirmations.consumeCurrent("phone-1", "confirm", -1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
