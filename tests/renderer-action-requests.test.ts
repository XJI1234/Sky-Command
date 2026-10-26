import { describe, expect, it } from "vitest";
import { createActionRequests } from "../src/production/operator-console/renderer/action-requests.js";

describe("操作按钮的未完成请求", () => {
  it("连续点击只发送一次请求，完成后可再次操作", async () => {
    const requests = createActionRequests();
    let sent = 0;
    let finish!: () => void;
    const reply = new Promise<void>(resolve => { finish = resolve; });
    const click = async () => {
      const request = requests.reserve("phone-1", "stream-start");
      if (!request.ok) return false;
      try { sent += 1; await reply; return true; } finally { request.release(); }
    };
    const clicks = Array.from({ length: 30 }, click);
    expect(sent).toBe(1);
    expect(requests.pending("phone-1", "stream-start")).toBe(true);
    finish();
    expect((await Promise.all(clicks)).filter(Boolean)).toHaveLength(1);
    expect(await click()).toBe(true);
    expect(sent).toBe(2);
  });

  it.each(["stream-start", "stream-stop", "photo-capture", "photo-fetch"])("%s 等待回执时阻止冲突的相机操作", action => {
    const requests = createActionRequests();
    const request = requests.reserve("phone-1", action);
    expect(request.ok).toBe(true);
    expect(requests.reserve("phone-1", "photo-fetch").ok).toBe(false);
    expect(requests.reserve("phone-1", "photo-capture").ok).toBe(false);
    expect(requests.reserve("phone-1", "stream-start").ok).toBe(false);
    if (request.ok) request.release();
    expect(requests.reserve("phone-1", "photo-fetch").ok).toBe(true);
  });

  it("长时间回传照片不阻止图传停止、返航、降落和其他设备", () => {
    const requests = createActionRequests();
    requests.reserve("phone-1", "photo-fetch");
    expect(requests.reserve("phone-1", "stream-stop").ok).toBe(true);
    expect(requests.reserve("phone-1", "flight-return-home").ok).toBe(true);
    expect(requests.reserve("phone-1", "flight-land").ok).toBe(true);
    expect(requests.reserve("phone-2", "stream-start").ok).toBe(true);
    expect(requests.reserve("phone-1", "stream-stop").ok).toBe(false);
  });

  it("航线请求阻止重复准备和启动，暂停停止仍可发送", () => {
    const requests = createActionRequests();
    requests.reserve("phone-1", "mission-upload");
    expect(requests.reserve("phone-1", "mission-start").ok).toBe(false);
    expect(requests.reserve("phone-1", "mission-stage").ok).toBe(false);
    expect(requests.reserve("phone-1", "mission-resume").ok).toBe(false);
    expect(requests.reserve("phone-1", "mission-pause").ok).toBe(true);
    expect(requests.reserve("phone-1", "mission-stop").ok).toBe(true);
    expect(requests.reserve("phone-1", "stream-start").ok).toBe(true);
  });

  it("请求失败后释放按钮，旧请求的重复释放不能解除新请求", async () => {
    const requests = createActionRequests();
    const first = requests.reserve("phone-1", "mission-start");
    if (!first.ok) throw new Error(first.reason);
    await expect((async () => {
      try { throw new Error("transport failed"); } finally { first.release(); }
    })()).rejects.toThrow("transport failed");
    const retry = requests.reserve("phone-1", "mission-start");
    expect(retry.ok).toBe(true);
    first.release();
    expect(requests.pending("phone-1", "mission-start")).toBe(true);
    if (retry.ok) retry.release();
    expect(requests.reason("phone-1", "mission-start")).toBeNull();
  });
});
