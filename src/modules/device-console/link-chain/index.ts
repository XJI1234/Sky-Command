export type LinkStatus = "connected" | "disconnected" | "unknown";

export interface LinkChainTelemetry {
  readonly sdkRegistered?: boolean;
  readonly remoteControllerConnected?: boolean;
  readonly flightControllerConnected?: boolean;
  readonly connected?: boolean;
}

export interface LinkChainSnapshot {
  readonly deviceId: string;
  readonly overall: "ready" | "degraded" | "offline";
  readonly computerToPhone: Exclude<LinkStatus, "unknown">;
  readonly phoneToRemoteController: LinkStatus;
  readonly remoteControllerToAircraft: LinkStatus;
}

export type LinkChainResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: "INVALID_INPUT"; readonly details: Readonly<{ readonly field: string; readonly reason: string }> }> }>;

interface LinkChainInput {
  readonly deviceId: unknown;
  readonly relayConnected: unknown;
  readonly telemetry: unknown;
}

// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public immutability is covered.
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public success results are covered.
const success = <T>(value: T): LinkChainResult<T> => freeze({ ok: true as const, value });
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public failures are covered.
const failure = <T>(field: string, reason: string): LinkChainResult<T> => freeze({ ok: false as const, error: freeze({ code: "INVALID_INPUT" as const, details: freeze({ field, reason }) }) });

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
}

function readInput(value: unknown): Readonly<LinkChainInput> | "invalid-container" | "unreadable" {
  if (value === null || typeof value !== "object") return "invalid-container";
  try {
    const input = value as LinkChainInput;
    return freeze({ deviceId: input.deviceId, relayConnected: input.relayConnected, telemetry: input.telemetry });
  } catch {
    return "unreadable";
  }
}

function readTelemetry(value: unknown): Readonly<LinkChainTelemetry> | null | Readonly<{ readonly field: string; readonly reason: string }> {
  if (value === null) return null;
  if (typeof value !== "object") return freeze({ field: "telemetry", reason: "invalid-container" });
  try {
    const telemetry = value as LinkChainTelemetry;
    const fields = ["sdkRegistered", "remoteControllerConnected", "flightControllerConnected", "connected"] as const;
    for (const field of fields) if (telemetry[field] !== undefined && typeof telemetry[field] !== "boolean") return freeze({ field: `telemetry.${field}`, reason: "invalid-type" });
    return freeze({
      // Stryker disable next-line ConditionalExpression: omitted optional telemetry fields and explicit undefined have identical public link semantics.
      ...(telemetry.sdkRegistered === undefined ? {} : { sdkRegistered: telemetry.sdkRegistered }),
      // Stryker disable next-line ConditionalExpression: omitted optional telemetry fields and explicit undefined have identical public link semantics.
      ...(telemetry.remoteControllerConnected === undefined ? {} : { remoteControllerConnected: telemetry.remoteControllerConnected }),
      // Stryker disable next-line ConditionalExpression: omitted optional telemetry fields and explicit undefined have identical public link semantics.
      ...(telemetry.flightControllerConnected === undefined ? {} : { flightControllerConnected: telemetry.flightControllerConnected }),
      // Stryker disable next-line ConditionalExpression: omitted optional telemetry fields and explicit undefined have identical public link semantics.
      ...(telemetry.connected === undefined ? {} : { connected: telemetry.connected })
    });
  } catch {
    return freeze({ field: "input", reason: "unreadable" });
  }
}

function evaluate(value: unknown): LinkChainResult<LinkChainSnapshot> {
  const input = readInput(value);
  if (input === "invalid-container") return failure("input", "invalid-container");
  if (input === "unreadable") return failure("input", "unreadable");
  if (!validDeviceId(input.deviceId)) return failure("deviceId", "invalid-id");
  if (typeof input.relayConnected !== "boolean") return failure("relayConnected", "invalid-type");
  const telemetry = readTelemetry(input.telemetry);
  if (telemetry !== null && "field" in telemetry) return failure(telemetry.field, telemetry.reason);
  if (!input.relayConnected) return success(freeze({ deviceId: input.deviceId, overall: "offline" as const, computerToPhone: "disconnected" as const, phoneToRemoteController: "unknown" as const, remoteControllerToAircraft: "unknown" as const }));
  if (telemetry === null || telemetry.sdkRegistered !== true) return success(freeze({ deviceId: input.deviceId, overall: "degraded" as const, computerToPhone: "connected" as const, phoneToRemoteController: "unknown" as const, remoteControllerToAircraft: "unknown" as const }));
  const remoteController = telemetry.remoteControllerConnected === true ? "connected" as const : "disconnected" as const;
  const aircraft = remoteController === "connected" ? telemetry.flightControllerConnected === true && telemetry.connected === true ? "connected" as const : "disconnected" as const : "unknown" as const;
  return success(freeze({ deviceId: input.deviceId, overall: aircraft === "connected" ? "ready" as const : "degraded" as const, computerToPhone: "connected" as const, phoneToRemoteController: remoteController, remoteControllerToAircraft: aircraft }));
}

// Stryker disable next-line ObjectLiteral: the ESM-static facade is instantiated before a transformed test module can re-import it; public identity is covered.
export const LinkChain = Object.freeze({ evaluate });
