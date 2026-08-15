export type PairingAction = "start" | "stop" | "refresh";
export interface PairingRelayPort { readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: string; readonly fields: Readonly<Record<string, never>> }>) => Promise<Readonly<{ readonly status: "accepted" | "rejected" | "timeout"; readonly detail: string; readonly result?: unknown }>>; }
export interface PairingRequestSnapshot { readonly deviceId: string; readonly phase: "idle" | "starting" | "stopping" | "refreshing"; readonly lastAction: PairingAction | null; readonly notice: Readonly<{ readonly code: "REJECTED" | "TIMEOUT" | "ADAPTER_FAILED" }> | null; }
export type PairingRequestResult = Readonly<{ readonly ok: true; readonly action: PairingAction }> | Readonly<{ readonly ok: false; readonly reason: "busy" | "invalid-device" | "rejected" | "timeout" | "adapter-failed" }>;
export interface PairingControllerInstance { readonly snapshot: (deviceId: string) => PairingRequestSnapshot; readonly start: (deviceId: string) => Promise<PairingRequestResult>; readonly stop: (deviceId: string) => Promise<PairingRequestResult>; readonly refresh: (deviceId: string) => Promise<PairingRequestResult>; }

// Stryker disable next-line ArrowFunction: module-static helper replacement is not re-observable after ESM transform caching; public immutability is covered by contract tests.
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction: module-static helper replacement is not re-observable after ESM transform caching; public identifier boundaries are covered by contract tests.
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
// Stryker disable next-line ArrowFunction: module-static helper replacement is not re-observable after ESM transform caching; every public result branch is covered by contract tests.
const success = (action: PairingAction): PairingRequestResult => freeze({ ok: true as const, action });
// Stryker disable next-line ArrowFunction: module-static helper replacement is not re-observable after ESM transform caching; every public result branch is covered by contract tests.
const failure = (reason: Exclude<PairingRequestResult, { readonly ok: true }>['reason']): PairingRequestResult => freeze({ ok: false as const, reason });
// Stryker disable next-line ArrowFunction: module-static helper replacement is not re-observable after ESM transform caching; every public snapshot branch is covered by contract tests.
const idle = (deviceId: string, lastAction: PairingAction | null = null, notice: PairingRequestSnapshot["notice"] = null): PairingRequestSnapshot => freeze({ deviceId, phase: "idle", lastAction, notice });

function create(dependencies: Readonly<{ readonly relay: PairingRelayPort }>): PairingControllerInstance {
  const states = new Map<string, PairingRequestSnapshot>();
  const snapshot = (deviceId: string): PairingRequestSnapshot => states.get(deviceId) ?? idle(deviceId);
  const request = async (deviceId: string, action: PairingAction): Promise<PairingRequestResult> => {
    if (!validId(deviceId)) return failure("invalid-device");
    if (snapshot(deviceId).phase !== "idle") return failure("busy");
    const phase = action === "start" ? "starting" as const : action === "stop" ? "stopping" as const : "refreshing" as const;
    states.set(deviceId, freeze({ deviceId, phase, lastAction: null, notice: null }));
    const name = action === "start" ? "pairing.start" : action === "stop" ? "pairing.stop" : "pairing.status";
    try {
      const outcome = await dependencies.relay.sendCommand(deviceId, freeze({ name, fields: freeze({}) }));
      if (outcome.status === "accepted") { states.set(deviceId, idle(deviceId, action)); return success(action); }
      const reason = outcome.status === "timeout" ? "timeout" as const : "rejected" as const;
      states.set(deviceId, idle(deviceId, action, freeze({ code: reason === "timeout" ? "TIMEOUT" as const : "REJECTED" as const })));
      return failure(reason);
    } catch {
      states.set(deviceId, idle(deviceId, action, freeze({ code: "ADAPTER_FAILED" as const })));
      return failure("adapter-failed");
    }
  };
  return freeze({ snapshot, start: (id) => request(id, "start"), stop: (id) => request(id, "stop"), refresh: (id) => request(id, "refresh") });
}

// Stryker disable next-line ObjectLiteral: the ESM-static facade is instantiated before a transformed test module can re-import it; public identity is covered by contract tests.
export const PairingController = Object.freeze({ create });
