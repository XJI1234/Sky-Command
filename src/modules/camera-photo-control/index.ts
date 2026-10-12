import { PhotoDispatcher, type PhotoDispatchResult, type PhotoDispatchSnapshot, type PhotoManifestEntry, type PhotoRelay } from "./photo-dispatcher/index.js";
import { PhotoInbox, type PhotoInboxFs, type PhotoInboxInstance, type StoredPhoto } from "./photo-inbox/index.js";

export { PhotoDispatcher } from "./photo-dispatcher/index.js";
export { PhotoInbox } from "./photo-inbox/index.js";
export type { PhotoDispatchResult, PhotoDispatchSnapshot, PhotoManifestEntry, PhotoRelay } from "./photo-dispatcher/index.js";
export type { PhotoInboxInstance, StoredPhoto, PhotoMediaFile } from "./photo-inbox/index.js";

export interface CameraPhotoControlDependencies {
  readonly relay: PhotoRelay;
  readonly now: () => number;
  readonly fs?: PhotoInboxFs;
  /** Photos already saved for this phone. Used so a restarted desktop does not ask for them again. */
  readonly storedPhotos?: (deviceId: string) => readonly Pick<StoredPhoto, "fileName" | "size" | "sha256">[] | Promise<readonly Pick<StoredPhoto, "fileName" | "size" | "sha256">[]>;
}

export interface CameraPhotoControlInstance {
  readonly capture: (deviceId: string) => Promise<PhotoDispatchResult>;
  readonly fetch: (deviceId: string) => Promise<PhotoDispatchResult>;
  readonly get: (deviceId: string) => PhotoDispatchSnapshot;
  readonly list: (deviceId: string) => readonly StoredPhoto[];
  readonly recordDisconnected: (deviceId: string) => PhotoDispatchSnapshot | null;
  readonly recordStored: (deviceId: string, fileName: string, sha256: string) => PhotoDispatchSnapshot | null;
  readonly inbox: PhotoInboxInstance;
  readonly subscribe: (listener: (snapshot: PhotoDispatchSnapshot) => void) => () => void;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

function create(dependencies: CameraPhotoControlDependencies): CameraPhotoControlInstance {
  const inbox = PhotoInbox.create({ now: dependencies.now, ...(dependencies.fs === undefined ? {} : { fs: dependencies.fs }) });
  const dispatcher = PhotoDispatcher.create({ relay: dependencies.relay, knownPhotos: (deviceId): readonly PhotoManifestEntry[] => inbox.list(deviceId).map(({ fileName, sha256 }) => ({ fileName, sha256 })) });
  const rememberStored = async (deviceId: string): Promise<void> => {
    if (dependencies.storedPhotos === undefined) return;
    let stored: readonly Pick<StoredPhoto, "fileName" | "size" | "sha256">[];
    try { stored = await dependencies.storedPhotos(deviceId); } catch { return; }
    if (!Array.isArray(stored)) return;
    for (const photo of stored) inbox.remember(deviceId, photo);
  };
  return freeze({
    capture: (deviceId) => dispatcher.capture(deviceId),
    fetch: async (deviceId) => {
      await rememberStored(deviceId);
      return dispatcher.fetch(deviceId);
    },
    get: (deviceId) => dispatcher.get(deviceId),
    list: (deviceId) => inbox.list(deviceId),
    recordDisconnected: (deviceId) => dispatcher.recordDisconnected(deviceId),
    recordStored: (deviceId, fileName, sha256) => dispatcher.recordStored(deviceId, fileName, sha256),
    inbox,
    subscribe: (listener) => dispatcher.subscribe(listener)
  });
}

export const CameraPhotoControl = freeze({ create });
