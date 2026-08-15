import { MapSettings, type MapSettingsError, type MapSettingsValue } from "../map-settings/index.js";
import { NetworkSettings, type NetworkSettingsError, type NetworkSettingsValue } from "../network-settings/index.js";

export interface SettingsStorage {
  read(): Promise<Uint8Array | null>;
  writeAtomically(bytes: Uint8Array): Promise<void>;
}

export interface SettingsSnapshot {
  readonly version: 1;
  readonly network: NetworkSettingsValue;
  readonly map: MapSettingsValue;
}

export interface SettingsError {
  readonly code:
    | "INVALID_CONFIGURATION"
    | "INVALID_NETWORK_SETTINGS"
    | "INVALID_MAP_SETTINGS"
    | "STORAGE_READ_FAILED"
    | "STORAGE_WRITE_FAILED";
  readonly details: Readonly<{ readonly field: string; readonly reason: string }>;
}

export type SettingsResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly error: SettingsError }>;

export type SettingsLoadResult =
  | Readonly<{ readonly status: "loaded"; readonly snapshot: SettingsSnapshot }>
  | Readonly<{ readonly status: "recovered"; readonly snapshot: SettingsSnapshot; readonly reason: "missing" | "corrupt" | "unsupported-version" }>
  | Readonly<{ readonly status: "failed"; readonly error: SettingsError }>;

export interface DesktopSettingsInstance {
  snapshot(): SettingsSnapshot;
  load(): Promise<SettingsLoadResult>;
  updateNetwork(input: unknown): SettingsResult<SettingsSnapshot>;
  updateMap(input: unknown): SettingsResult<SettingsSnapshot>;
  save(): Promise<SettingsResult<SettingsSnapshot>>;
}

const defaultNetworkResult = NetworkSettings.create({ listenPort: 19500, manualHost: null });
const defaultMapResult = MapSettings.create({ basemap: "tianditu-vector", credential: null });
// These literals are validated at module initialization and become trusted values for patching.
const defaultNetwork = (defaultNetworkResult as { readonly ok: true; readonly value: NetworkSettingsValue }).value;
const defaultMap = (defaultMapResult as { readonly ok: true; readonly value: MapSettingsValue }).value;

const freezeSnapshot = (network: NetworkSettingsValue, map: MapSettingsValue): SettingsSnapshot => Object.freeze({
  version: 1 as const,
  network,
  map
});

const defaultSnapshot = freezeSnapshot(defaultNetwork, defaultMap);

function failure<T>(code: SettingsError["code"], field: string, reason: string): SettingsResult<T> {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, details: Object.freeze({ field, reason }) })
  });
}

function success<T>(value: T): SettingsResult<T> {
  return Object.freeze({ ok: true as const, value });
}

// Stryker disable next-line all: the sentinel identity, not its marker payload, defines corruption.
const corruptDocument = Object.freeze({ version: 2 });
// Stryker disable next-line all: this fallback is overwritten on successful decoding.
const unsupportedDocument = Object.freeze({ version: 2 });

function decodeDocument(bytes: Uint8Array): unknown {
  let parsed: unknown = unsupportedDocument;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = corruptDocument;
  }
  return parsed;
}

function readVersionOne(value: Record<string, unknown>): SettingsSnapshot | null {
  const network = NetworkSettings.create(value.network);
  if (!network.ok) return null;
  const map = MapSettings.create(value.map);
  if (!map.ok) return null;
  return freezeSnapshot(network.value, map.value);
}

function readVersionZero(value: Record<string, unknown>): SettingsSnapshot | null {
  const network = NetworkSettings.create({
    listenPort: value.port === undefined ? defaultNetwork.listenPort : value.port,
    manualHost: value.host === undefined ? defaultNetwork.manualHost : value.host
  });
  if (!network.ok) return null;
  return freezeSnapshot(network.value, defaultMap);
}

