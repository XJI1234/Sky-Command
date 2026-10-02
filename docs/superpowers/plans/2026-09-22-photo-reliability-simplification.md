# Photo Reliability Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing camera-photo protocol while removing shared cross-device media state and making transfer completion depend on a verified receipt.

**Architecture:** `media-intake` keeps transfer bytes and validation behind its existing seam, but supplies the connection identity to its sink on every effect. `relay-link` resolves the corresponding device at that seam, so it has no mutable current-media cursor. `photo-dispatcher` stores the phone-confirmed delivery identity and the inbox receipt independently, completing fetch only when both match.

**Tech Stack:** TypeScript, Vitest, Kotlin, Gradle, DJI MSDK v5.17.

## Global Constraints

- Preserve `camera.photo.capture`, `camera.photo.fetch`, and all wire frame names and fields.
- Do not change RTMP lifecycle ownership or add a dependency between photo and live-stream.
- Test each new behavior before production code; retain all existing tests unchanged except fixtures that must express the existing delivered result contract.
- Leave temporary XML, captures, releases, and this plan untracked.

---

### Task 1: Connection-Scoped Desktop Media Sink

**Files:**
- Modify: `D:/Desktop/Sky Command/src/modules/relay-link/media-intake/index.ts`
- Modify: `D:/Desktop/Sky Command/src/modules/relay-link/index.ts`
- Modify: `D:/Desktop/Sky Command/src/modules/relay-link/media-intake/CONTRACT.md`
- Test: `D:/Desktop/Sky Command/tests/relay-link-contract.test.ts`

**Interfaces:**
- Consumes: decoded `media-begin`, `media-chunk`, and `media-complete` frames plus the server connection id.
- Produces: one `onPhoto(deviceId, file)` call associated with the connection that completed the file.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps interleaved media transfers associated with their own paired devices", async () => {
  // Pair phone-a and phone-b, begin both transfers, then complete phone-a first.
  // Assert onPhoto receives [{ deviceId: "phone-a", fileName: "a.jpg" },
  //                          { deviceId: "phone-b", fileName: "b.jpg" }].
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=dot tests/relay-link-contract.test.ts`
Expected: FAIL because the first completed file is routed through the global current-media device.

- [ ] **Step 3: Write minimal implementation**

```ts
interface MediaSink {
  begin(connectionId: string, input: MediaBeginInput): MediaSinkResult;
  append(connectionId: string, bytes: Uint8Array): MediaSinkResult;
  complete(connectionId: string, file: MediaFile): MediaSinkResult;
  abort(connectionId: string): void;
}
```

Remove `currentMediaConnection` and `currentMediaDevice`; resolve the paired device inside `complete(connectionId, file)`.

- [ ] **Step 4: Run targeted tests to verify it passes**

Run: `npm test -- --reporter=dot tests/relay-link-contract.test.ts tests/media-intake-contract.test.ts`
Expected: PASS.

### Task 2: Digest-Correlated Photo Completion

**Files:**
- Modify: `D:/Desktop/Sky Command/src/modules/camera-photo-control/photo-dispatcher/index.ts`
- Modify: `D:/Desktop/Sky Command/src/modules/camera-photo-control/photo-dispatcher/CONTRACT.md`
- Test: `D:/Desktop/Sky Command/tests/photo-dispatcher-contract.test.ts`

**Interfaces:**
- Consumes: successful fetch result `{ outcome: "DELIVERED", fileName, size, sha256 }` and inbox `recordStored(deviceId, fileName, sha256)`.
- Produces: `SUCCEEDED` only after the same file name and SHA-256 are known from both sources.

- [ ] **Step 1: Write the failing test**

```ts
await dispatcher.capture("phone-1");
const fetch = dispatcher.fetch("phone-1");
dispatcher.recordStored("phone-1", "DJI_0001.jpg", "b".repeat(64));
// The successful phone response declares "a".repeat(64).
await expect(fetch).resolves.toMatchObject({ ok: false, code: "TRANSFER_FAILED" });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=dot tests/photo-dispatcher-contract.test.ts`
Expected: FAIL because `recordStored` currently ignores its `sha256` argument.

- [ ] **Step 3: Write minimal implementation**

```ts
type DeliveredPhoto = Readonly<{ fileName: string; sha256: string }>;
// Per device, retain the phone-confirmed delivery and inbox receipt.
// Set phase "stored" and resolve the pending fetch only when both values match.
```

- [ ] **Step 4: Run targeted test to verify it passes**

Run: `npm test -- --reporter=dot tests/photo-dispatcher-contract.test.ts`
Expected: PASS.

### Task 3: Android Rejection and Timeout Containment Audit

**Files:**
- Modify only after an MSDK callback capable of proving camera/media release is identified.
- Test: `D:/Desktop/MSDK-relay/src/modules/camera-photo/photo-executor/src/test/kotlin/com/skycommand/relay/photo/executor/PhotoExecutorContractTest.kt`

**Interfaces:**
- Consumes: timeout/cancellation from `DjiOperationCoordinator`.
- Produces: a second photo operation only after the matching first hardware operation has a real terminal or authoritative settled observation.

- [ ] **Step 1: Verify the MSDK release signal**

Run: `rg -n "KeyIsShootingPhoto|stopPullOriginalMediaFileFromCamera|disable" docs src`
Expected: identify an MSDK callback or state key that proves a capture/download is settled; do not use a guessed delay.

- [ ] **Step 2: Write the failing test**

```kotlin
// Time out an accepted photo operation whose fake port has not reported settled.
// Assert a second normal operation is rejected; invoke the settled callback;
// assert the next operation is then admitted.
```

- [ ] **Step 3: Implement only the proven settled seam**

```kotlin
// DjiPhotoPort must report real asynchronous settle completion.
// PhotoExecutor calls confirmHardwareSettled only from that report.
```

- [ ] **Step 4: Run Android focused tests and assemble**

Run: `.\\gradlew.bat :camera-photo:photo-executor:testDebugUnitTest :camera-photo:android-dji-photo-adapter:testDebugUnitTest :app:assembleDebug --console=plain`
Expected: BUILD SUCCESSFUL.

## Plan Review

- Task 1 removes the cross-device state source without changing the media protocol.
- Task 2 preserves normal successful transfer behavior while rejecting mismatched evidence.
- Task 3 is intentionally gated on an authoritative MSDK signal so it cannot replace a real hardware fact with a timer.
- No task changes RTMP, flight control, or the desktop UI contract.
