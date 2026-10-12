import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { MediaIntake, type MediaFile } from "../src/modules/relay-link/media-intake/index.js";
import type { RelayFrame } from "../src/modules/relay-link/protocol-core/index.js";

const hex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const digest = (bytes: Uint8Array): string => hex(sha256(bytes));

describe("media-intake", () => {
  it("异步保存期间不回复成功，拒绝时只回复失败", async () => {
    for (const stored of ["accepted", "rejected"] as const) {
      let resolve: (value: typeof stored) => void = () => undefined;
      const results: RelayFrame[] = [];
      const bytes = new Uint8Array([1, 2, 3]);
      const intake = MediaIntake.create({ sink: {
        begin: () => "accepted", append: () => "accepted", abort: () => undefined,
        complete: () => new Promise<typeof stored>((done) => { resolve = done; }),
      }, results: { send: (_id, frame) => { results.push(frame); } } });
      intake.accept("conn", { type: "media-begin", id: "photo", fileName: "DJI_1.jpg", size: bytes.length, sha256: digest(bytes) });
      intake.accept("conn", { type: "media-chunk", id: "photo", data: bytes });
      intake.accept("conn", { type: "media-complete", id: "photo" });
      expect(results).toEqual([]);
      resolve(stored); await Promise.resolve();
      expect(results).toEqual([{ type: "media-result", id: "photo", ok: stored === "accepted", detail: stored === "accepted" ? "Photo stored" : "TRANSFER_FAILED" }]);
    }
  });

  it("保存中断线不发送迟到成功，超出声明大小立即拒绝", async () => {
    let resolve: (value: "accepted") => void = () => undefined;
    const results: RelayFrame[] = [];
    const bytes = new Uint8Array([1, 2, 3]);
    const intake = MediaIntake.create({ sink: {
      begin: () => "accepted", append: () => "accepted", abort: () => undefined,
      complete: () => new Promise<"accepted">((done) => { resolve = done; }),
    }, results: { send: (_id, frame) => { results.push(frame); } } });
    intake.accept("conn", { type: "media-begin", id: "photo", fileName: "DJI_1.jpg", size: bytes.length, sha256: digest(bytes) });
    intake.accept("conn", { type: "media-chunk", id: "photo", data: bytes });
    intake.accept("conn", { type: "media-complete", id: "photo" });
    intake.cancelConnection("conn", "disconnected");
    resolve("accepted"); await Promise.resolve();
    expect(results).toEqual([]);
    intake.accept("conn2", { type: "media-begin", id: "overflow", fileName: "DJI_2.jpg", size: 1, sha256: digest(bytes) });
    intake.accept("conn2", { type: "media-chunk", id: "overflow", data: bytes });
    expect(results).toEqual([{ type: "media-result", id: "overflow", ok: false, detail: "TRANSFER_FAILED" }]);
  });

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
