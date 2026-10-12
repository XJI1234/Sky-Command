import { sha256 } from "@noble/hashes/sha2.js";
import { ProtocolLimits, validate, type RelayFrame } from "../protocol-core/index.js";

export interface MediaTransfer {
  readonly transferId: string;
  readonly fileName: string;
  readonly size: number;
  readonly sha256: string;
}

export interface MediaFile extends MediaTransfer {
  readonly bytes: Uint8Array;
}

export type MediaSinkResult = "accepted" | "rejected";

export interface MediaSink {
  begin(connectionId: string, transfer: Readonly<MediaTransfer>): MediaSinkResult;
  append(connectionId: string, bytes: Uint8Array): MediaSinkResult;
  complete(connectionId: string, file: MediaFile): MediaSinkResult | Promise<MediaSinkResult>;
  abort(connectionId: string): void;
}

export interface MediaResultSink {
  send(connectionId: string, frame: Extract<RelayFrame, { readonly type: "media-result" }>): void;
}

export type MediaIntakeStatus = "succeeded" | "rejected" | "disconnected" | "transfer-failed";

export interface MediaIntakeOptions {
  readonly sink: MediaSink;
  readonly results: MediaResultSink;
}

export interface MediaIntakeInstance {
  accept(connectionId: string, frame: RelayFrame): void;
  cancelConnection(connectionId: string, reason: string): void;
}

interface ActiveMediaTransfer extends MediaTransfer {
  readonly chunks: Uint8Array[];
  readonly checksum: ReturnType<typeof sha256.create>;
  receivedBytes: number;
  completing: boolean;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const hex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const result = (id: string, ok: boolean, detail: string): Extract<RelayFrame, { readonly type: "media-result" }> =>
  freeze({ type: "media-result", id, ok, detail });

function create(options: MediaIntakeOptions): MediaIntakeInstance {
  const active = new Map<string, ActiveMediaTransfer>();
  const fail = (connectionId: string, id: string, detail: string): void => {
    active.delete(connectionId);
    runCatching(() => options.sink.abort(connectionId));
    runCatching(() => options.results.send(connectionId, result(id, false, detail)));
  };
  const runCatching = (work: () => void): void => { try { work(); } catch { /* isolate sink and result faults */ } };
  return freeze({
    accept: (connectionId, frame) => {
      if (frame.type === "media-begin") {
        if (!validate(frame).ok) return;
        const current = active.get(connectionId);
        if (current !== undefined && current.transferId === frame.id) {
          options.results.send(connectionId, result(frame.id, false, "TRANSFER_ALREADY_ACTIVE"));
          return;
        }
        if (current !== undefined) {
          active.delete(connectionId);
          runCatching(() => options.sink.abort(connectionId));
          options.results.send(connectionId, result(current.transferId, false, "TRANSFER_SUPERSEDED"));
        }
        const transfer = freeze({ transferId: frame.id, fileName: frame.fileName, size: frame.size, sha256: frame.sha256 });
        if (options.sink.begin(connectionId, transfer) !== "accepted") {
          options.results.send(connectionId, result(frame.id, false, "TRANSFER_FAILED"));
          return;
        }
        active.set(connectionId, { ...transfer, chunks: [], checksum: sha256.create(), receivedBytes: 0, completing: false });
        return;
      }
      const current = active.get(connectionId);
      if (frame.type === "media-chunk") {
        if (current === undefined || current.transferId !== frame.id) {
          options.results.send(connectionId, result(frame.id, false, "TRANSFER_NOT_ACTIVE"));
          return;
        }
        const data = frame.data instanceof Uint8Array ? frame.data : new Uint8Array();
        if (current.completing || data.byteLength < 1 || data.byteLength > ProtocolLimits.maxMissionChunkBytes || current.receivedBytes + data.byteLength > current.size || options.sink.append(connectionId, data) !== "accepted") {
          fail(connectionId, frame.id, "TRANSFER_FAILED");
          return;
        }
        const owned = data.slice();
        current.chunks.push(owned);
        current.checksum.update(owned);
        current.receivedBytes += owned.byteLength;
        return;
      }
      if (frame.type !== "media-complete") return;
      if (current === undefined || current.transferId !== frame.id) {
        options.results.send(connectionId, result(frame.id, false, "TRANSFER_NOT_ACTIVE"));
        return;
      }
      if (current.completing) return;
      if (current.receivedBytes !== current.size || hex(current.checksum.digest()) !== current.sha256) {
        fail(connectionId, frame.id, current.receivedBytes !== current.size ? "TRANSFER_SIZE_MISMATCH" : "TRANSFER_CHECKSUM_MISMATCH");
        return;
      }
      current.completing = true;
      const bytes = concat(current.chunks);
      current.chunks.length = 0;
      const file: MediaFile = freeze({ transferId: current.transferId, fileName: current.fileName, size: current.size, sha256: current.sha256, bytes });
      const finish = (stored: MediaSinkResult): void => {
        if (active.get(connectionId) !== current) return;
        active.delete(connectionId);
        if (stored !== "accepted") runCatching(() => options.sink.abort(connectionId));
        runCatching(() => options.results.send(connectionId, result(frame.id, stored === "accepted", stored === "accepted" ? "Photo stored" : "TRANSFER_FAILED")));
      };
      try {
        const stored = options.sink.complete(connectionId, file);
        if (typeof stored === "string") finish(stored);
        else void stored.then(finish, () => finish("rejected"));
      } catch { finish("rejected"); }
    },
    cancelConnection: (connectionId) => {
      const current = active.get(connectionId);
      if (current === undefined) return;
      active.delete(connectionId);
      runCatching(() => options.sink.abort(connectionId));
    }
  });
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export const MediaIntake = freeze({ create });
