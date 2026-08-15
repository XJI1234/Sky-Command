import { ImporterCancelled, ImporterPhaseError } from "./error-map.js";
import type { RouteImportCancellation } from "./types.js";

type CancellationRead =
  | Readonly<{ ok: true; aborted: boolean }>
  | Readonly<{ ok: false; reason: "non-boolean" | "unreadable" }>;

function readAborted(cancellation: RouteImportCancellation): CancellationRead {
  let value: unknown;
  try {
    value = cancellation.aborted;
  } catch {
    return Object.freeze({ ok: false, reason: "unreadable" });
  }
  return typeof value === "boolean"
    ? Object.freeze({ ok: true, aborted: value })
    : Object.freeze({ ok: false, reason: "non-boolean" });
}

export function throwIfCancelled(cancellation: RouteImportCancellation | undefined): void {
  if (cancellation === undefined) return;
  const result = readAborted(cancellation);
  if (!result.ok) {
    throw new ImporterPhaseError("DOMAIN_INVARIANT_VIOLATION", {
      phase: "cancellation",
      reason: result.reason
    });
  }
  if (result.aborted) throw new ImporterCancelled();
}

export async function yieldAndCheck(cancellation: RouteImportCancellation | undefined): Promise<void> {
  throwIfCancelled(cancellation);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfCancelled(cancellation);
}
