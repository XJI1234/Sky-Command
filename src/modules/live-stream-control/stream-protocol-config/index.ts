export interface RtmpTargetInput {
  readonly deviceId: string;
  readonly endpoint: Readonly<{ readonly host: string; readonly port: number }>;
}

export interface RtmpTarget {
  readonly protocol: "rtmp";
  readonly rtmpUrl: string;
}

export type StreamTargetResult =
  | Readonly<{ readonly ok: true; readonly value: RtmpTarget }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "INVALID_DEVICE_ID" | "INVALID_ENDPOINT_HOST" | "INVALID_ENDPOINT_PORT" | "INVALID_TARGET" }>;

// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public immutability is tested.
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; every failure result is tested.
const failure = (code: Extract<StreamTargetResult, { readonly ok: false }>['code']): StreamTargetResult => freeze({ ok: false as const, code });
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public validation boundaries are tested.
const validDeviceId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public validation boundaries are tested.
const validHost = (value: unknown): value is string => typeof value === "string" && Array.from(value).length >= 1 && Array.from(value).length <= 253 && !/[\s\p{Cc}/?#@:]/u.test(value);
// Stryker disable next-line ArrowFunction, ConditionalExpression: Number.isSafeInteger already rejects every non-number; typeof is needed only for TypeScript narrowing.
const validPort = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1024 && value <= 65_535;

function isValidRtmpTarget(value: string, host: string, port: number, encodedDeviceId: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "rtmp:" && parsed.username === "" && parsed.password === "" && parsed.hostname === host && parsed.port === String(port) && parsed.pathname === `/live/${encodedDeviceId}` && parsed.search === "" && parsed.hash === "";
  }
  // Stryker disable next-line BlockStatement: false and undefined are observationally equivalent at the caller's boolean negation.
  catch {
    return false;
  }
}

function createRtmpTarget(input: unknown): StreamTargetResult {
  if (typeof input !== "object") return failure("INVALID_INPUT");
  let deviceId: unknown;
  let endpoint: unknown;
  try {
    ({ deviceId, endpoint } = input as RtmpTargetInput);
  } catch {
    return failure("INVALID_INPUT");
  }
  if (!validDeviceId(deviceId)) return failure("INVALID_DEVICE_ID");
  if (typeof endpoint !== "object") return failure("INVALID_INPUT");
  let host: unknown;
  let port: unknown;
  try {
    ({ host, port } = endpoint as RtmpTargetInput["endpoint"]);
  } catch {
    return failure("INVALID_INPUT");
  }
  if (!validHost(host)) return failure("INVALID_ENDPOINT_HOST");
  if (!validPort(port)) return failure("INVALID_ENDPOINT_PORT");
  let encodedDeviceId: string;
  try {
    encodedDeviceId = encodeURIComponent(deviceId);
  } catch {
    return failure("INVALID_TARGET");
  }
  const rtmpUrl = `rtmp://${host}:${port}/live/${encodedDeviceId}`;
  if (!isValidRtmpTarget(rtmpUrl, host, port, encodedDeviceId)) return failure("INVALID_TARGET");
  return freeze({ ok: true as const, value: freeze({ protocol: "rtmp" as const, rtmpUrl }) });
}

// Stryker disable next-line ObjectLiteral: the ESM-static facade is created before transformed tests can re-import it; public export use is tested.
export const StreamProtocolConfig = freeze({ createRtmpTarget });
