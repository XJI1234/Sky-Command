export type PhotoProgressStage = "preparing" | "listing" | "downloading" | "receiving" | "verifying" | "saving" | "saved" | "completed" | "empty" | "failed" | "disconnected";
export interface PhotoProgressUpdate {
  readonly stage: PhotoProgressStage;
  readonly photoIndex: number;
  readonly completedCount: number;
  readonly fileName: string | null;
  readonly transferredBytes: number;
  readonly totalBytes: number | null;
}
export interface PhotoProgressEvent {
  readonly stage: PhotoProgressStage;
  readonly photoIndex: number;
  readonly completedCount: number;
  readonly fileName: string | null;
  readonly atMs: number;
}
export interface PhotoBatchProgress extends PhotoProgressUpdate {
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
  readonly finishedAtMs: number | null;
  readonly history: readonly PhotoProgressEvent[];
  readonly platformError?: Readonly<{ readonly code: string; readonly description: string }>;
  readonly failedStage?: PhotoProgressStage;
}
const terminalStages = new Set<PhotoProgressStage>(["completed", "empty", "failed", "disconnected"]);
export function advancePhotoProgress(previous: PhotoBatchProgress | undefined, update: PhotoProgressUpdate, nowMs: number): PhotoBatchProgress {
  const changed = previous === undefined || previous.stage !== update.stage || previous.photoIndex !== update.photoIndex || previous.fileName !== update.fileName;
  const history = changed
    ? [...(previous?.history ?? []), Object.freeze({ stage: update.stage, photoIndex: update.photoIndex, completedCount: update.completedCount, fileName: update.fileName, atMs: nowMs })].slice(-8)
    : previous.history;
  return Object.freeze({ ...update, startedAtMs: previous?.startedAtMs ?? nowMs, updatedAtMs: nowMs, finishedAtMs: terminalStages.has(update.stage) ? nowMs : null, history: Object.freeze(history) });
}
