import { describe, expect, it } from "vitest";

const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/modules/live-stream-control/stream-protocol-config/index.ts", import.meta.url), "utf8"));
const contract = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/modules/live-stream-control/stream-protocol-config/CONTRACT.md", import.meta.url), "utf8"));

describe("stream-protocol-config 架构契约", () => {
  it("拥有中文契约并只暴露 RTMP 目标构造接口", () => {
    expect(contract).toContain("唯一职责");
    expect(contract).toContain("createRtmpTarget");
    expect(source).toContain("export const StreamProtocolConfig");
  });

  it("不依赖平台、媒体、网络或兄弟模块实现", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/node:|electron|ffmpeg|websocket|media-pipeline|relay-link|device-console/i);
  });
});
