import { SaxesParser, type SaxesTagNS } from "saxes";
import { createError, type RouteLibraryError } from "../../domain/index.js";
import { ImporterPhaseError } from "./error-map.js";
import { ImporterCancelled } from "./error-map.js";
import { throwIfCancelled, yieldAndCheck } from "./cancellation.js";
import { detectXmlEncoding, type DetectedXmlEncoding } from "./encoding.js";
import type { RawWaypointAltitudeSource, RawWaypointCandidate, RouteImportCancellation } from "./types.js";

const KML_NAMESPACE = "http://www.opengis.net/kml/2.2";
const XINCLUDE_NAMESPACE = "http://www.w3.org/2001/XInclude";
const WPML_HTTP_PREFIX = "http://www.dji.com/wpmz/";
const WPML_HTTPS_PREFIX = "https://www.dji.com/wpmz/";
const MAX_FIELD_CODE_POINTS = 160;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const ABSOLUTE_PATH_SUMMARY = /(?:^|[ \t\r\n,])(?:[A-Za-z]:[\\/]|\\\\|\/[^ \t\r\n,])/u;
const EXCLUDED_KML_SUBTREES = new Set([
  "Camera",
  "LinearRing",
  "LookAt",
  "Model",
  "Polygon",
  "Style",
  "StyleMap",
  "description"
]);
const WPML_FIELDS = new Set(["index", "executeHeight", "ellipsoidHeight", "height"]);

interface ParsedXmlDocument {
  readonly wpmlNamespace: string | null;
  readonly waypointCandidates: readonly RawWaypointCandidate[];
}

type XmlParseResult =
  | Readonly<{ ok: true; value: ParsedXmlDocument }>
  | Readonly<{ ok: false; error: RouteLibraryError }>;

interface CandidateDraft {
  readonly declaredSequenceText: string | null;
  readonly longitudeText: string | null;
  readonly latitudeText: string | null;
  readonly altitudeText: string | null;
  readonly altitudeSource: RawWaypointAltitudeSource;
  readonly malformed: boolean;
  readonly rawSummary: string;
}

interface PlacemarkState {
  readonly fieldValues: Map<string, CapturedText[]>;
  coordinateElementCount: number;
  coordinateTupleCount: number;
  firstCoordinate: CapturedTuple | undefined;
  pointDepth: number;
}

type FieldKind = "index" | "execute-height" | "ellipsoid-height" | "height";

type CaptureState =
  | { readonly target: "line"; readonly depth: number; readonly tokenizer: CoordinateTokenizer }
  | { readonly target: "point"; readonly depth: number; readonly placemark: PlacemarkState; readonly tokenizer: CoordinateTokenizer }
  | { readonly target: "field"; readonly depth: number; readonly placemark: PlacemarkState; readonly kind: FieldKind; readonly text: LimitedText };

interface CapturedTuple {
  readonly components: readonly [CapturedText, CapturedText, CapturedText];
  readonly componentCount: number;
  readonly rawSummary: string;
}

interface CapturedText {
  readonly value: string;
  readonly truncated: boolean;
}

function supportedKmlUri(uri: string): boolean {
  return uri === "" || uri === KML_NAMESPACE;
}

function isWpmlUri(uri: string): boolean {
  return (uri.startsWith(WPML_HTTP_PREFIX) && uri.length > WPML_HTTP_PREFIX.length)
    || (uri.startsWith(WPML_HTTPS_PREFIX) && uri.length > WPML_HTTPS_PREFIX.length);
}

function startsExcludedSubtree(local: string, uri: string): boolean {
  return (supportedKmlUri(uri) && EXCLUDED_KML_SUBTREES.has(local))
    || (isWpmlUri(uri) && !WPML_FIELDS.has(local));
}

function isControlCharacter(value: string): boolean {
  return CONTROL_CHARACTER.test(value);
}

