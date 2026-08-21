export interface WhipTargetInput {
  readonly deviceId: string;
  readonly endpoint: Readonly<{ readonly host: string; readonly port: number }>;
}

export interface WhipTargetValue {
  readonly protocol: "whip";
  readonly whipUrl: string;
}

export type WhipTargetResult =
  | Readonly<{ readonly ok: true; readonly value: WhipTargetValue }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "INVALID_DEVICE_ID" | "INVALID_ENDPOINT_HOST" | "INVALID_ENDPOINT_PORT" | "INVALID_TARGET" }>;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const failure = (code: Extract<WhipTargetResult, { readonly ok: false }>['code']): WhipTargetResult => freeze({ ok: false as const, code });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
}

function validHost(value: unknown): value is string {
  return typeof value === "string"
    && Array.from(value).length >= 1
    && Array.from(value).length <= 253
    && !/[\s\p{Cc}/?#@:]/u.test(value);
}

function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1024 && value <= 65_535;
}

function validTarget(value: string, host: string, port: number, encodedDeviceId: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.hostname === host
      && parsed.port === String(port)
      && parsed.pathname === `/live/${encodedDeviceId}/whip`
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function create(input: unknown): WhipTargetResult {
  if (!record(input)) return failure("INVALID_INPUT");
  let deviceId: unknown;
  let endpoint: unknown;
  try {
    deviceId = input.deviceId;
    endpoint = input.endpoint;
  } catch {
    return failure("INVALID_INPUT");
  }
  if (!validDeviceId(deviceId)) return failure("INVALID_DEVICE_ID");
  if (!record(endpoint)) return failure("INVALID_INPUT");
  let host: unknown;
  let port: unknown;
  try {
    host = endpoint.host;
    port = endpoint.port;
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
  const whipUrl = `http://${host}:${port}/live/${encodedDeviceId}/whip`;
  if (!validTarget(whipUrl, host, port, encodedDeviceId)) return failure("INVALID_TARGET");
  return freeze({ ok: true as const, value: freeze({ protocol: "whip" as const, whipUrl }) });
}

export const WhipTarget = freeze({ create });