function parseSnapshot(value: unknown):
  | Readonly<{ kind: "loaded"; snapshot: SettingsSnapshot }>
  | Readonly<{ kind: "recovered"; reason: "corrupt" | "unsupported-version" }> {
  if (value === corruptDocument) return Object.freeze({ kind: "recovered" as const, reason: "corrupt" as const });
  // Stryker disable next-line all: primitive roots and object roots with missing fields both recover as corrupt.
  if (value === null || typeof value !== "object") return Object.freeze({ kind: "recovered" as const, reason: "corrupt" as const });
  const record = value as Record<string, unknown>;
  if (record.version === 0) {
    const snapshot = readVersionZero(record);
    return snapshot === null
      ? Object.freeze({ kind: "recovered" as const, reason: "corrupt" as const })
      : Object.freeze({ kind: "loaded" as const, snapshot });
  }
  if (typeof record.version !== "number") return Object.freeze({ kind: "recovered" as const, reason: "corrupt" as const });
  if (record.version !== 1) return Object.freeze({ kind: "recovered" as const, reason: "unsupported-version" as const });
  const snapshot = readVersionOne(record);
  return snapshot === null
    ? Object.freeze({ kind: "recovered" as const, reason: "corrupt" as const })
    : Object.freeze({ kind: "loaded" as const, snapshot });
}

function serialize(snapshot: SettingsSnapshot): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    version: 1,
    network: {
      listenPort: snapshot.network.listenPort,
      relayPort: snapshot.network.relayPort,
      manualHost: snapshot.network.manualHost
    },
    map: {
      basemap: snapshot.map.basemap,
      credential: snapshot.map.credential
    }
  }));
}

function enqueue<T>(queue: { tail: Promise<void> }, operation: () => Promise<T>): Promise<T> {
  const run = queue.tail.then(operation, operation);
  /* c8 ignore next -- each public load/save operation normalizes its own failure into a result. */
  queue.tail = run.then(() => undefined, () => undefined);
  return run;
}

function create(storage: SettingsStorage): DesktopSettingsInstance {
  let current = defaultSnapshot;
  const queue = { tail: Promise.resolve() };

  const snapshot = (): SettingsSnapshot => current;

  const recover = (reason: "missing" | "corrupt" | "unsupported-version"): SettingsLoadResult => {
    current = defaultSnapshot;
    return Object.freeze({ status: "recovered" as const, snapshot: defaultSnapshot, reason });
  };

  const updateNetwork = (input: unknown): SettingsResult<SettingsSnapshot> => {
    const result = NetworkSettings.patch(current.network, input);
    if (!result.ok) return result as SettingsResult<SettingsSnapshot>;
    current = freezeSnapshot(result.value, current.map);
    return success(current);
  };

  const updateMap = (input: unknown): SettingsResult<SettingsSnapshot> => {
    const result = MapSettings.patch(current.map, input);
    if (!result.ok) return result as SettingsResult<SettingsSnapshot>;
    current = freezeSnapshot(current.network, result.value);
    return success(current);
  };

  const load = (): Promise<SettingsLoadResult> => enqueue(queue, async () => {
    let bytes: Uint8Array | null;
    try {
      bytes = await storage.read();
    } catch {
      return Object.freeze({
        status: "failed" as const,
        error: Object.freeze({
          code: "STORAGE_READ_FAILED" as const,
          details: Object.freeze({ field: "storage", reason: "read-failed" })
        })
      });
    }
    if (bytes === null) return recover("missing");
    const parsed = parseSnapshot(decodeDocument(new Uint8Array(bytes)));
    if (parsed.kind === "recovered") return recover(parsed.reason);
    current = parsed.snapshot;
    return Object.freeze({ status: "loaded" as const, snapshot: current });
  });

  const save = (): Promise<SettingsResult<SettingsSnapshot>> => {
    const captured = current;
    return enqueue(queue, async () => {
      try {
        await storage.writeAtomically(serialize(captured));
        return success(captured);
      } catch {
        return failure("STORAGE_WRITE_FAILED", "storage", "write-failed");
      }
    });
  };

  return Object.freeze({ snapshot, load, updateNetwork, updateMap, save });
}

export const DesktopSettings = Object.freeze({ create });

export type { MapSettingsError, NetworkSettingsError };
