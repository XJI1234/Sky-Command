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
  /** Current disk inventory for this phone. Replaces cached records before every fetch. */
  readonly storedPhotos?: (deviceId: string) => readonly Pick<StoredPhoto, "fileName" | "size" | "sha256">[] | Promise<readonly Pick<StoredPhoto, "fileName" | "size" | "sha256">[]>;
}

export interface CameraPhotoControlInstance {
  readonly capture: (deviceId: string) => Promise<PhotoDispatchResult>;
  readonly fetch: (deviceId: string) => Promise<PhotoDispatchResult>;
  readonly stopFetch: (deviceId: string) => Promise<PhotoDispatchResult>;
  readonly get: (deviceId: string) => PhotoDispatchSnapshot;
  readonly list: (deviceId: string) => readonly StoredPhoto[];
  readonly recordDisconnected: (deviceId: string) => PhotoDispatchSnapshot | null;
  readonly recordStored: (deviceId: string, fileName: string, sha256: string) => PhotoDispatchSnapshot | null;
  readonly storedConfirmation: (deviceId: string) => (fileName: string, sha256: string) => PhotoDispatchSnapshot | null;
  readonly inbox: PhotoInboxInstance;
  readonly subscribe: (listener: (snapshot: PhotoDispatchSnapshot) => void) => () => void;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

function create(dependencies: CameraPhotoControlDependencies): CameraPhotoControlInstance {
  const inbox = PhotoInbox.create({ now: dependencies.now, ...(dependencies.fs === undefined ? {} : { fs: dependencies.fs }) });
  const dispatcher = PhotoDispatcher.create({ relay: dependencies.relay, now: dependencies.now, knownPhotos: (deviceId): readonly PhotoManifestEntry[] => inbox.list(deviceId).map(({ fileName, sha256 }) => ({ fileName, sha256 })) });
  const rememberStored = async (deviceId: string): Promise<void> => {
    if (dependencies.storedPhotos === undefined) return;
    let stored: readonly Pick<StoredPhoto, "fileName" | "size" | "sha256">[];
    stored = await dependencies.storedPhotos(deviceId);
    if (!Array.isArray(stored)) throw new Error("Invalid stored photo inventory");
    inbox.forget(deviceId);
    for (const photo of stored) inbox.remember(deviceId, photo);
  };
  return freeze({
    capture: (deviceId) => dispatcher.capture(deviceId),
    fetch: (deviceId) => dispatcher.fetch(deviceId, () => rememberStored(deviceId)),
    stopFetch: (deviceId) => dispatcher.stopFetch(deviceId),
    get: (deviceId) => dispatcher.get(deviceId),
    list: (deviceId) => inbox.list(deviceId),
    recordDisconnected: (deviceId) => dispatcher.recordDisconnected(deviceId),
    recordStored: (deviceId, fileName, sha256) => dispatcher.recordStored(deviceId, fileName, sha256),
    storedConfirmation: (deviceId) => dispatcher.storedConfirmation(deviceId),
    inbox,
    subscribe: (listener) => dispatcher.subscribe(listener)
  });
}

export const CameraPhotoControl = freeze({ create });