class LimitedText {
  private readonly value: string[] = [];
  private significantLength = 0;
  private truncated = false;

  append(text: string): void {
    for (const codePoint of text) {
      if (isControlCharacter(codePoint)) continue;
      const whitespace = codePoint.trim().length === 0;
      if (whitespace && this.significantLength === 0) continue;
      if (this.value.length < MAX_FIELD_CODE_POINTS) {
        this.value.push(codePoint);
      } else if (!whitespace) {
        this.truncated = true;
      }
      if (!whitespace) this.significantLength = this.value.length;
    }
  }

  finish(): CapturedText {
    return Object.freeze({
      value: this.value.slice(0, this.significantLength).join(""),
      truncated: this.truncated
    });
  }
}

class LimitedSummary {
  private readonly value: string[] = [];

  append(codePoint: string): void {
    if (!isControlCharacter(codePoint) && this.value.length < MAX_FIELD_CODE_POINTS) {
      this.value.push(codePoint);
    }
  }

  finish(): string {
    return summarize(this.value.join(""));
  }
}

class TupleBuilder {
  private readonly components = [new LimitedText(), new LimitedText(), new LimitedText()] as const;
  private readonly summary = new LimitedSummary();
  private componentIndex = 0;

  append(codePoint: string): void {
    this.summary.append(codePoint);
    if (codePoint === ",") {
      this.componentIndex += 1;
      return;
    }
    this.components[this.componentIndex]?.append(codePoint);
  }

  finish(): CapturedTuple {
    return Object.freeze({
      components: Object.freeze([
        this.components[0].finish(),
        this.components[1].finish(),
        this.components[2].finish()
      ] as const),
      componentCount: this.componentIndex + 1,
      rawSummary: this.summary.finish()
    });
  }
}

class CoordinateTokenizer {
  private current: TupleBuilder | undefined;

  constructor(private readonly onTuple: (tuple: CapturedTuple) => void) {}

  append(text: string): void {
    for (const codePoint of text) {
      if (codePoint === " " || codePoint === "\t" || codePoint === "\r" || codePoint === "\n") {
        this.emitCurrent();
        continue;
      }
      this.current ??= new TupleBuilder();
      this.current.append(codePoint);
    }
  }

  finish(): void {
    this.emitCurrent();
  }

  private emitCurrent(): void {
    if (this.current === undefined) return;
    const tuple = this.current.finish();
    this.current = undefined;
    this.onTuple(tuple);
  }
}

function safeText(text: CapturedText): { value: string | null; malformed: boolean } {
  return {
    value: text.value.length === 0 ? null : text.value,
    malformed: text.truncated
  };
}

function summarize(value: string): string {
  return ABSOLUTE_PATH_SUMMARY.test(value) ? "[redacted]" : value;
}

const MISSING_ALTITUDE = Object.freeze({
  text: null,
  source: "missing" as const,
  malformed: false
});

type NormalizedAltitude = Readonly<{
  text: string | null;
  source: RawWaypointAltitudeSource;
  malformed: boolean;
}>;

type AltitudeSelector = (coordinate: NormalizedAltitude, fallback: NormalizedAltitude) => NormalizedAltitude;

function coordinateFirst(coordinate: NormalizedAltitude, fallback: NormalizedAltitude): NormalizedAltitude {
  return coordinate.text === null ? fallback : coordinate;
}

function fallbackFirst(coordinate: NormalizedAltitude, fallback: NormalizedAltitude): NormalizedAltitude {
  return fallback.text === null ? coordinate : fallback;
}

