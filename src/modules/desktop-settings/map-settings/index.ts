export type MapBasemap = "tianditu-vector" | "tianditu-image";

export interface MapSettingsValue {
  readonly basemap: MapBasemap;
  readonly credential: string | null;
}

export interface MapSettingsPatch {
  readonly basemap?: MapBasemap;
  readonly credential?: string | null;
}

export interface MapSettingsError {
  readonly code: "INVALID_CONFIGURATION" | "INVALID_MAP_SETTINGS";
  readonly details: Readonly<{ readonly field: string; readonly reason: string }>;
}

export type MapSettingsResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly error: MapSettingsError }>;

type InputSnapshot = Readonly<{ readonly basemap: unknown; readonly credential: unknown }>;

const trustedValues = new WeakSet<object>();

function success<T>(value: T): MapSettingsResult<T> {
  return Object.freeze({ ok: true as const, value });
}

function failure<T>(code: MapSettingsError["code"], field: string, reason: string): MapSettingsResult<T> {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, details: Object.freeze({ field, reason }) })
  });
}

function snapshotInput(value: unknown): InputSnapshot | "invalid-container" | "unreadable" {
  if (value === null || typeof value !== "object") return "invalid-container";
  try {
    return Object.freeze({
      basemap: (value as Record<string, unknown>).basemap,
      credential: (value as Record<string, unknown>).credential
    });
  } catch {
    return "unreadable";
  }
}

function readBasemap(value: unknown): MapSettingsResult<MapBasemap> {
  if (typeof value !== "string") return failure("INVALID_MAP_SETTINGS", "basemap", "invalid-type");
  if (value === "tianditu-vector" || value === "tianditu-image") return success(value);
  return failure("INVALID_MAP_SETTINGS", "basemap", "unsupported-basemap");
}

function readCredential(value: unknown): MapSettingsResult<string | null> {
  if (value === null) return success(null);
  if (typeof value !== "string") return failure("INVALID_MAP_SETTINGS", "credential", "invalid-type");
  const normalized = value.trim();
  if (normalized.length === 0) return failure("INVALID_MAP_SETTINGS", "credential", "credential-empty");
  if (Array.from(normalized).length > 256) return failure("INVALID_MAP_SETTINGS", "credential", "credential-too-long");
  if (/[\s\p{Cc}]/u.test(normalized)) return failure("INVALID_MAP_SETTINGS", "credential", "credential-unsafe-text");
  return success(normalized);
}

function create(input: unknown): MapSettingsResult<MapSettingsValue> {
  const snapshot = snapshotInput(input);
  if (typeof snapshot === "string") return failure("INVALID_MAP_SETTINGS", "input", snapshot);
  const basemap = readBasemap(snapshot.basemap);
  if (!basemap.ok) return basemap;
  const credential = readCredential(snapshot.credential);
  if (!credential.ok) return credential;
  const value = Object.freeze({ basemap: basemap.value, credential: credential.value });
  trustedValues.add(value);
  return success(value);
}

function patch(current: MapSettingsValue, update: unknown): MapSettingsResult<MapSettingsValue> {
  if (!trustedValues.has(current)) {
    return failure("INVALID_CONFIGURATION", "current", "untrusted");
  }
  const snapshot = snapshotInput(update);
  if (typeof snapshot === "string") return failure("INVALID_MAP_SETTINGS", "input", snapshot);
  return create({
    basemap: snapshot.basemap === undefined ? current.basemap : snapshot.basemap,
    credential: snapshot.credential === undefined ? current.credential : snapshot.credential
  });
}

export const MapSettings = Object.freeze({ create, patch });
