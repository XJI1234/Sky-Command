import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

const extensionOf = (fileName: string): "kml" | "kmz" | null => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".kmz")) return "kmz";
  if (lower.endsWith(".kml")) return "kml";
  return null;
};

const safeFileName = (fileName: string): string | null => {
  const trimmed = fileName.trim();
  if (trimmed.length === 0 || trimmed.length > 180) return null;
  if (trimmed.includes("..") || /[\\/\u0000]/.test(trimmed)) return null;
  return extensionOf(trimmed) === null ? null : trimmed;
};

const bytesOf = (value: unknown): Uint8Array | null => value instanceof Uint8Array ? value : null;

const descend = (value: unknown): unknown => {
  let current = value;
  for (let step = 0; step < 6; step += 1) {
    if (!isRecord(current)) return current;
    if (current.status === "imported" || current.status === "rejected" || current.status === "cancelled") return current;
    if (current.ok === false) return current;
    if (!("value" in current)) return current;
    current = current.value;
  }
  return current;
};

export function importedRouteSha256(result: unknown): string | null {
  const body = descend(result);
  if (!isRecord(body) || body.status !== "imported" || !isRecord(body.route)) return null;
  return typeof body.route.sha256 === "string" && SHA256.test(body.route.sha256) ? body.route.sha256 : null;
}

export function routeSha256(routes: unknown, routeId: unknown): string | null {
  if (!Array.isArray(routes) || typeof routeId !== "string") return null;
  const match = routes.find((item) => isRecord(item) && item.routeId === routeId);
  if (!isRecord(match) || typeof match.sha256 !== "string" || !SHA256.test(match.sha256)) return null;
  return match.sha256;
}

export function invocationFailed(result: unknown): boolean {
  let current = result;
  for (let step = 0; step < 6; step += 1) {
    if (!isRecord(current)) return false;
    if (current.ok === false) return true;
    if (!("value" in current)) return false;
    current = current.value;
  }
  return false;
}

export function rememberRouteFile(directory: string, fileName: unknown, bytes: unknown, sha256: string): void {
  if (!SHA256.test(sha256) || typeof fileName !== "string") return;
  const storedName = safeFileName(fileName);
  const payload = bytesOf(bytes);
  if (storedName === null || payload === null) return;
  const ext = extensionOf(storedName);
  if (ext === null) return;
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, `${sha256}.${ext}`);
  const temporary = `${destination}.tmp`;
  try {
    writeFileSync(temporary, payload);
    renameSync(temporary, destination);
    writeFileSync(join(directory, `${sha256}.name`), storedName, "utf8");
  } catch {
    try { unlinkSync(temporary); } catch { /* a failed write must not undo the import */ }
  }
}

export function forgetRouteFile(directory: string, sha256: string | null): void {
  if (sha256 === null || !SHA256.test(sha256)) return;
  for (const suffix of ["kmz", "kml", "name"]) {
    try { unlinkSync(join(directory, `${sha256}.${suffix}`)); } catch { /* already absent */ }
  }
}

export function loadRouteFiles(directory: string): readonly { readonly fileName: string; readonly bytes: Uint8Array }[] {
  let names: string[];
  try { names = readdirSync(directory); } catch { return []; }
  const loaded: { fileName: string; bytes: Uint8Array }[] = [];
  for (const name of names) {
    const ext = extensionOf(name);
    if (ext === null) continue;
    const sha256 = name.slice(0, -(ext.length + 1));
    if (!SHA256.test(sha256)) continue;
    let fileName = name;
    try {
      const stored = readFileSync(join(directory, `${sha256}.name`), "utf8").trim();
      const safe = safeFileName(stored);
      if (safe !== null) fileName = safe;
    } catch { /* the hash file name still identifies the bytes */ }
    try {
      loaded.push({ fileName, bytes: new Uint8Array(readFileSync(join(directory, name))) });
    } catch { /* skip an unreadable copy */ }
  }
  return loaded;
}