function tupleDraft(
  tuple: CapturedTuple,
  fallback: NormalizedAltitude,
  declaredSequenceText: string | null,
  forceMalformed: boolean,
  selectAltitude: AltitudeSelector
): CandidateDraft {
  const longitude = safeText(tuple.components[0]);
  const latitude = safeText(tuple.components[1]);
  const normalizedCoordinateAltitude = safeText(tuple.components[2]);
  const coordinateAltitude = Object.freeze({
    text: normalizedCoordinateAltitude.value,
    source: "coordinate" as const,
    malformed: normalizedCoordinateAltitude.malformed
  });
  const altitude = selectAltitude(coordinateAltitude, fallback);
  const malformed = forceMalformed
    || tuple.componentCount > 3
    || longitude.value === null
    || latitude.value === null
    || longitude.malformed
    || latitude.malformed
    || normalizedCoordinateAltitude.malformed
    || fallback.malformed
    || altitude.malformed;
  return Object.freeze({
    declaredSequenceText,
    longitudeText: longitude.value,
    latitudeText: latitude.value,
    altitudeText: altitude.text,
    altitudeSource: altitude.source,
    malformed,
    rawSummary: tuple.rawSummary
  });
}

function chooseField(
  state: PlacemarkState,
  names: readonly string[]
): Readonly<{ text: string | null; source: RawWaypointAltitudeSource; malformed: boolean }> {
  let malformed = false;
  let selected: Readonly<{ text: string; source: RawWaypointAltitudeSource }> | undefined;
  for (const name of names) {
    const values = state.fieldValues.get(name);
    if (values === undefined) continue;
    const normalized = values.map((value) => safeText(value));
    const first = normalized[0]!;
    const different = normalized.some((value) => value.value !== first.value);
    malformed ||= different || normalized.some((value) => value.malformed);
    if (selected === undefined && first.value !== null) {
      selected = Object.freeze({ text: first.value, source: name as RawWaypointAltitudeSource });
    }
  }
  return Object.freeze(selected === undefined
    ? { text: null, source: "missing", malformed }
    : { ...selected, malformed });
}

function chooseTextField(
  state: PlacemarkState,
  name: string
): Readonly<{ text: string | null; malformed: boolean }> {
  const values = state.fieldValues.get(name);
  if (values === undefined) return Object.freeze({ text: null, malformed: false });
  const normalized = values.map((value) => safeText(value));
  const first = normalized[0]!;
  return Object.freeze({
    text: first.value,
    malformed: normalized.some((value) => value.value !== first.value || value.malformed)
  });
}

function finalizeCandidate(draft: CandidateDraft, documentOrder: number): RawWaypointCandidate {
  return Object.freeze({ documentOrder, ...draft });
}

function decodeChunk(decoder: TextDecoder, bytes?: Uint8Array): string {
  try {
    return bytes === undefined ? decoder.decode() : decoder.decode(bytes, { stream: true });
  } catch {
    throw new ImporterPhaseError("INVALID_XML", { phase: "xml-decoding" });
  }
}

