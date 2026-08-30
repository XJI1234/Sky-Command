import { describe, expect, it } from "vitest";
import { TelemetryIntake, type TelemetryInput } from "../src/modules/relay-link/telemetry-intake/index.js";

const object = (fields: Record<string, unknown>) => ({ kind: "object" as const, fields });
const input = (overrides: Partial<TelemetryInput> = {}): TelemetryInput => ({ connectionId: "connection-1", payload: object({ battery: { kind: "number", value: "98" } }), capabilities: object({ live: { kind: "boolean", value: true } }), ...overrides });

describe("telemetry-intake contract", () => {
  it("accepts and replaces one immutable snapshot per connection", () => {
    const intake = TelemetryIntake.create();
    expect(intake.accept(input())).toMatchObject({ ok: true, value: { connectionId: "connection-1" } });
    expect(intake.accept(input({ payload: object({ battery: { kind: "number", value: "97" } }) }))).toMatchObject({ ok: true });
    expect(intake.snapshot()).toHaveLength(1);
    expect(intake.get("connection-1")).toMatchObject({ payload: { fields: { battery: { value: "97" } } } });
  });

  it("records only the local acceptance time for each validated telemetry frame", () => {
    let now = 1_725_000_000_000;
    const intake = TelemetryIntake.create({ now: () => now });

    expect(intake.accept(input())).toMatchObject({ ok: true, value: { receivedAtMs: 1_725_000_000_000 } });
    now += 800;
    expect(intake.accept(input({ payload: object({ battery: { kind: "number", value: "97" } }) }))).toMatchObject({ ok: true, value: { receivedAtMs: 1_725_000_000_800 } });
    expect(intake.get("connection-1")).toMatchObject({ receivedAtMs: 1_725_000_000_800 });
  });

  it("preserves order, removes independently, and ignores unknown removal", () => {
    const intake = TelemetryIntake.create();
    intake.accept(input());
    intake.accept(input({ connectionId: "connection-2" }));
    intake.removeConnection("missing");
    expect(intake.get("missing")).toBeNull();
    expect(intake.get(" ")).toBeNull();
    intake.removeConnection(" ");
    intake.removeConnection("connection-1");
    expect(intake.snapshot().map((value) => value.connectionId)).toEqual(["connection-2"]);
  });

  it("rejects malformed and hostile values without state changes", () => {
    const intake = TelemetryIntake.create();
    expect(intake.accept(null as never)).toMatchObject({ ok: false, error: { code: "INVALID_TELEMETRY" } });
    expect(intake.accept(input({ connectionId: " " }))).toMatchObject({ ok: false, error: { code: "INVALID_TELEMETRY" } });
    expect(intake.accept(input({ payload: object({ bad: { kind: "unknown" } }) }))).toMatchObject({ ok: false, error: { code: "INVALID_TELEMETRY" } });
    const hostile = new Proxy(input(), { get() { throw new Error("sensitive"); } });
    expect(() => intake.accept(hostile)).not.toThrow();
    expect(intake.accept(hostile)).toMatchObject({ ok: false, error: { code: "INVALID_TELEMETRY" } });
    expect(intake.snapshot()).toEqual([]);
  });

  it("contains listeners, supports reentrant accepts, and returns frozen views", () => {
    const intake = TelemetryIntake.create();
    const seen: string[] = [];
    let nested = false;
    intake.subscribe(() => { throw new Error("listener failure"); });
    const unsubscribe = intake.subscribe((snapshot) => {
      seen.push(snapshot.connectionId);
      if (!nested) { nested = true; intake.accept(input({ connectionId: "connection-2" })); }
    });
    intake.accept(input());
    unsubscribe(); unsubscribe();
    const snapshot = intake.snapshot();
    expect(seen).toEqual(["connection-1", "connection-2"]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(() => (snapshot as unknown as Array<unknown>).pop()).toThrow();
  });
});
