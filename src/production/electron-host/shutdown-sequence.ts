export interface DesktopHostShutdownDependencies {
  readonly disposeShell: () => Promise<void>;
  readonly disposeApplication: () => Promise<void>;
  readonly flushJournal: () => Promise<void>;
  readonly quit: () => void;
  /** Maximum time one shutdown stage may hold the process before cleanup advances. */
  readonly stageTimeoutMs?: number;
}

/** Guarantees process exit only after every owned shutdown stage has been attempted. */
export async function shutdownDesktopHost(dependencies: DesktopHostShutdownDependencies): Promise<void> {
  const timeoutMs = dependencies.stageTimeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("Shutdown timeout is invalid");
  const runStage = async (stage: () => Promise<void>): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(stage),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Shutdown stage timed out")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  try {
    await runStage(dependencies.disposeShell);
  } finally {
    try {
      await runStage(dependencies.disposeApplication);
    } finally {
      try {
        await runStage(dependencies.flushJournal);
      } finally {
        dependencies.quit();
      }
    }
  }
}
