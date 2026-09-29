# Photo Batch Sync Design

## Goal

Make one desktop **回传照片** action synchronize every camera photo that is not present in the current computer's photo inbox, while preserving resumability after a failed transfer or reconnect.

## Confirmed Rule

The current computer is authoritative for "already transferred". A phone-side record of a previous successful send is not sufficient because it cannot distinguish this computer from another computer, and it becomes stale when local files are removed. The desktop therefore sends its current inbox manifest with each fetch request. A photo is considered synchronized only after the desktop has verified the media bytes, atomically stored the file, and returned a successful `media-result`.

## Data Flow

1. The desktop reads the device-scoped photo inbox manifest as `(fileName, sha256)` entries.
2. `camera.photo.fetch` carries that manifest in a validated `knownPhotos` JSON array. The existing empty-field capture command remains unchanged.
3. The phone enumerates camera media in deterministic order and repeatedly selects the next file whose identity is not in `knownPhotos` and has not already been acknowledged during this fetch session.
4. For each selected file, the phone downloads it, publishes one media transfer, and waits for the matching successful `media-result` before selecting the next file.
5. When no candidate remains, the phone returns a terminal `NONE` result with a count of files transferred during this fetch. A non-empty batch returns `DELIVERED` with the final file identity and the total count.
6. The desktop correlates every media-result with `photo-inbox.accept` and calls `recordStored` for each accepted file. The dispatcher completes only after the phone's terminal result matches the final stored file; the result exposes `count` for operator feedback.

## Boundaries

- `photo-dispatcher` owns the per-device fetch session, manifest construction, final-result validation, and waiting for local storage confirmation. It must reject a second fetch while any batch is active.
- `photo-inbox` owns the immutable manifest and duplicate rule. Its list must be available to the dispatcher without exposing file paths or bytes.
- `relay-operations-adapter` forwards the structured fetch fields after validating the bounded manifest shape; it must not silently convert a non-empty manifest back to `{}`.
- `photo-command-handler` validates the `knownPhotos` array and maps it to an immutable platform-neutral request. It does not enumerate media or perform transfer work.
- `PhotoExecutor`/`AndroidDjiPhotoPort` keep one DJI download active at a time. The batch loop is above the executor so each successful media acknowledgement releases the DJI/media resources before the next file.
- `PhotoSentLedger` is no longer the source of truth for current-computer synchronization. It may remain only as an in-session safety set, or be removed if the batch request's acknowledged identities already provide that set.

## Failure and Resume Semantics

- A transfer is added to the acknowledged set only after `media-result.ok=true` and local atomic storage succeed.
- A failed, timed-out, rejected, or disconnected transfer is not added to either the phone session set or desktop manifest. The fetch fails with a stable transfer code and the next explicit click retries it.
- A late media result from an aborted generation cannot complete a newer batch.
- A duplicate already present in the inbox is treated as synchronized and must not overwrite the existing file.
- Empty camera storage returns `NOTHING_TO_FETCH` with `count: 0`, without being treated as a transport failure.
- The manifest and result counts are bounded by protocol JSON limits. Invalid entries, unsafe names, invalid SHA-256 values, or oversized manifests reject before DJI or media work starts.

## Compatibility

Capture stays `camera.photo.capture` with `{}`. Older phones that only accept an empty fetch request will reject the new structured request; the desktop reports a stable unsupported/invalid command result rather than silently falling back to one-photo behavior. No live-stream, flight, mission, or settings command is changed.

## Testing

- TypeScript dispatcher tests: manifest is sent, ten-photo batch completes, duplicate click is a no-op, each media acknowledgement gates the next download, and a mid-batch failure resumes from the first unacknowledged file.
- TypeScript inbox/adapter tests: manifest entries are frozen and bounded; accepted files are reflected before the final command result; invalid fetch fields are rejected.
- Kotlin command/executor/adapter tests: structured manifest parsing, deterministic `downloadNext` iteration, `NONE` only after all candidates, acknowledged files are not selected again in the same batch, and failure leaves the candidate retryable.
- Existing photo, media-intake, relay, and cross-runtime contract suites remain green.

