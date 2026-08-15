# D3.2 Route Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the D3.2 deep module that safely converts untrusted KML/KMZ bytes into a deterministic, immutable `ParsedRouteDocument` without performing D3.3 domain qualification or classification.

**Architecture:** `importer/index.ts` is the only external seam and only orchestrates focused internal files. Intake owns runtime validation and snapshotting, digest owns SHA-256, archive owns ZIP safety and document selection, XML owns streaming syntax parsing and raw candidate extraction, and cancellation owns cooperative yielding. All behavior is tested through the public `RouteImporter.ingest` interface.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, fast-check 4.2, `@zip.js/zip.js` 2.8.x, `saxes` 6.0.x, `@noble/hashes` 1.8.x, Stryker 9.3.

## Global Constraints

- The approved contract is `src/modules/route-library/importer/CONTRACT.md` version 0.1.0.
- The only public behavior is `RouteImporter.ingest(fileName, bytes, limits, cancellation?)`.
- Outcomes are exactly `parsed`, `rejected`, or `cancelled`; cancellation is not an error.
- D3.2 must not import D3.3-D3.7, Vue, Electron, DOM, Cesium, Android, or DJI packages.
- D3.2 must not create D3.1 waypoint, qualified-route, asset, ID, warning, classification, catalog, or preview values.
- Original files default to at most 100 MiB, archives to 1,000 entries and 200 MiB expanded data, and candidates to 100,000; all actual values come from validated limits.
- XML parsing never loads DTD, entities, XInclude, network, or local files.
- KMZ entries are validated in memory and never extracted to disk.
- Production code is written only after its corresponding test has failed for the expected reason.
- Each task ends with the focused test, full `npm run check`, and no TypeScript errors.

---

## File Structure

```text
src/modules/route-library/importer/
  CONTRACT.md                  approved specification
  index.ts                     only public entry and exports
  internal/types.ts            importer-only structural types
  internal/outcome.ts          immutable parsed/rejected/cancelled values
  internal/cancellation.ts     cancellation reads and cooperative yielding
  internal/intake.ts           limits, filename, bytes, snapshot, format probe
  internal/digest.ts           incremental SHA-256
  internal/xml.ts              encoding, SAX security, candidate extraction
  internal/archive.ts          ZIP validation and source-document selection
  internal/error-map.ts        stable phase-specific third-party error mapping

tests/
  importer-contract.test.ts    public interface, input, outcomes, ownership
  importer-xml.test.ts         KML/WPML compatibility and XML security
  importer-archive.test.ts     KMZ selection, limits, paths, corruption
  importer-property.test.ts    generated filename/path/bytes/copy properties
  importer-concurrency.test.ts cancellation, concurrent isolation, yielding
  importer-architecture.test.ts dependency and public-export rules
  importer-type-contract.ts    compile-time public interface expectations
  importer-performance.perf.ts 100,000-candidate and event-loop checks
  helpers/zip-fixture.ts       deterministic ZIP fixtures including bad flags
```

No internal file is a new D3 secondary module or an externally supported seam.

---

### Task 1: Public Types, Outcomes, and Intake Snapshot

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/modules/route-library/importer/index.ts`
- Create: `src/modules/route-library/importer/internal/types.ts`
- Create: `src/modules/route-library/importer/internal/outcome.ts`
- Create: `src/modules/route-library/importer/internal/cancellation.ts`
- Create: `src/modules/route-library/importer/internal/intake.ts`
- Test: `tests/importer-contract.test.ts`
- Test: `tests/importer-type-contract.ts`

**Interfaces:**
- Consumes: D3.1 `createError`, `RouteLibraryError`, and `RouteFileFormat` from `domain/index.ts`.
- Produces: `RouteImporter`, `RouteImportLimits`, `RouteImportCancellation`, `RouteIngestOutcome`, `ParsedRouteDocument`, and `RawWaypointCandidate` from `importer/index.ts`.

- [ ] **Step 1: Add the runtime dependencies**

Run:

```powershell
npm install '@zip.js/zip.js@^2.8.36' 'saxes@^6.0.0' '@noble/hashes@^1.8.0'
```

Expected: lockfile updates and `npm audit` reports no unresolved high-severity vulnerability.

- [ ] **Step 2: Write failing public-contract and type tests**

The runtime test must call only the intended public interface:

```ts
import { RouteImporter } from "../src/modules/route-library/importer/index.js";

const limits = Object.freeze({
  maxFileBytes: 1024,
  maxArchiveEntries: 10,
  maxExpandedBytes: 2048,
  maxWaypoints: 10
});

it("returns cancelled before reading invalid input", async () => {
  const result = await RouteImporter.ingest(null, null, limits, { aborted: true });
  expect(result).toEqual({ status: "cancelled" });
});

