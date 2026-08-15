import { describe, expect, it } from "vitest";
import { RtmpIngest } from "../src/modules/media-pipeline/rtmp-ingest/index.js";

function fixture() {
  let events: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void } | null = null;
  const listens: number[] = [];
  let closes = 0;
  const ingest = RtmpIngest.create({
    listen: (port, next) => { listens.push(port); events = next; },
    close: () => { closes += 1; }
  });
  return { ingest, events: () => events!, listens, closes: () => closes };
}

describe("媒体管线 rtmp-ingest 契约", () => {
  it("只接受规范的 /live/{deviceId} 发布路径，并按设备隔离与稳定排序", () => {
    const { ingest, events, listens } = fixture();
    expect(ingest.start(19500)).toMatchObject({ ok: true, value: { phase: "listening", port: 19500, streams: [] } });
    expect(listens).toEqual([19500]);
    events().onPublished("/live/phone%2F1");
    events().onPublished("/live/phone-2");
    events().onPublished("/live/phone-2");
    events().onPublished("/live/phone%2f1");
    events().onPublished("/prefix/live/phone-3");
    events().onPublished("xxxxxxphone-3");
    events().onPublished("/live/phone-3/trailing");
    events().onPublished("/live/only%2fnoncanonical");
    events().onPublished("/live/%ZZ");
    events().onPublished("/live/%20");
    events().onPublished("/live/");
    events().onPublished("/live/a%00b");
    expect(ingest.snapshot().streams).toEqual([
      { deviceId: "phone-2", phase: "active", revision: 1 },
      { deviceId: "phone/1", phase: "active", revision: 1 }
    ]);
    events().onUnpublished("/live/phone-2");
    events().onPublished(`/live/${"a".repeat(128)}`);
    events().onPublished(`/live/${"b".repeat(129)}`);
    events().onPublished("/live/phone-2");
    expect(ingest.snapshot().streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceId: "phone-2", phase: "active" }),
      expect.objectContaining({ deviceId: "phone/1", phase: "active" })
    ]));
    events().onUnpublished("/live/missing");
    expect(ingest.snapshot().streams).toEqual([
      { deviceId: "a".repeat(128), phase: "active", revision: 1 },
      { deviceId: "phone-2", phase: "active", revision: 3 },
      { deviceId: "phone/1", phase: "active", revision: 1 }
    ]);
  });

  it("管理监听与停止生命周期，并忽略停止后的迟到回调", () => {
    const { ingest, events, closes } = fixture();
    expect(ingest.start(1023)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(ingest.start(65536)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(ingest.start("19500")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(ingest.stop()).toMatchObject({ ok: false, code: "NOT_LISTENING" });
    ingest.start(19500);
    expect(ingest.start(19501)).toMatchObject({ ok: false, code: "ALREADY_LISTENING" });
    events().onPublished("/live/phone-1");
    expect(ingest.stop()).toMatchObject({ ok: true, value: { phase: "idle", streams: [] } });
    expect(closes()).toBe(1);
    events().onPublished("/live/late");
    expect(ingest.snapshot()).toMatchObject({ phase: "idle", streams: [] });
  });
  it("将监听和停止异常映射为稳定诊断，并在监听建立期间接收同步发布", () => {
    let failListen = true;
    const failed = RtmpIngest.create({ listen: () => { if (failListen) throw new Error("C:/private secret"); }, close: () => undefined });
    expect(failed.start(19500)).toEqual({ ok: false, code: "LISTEN_FAILED", value: { phase: "failed", revision: 1, port: null, streams: [], diagnostic: "无法启动 RTMP 接收服务。请检查端口与桌面端权限。" } });
    failListen = false;
    expect(failed.start(1024)).toMatchObject({ ok: true, value: { phase: "listening", port: 1024 } });

    let publish: ((path: string) => void) | null = null;
    const synchronous = RtmpIngest.create({ listen: (_port, events) => { publish = events.onPublished; events.onPublished("/live/phone-1"); }, close: () => undefined });
    expect(synchronous.start(65535)).toMatchObject({ ok: true, value: { port: 65535, streams: [{ deviceId: "phone-1", phase: "active" }] } });
    expect(Object.isFrozen(synchronous.snapshot())).toBe(true);
    publish!("/live/phone-2");
    expect(synchronous.snapshot().streams).toHaveLength(2);

    let failClose = true;
    const closing = RtmpIngest.create({ listen: () => undefined, close: () => { if (failClose) throw new Error("C:/private secret"); } });
    closing.start(19500);
    expect(closing.stop()).toEqual({ ok: false, code: "CLOSE_FAILED", value: { phase: "listening", revision: 2, port: 19500, streams: [], diagnostic: "无法停止 RTMP 接收服务。请检查端口与桌面端权限。" } });
    failClose = false;
    expect(closing.stop()).toMatchObject({ ok: true, value: { phase: "idle", revision: 3, streams: [] } });
  });

  it("拒绝不完整接收适配器，并保持所有流快照和结果冻结", () => {
    for (const port of [null, {}, { listen: () => undefined }, { close: () => undefined }, { listen: 7, close: 8 }]) {
      expect(() => RtmpIngest.create(port as never)).toThrow("Invalid RTMP ingress port");
    }
    const { ingest } = fixture();
    const started = ingest.start(19500);
    expect(Object.isFrozen(started)).toBe(true);
    expect(Object.isFrozen(started.value)).toBe(true);
    expect(Object.isFrozen(started.value.streams)).toBe(true);
  });
});
