/** Counts decoded frames rather than trusting currentTime, which can advance over a frozen image. */
export function createPlaybackProgress() {
  let lastFrames = -1;
  let lastTime = -1;
  let lastProgressAt = 0;
  return Object.freeze({
    reset: (): void => { lastFrames = -1; lastTime = -1; lastProgressAt = 0; },
    observe: (now: number, time: number, frames: number | null): number => {
      const changed = frames === null ? time > lastTime + 0.05 : frames > lastFrames;
      if (changed) lastProgressAt = now;
      lastFrames = frames ?? lastFrames;
      if (changed) lastTime = time;
      return lastProgressAt;
    },
  });
}
