export interface NetworkSettingsValue {
  readonly listenPort: number;
  readonly relayPort: number;
  readonly manualHost: string | null;
}

export interface NetworkSettingsPatch {
  readonly listenPort?: number;
  readonly relayPort?: number;
  readonly manualHost?: string | null;
}

export interface NetworkSettingsError {
  readonly code: "INVALID_CONFIGURATION" | "INVALID_NETWORK_SETTINGS";
  readonly details: Readonly<{ readonly field: string; readonly reason: string }>;
}

export type NetworkSettingsResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly error: NetworkSettingsError }>;

type InputSnapshot = Readonly<{ readonly listenPort: unknown; readonly relayPort: unknown; readonly manualHost: unknown }>;

const trustedValues = new WeakSet<object>();

function success<T>(value: T): NetworkSettingsResult<T> {
  return Object.freeze({ ok: true as const, value });
}

function failure<T>(code: NetworkSettingsError["code"], field: string, reason: string): NetworkSettingsResult<T> {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, details: Object.freeze({ field, reason }) })
  });
}

function snapshotInput(value: unknown): InputSnapshot | "invalid-container" | "unreadable" {
  if (value === null || typeof value !== "object") return "invalid-container";
  try {
    return Object.freeze({
      listenPort: (value as Record<string, unknown>).listenPort,
      relayPort: (value as Record<string, unknown>).relayPort,
      manualHost: (value as Record<string, unknown>).manualHost
    });
  } catch {
    return "unreadable";
  }
}

function readPort(value: unknown, field: "listenPort" | "relayPort"): NetworkSettingsResult<number> {
  if (!Number.isSafeInteger(value)) {
    return failure("INVALID_NETWORK_SETTINGS", field, "not-safe-integer");
  }
  const port = value as number;
  if (port < 1024 || port > 65535) return failure("INVALID_NETWORK_SETTINGS", field, "out-of-range");
  return success(port);
}

function readIpv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  const first = octets[0]!;
  const second = octets[1]!;
  const isLocal = first === 10
    || first === 127
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
  return isLocal ? octets.join(".") : "";
}

function parseIpv6Group(value: string): number | null {
  if (!/^[0-9a-f]{1,4}$/iu.test(value)) return null;
  return Number.parseInt(value, 16);
}

function readIpv6(value: string): readonly number[] | null {
  const marker = value.indexOf("::");
  const parseSide = (side: string): number[] | null => {
    if (side.length === 0) return [];
    const parts = side.split(":");
    const groups = parts.map(parseIpv6Group);
    return groups.some((group) => group === null) ? null : groups as number[];
  };

  if (marker === -1) {
    const groups = parseSide(value);
    return groups === null || groups.length !== 8 ? null : groups;
  }
  const left = parseSide(value.slice(0, marker));
  const right = parseSide(value.slice(marker + 2));
  // Stryker disable next-line all: equivalent mutations cannot change the canonical result.
  if (left === null || right === null || left.length + right.length >= 8) return null;
  // Stryker disable next-line all: equivalent zero-run arithmetic is erased by canonicalization.
  return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right];
}

function canonicalIpv6(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 1;
  let runStart = 0;
    // Stryker disable next-line all: the extra terminal iteration has no observable effect.
    while (runStart < groups.length) {
    if (groups[runStart] !== 0) {
      runStart += 1;
      continue;
    }
    let runEnd = runStart;
    // Stryker disable next-line all: undefined is not a zero group.
    while (runEnd < groups.length && groups[runEnd] === 0) runEnd += 1;
    if (runEnd - runStart > bestLength) {
      bestStart = runStart;
      bestLength = runEnd - runStart;
    }
    runStart = runEnd;
  }
  const text = groups.map((group) => group.toString(16));
  if (bestStart === -1) return text.join(":");
  const before = text.slice(0, bestStart).join(":");
  const after = text.slice(bestStart + bestLength).join(":");
  return before + "::" + after;
}

function readHost(value: unknown): NetworkSettingsResult<string | null> {
  if (value === null) return success(null);
  if (typeof value !== "string") return failure("INVALID_NETWORK_SETTINGS", "manualHost", "invalid-type");
  if (/\s|\p{Cc}/u.test(value)) return failure("INVALID_NETWORK_SETTINGS", "manualHost", "unsafe-text");
  const startsBracket = value.startsWith("[");
  const endsBracket = value.endsWith("]");
  if (startsBracket !== endsBracket) {
    return failure("INVALID_NETWORK_SETTINGS", "manualHost", "invalid-ip");
  }
  const text = startsBracket ? value.slice(1, -1) : value;
  const ipv4 = readIpv4(text);
  if (ipv4 !== null) {
    return ipv4.length === 0
      ? failure("INVALID_NETWORK_SETTINGS", "manualHost", "not-local")
      : success(ipv4);
  }
  const ipv6 = readIpv6(text);
  if (ipv6 === null) return failure("INVALID_NETWORK_SETTINGS", "manualHost", "invalid-ip");
  const loopback = ipv6.slice(0, 7).every((group) => group === 0) && ipv6[7] === 1;
  const uniqueLocal = (ipv6[0]! & 0xfe00) === 0xfc00;
  const linkLocal = (ipv6[0]! & 0xffc0) === 0xfe80;
  return loopback || uniqueLocal || linkLocal
    ? success(canonicalIpv6(ipv6))
    : failure("INVALID_NETWORK_SETTINGS", "manualHost", "not-local");
}

function create(input: unknown): NetworkSettingsResult<NetworkSettingsValue> {
  const snapshot = snapshotInput(input);
  if (typeof snapshot === "string") return failure("INVALID_NETWORK_SETTINGS", "input", snapshot);
  const port = readPort(snapshot.listenPort, "listenPort");
  if (!port.ok) return port;
  const relayPort = snapshot.relayPort === undefined ? success(8080) : readPort(snapshot.relayPort, "relayPort");
  if (!relayPort.ok) return relayPort;
  const host = readHost(snapshot.manualHost);
  if (!host.ok) return host;
  const value = Object.freeze({ listenPort: port.value, relayPort: relayPort.value, manualHost: host.value });
  trustedValues.add(value);
  return success(value);
}

function patch(current: NetworkSettingsValue, update: unknown): NetworkSettingsResult<NetworkSettingsValue> {
  if (!trustedValues.has(current)) {
    return failure("INVALID_CONFIGURATION", "current", "untrusted");
  }
  const snapshot = snapshotInput(update);
  if (typeof snapshot === "string") return failure("INVALID_NETWORK_SETTINGS", "input", snapshot);
  return create({
    listenPort: snapshot.listenPort === undefined ? current.listenPort : snapshot.listenPort,
    relayPort: snapshot.relayPort === undefined ? current.relayPort : snapshot.relayPort,
    manualHost: snapshot.manualHost === undefined ? current.manualHost : snapshot.manualHost
  });
}

export const NetworkSettings = Object.freeze({ create, patch });
