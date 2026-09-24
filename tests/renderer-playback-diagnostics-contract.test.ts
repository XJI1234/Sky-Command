import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");

describe("renderer playback diagnostics", () => {
  it("records exactly one first rendered frame per attached HTTP-FLV player", () => {
    const text = source();

    expect(text).toContain('action: "video-first-frame-rendered"');
    expect(text).toContain("firstPlaybackFrameReported");
    expect(text).toContain("recordFirstPlaybackFrame");
    expect(text).toContain("video.videoWidth");
    expect(text).toContain("video.videoHeight");
  });
});
