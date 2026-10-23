import { describe, expect, it } from "vitest";
import { createPhotoProgressCache, photoProgressView } from "../src/production/operator-console/renderer/photo-progress.js";

const activePhoto = {
  phase: "fetching",
  code: null,
  progress: {
    stage: "listing",
    photoIndex: 0,
    completedCount: 0,
    fileName: null,
    transferredBytes: 0,
    totalBytes: null,
    startedAtMs: 1_000,
    updatedAtMs: 1_000,
    finishedAtMs: null,
    history: [],
  },
};

describe("photo progress after stop", () => {
  it("停止后的空进度快照必须结束缓存里的进行中回传", () => {
    const cache = createPhotoProgressCache();
    const device = { deviceId: "phone-1", connection: { relay: "online" }, photo: activePhoto };
    cache.observe([device], 2_000);
    expect(photoProgressView(cache.get("phone-1"), 2_000)?.active).toBe(true);
    cache.observe([{ ...device, photo: { phase: "idle", code: "STOPPED" } }], 3_000);
    const view = photoProgressView(cache.get("phone-1"), 3_000);
    expect(view).toMatchObject({ stage: "stopped", active: false, heading: "回传已停止" });
  });
});