it("snapshots only the active Uint8Array view", async () => {
  const backing = new Uint8Array([9, 60, 107, 109, 108, 47, 62, 9]);
  const bytes = backing.subarray(1, 7);
  const pending = RouteImporter.ingest("route.kml", bytes, limits);
  backing.fill(0);
  const result = await pending;
  expect(result.status).toBe("parsed");
  if (result.status === "parsed") expect([...result.document.originalBytes]).toEqual([60, 107, 109, 108, 47, 62]);
});
```

The type test must assert the three discriminants and prove `Parser`, `Reader`, and third-party types are not exported.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npx vitest run tests/importer-contract.test.ts
npx tsc --noEmit -p tsconfig.type-tests.json
```

Expected: FAIL because `importer/index.ts` and `RouteImporter` do not exist.

- [ ] **Step 4: Implement minimal public types, outcomes, cancellation, and intake**

Define the public shape exactly once in `internal/types.ts`:

```ts
export interface RouteImportLimits {
  readonly maxFileBytes: number;
  readonly maxArchiveEntries: number;
  readonly maxExpandedBytes: number;
  readonly maxWaypoints: number;
}

export interface RouteImportCancellation { readonly aborted: boolean }

export type RouteIngestOutcome =
  | Readonly<{ status: "parsed"; document: ParsedRouteDocument }>
  | Readonly<{ status: "rejected"; error: RouteLibraryError }>
  | Readonly<{ status: "cancelled" }>;
```

`intake.ts` must validate cancellation first, validate limits without coercion, validate the trimmed basename, reject unsafe paths, validate/copy only the active Uint8Array view, and return a controlled internal result. `outcome.ts` freezes all objects and implements `originalBytes` as a getter returning `snapshot.slice()`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run `npx vitest run tests/importer-contract.test.ts && npm run test:types`.

Expected: all Task 1 tests pass; XML/KMZ behaviors may still return a controlled `rejected` placeholder only where no production behavior has yet been specified by a failing test.

- [ ] **Step 6: Run the full baseline**

Run `npm run check`.

Expected: 146 existing D3.1 tests, new Task 1 tests, type checks, coverage, and performance tests pass.

---

### Task 2: SHA-256 and Deterministic Format Probe

**Files:**
- Create: `src/modules/route-library/importer/internal/digest.ts`
- Modify: `src/modules/route-library/importer/internal/intake.ts`
- Modify: `src/modules/route-library/importer/index.ts`
- Modify: `tests/importer-contract.test.ts`
- Test: `tests/importer-property.test.ts`

**Interfaces:**
- Consumes: the immutable `FileSnapshot` produced by intake.
- Produces: internal `sha256(snapshot, cancellation)` and `DetectedContainer = "xml" | "zip" | "unknown"`.

- [ ] **Step 1: Write failing tests for exact hash and mismatch errors**

Use the published SHA-256 vector for bytes `abc` and compare generated byte arrays against `node:crypto` in property tests. Add `.kml`+ZIP, `.kmz`+XML, random `.kml`, random `.kmz`, empty, and exact-size boundary cases. Assert stable error codes, not messages.

- [ ] **Step 2: Run focused tests and verify RED**

Run `npx vitest run tests/importer-contract.test.ts tests/importer-property.test.ts`.

Expected: FAIL because SHA-256 and content-aware format probing are absent.

- [ ] **Step 3: Implement incremental digest and probe**

`digest.ts` uses `sha256.create()` from `@noble/hashes/sha256`, updates fixed-size chunks, checks cancellation between chunks, and returns lowercase hex. `intake.ts` recognizes XML BOM/whitespace/declaration/comment prefixes and ZIP signatures without claiming a corrupt ZIP is valid.

- [ ] **Step 4: Verify GREEN and refactor**

Run focused tests, then `npm run check`. Expected: all tests pass and no third-party hash type crosses `index.ts`.

---

### Task 3: Streaming XML and Raw Candidate Extraction

**Files:**
- Create: `src/modules/route-library/importer/internal/xml.ts`
- Create: `src/modules/route-library/importer/internal/error-map.ts`
- Modify: `src/modules/route-library/importer/index.ts`
- Test: `tests/importer-xml.test.ts`

**Interfaces:**
- Consumes: selected XML bytes, `sourceKind`, max candidates, and cancellation.
- Produces: `ParsedXmlDocument { wpmlNamespace, waypointCandidates }` containing only frozen plain values.

- [ ] **Step 1: Write failing compatibility tests**

Create minimal UTF-8/BOM/UTF-16 KML fixtures for LineString priority, multiple LineStrings, Point fallback, missing altitude, malformed nonblank tuples, arbitrary XML prefix bound to DJI WPML, WPML sequence text, and height precedence. Verify text remains text and `documentOrder` is continuous.

