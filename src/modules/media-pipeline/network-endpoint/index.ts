export type NetworkKind = "physical" | "wifi" | "virtual" | "vpn" | "tunnel" | "bluetooth";
export interface InterfaceFact {
  readonly name: string;
  readonly enabled: boolean;
  readonly internal: boolean;
  readonly kind: NetworkKind;
  readonly ipv4: string;
}
export interface Endpoint {
  readonly host: string;
  readonly port: number;
  readonly source: "manual" | "automatic";
  readonly rtmpUrlFor: (deviceId: unknown) => DeviceEndpointResult;
}
export type DeviceEndpointResult = Readonly<{ readonly ok: true; readonly value: Readonly<{ readonly rtmpUrl: string }> }> | Readonly<{ readonly ok: false; readonly code: "INVALID_DEVICE_ID" }>;
export type EndpointResult = Readonly<{ readonly ok: true; readonly value: Endpoint }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "NO_LOCAL_ENDPOINT" }>;
export interface NetworkEndpointInstance { readonly resolve: (interfaces: unknown, manualHost: unknown) => EndpointResult; }

type Octets = readonly [number, number, number, number];
interface ParsedIpv4 { readonly text: string; readonly octets: Octets; }

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function failure(code: "INVALID_INPUT" | "NO_LOCAL_ENDPOINT"): EndpointResult { return freeze({ ok: false as const, code }); }

function parseIpv4(value: unknown): ParsedIpv4 | null {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const parsed = parts.map(parseOctet);
  if (parsed.some((part) => part === null)) return null;
  const octets: Octets = [parsed[0]!, parsed[1]!, parsed[2]!, parsed[3]!];
  return freeze({ text: octets.join("."), octets });
}

function parseOctet(value: string): number | null {
  if (!/^(0|[1-9]\d{0,2})$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return parsed <= 255 ? parsed : null;
}

function isPrivateIpv4(octets: Octets): boolean {
  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 172) return second >= 16 && second <= 31;
  if (first === 192) return second === 168;
  // Tailscale CGNAT 100.64.0.0/10 — phone-reachable mesh LAN
  if (first === 100) return second >= 64 && second <= 127;
  return false;
}

function compareIpv4(left: Octets, right: Octets): number {
  return ipv4Number(left) - ipv4Number(right);
}

function ipv4Number([first, second, third, fourth]: Octets): number {
  return first * 16_777_216 + second * 65_536 + third * 256 + fourth;
}

function privateIpv4(value: unknown): ParsedIpv4 | null {
  const parsed = parseIpv4(value);
  return parsed !== null && isPrivateIpv4(parsed.octets) ? parsed : null;
}

function port(value: unknown): value is number {
  if (!Number.isSafeInteger(value)) return false;
  const number = value as number;
  return number >= 1024 && number <= 65535;
}

function deviceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128 && !value.includes("\0");
}

function candidateIpv4(item: unknown): ParsedIpv4 | null {
  if (item === null) return null;
  const fact = item as InterfaceFact;
  if (fact.enabled !== true) return null;
  if (fact.internal !== false) return null;
  if (fact.kind !== "physical" && fact.kind !== "wifi") return null;
  return privateIpv4(fact.ipv4);
}

function automaticHost(interfaces: unknown): string | null {
  if (!Array.isArray(interfaces)) return null;
  const candidates = interfaces
    .map(candidateIpv4)
    .filter((candidate): candidate is ParsedIpv4 => candidate !== null)
    .sort((left, right) => compareIpv4(left.octets, right.octets));
  return candidates[0]?.text ?? null;
}

function create(listenPort: number): NetworkEndpointInstance {
  if (!port(listenPort)) throw new TypeError("Invalid listen port");
  return freeze({ resolve: (interfaces, manualHost) => {
    if (manualHost === null) return endpoint(automaticHost(interfaces), listenPort, "automatic");
    const manual = privateIpv4(manualHost);
    if (manual === null) return failure("INVALID_INPUT");
    return endpoint(manual.text, listenPort, "manual");
  }});
}

function endpoint(host: string | null, listenPort: number, source: Endpoint["source"]): EndpointResult {
  if (host === null) return failure("NO_LOCAL_ENDPOINT");
  const rtmpUrlFor = (rawDeviceId: unknown): DeviceEndpointResult => {
    if (!deviceId(rawDeviceId)) return freeze({ ok: false as const, code: "INVALID_DEVICE_ID" as const });
    return freeze({ ok: true as const, value: freeze({ rtmpUrl: `rtmp://${host}:${listenPort}/live/${encodeURIComponent(rawDeviceId)}` }) });
  };
  return freeze({ ok: true as const, value: freeze({ host, port: listenPort, source, rtmpUrlFor }) });
}

class NetworkEndpointApi { readonly create = create; }
export const NetworkEndpoint = freeze(new NetworkEndpointApi());
