# 旧 HLS 图传压到 3–5 秒实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Task 1–2 已按校正后的依赖语义落地。契约与实现必须保持 `gop_cache: true`、`lowLatencyMode: true`。禁止为「对齐本文更早草稿」改成 `false`。剩余工作只有 Task 3 真机秒表。

**Goal:** 在不改手机 DJI 推流、不改 `media-pipeline` 模块契约、不拆 WHIP 旁路的前提下，把旧 RTMP→HLS 玻璃到玻璃延迟从约 8–12 秒压到约 3–5 秒。

**Architecture:** 延迟几乎全在桌面胶水层。原先可压的是 FFmpeg 2 秒切片和 hls.js 默认攒多个分片。GOP 缓存不是持续延迟源：`node-media-server` 只在新的本地 FFmpeg 播放端接入时补发当前可解码 GOP。本计划只改 `media-ports.ts` 的收流/切片参数和渲染器的 hls.js 缓冲，继续 `-c:v copy`，不做转码、不做 LL-HLS、不引入新端口。

**Tech Stack:** node-media-server RTMP、FFmpeg HLS、hls.js、Vitest 源码契约测试。

## 全局约束

- 目标是稳定 3–5 秒，不是亚秒；亚秒仍走 WHIP。
- 不改 `src/modules/media-pipeline/**` 契约与实现；FFmpeg 命令行属于 Electron 适配器。
- 不改手机 `LiveStream` / `ILiveStreamManager`；MSDK 5.17 没有可稳妥设置的 GOP 公开接口。
- 视频继续 bitstream copy。禁止 `-c:v libx264`，禁止 `split_by_time`（copy 时会切在非关键帧上，接头容易花屏）。
- 图传不听声音：输出 `-an`，避免 DJI 无音频或静音 AAC 时 FFmpeg 等音轨。
- 双轨互斥保持原样；本计划不删 WHIP，也不改命令名。
- 操作员文案不写「实时」；旧路仍是延迟图传。
- 测试沿用 Electron 胶水的源码扫描契约，不导出内部 `ffmpegArgs`。

---

## 现状与延迟账

当前实现：

```144:144:src/production/electron-host/media-ports.ts
      server = new NodeRtmpServer({ rtmp: { port, chunk_size: 60_000, gop_cache: true, ping: 30, ping_timeout: 60 } });
```

```204:218:src/production/electron-host/media-ports.ts
function ffmpegArgs(job: TranscodeJob, playlist: string): readonly string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-i", job.inputUrl,
    "-c:v", "copy",
    "-c:a", "aac",
    "-ac", "2",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "6",
    "-hls_flags", "delete_segments+append_list",
    "-hls_segment_filename", join(job.outputDirectory, "seg-%03d.ts"),
    playlist,
  ];
}
```

```93:93:src/production/operator-console/renderer/main.ts
    hlsPlayer = new Hls({ enableWorker: true, lowLatencyMode: true });
```

| 段 | 现在 | 改后目标 |
|---|---|---|
| 飞机 + DJI RTMP | 1–2s | 1–2s（本计划不动） |
| node-media-server | 接入时补发当前 GOP，不给已连接 FFmpeg 持续囤积 | 保持 `gop_cache: true` |
| FFmpeg 开流探测 | 0.5–1s | ~0.1s（缩小 probe） |
| HLS 切片 | 2s（等关键帧，`hls_time 2`） | 1–2s（`hls_time 1`，仍对齐关键帧） |
| hls.js | 4–6s（默认约 3×2s） | 1–2s（只落后 1 个分片，1.2 倍追帧） |
| **合计** | **8–12s** | **3–5s** |

已核对依赖后否决的草稿项：

- 不要把 `gop_cache` 改成 `false`。`node-media-server` 只在新 RTMP 播放端接入时把当前 `rtmpGopCacheQueue` 写给它；关键帧会清空队列再开始新 GOP。关掉后 FFmpeg 只能等下一个 DJI 关键帧。
- 不要把 `lowLatencyMode` 改成 `false`。当前 `hls.js` 的 `maxLiveSyncPlaybackRate` 追帧在 `!lowLatencyMode` 时直接 return。没有 `#EXT-X-PART` 时它不会变成 LL-HLS；同步距离仍由 `liveSyncDurationCount: 1` 决定。
- 不要加 `-flags low_delay`：`-c:v copy` 没有解码/编码路径。
- 不要加 `-hls_allow_cache 0`：本机 HLS HTTP 已返回 `Cache-Control: no-store`。

飞机 GOP 若是 2 秒，切片仍会落到约 2 秒。靠缩短切片和播放器只落后 1 段，仍应落在 3–5 秒。若真机测得仍大于 5 秒，下一轮再查 DJI GOP，不在本计划改缓存开关。

---

## 文件

```text
修改  src/production/electron-host/media-ports.ts
修改  src/production/operator-console/renderer/main.ts
新增  tests/hls-latency-contract.test.ts
```

`electron-host` / `operator-console` 的 CONTRACT 已写明：必须保留 `gop_cache: true` 与 `lowLatencyMode: true`。后续改动不得回退这两项。

---

### Task 1: 收流与切片参数

**Files:**
- Modify: `src/production/electron-host/media-ports.ts`
- Test: `tests/hls-latency-contract.test.ts`

**Produces:** 保留 GOP 接入补发；FFmpeg 输入低延迟；1 秒目标切片；无音频；3 段播放列表。

- [x] **Step 1: 写失败的源码契约测试**