async function parseXmlBytes(
  bytes: Uint8Array,
  sourceKind: "kml" | "waylines-wpml",
  maxWaypoints: number,
  cancellation?: RouteImportCancellation,
  knownEncoding?: DetectedXmlEncoding
): Promise<ParsedXmlDocument> {
  const detected = knownEncoding ?? await detectXmlEncoding(bytes, cancellation);
  if (detected === null) throw new ImporterPhaseError("INVALID_XML", { phase: "xml-encoding" });
  const actualEncoding = detected.encoding;
  const lineDrafts: CandidateDraft[] = [];
  const pointDrafts: CandidateDraft[] = [];
  let pointOverflow = false;
  let sawLineCoordinates = false;
  let lineDepth = 0;
  const placemarks: PlacemarkState[] = [];
  let capture: CaptureState | undefined;
  let elementDepth = 0;
  let excludedDepth: number | undefined;
  let rootSeen = false;
  let wpmlNamespace: string | null = null;

  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new ImporterPhaseError("EXTERNAL_ENTITY_FORBIDDEN", { phase: "xml-doctype" }); });
  parser.on("xmldecl", (declaration) => {
    const declared = declaration.encoding?.toLowerCase();
    if (declared === undefined) return;
    const compatible = actualEncoding === "utf-8"
      ? declared === "utf-8" || declared === "utf8"
      : declared === "utf-16" || declared === actualEncoding;
    if (!compatible) throw new ImporterPhaseError("INVALID_XML", { phase: "xml-encoding" });
  });
  parser.on("opentag", (tag: SaxesTagNS) => {
    elementDepth += 1;
    const local = tag.local;
    const uri = tag.uri;
    if (!rootSeen) {
      rootSeen = true;
      if (local !== "kml" || !supportedKmlUri(uri)) {
        throw new ImporterPhaseError("INVALID_XML", { phase: "xml-root" });
      }
    }
    if (uri === XINCLUDE_NAMESPACE && local === "include") {
      throw new ImporterPhaseError("EXTERNAL_ENTITY_FORBIDDEN", { phase: "xml-xinclude" });
    }
    if (isWpmlUri(uri)) wpmlNamespace ??= uri;
    if (excludedDepth === undefined && startsExcludedSubtree(local, uri)) excludedDepth = elementDepth;
    if (excludedDepth !== undefined) return;

    if (local === "Placemark" && supportedKmlUri(uri)) {
      placemarks.push({
        coordinateElementCount: 0,
        coordinateTupleCount: 0,
        fieldValues: new Map(),
        firstCoordinate: undefined,
        pointDepth: 0
      });
      return;
    }
    if (local === "LineString" && supportedKmlUri(uri)) lineDepth += 1;
    const placemark = placemarks.at(-1);
    if (placemark !== undefined && local === "Point" && supportedKmlUri(uri)) {
      placemark.pointDepth += 1;
    }
    if (local === "coordinates" && supportedKmlUri(uri)) {
      if (capture === undefined && sourceKind === "kml" && lineDepth > 0) {
        sawLineCoordinates = true;
        capture = {
          target: "line",
          depth: elementDepth,
          tokenizer: new CoordinateTokenizer((tuple) => {
            lineDrafts.push(tupleDraft(tuple, MISSING_ALTITUDE, null, false, coordinateFirst));
            if (lineDrafts.length > maxWaypoints) throw new ImporterPhaseError("TOO_MANY_WAYPOINTS");
          })
        };
      } else if (capture === undefined && placemark !== undefined && placemark.pointDepth > 0) {
        capture = {
          target: "point",
          depth: elementDepth,
          placemark,
          tokenizer: new CoordinateTokenizer((tuple) => {
            placemark.coordinateTupleCount += 1;
            placemark.firstCoordinate ??= tuple;
          })
        };
      }
      return;
    }
    if (capture === undefined && placemark !== undefined && isWpmlUri(uri)) {
      switch (local) {
        case "index":
          capture = { target: "field", depth: elementDepth, placemark, kind: "index", text: new LimitedText() };
          break;
        case "executeHeight":
          capture = { target: "field", depth: elementDepth, placemark, kind: "execute-height", text: new LimitedText() };
          break;
        case "ellipsoidHeight":
          capture = { target: "field", depth: elementDepth, placemark, kind: "ellipsoid-height", text: new LimitedText() };
          break;
        case "height":
          capture = { target: "field", depth: elementDepth, placemark, kind: "height", text: new LimitedText() };
          break;
      }
    }
  });
  const appendText = (text: string) => {
    if (excludedDepth !== undefined) return;
    if (capture === undefined) return;
    if (capture.target === "field") capture.text.append(text);
    else capture.tokenizer.append(text);
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", (tag: SaxesTagNS) => {
    const local = tag.local;
    const uri = tag.uri;
    if (excludedDepth !== undefined) {
      if (elementDepth === excludedDepth) excludedDepth = undefined;
      elementDepth -= 1;
      return;
    }
    if (capture !== undefined && capture.depth === elementDepth) {
      const completed = capture;
      capture = undefined;
      switch (completed.target) {
        case "line":
          completed.tokenizer.finish();
          break;
        case "point":
          completed.tokenizer.finish();
          completed.placemark.coordinateElementCount += 1;
          break;
        case "field": {
          const existing = completed.placemark.fieldValues.get(completed.kind) ?? [];
          existing.push(completed.text.finish());
          completed.placemark.fieldValues.set(completed.kind, existing);
          break;
        }
      }
    }

    const placemark = placemarks.at(-1);
    if (local === "Point" && supportedKmlUri(uri) && placemark !== undefined) placemark.pointDepth -= 1;
    if (local === "LineString" && supportedKmlUri(uri)) lineDepth -= 1;
    if (local === "Placemark" && supportedKmlUri(uri)) {
      const completedPlacemark = placemarks.pop()!;
      const sequence = chooseTextField(completedPlacemark, "index");
      const declaredSequence = sequence.text;
      const fallback = chooseField(completedPlacemark, ["execute-height", "ellipsoid-height", "height"] as const);
      if (completedPlacemark.coordinateTupleCount === 0) {
        if (sourceKind === "waylines-wpml") {
          pointDrafts.push(Object.freeze({
            declaredSequenceText: declaredSequence,
            longitudeText: null,
            latitudeText: null,
            altitudeText: fallback.text,
            altitudeSource: fallback.source,
            malformed: true,
            rawSummary: ""
          }));
        }
      } else {
        const tuple = completedPlacemark.firstCoordinate!;
        pointDrafts.push(tupleDraft(
          tuple,
          fallback,
          sourceKind === "waylines-wpml" ? declaredSequence : null,
          completedPlacemark.coordinateElementCount !== 1
            || completedPlacemark.coordinateTupleCount !== 1
            || sequence.malformed,
          sourceKind === "waylines-wpml" ? fallbackFirst : coordinateFirst
        ));
      }
      if (pointDrafts.length > maxWaypoints) {
        pointDrafts.length = maxWaypoints;
        pointOverflow = true;
        if (sourceKind === "waylines-wpml") throw new ImporterPhaseError("TOO_MANY_WAYPOINTS");
      }
    }
    elementDepth -= 1;
  });

  const decoder = new TextDecoder(actualEncoding, { fatal: true });
  const chunkSize = 64 * 1024;
  let offset = detected.offset;
  while (offset !== bytes.byteLength) {
    throwIfCancelled(cancellation);
    const end = Math.min(offset + chunkSize, bytes.byteLength);
    parser.write(decodeChunk(decoder, bytes.subarray(offset, end)));
    offset = end;
    await yieldAndCheck(cancellation);
  }
  throwIfCancelled(cancellation);
  parser.write(decodeChunk(decoder));
  parser.close();
  if (!sawLineCoordinates && pointOverflow) throw new ImporterPhaseError("TOO_MANY_WAYPOINTS");
  const selected = sawLineCoordinates ? lineDrafts : pointDrafts;
  return Object.freeze({
    wpmlNamespace,
    waypointCandidates: Object.freeze(selected.map(finalizeCandidate))
  });
}

export async function parseXmlDocument(
  bytes: Uint8Array,
  sourceKind: "kml" | "waylines-wpml",
  maxWaypoints: number,
  cancellation?: RouteImportCancellation,
  knownEncoding?: DetectedXmlEncoding
): Promise<XmlParseResult> {
  try {
    const value = await parseXmlBytes(bytes, sourceKind, maxWaypoints, cancellation, knownEncoding);
    return Object.freeze({ ok: true as const, value });
  } catch (error) {
    if (error instanceof ImporterCancelled) throw error;
    const phaseError = error instanceof ImporterPhaseError
      ? error
      : new ImporterPhaseError("INVALID_XML", { phase: "xml-syntax" });
    return Object.freeze({ ok: false as const, error: createError(phaseError.code, phaseError.details) });
  }
}
