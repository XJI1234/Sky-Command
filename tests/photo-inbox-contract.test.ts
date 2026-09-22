import { describe, expect, it } from "vitest";
import { PhotoInbox } from "../src/modules/camera-photo-control/photo-inbox/index.js";

const file = (fileName = "DJI_0001.jpg", bytes = new Uint8Array([1, 2, 3]), sha256 = "a".repeat(64)) => ({
  fileName,
  size: bytes.byteLength,
  sha256,
  bytes,
});

describe("photo-inbox", () => {
  it("按设备收下原图、按文件名和摘要去重，且不泄漏路径", () => {
    const inbox = PhotoInbox.create({ now: () => 1_700_000_000_000 });
    expect(inbox.accept("phone-1", file())).toBe("accepted");
    expect(inbox.accept("phone-1", file())).toBe("duplicate");
    expect(inbox.accept("phone-1", file("DJI_0002.jpg", new Uint8Array([4]), "a".repeat(64)))).toBe("duplicate");
    expect(inbox.accept("phone-2", file())).toBe("accepted");
    expect(inbox.accept("phone-1", file("..\\escape.jpg"))).toBe("rejected");
    expect(JSON.stringify(inbox.list("phone-1"))).not.toMatch(/[\\/]/u);
    expect(inbox.list("phone-1")).toEqual([{ fileName: "DJI_0001.jpg", size: 3, sha256: "a".repeat(64), receivedAtMs: 1_700_000_000_000 }]);
    expect(inbox.list("phone-2")).toHaveLength(1);
    expect(inbox.forget("phone-1")).toBe(true);
    expect(inbox.list("phone-1")).toEqual([]);
  });

  it("磁盘写入失败时不登记清单", () => {
    const inbox = PhotoInbox.create({
      now: () => 1,
      fs: { writeAtomic: () => false },
    });
    expect(inbox.accept("phone-1", file())).toBe("rejected");
    expect(inbox.list("phone-1")).toEqual([]);
  });
});
