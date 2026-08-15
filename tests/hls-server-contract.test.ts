import { describe, expect, it } from "vitest";
import { HlsServer } from "../src/modules/media-pipeline/hls-server/index.js";

const input = { port: 18600, rootDirectory: "C:/private/hls" };

function fixture(options: { readonly listen?: (value: { readonly host: "127.0.0.1"; readonly port: number; readonly rootDirectory: string }) => void; readonly close?: () => void } = {}) {
  const bindings: Array<{ readonly host: "127.0.0.1"; readonly port: number; readonly rootDirectory: string }> = [];
  let closes = 0;
  const server = HlsServer.create({
    listen: (value) => { bindings.push(value); options.listen?.(value); },
    close: () => { closes += 1; options.close?.(); }
  });
  return { server, bindings, closes: () => closes };
}

describe("媒体管线 hls-server 契约", () => {
  it("仅在回环地址监听，并为合法流生成编码后的本地播放地址", () => {
    const { server, bindings } = fixture();
    expect(server.snapshot()).toEqual({ phase: "idle", revision: 0, port: null, diagnostic: null });
    expect(server.start(input)).toEqual({ ok: true, value: { phase: "listening", revision: 1, port: 18600, diagnostic: null } });
    expect(bindings).toEqual([{ host: "127.0.0.1", port: 18600, rootDirectory: "C:/private/hls" }]);

    const playback = server.playback("phone/1?preview #1%");
    expect(playback).toEqual({ ok: true, value: { streamId: "phone/1?preview #1%", url: "http://127.0.0.1:18600/hls/phone%2F1%3Fpreview%20%231%25/index.m3u8" } });
    expect(Object.isFrozen(playback)).toBe(true);
    if (playback.ok) expect(Object.isFrozen(playback.value)).toBe(true);
    expect(JSON.stringify(server.snapshot())).not.toContain("C:/private");
  });

  it("拒绝非法监听输入与非法流标识，且不调用端口适配器", () => {
    const { server, bindings } = fixture();
    for (const invalid of [null, {}, { ...input, port: 1023 }, { ...input, port: 65536 }, { ...input, port: 18600.5 }, { ...input, port: "18600" }, { ...input, rootDirectory: " " }]) {
      expect(server.start(invalid)).toMatchObject({ ok: false, code: "INVALID_INPUT", value: { phase: "idle" } });
    }
    expect(server.playback("phone-1")).toMatchObject({ ok: false, code: "NOT_LISTENING", value: { phase: "idle" } });
    expect(bindings).toEqual([]);

    server.start(input);
    for (const streamId of [null, " ", "a\0b", "a".repeat(129)]) {
      expect(server.playback(streamId)).toMatchObject({ ok: false, code: "INVALID_INPUT", value: { phase: "listening" } });
    }
    expect(server.playback("a".repeat(128))).toMatchObject({ ok: true, value: { streamId: "a".repeat(128) } });
    const lowest = fixture();
    expect(lowest.server.start({ ...input, port: 1024 })).toMatchObject({ ok: true, value: { port: 1024 } });
    const highest = fixture();
    expect(highest.server.start({ ...input, port: 65535 })).toMatchObject({ ok: true, value: { port: 65535 } });
  });

  it("将监听失败转为稳定且脱敏的快照，并支持之后重试", () => {
    let fail = true;
    const { server, bindings } = fixture({ listen: () => { if (fail) throw new Error(`permission ${input.rootDirectory}`); } });
    const failed = server.start(input);
    expect(failed).toEqual({ ok: false, code: "LISTEN_FAILED", value: { phase: "failed", revision: 1, port: null, diagnostic: "无法启动本地 HLS 服务。请检查端口与桌面端权限。" } });
    expect(JSON.stringify(failed)).not.toContain(input.rootDirectory);
    fail = false;
    expect(server.start(input)).toMatchObject({ ok: true, value: { phase: "listening", revision: 2, port: 18600, diagnostic: null } });
    expect(bindings).toHaveLength(2);
  });

  it("拒绝重复监听，并在停止后恢复可重启的空闲状态", () => {
    const { server, bindings, closes } = fixture();
    server.start(input);
    expect(server.start({ ...input, port: 18601 })).toMatchObject({ ok: false, code: "ALREADY_LISTENING", value: { phase: "listening", port: 18600 } });
    expect(bindings).toHaveLength(1);
    expect(server.stop()).toEqual({ ok: true, value: { phase: "idle", revision: 2, port: null, diagnostic: null } });
    expect(closes()).toBe(1);
    expect(server.stop()).toMatchObject({ ok: false, code: "NOT_LISTENING", value: { phase: "idle" } });
    expect(server.start({ ...input, port: 18601 })).toMatchObject({ ok: true, value: { phase: "listening", revision: 3, port: 18601 } });
  });

  it("停止异常时保留监听状态并返回稳定诊断，之后可以重试", () => {
    let fail = true;
    const { server, closes } = fixture({ close: () => { if (fail) throw new Error(`cannot close ${input.rootDirectory}`); } });
    server.start(input);
    const failed = server.stop();
    expect(failed).toEqual({ ok: false, code: "CLOSE_FAILED", value: { phase: "listening", revision: 2, port: 18600, diagnostic: "无法停止本地 HLS 服务。请检查桌面端权限。" } });
    expect(JSON.stringify(failed)).not.toContain(input.rootDirectory);
    fail = false;
    expect(server.stop()).toMatchObject({ ok: true, value: { phase: "idle", revision: 3, port: null, diagnostic: null } });
    expect(closes()).toBe(2);
  });

  it("在创建阶段拒绝不完整的 HTTP 服务适配器", () => {
    for (const port of [null, {}, { listen: () => undefined }, { close: () => undefined }, { listen: 7, close: 8 }]) {
      expect(() => HlsServer.create(port as never)).toThrow("Invalid HLS server port");
    }
  });
});
