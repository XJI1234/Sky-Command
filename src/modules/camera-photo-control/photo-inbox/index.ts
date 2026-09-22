export interface StoredPhoto {
  readonly fileName: string;
  readonly size: number;
  readonly sha256: string;
  readonly receivedAtMs: number;
}

export interface PhotoMediaFile {
  readonly fileName: string;
  readonly size: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export type PhotoInboxAccept = "accepted" | "duplicate" | "rejected";
export interface PhotoInboxFs {
  writeAtomic(deviceId: string, fileName: string, bytes: Uint8Array): boolean;
}
export interface PhotoInboxOptions {
  readonly now: () => number;
  readonly fs?: PhotoInboxFs;
}
export interface PhotoInboxInstance {
  accept(deviceId: string, file: PhotoMediaFile): PhotoInboxAccept;
  list(deviceId: string): readonly StoredPhoto[];
  forget(deviceId: string): boolean;
  subscribe(listener: (deviceId: string, photos: readonly StoredPhoto[]) => void): () => void;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validPhotoName = (value: unknown): value is string => {
  if (!validId(value) || value.includes("..") || /[\\/]/u.test(value)) return false;
  const lower = value.toLowerCase();
  return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".dng");
};

function create(options: PhotoInboxOptions): PhotoInboxInstance {
  const photos = new Map<string, StoredPhoto[]>();
  const listeners = new Set<(deviceId: string, photos: readonly StoredPhoto[]) => void>();
  const publish = (deviceId: string): void => {
    const current = freeze([...(photos.get(deviceId) ?? [])]);
    for (const listener of [...listeners]) { try { listener(deviceId, current); } catch { /* isolate */ } }
  };
  return freeze({
    accept: (deviceId, file) => {
      if (!validId(deviceId) || !validPhotoName(file?.fileName) || !(file.bytes instanceof Uint8Array) || file.size !== file.bytes.byteLength || file.size < 1 || file.size > 104857600 || !/^[0-9a-f]{64}$/u.test(file.sha256)) return "rejected";
      const existing = photos.get(deviceId) ?? [];
      if (existing.some((item) => item.fileName === file.fileName || item.sha256 === file.sha256)) return "duplicate";
      if (options.fs !== undefined) {
        let persisted = false;
        try { persisted = options.fs.writeAtomic(deviceId, file.fileName, file.bytes.slice()) === true; } catch { persisted = false; }
        if (!persisted) return "rejected";
      }
      const receivedAtMs = options.now();
      if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0) return "rejected";
      photos.set(deviceId, [...existing, freeze({ fileName: file.fileName, size: file.size, sha256: file.sha256, receivedAtMs })]);
      publish(deviceId);
      return "accepted";
    },
    list: (deviceId) => validId(deviceId) ? freeze([...(photos.get(deviceId) ?? [])]) : freeze([]),
    forget: (deviceId) => {
      if (!validId(deviceId) || !photos.has(deviceId)) return false;
      photos.delete(deviceId);
      publish(deviceId);
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      let active = true;
      return () => { if (active) { active = false; listeners.delete(listener); } };
    }
  });
}

export const PhotoInbox = freeze({ create });
