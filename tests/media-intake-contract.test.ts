import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { MediaIntake, type MediaFile } from "../src/modules/relay-link/media-intake/index.js";
import type { RelayFrame } from "../src/modules/relay-link/protocol-core/index.js";

const hex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const digest = (bytes: Uint8Array): string => hex(sha256(bytes));

describe("media-intake", () => {
  it("收齐分块后校验摘要并回复成功结果", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const completed: MediaFile[] = [];
    const results: RelayFrame[] = [];
    const intake = MediaIntake.create({
      sink: {
        begin: () => "accepted",
        append: () => "accepted",
        complete: (_connectionId, file) => { completed.push(file); return "accepted"; },
        abort: () => undefined,
      },
      results: { send: (_connectionId, frame) => { results.push(frame); } },
    });

    intake.accept("conn-1", { type: "media-begin", id: "photo-1", fileName: "DJI_0001.jpg", size: bytes.byteLength, sha256: digest(bytes) });
    intake.accept("conn-1", { type: "media-chunk", id: "photo-1", data: bytes.subarray(0, 2) });
    intake.accept("conn-1", { type: "media-chunk", id: "photo-1", data: bytes.subarray(2) });
    intake.accept("conn-1", { type: "media-complete", id: "photo-1" });

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ transferId: "photo-1", fileName: "DJI_0001.jpg", size: 4, sha256: digest(bytes) });
    expect(Array.from(completed[0]!.bytes)).toEqual([1, 2, 3, 4]);
    expect(results).toEqual([{ type: "media-result", id: "photo-1", ok: true, detail: "Photo stored" }]);
  });

  it("摘要失败、无活动传输和断线都不会成功落盘", () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const completed: MediaFile[] = [];
    const aborted: string[] = [];
    const results: Array<Readonly<{ readonly id: string; readonly ok: boolean; readonly detail: string }>> = [];
    const intake = MediaIntake.create({
      sink: {
        begin: () => "accepted",
        append: () => "accepted",
        complete: (_connectionId, file) => { completed.push(file); return "accepted"; },
        abort: () => { aborted.push("abort"); },
      },
      results: { send: (_connectionId, frame) => { results.push(frame); } },
    });

    intake.accept("conn-1", { type: "media-chunk", id: "photo-missing", data: bytes });
    intake.accept("conn-1", { type: "media-begin", id: "photo-1", fileName: "DJI_0001.jpg", size: bytes.byteLength, sha256: "a".repeat(64) });
    intake.accept("conn-1", { type: "media-chunk", id: "photo-1", data: bytes });
    intake.accept("conn-1", { type: "media-complete", id: "photo-1" });
    intake.accept("conn-2", { type: "media-begin", id: "photo-2", fileName: "DJI_0002.jpg", size: 1, sha256: digest(new Uint8Array([1])) });
    intake.cancelConnection("conn-2", "closed");

    expect(completed).toEqual([]);
    expect(results.map((item) => item.detail)).toEqual(["TRANSFER_NOT_ACTIVE", "TRANSFER_CHECKSUM_MISMATCH"]);
    expect(aborted.length).toBeGreaterThanOrEqual(2);
  });
});
