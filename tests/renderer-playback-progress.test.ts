import { expect, it } from "vitest";
import { createPlaybackProgress } from "../src/production/operator-console/renderer/playback-progress.js";

it("advancing the media clock without new decoded frames does not hide a frozen image", () => {
  const progress = createPlaybackProgress();
  expect(progress.observe(1000, 0.04, 1)).toBe(1000);
  expect(progress.observe(15000, 14, 1)).toBe(1000);
  expect(progress.observe(16000, 15, 2)).toBe(16000);
  progress.reset();
  expect(progress.observe(17000, 0.01, 1)).toBe(17000);
});

it("uses media time when decoded frame statistics are unavailable", () => {
  const progress = createPlaybackProgress();
  expect(progress.observe(1000, 1, null)).toBe(1000);
  expect(progress.observe(2000, 1.01, null)).toBe(1000);
  expect(progress.observe(3000, 2, null)).toBe(3000);
});