- [ ] **Step 2: Run compatibility tests and verify RED**

Run `npx vitest run tests/importer-xml.test.ts`.

Expected: FAIL because XML parsing is not implemented.

- [ ] **Step 3: Implement the minimal SAX state machine**

Use `SaxesParser` with namespace mode. Maintain only the current element stack, current Placemark, current coordinate text, LineString candidates, Point candidates, and bounded text fields. Reject `ondoctype`; reject XInclude by namespace/local name; never evaluate entity replacements. Select LineStrings for KML and Points for WPML exactly as specified.

- [ ] **Step 4: Verify compatibility tests GREEN**

Run focused tests. Expected: all normal KML/WPML cases pass.

- [ ] **Step 5: Write failing XML security and limit tests**

Add external/internal DTD, parameter entity, XInclude, malformed XML, wrong root/namespace, invalid UTF, encoding mismatch, more than 100,000 candidates, missing WPML Point, duplicate semantic fields, Polygon/style/description coordinates, and 161-code-point field cases.

- [ ] **Step 6: Run security tests and verify RED**

Expected: each new test fails on the missing stable security behavior, not on fixture construction.

- [ ] **Step 7: Implement security mapping and bounded parsing**

Map DTD/entity/XInclude to `EXTERNAL_ENTITY_FORBIDDEN`, syntax/encoding/root to `INVALID_XML`, and candidate overflow to `TOO_MANY_WAYPOINTS`. Preserve malformed candidates and bounded summaries instead of filtering them.

- [ ] **Step 8: Verify GREEN and full baseline**

Run `npx vitest run tests/importer-xml.test.ts && npm run check`.

---

### Task 4: KMZ Archive Validation and Source Selection

**Files:**
- Create: `src/modules/route-library/importer/internal/archive.ts`
- Create: `tests/helpers/zip-fixture.ts`
- Test: `tests/importer-archive.test.ts`
- Modify: `src/modules/route-library/importer/index.ts`

**Interfaces:**
- Consumes: immutable KMZ snapshot, archive limits, and cancellation.
- Produces: `SelectedRouteDocument { sourceDocument, sourceKind, xmlBytes }` with no ZIP library types.

- [ ] **Step 1: Write failing normal-selection tests**

Build fixtures for canonical `wpmz/waylines.wpml`, Wayline root `waylines.wpml`, nested unique WPML, canonical/root/nested template, unique other KML, empty ZIP, ambiguous same-tier entries, and canonical-over-lower-priority entries.

- [ ] **Step 2: Run normal tests and verify RED**

Run `npx vitest run tests/importer-archive.test.ts`.

Expected: FAIL because archive reading is absent.

- [ ] **Step 3: Implement metadata validation and deterministic selection**

Use `ZipReader` with a `Uint8ArrayReader`; copy entry metadata into internal plain records; check entry count before walking all entries; normalize paths without disk APIs; reject case-insensitive normalized duplicates; choose exactly one document by contract priority.

- [ ] **Step 4: Verify normal tests GREEN**

Run focused tests and confirm both real Wayline fixtures parse through the public interface.

- [ ] **Step 5: Write failing archive-security tests**

Cover traversal with slash/backslash, absolute/UNC/drive/NUL/control paths, encrypted flags, special entries, ZIP64 limits, declared and actual expansion limits, truncation, CRC mismatch, unsupported compression, corrupted unselected resource, entry-count boundaries, and damaged WPML with valid template present.

- [ ] **Step 6: Run archive-security tests and verify RED**

Expected: FAIL on missing precise error codes or skipped full-archive validation.

- [ ] **Step 7: Implement streamed full-archive verification**

Validate each non-directory entry through a bounded writer/sink, sum actual bytes with overflow protection, verify CRC/signature through zip.js, retain only selected XML bytes, close `ZipReader` in `finally`, and map third-party failures in `error-map.ts` without leaking messages.

- [ ] **Step 8: Verify GREEN and full baseline**

Run `npx vitest run tests/importer-archive.test.ts && npm run check`.

---

### Task 5: Cancellation, Concurrency, Ownership, and Event-Loop Yielding

**Files:**
- Modify: `src/modules/route-library/importer/internal/cancellation.ts`
- Modify: `src/modules/route-library/importer/internal/digest.ts`
- Modify: `src/modules/route-library/importer/internal/xml.ts`
- Modify: `src/modules/route-library/importer/internal/archive.ts`
- Modify: `src/modules/route-library/importer/internal/outcome.ts`
- Test: `tests/importer-concurrency.test.ts`
- Test: `tests/importer-performance.perf.ts`
- Modify: `vitest.performance.config.ts`

**Interfaces:**
- Consumes: structurally compatible `{ readonly aborted: boolean }`.
- Produces: deterministic cancellation at phase/chunk/entry checkpoints with no persistent resources.

