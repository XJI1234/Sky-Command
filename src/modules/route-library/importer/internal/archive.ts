import {
  Uint8ArrayReader,
  Writer,
  ZipReader,
  type Entry,
  type FileEntry
} from "@zip.js/zip.js";
import { createError, type RouteLibraryError } from "../../domain/index.js";
import { ImporterPhaseError } from "./error-map.js";
import { ImporterCancelled } from "./error-map.js";
import { throwIfCancelled, yieldAndCheck } from "./cancellation.js";
import type { RouteImportCancellation, RouteImportLimits } from "./types.js";

interface NormalizedEntry {
  readonly entry: Entry;
  readonly path: string;
}

export interface SelectedRouteDocument {
  readonly sourceDocument: string;
  readonly sourceKind: "kml" | "waylines-wpml";
  readonly xmlBytes: Uint8Array;
}

type ArchiveResult =
  | Readonly<{ ok: true; value: SelectedRouteDocument }>
  | Readonly<{ ok: false; error: RouteLibraryError }>;

class ExpansionBudget {
  private used = 0;

  constructor(private readonly maxBytes: number) {}

  consume(byteLength: number): void {
    const next = this.used + byteLength;
    if (!Number.isSafeInteger(next) || next > this.maxBytes) {
      throw new ImporterPhaseError("ARCHIVE_EXPANSION_LIMIT", { phase: "archive-stream" });
    }
    this.used = next;
  }
}

abstract class BoundedWriter extends Writer<Uint8Array> {
  private bytesSinceYield = 0;

  constructor(
    private readonly budget: ExpansionBudget,
    private readonly cancellation: RouteImportCancellation | undefined,
    private readonly onFailure: (error: unknown) => void
  ) {
    super();
  }

  protected count(array: Uint8Array): void {
    try {
      throwIfCancelled(this.cancellation);
      this.budget.consume(array.byteLength);
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
    this.bytesSinceYield += array.byteLength;
  }

  protected async yieldIfNeeded(): Promise<void> {
    if (this.bytesSinceYield < 1024 * 1024) return;
    this.bytesSinceYield = 0;
    try {
      await yieldAndCheck(this.cancellation);
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  protected fail(error: unknown): never {
    this.onFailure(error);
    throw error;
  }
}

class RetainingWriter extends BoundedWriter {
  private readonly output: Uint8Array;
  private offset = 0;

  constructor(
    private readonly expectedByteLength: number,
    budget: ExpansionBudget,
    cancellation: RouteImportCancellation | undefined,
    onFailure: (error: unknown) => void
  ) {
    super(budget, cancellation, onFailure);
    this.output = new Uint8Array(expectedByteLength);
  }

  override async writeUint8Array(array: Uint8Array): Promise<void> {
    this.count(array);
    if (array.byteLength > this.output.byteLength - this.offset) {
      this.fail(new ImporterPhaseError("CORRUPT_KMZ", { phase: "archive-stream" }));
    }
    this.output.set(array, this.offset);
    this.offset += array.byteLength;
    await this.yieldIfNeeded();
  }

  override async getData(): Promise<Uint8Array> {
    if (this.offset !== this.expectedByteLength) {
      this.fail(new ImporterPhaseError("CORRUPT_KMZ", { phase: "archive-stream" }));
    }
    return this.output;
  }
}

class DiscardingWriter extends BoundedWriter {
  override async writeUint8Array(array: Uint8Array): Promise<void> {
    this.count(array);
    await this.yieldIfNeeded();
  }

  override async getData(): Promise<Uint8Array> {
    return new Uint8Array(0);
  }
}

function entrySummary(path: string): string {
  return Array.from(path).slice(0, 160).join("");
}

function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function unsafePath(rawPath: string, index: number): never {
  throw new ImporterPhaseError("UNSAFE_ARCHIVE_PATH", {
    phase: "archive-path",
    entryIndex: index,
    entryNameSummary: entrySummary(rawPath)
  });
}

function normalizePath(rawPath: string, index: number): string {
  if (rawPath.includes("\u0000") || /[\u0000-\u001f\u007f-\u009f]/u.test(rawPath)) {
    unsafePath(rawPath, index);
  }
  const replaced = rawPath.replaceAll("\\", "/");
  let pathForAbsoluteCheck = replaced;
  while (pathForAbsoluteCheck.startsWith("./")) {
    pathForAbsoluteCheck = pathForAbsoluteCheck.slice(2);
  }
  if (pathForAbsoluteCheck.startsWith("/") || /^[A-Za-z]:/u.test(pathForAbsoluteCheck)) {
    unsafePath(rawPath, index);
  }
  const segments = replaced.split("/");
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === "..") {
      unsafePath(rawPath, index);
    }
    if (segment === "" || segment === ".") continue;
    normalized.push(segment);
  }
  if (normalized.length === 0) {
    unsafePath(rawPath, index);
  }
  return normalized.join("/");
}

function isUnsupportedEntryType(entry: Entry): boolean {
  const type = (entry.unixMode ?? 0) & 0xf000;
  return type !== 0 && type !== 0x4000 && type !== 0x8000;
}

function declaredSize(entry: Entry, index: number): number {
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
    throw new ImporterPhaseError("ARCHIVE_EXPANSION_LIMIT", { entryIndex: index, phase: "archive-metadata" });
  }
  return entry.uncompressedSize;
}

function uniqueOrAmbiguous(entries: readonly NormalizedEntry[], predicate: (path: string) => boolean): NormalizedEntry | undefined {
  const matches = entries.filter((entry) => !entry.entry.directory && predicate(foldAsciiCase(entry.path)));
  if (matches.length > 1) throw new ImporterPhaseError("CORRUPT_KMZ", { phase: "archive-document-selection" });
  return matches[0];
}

