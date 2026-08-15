import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

export async function makeKmz(entries: Readonly<Record<string, string>>): Promise<Uint8Array> {
  const writer = new Uint8ArrayWriter();
  const zip = new ZipWriter(writer);
  for (const [name, contents] of Object.entries(entries)) await zip.add(name, new TextReader(contents));
  return zip.close();
}

export async function makeStoredKmz(entries: Readonly<Record<string, string>>): Promise<Uint8Array> {
  const writer = new Uint8ArrayWriter();
  const zip = new ZipWriter(writer);
  for (const [name, contents] of Object.entries(entries)) {
    await zip.add(name, new TextReader(contents), { level: 0 });
  }
  return zip.close();
}

export async function makeSymlinkKmz(name: string, contents: string): Promise<Uint8Array> {
  const writer = new Uint8ArrayWriter();
  const zip = new ZipWriter(writer);
  await zip.add(name, new TextReader(contents), { unixMode: 0o120777 });
  return zip.close();
}

export async function makeSpecialEntryKmz(name: string, contents: string, unixMode: number): Promise<Uint8Array> {
  return makeModeAwareKmz([{ name, contents, unixMode }]);
}

export async function makeModeAwareKmz(
  entries: readonly Readonly<{ name: string; contents: string; unixMode?: number }>[]
): Promise<Uint8Array> {
  const writer = new Uint8ArrayWriter();
  const zip = new ZipWriter(writer);
  for (const entry of entries) {
    await zip.add(entry.name, new TextReader(entry.contents), { unixMode: entry.unixMode });
  }
  return zip.close();
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function signatureAt(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24);
}

function findSignature(bytes: Uint8Array, signature: number, start = 0): number {
  for (let offset = start; offset + 4 <= bytes.byteLength; offset += 1) {
    if (signatureAt(bytes, offset) === signature) return offset;
  }
  throw new Error("ZIP fixture signature not found");
}

export async function makeOverlappingKmz(contents: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(contents);
  const fixedDate = new Date("2020-01-01T00:00:00.000Z");
  const innerWriter = new Uint8ArrayWriter();
  const innerZip = new ZipWriter(innerWriter);
  await innerZip.add("waylines.wpml", new Uint8ArrayReader(encoded), { level: 0, lastModDate: fixedDate });
  const inner = await innerZip.close();
  const innerCentralOffset = findSignature(inner, 0x02014b50);
  const embeddedLocalRecord = inner.slice(0, innerCentralOffset);

  const outerWriter = new Uint8ArrayWriter();
  const outerZip = new ZipWriter(outerWriter);
  await outerZip.add("res/blob.bin", new Uint8ArrayReader(embeddedLocalRecord), { level: 0, lastModDate: fixedDate });
  await outerZip.add("waylines.wpml", new Uint8ArrayReader(encoded), { level: 0, lastModDate: fixedDate });
  const outer = await outerZip.close();

  const firstNameLength = readUint16(outer, 26);
  const firstExtraLength = readUint16(outer, 28);
  const embeddedOffset = 30 + firstNameLength + firstExtraLength;
  const targetName = new TextEncoder().encode("waylines.wpml");
  let centralOffset = findSignature(outer, 0x02014b50);
  while (centralOffset + 46 <= outer.byteLength) {
    const nameLength = readUint16(outer, centralOffset + 28);
    const extraLength = readUint16(outer, centralOffset + 30);
    const commentLength = readUint16(outer, centralOffset + 32);
    const nameStart = centralOffset + 46;
    if (nameLength === targetName.length && targetName.every((value, index) => outer[nameStart + index] === value)) {
      const copy = outer.slice();
      writeUint32(copy, centralOffset + 42, embeddedOffset);
      return copy;
    }
    centralOffset += 46 + nameLength + extraLength + commentLength;
    if (signatureAt(outer, centralOffset) !== 0x02014b50) break;
  }
  throw new Error("ZIP fixture central entry not found");
}

function setFlags(bytes: Uint8Array, fileName: string, flags: number, target: "all" | "local"): Uint8Array {
  const copy = bytes.slice();
  const encoded = new TextEncoder().encode(fileName);
  for (let offset = 0; offset + 30 <= copy.length; offset += 1) {
    const signature = copy[offset]! | (copy[offset + 1]! << 8) | (copy[offset + 2]! << 16) | (copy[offset + 3]! << 24);
    const local = signature === 0x04034b50;
    const central = signature === 0x02014b50;
    if (!local && !central) continue;
    if (target === "local" && !local) continue;
    const nameLengthOffset = offset + (central ? 28 : 26);
    const nameLength = readUint16(copy, nameLengthOffset);
    const nameStart = offset + (central ? 46 : 30);
    if (nameLength !== encoded.length) continue;
    if (!encoded.every((value, index) => copy[nameStart + index] === value)) continue;
    writeUint16(copy, offset + (central ? 8 : 6), flags);
  }
  return copy;
}

export function setGeneralPurposeFlags(bytes: Uint8Array, fileName: string, flags: number): Uint8Array {
  return setFlags(bytes, fileName, flags, "all");
}

export function setLocalGeneralPurposeFlags(bytes: Uint8Array, fileName: string, flags: number): Uint8Array {
  return setFlags(bytes, fileName, flags, "local");
}

export function appendArchiveData(bytes: Uint8Array, suffix: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.byteLength + suffix.byteLength);
  output.set(bytes);
  output.set(suffix, bytes.byteLength);
  return output;
}

export function concatenateArchives(first: Uint8Array, second: Uint8Array): Uint8Array {
  return appendArchiveData(first, second);
}

export function corruptPayloadByte(bytes: Uint8Array, fileName: string): Uint8Array {
  const copy = bytes.slice();
  const encoded = new TextEncoder().encode(fileName);
  for (let offset = 0; offset + 30 <= copy.length; offset += 1) {
    if (copy[offset] === 0x50 && copy[offset + 1] === 0x4b && copy[offset + 2] === 0x03 && copy[offset + 3] === 0x04) {
      const nameLength = readUint16(copy, offset + 26);
      const extraLength = readUint16(copy, offset + 28);
      const nameStart = offset + 30;
      if (nameLength !== encoded.length || !encoded.every((value, index) => copy[nameStart + index] === value)) continue;
      copy[offset + 30 + nameLength + extraLength]! ^= 0xff;
      return copy;
    }
  }
  return copy;
}

export function truncateArchive(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, Math.max(0, bytes.length - 12));
}

export function corruptDeclaredSize(bytes: Uint8Array, fileName: string): Uint8Array {
  const copy = bytes.slice();
  const encoded = new TextEncoder().encode(fileName);
  for (let offset = 0; offset + 46 <= copy.length; offset += 1) {
    if (!(copy[offset] === 0x50 && copy[offset + 1] === 0x4b && copy[offset + 2] === 0x01 && copy[offset + 3] === 0x02)) continue;
    const nameLength = readUint16(copy, offset + 28);
    const nameStart = offset + 46;
    if (nameLength !== encoded.length || !encoded.every((value, index) => copy[nameStart + index] === value)) continue;
    copy[offset + 24] = 0xff;
    copy[offset + 25] = 0xff;
    copy[offset + 26] = 0xff;
    copy[offset + 27] = 0xff;
    return copy;
  }
  return copy;
}
