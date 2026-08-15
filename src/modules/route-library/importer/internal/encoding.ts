export type XmlEncoding = "utf-8" | "utf-16le" | "utf-16be";

export interface DetectedXmlEncoding {
  readonly encoding: XmlEncoding;
  readonly offset: number;
}

import { throwIfCancelled, yieldAndCheck } from "./cancellation.js";
import type { RouteImportCancellation } from "./types.js";

const YIELD_INTERVAL_BYTES = 1024 * 1024;

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

async function looksLikeUtf16Xml(
  bytes: Uint8Array,
  littleEndian: boolean,
  cancellation: RouteImportCancellation | undefined
): Promise<boolean> {
  let nextYieldAt = YIELD_INTERVAL_BYTES;
  for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
    if (offset >= nextYieldAt) {
      await yieldAndCheck(cancellation);
      nextYieldAt += YIELD_INTERVAL_BYTES;
    }
    const codeUnit = littleEndian
      ? bytes[offset]! | (bytes[offset + 1]! << 8)
      : (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (codeUnit === 0x20 || codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d) continue;
    return codeUnit === 0x3c;
  }
  return false;
}

export async function detectXmlEncoding(
  bytes: Uint8Array,
  cancellation?: RouteImportCancellation
): Promise<DetectedXmlEncoding | null> {
  throwIfCancelled(cancellation);
  if (hasPrefix(bytes, [0xff, 0xfe])) return Object.freeze({ encoding: "utf-16le", offset: 2 });
  if (hasPrefix(bytes, [0xfe, 0xff])) return Object.freeze({ encoding: "utf-16be", offset: 2 });
  if (hasPrefix(bytes, [0xef, 0xbb, 0xbf])) return Object.freeze({ encoding: "utf-8", offset: 3 });
  if (await looksLikeUtf16Xml(bytes, false, cancellation)) return Object.freeze({ encoding: "utf-16be", offset: 0 });
  if (await looksLikeUtf16Xml(bytes, true, cancellation)) return Object.freeze({ encoding: "utf-16le", offset: 0 });
  let nextYieldAt = YIELD_INTERVAL_BYTES;
  for (let offset = 0; offset !== bytes.byteLength; offset += 1) {
    if (offset >= nextYieldAt) {
      await yieldAndCheck(cancellation);
      nextYieldAt += YIELD_INTERVAL_BYTES;
    }
    const byte = bytes[offset]!;
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    return byte === 0x3c ? Object.freeze({ encoding: "utf-8", offset: 0 }) : null;
  }
  return null;
}