function selectDocument(entries: readonly NormalizedEntry[]): NormalizedEntry | undefined {
  const canonicalWpml = uniqueOrAmbiguous(entries, (path) => path === "wpmz/waylines.wpml");
  if (canonicalWpml !== undefined) return canonicalWpml;
  const rootWpml = uniqueOrAmbiguous(entries, (path) => path === "waylines.wpml");
  if (rootWpml !== undefined) return rootWpml;
  const nestedWpml = uniqueOrAmbiguous(entries, (path) => path.endsWith("/waylines.wpml"));
  if (nestedWpml !== undefined) return nestedWpml;

  const canonicalTemplate = uniqueOrAmbiguous(entries, (path) => path === "wpmz/template.kml");
  if (canonicalTemplate !== undefined) return canonicalTemplate;
  const rootTemplate = uniqueOrAmbiguous(entries, (path) => path === "template.kml");
  if (rootTemplate !== undefined) return rootTemplate;
  const nestedTemplate = uniqueOrAmbiguous(entries, (path) => path.endsWith("/template.kml"));
  if (nestedTemplate !== undefined) return nestedTemplate;
  return uniqueOrAmbiguous(entries, (path) => path.endsWith(".kml"));
}

function convertError(error: unknown): RouteLibraryError {
  if (error instanceof ImporterPhaseError) return createError(error.code, error.details);
  return createError("CORRUPT_KMZ", { phase: "archive-read" });
}

async function closeQuietly(reader: ZipReader<Uint8Array>): Promise<void> {
  try {
    await reader.close();
  } catch {
    // Cleanup failures must not replace the completed import outcome.
  }
}

export async function readKmz(
  bytes: Uint8Array,
  limits: RouteImportLimits,
  cancellation?: RouteImportCancellation
): Promise<ArchiveResult> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    checkOverlappingEntry: true,
    checkSignature: true,
    strictness: "strict"
  });
  return (async () => {
    let streamFailure: unknown;
    const captureStreamFailure = (error: unknown): void => {
      streamFailure = error;
    };
    try {
      throwIfCancelled(cancellation);
      const entries: Entry[] = [];
      for await (const entry of reader.getEntriesGenerator()) {
        throwIfCancelled(cancellation);
        entries.push(entry);
        if (entries.length > limits.maxArchiveEntries) {
          return Object.freeze({ ok: false, error: createError("ARCHIVE_ENTRY_LIMIT", { count: entries.length }) });
        }
      }

      const normalized: NormalizedEntry[] = [];
      const seen = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        throwIfCancelled(cancellation);
        const path = normalizePath(entry.filename, index);
        const key = foldAsciiCase(path);
        if (seen.has(key)) {
          return Object.freeze({ ok: false, error: createError("CORRUPT_KMZ", { phase: "archive-duplicate-path" }) });
        }
        seen.add(key);
        normalized.push(Object.freeze({ entry, path }));
      }

      for (const [index, item] of normalized.entries()) {
        throwIfCancelled(cancellation);
        if (item.entry.encrypted) {
          return Object.freeze({ ok: false, error: createError("ENCRYPTED_KMZ", { entryIndex: index }) });
        }
        if (isUnsupportedEntryType(item.entry)) {
          return Object.freeze({ ok: false, error: createError("CORRUPT_KMZ", { phase: "archive-special-entry" }) });
        }
      }

      let declaredTotal = 0n;
      const declaredSizes = new Map<Entry, number>();
      for (const [index, item] of normalized.entries()) {
        throwIfCancelled(cancellation);
        if (item.entry.directory) continue;
        const size = declaredSize(item.entry, index);
        declaredSizes.set(item.entry, size);
        declaredTotal += BigInt(size);
        if (declaredTotal > BigInt(limits.maxExpandedBytes)) {
          return Object.freeze({ ok: false, error: createError("ARCHIVE_EXPANSION_LIMIT", { phase: "archive-metadata" }) });
        }
      }

      let selected: NormalizedEntry | undefined;
      let selectionError: RouteLibraryError = createError("ROUTE_DOCUMENT_MISSING");
      try {
        selected = selectDocument(normalized);
      } catch (error) {
        selectionError = convertError(error);
      }

      const expansionBudget = new ExpansionBudget(limits.maxExpandedBytes);
      let selectedBytes: Uint8Array<ArrayBufferLike> | undefined;
      for (const item of normalized) {
        throwIfCancelled(cancellation);
        if (item.entry.directory) continue;
        const retain = item === selected;
        const writer = retain
          ? new RetainingWriter(declaredSizes.get(item.entry)!, expansionBudget, cancellation, captureStreamFailure)
          : new DiscardingWriter(expansionBudget, cancellation, captureStreamFailure);
        await (item.entry as FileEntry).getData(writer);
        if (streamFailure !== undefined) throw streamFailure;
        if (retain) selectedBytes = await writer.getData();
      }
      if (selected === undefined) return Object.freeze({ ok: false, error: selectionError });
      return Object.freeze({
        ok: true,
        value: Object.freeze({
          sourceDocument: selected.path,
          sourceKind: foldAsciiCase(selected.path).endsWith("waylines.wpml") ? "waylines-wpml" : "kml",
          xmlBytes: selectedBytes!
        })
      });
    } catch (error) {
      const effectiveError = streamFailure ?? error;
      if (effectiveError instanceof ImporterCancelled) throw new ImporterCancelled();
      return Object.freeze({ ok: false, error: convertError(effectiveError) });
    }
  })().finally(() => closeQuietly(reader));
}
