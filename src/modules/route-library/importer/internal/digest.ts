import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { throwIfCancelled, yieldAndCheck } from "./cancellation.js";
import type { RouteImportCancellation } from "./types.js";

const HASH_CHUNK_BYTES = 1024 * 1024;

export async function calculateSha256(bytes: Uint8Array, cancellation?: RouteImportCancellation): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < bytes.length; offset += HASH_CHUNK_BYTES) {
    throwIfCancelled(cancellation);
    hash.update(bytes.subarray(offset, offset + HASH_CHUNK_BYTES));
    await yieldAndCheck(cancellation);
  }
  return bytesToHex(hash.digest());
}