Create `tests/hls-latency-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mediaPorts = () => readFileSync(new URL("../src/production/electron-host/media-ports.ts", import.meta.url), "utf8");
const renderer = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");

describe("旧 HLS 低延迟切片", () => {
  it("RTMP 不缓存 GOP，FFmpeg 按 1 秒目标切片且不转视频、不转音频", () => {
    const source = mediaPorts();
    expect(source).toContain("gop_cache: true");
    expect(source).not.toContain("gop_cache: false");
    expect(source).toContain('"-hls_time", "1"');
    expect(source).toContain('"-hls_list_size", "3"');
    expect(source).toContain("delete_segments+append_list+independent_segments");
    expect(source).toContain('"-an"');
    expect(source).toContain("-fflags");
    expect(source).toContain("nobuffer");
    expect(source).toContain("-analyzeduration");
    expect(source).toContain('"-c:v", "copy"');
    expect(source).not.toContain('"-c:a", "aac"');
    expect(source).not.toContain("split_by_time");
    expect(source).not.toContain("libx264");
  });

  it("hls.js 只落后一个分片，并且不假装这是 LL-HLS", () => {
    const source = renderer();
    expect(source).toContain("liveSyncDurationCount: 1");
    expect(source).toContain("liveMaxLatencyDurationCount: 4");
    expect(source).toContain("maxLiveSyncPlaybackRate: 1.2");
    expect(source).toContain("lowLatencyMode: true");
    expect(source).not.toContain("lowLatencyMode: false");
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/hls-latency-contract.test.ts`

Expected: 已按校正后的契约改完；不要再把 `gop_cache` / `lowLatencyMode` 改成 `false`。

- [x] **Step 3: 改 RTMP 与 FFmpeg 参数**

保持 `gop_cache: true`。不要加 `-flags low_delay` 或 `-hls_allow_cache 0`。

落地后的 `ffmpegArgs`（输入参数必须在 `-i` 之前）：

```ts
function ffmpegArgs(job: TranscodeJob, playlist: string): readonly string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-fflags", "nobuffer+discardcorrupt",
    "-probesize", "32768",
    "-analyzeduration", "0",
    "-i", job.inputUrl,
    "-c:v", "copy",
    "-an",
    "-f", "hls",
    "-hls_time", "1",
    "-hls_list_size", "3",
    "-hls_flags", "delete_segments+append_list+independent_segments",
    "-flush_packets", "1",
    "-hls_segment_filename", join(job.outputDirectory, "seg-%03d.ts"),
    playlist,
  ];
}
```

禁止加 `split_by_time`。`independent_segments` 只声明「分片从关键帧开始」，copy 时 FFmpeg 仍按关键帧切；`hls_time 1` 是目标时长，GOP 大于 1 秒时实际分片会变长，这是接受的。

- [x] **Step 4: 再跑 Task 1 的测试**

Expected: 第一条通过；第二条在 Task 2 完成后通过。

---

### Task 2: 播放器缓冲

**Files:**
- Modify: `src/production/operator-console/renderer/main.ts`
- Test: `tests/hls-latency-contract.test.ts`

**Consumes:** Task 1 已缩短分片。

**Produces:** 播放器只落后约 1 个分片，积压时用 1.2 倍速追。

- [x] **Step 1: 改 `attachVideo` 的 Hls 构造**

```ts
    hlsPlayer = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 4,
      liveDurationInfinity: true,
      maxLiveSyncPlaybackRate: 1.2,
      maxBufferLength: 4,
      maxMaxBufferLength: 8,
      backBufferLength: 0,
    });
```

`lowLatencyMode: true` 只为打开 1.2 倍追帧，不引入 LL-HLS。不要改 WHEP / `closeWhep` / HLS 与 WHIP 互斥逻辑。`attachVideo` 仍先 `closeWhep()`。

- [x] **Step 2: 跑完整延迟契约**

Run: `npx vitest run tests/hls-latency-contract.test.ts tests/electron-renderer-webrtc-contract.test.ts tests/operator-console-contract.test.ts`

Expected: 全部通过。契约锁定 `lowLatencyMode: true`。

---

### Task 3: 回归与真机验收

**Files:** 无新文件。

- [ ] **Step 1: 跑相关桌面测试**

Run: `npx vitest run tests/hls-latency-contract.test.ts tests/electron-renderer-webrtc-contract.test.ts tests/operator-console-contract.test.ts tests/media-pipeline-contract.test.ts tests/operation-workflow-contract.test.ts`

Expected: PASS。`media-pipeline` 不应被本计划改到。

- [ ] **Step 2: 真机对照（人工，不自动化）**

1. 电脑和手机同一 Wi-Fi。不要同时点「启动低延迟图传」。
2. 只点「启动图传」，等 HLS ready 后附着播放器。
3. 对秒表或手机秒表：飞机镜头对准，电脑画面应在约 3–5 秒内跟上。
4. 摇一下飞机或挡一下镜头，确认没有花屏接头；若花屏，先查是否误加了 `split_by_time`。
5. 弱网下允许短暂卡顿后 1.2 倍速追赶。
6. 再单独测一次 WHIP，确认旧路参数没有碰到低延迟旁路。

记录实测秒数。若稳定 >5 秒，下一轮再查 DJI GOP，不在本计划加转码。

---

## 明确不做

- LL-HLS / CMAF / fMP4 / `#EXT-X-PART`
- 重编码视频
- 改手机 RTMP 命令或质量档
- 删 WHIP 或旧按钮
- 把播放器缓冲降到 0 个分片（`liveSyncDurationCount: 0` 在经典 HLS 上会频繁卡死）
- 把 `gop_cache` 或 `lowLatencyMode` 改成 `false`
- 加 `-flags low_delay` 或 `-hls_allow_cache 0`

## 回退

把 FFmpeg / hls.js 缓冲参数改回切片前的数组即可。`gop_cache: true` 与 `lowLatencyMode: true` 本来就要留下，不是回退项。不涉及数据迁移。