- [ ] **Step 1: Write failing cancellation and isolation tests**

Use cancellation objects whose `aborted` getter flips after a known number of reads. Test cancellation before intake, during digest, during archive verification, during XML parsing, and immediately before return. Run two imports concurrently and mutate every returned byte copy.

- [ ] **Step 2: Verify RED**

Run `npx vitest run tests/importer-concurrency.test.ts`.

Expected: FAIL where long phases do not check cancellation or share mutable values.

- [ ] **Step 3: Implement cooperative checkpoints and cleanup**

Create one internal cancellation helper that safely reads `aborted`, yields with a macrotask-compatible scheduler for work over 1 MiB, and returns an internal cancellation sentinel. Every phase catches only that sentinel as `cancelled`; all readers close in `finally`.

- [ ] **Step 4: Verify GREEN**

Run focused tests. Expected: cancellation never returns a document or error.

- [ ] **Step 5: Write and run performance tests**

Generate exactly 100,000 candidates and a greater-than-1-MiB document. Assert the limit case parses, 100,001 rejects, and an independently queued timer runs before the large ingest resolves. Run `npm run test:performance`.

- [ ] **Step 6: Refactor while green**

Remove duplicate cancellation checks and copying logic without changing the public interface, then run `npm run check`.

---

### Task 6: Architecture, Exhaustive Properties, Coverage, Mutation, and Audit

**Files:**
- Create: `tests/importer-architecture.test.ts`
- Expand: `tests/importer-property.test.ts`
- Modify: `vitest.config.ts`
- Modify: `stryker.config.json`
- Modify: `tsconfig.type-tests.json`

**Interfaces:**
- Consumes: the finished `importer/index.ts` interface only.
- Produces: automated proof of dependency direction, public-surface size, robustness, full coverage, and mutation strength.

- [ ] **Step 1: Write failing architecture tests**

Scan importer production imports and exports. Assert only approved domain imports are used, no forbidden package names occur, internal files are not re-exported, and exactly the approved importer names appear at `index.ts`.

- [ ] **Step 2: Verify RED, then enforce the public seam**

Run `npx vitest run tests/importer-architecture.test.ts`; remove any leaked internal exports/imports; rerun until green.

- [ ] **Step 3: Add generated robustness properties**

Generate Unicode basenames, unsafe path segment arrays, arbitrary byte arrays, coordinate lexemes, mutation sequences, and cancellation schedules. Compare SHA-256 to `node:crypto`; assert no third-party exception or partial document escapes.

- [ ] **Step 4: Verify property tests GREEN**

Run `npx vitest run tests/importer-property.test.ts --reporter=verbose`.

- [ ] **Step 5: Extend coverage and mutation scopes**

Include `src/modules/route-library/importer/internal/**/*.ts` in coverage and mutation, excluding only `index.ts`. Run `npm run test:coverage`; add behavior tests until statements, branches, functions, and lines all report 100%.

- [ ] **Step 6: Run mutation testing**

Run `npm run test:mutation`. Inspect each survivor and add a public-interface test that distinguishes the changed behavior. Repeat until all effective mutants are killed and the score is 100%.

- [ ] **Step 7: Run final verification**

Run:

```powershell
npm run verify
npm audit
```

Expected: strict type checks pass; all contract, security, property, concurrency, architecture, performance, coverage, and mutation tests pass; coverage and effective mutation score are 100%; audit has no unresolved high-severity vulnerability.

- [ ] **Step 8: Check contract traceability**

Read each numbered section of `importer/CONTRACT.md` and record the implementing file/test beside it in the plan execution notes. Any uncovered clause blocks completion.

---

## Execution Notes

- `D:\Desktop\Sky Command` is currently not a Git repository, so task-level commits in the generic skill template are not possible. Do not initialize Git without user authorization.
- Checkboxes are updated after each verified RED/GREEN cycle, not in bulk at the end.
- Any implementation discovery that changes an external type, error precedence, document selection rule, or responsibility requires stopping and updating the approved contract first.

### 2026-08-09 Verification Update

- Implementation is present under `src/modules/route-library/importer/` with the single public `RouteImporter.ingest` seam.
- `npm test`: 222 tests passed.
- `npm run test:types`: passed.
- `npm run test:coverage`: passed with 100% statements, branches, functions, and lines.
- `npm run test:performance`: passed, including the 100,000-candidate limit and event-loop yielding checks.
- `npm audit`: 0 vulnerabilities.
- `npm run test:mutation`: executed but did not meet the configured 100% threshold (76.09%; 203 surviving mutants and 387 TypeScript mutation-compilation errors). This remains an explicit quality-gate gap and is not being hidden by threshold changes.
- The workspace is not a Git repository, so no commit was created.
