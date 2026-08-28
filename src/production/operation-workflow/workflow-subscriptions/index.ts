import type { WorkflowSubscriptionPort } from "../ports.js";

type Source = WorkflowSubscriptionPort;
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

function create(sources: readonly Source[], onChange: () => void) {
  let disposed = false;
  const subscriptions = sources.map((source) => {
    try { return source.subscribe(() => { if (!disposed) onChange(); }); }
    catch { return () => undefined; }
  });
  return freeze({
    dispose: () => { if (disposed) return; disposed = true; for (const unsubscribe of subscriptions) { try { unsubscribe(); } catch { /* cleanup continues */ } } }
  });
}

export const WorkflowSubscriptions = freeze({ create });
