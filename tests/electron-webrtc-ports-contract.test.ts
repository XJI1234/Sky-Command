import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createMediaMtxProcessPort, createMediaPathPort, createWhepPlaybackBridge } from "../src/production/electron-host/webrtc-ports.js";

describe("Electron 低延迟端口", () => {
  it("用私有临时配置启动 MediaMTX，并让终止和退出回调只发生一次", () => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    let killed = 0;
    const child = {
      killed: false,
      on: (event: string, listener: (...args: unknown[]) => void) => { listeners[event] = listener; return child; },
      kill: () => { killed += 1; child.killed = true; listeners.exit?.(0); return true; },
    };
    let spawned: { readonly executablePath: string; readonly args: readonly string[] } | null = null;
    const port = createMediaMtxProcessPort({
      spawn: (executablePath, args) => { spawned = { executablePath, args }; return child; },
    });
    const exits: unknown[] = [];
    const handle = port.launch({ executablePath: "D:/private-mediamtx.exe", config: "api: yes\npath: secret" }, (event) => exits.push(event));

    expect(spawned?.executablePath).toBe("D:/private-mediamtx.exe");
    expect(spawned?.args).toHaveLength(1);
    const configPath = spawned?.args[0];
    expect(typeof configPath).toBe("string");
    if (typeof configPath !== "string") return;
    expect(readFileSync(configPath, "utf8")).toContain("api: yes");
    expect(exits).toEqual([]);
    handle.terminate();
    handle.terminate();
    expect(killed).toBe(1);
    expect(exits).toEqual([{ kind: "exited" }]);
    expect(existsSync(configPath)).toBe(false);
    expect(JSON.stringify(exits)).not.toContain("private-mediamtx");
  });

  it("只把 MediaMTX API 返回的合法 live path 交给路径观察器", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: [
        { name: "live/drone-a" },
        { name: "/live/drone%20b" },
        { name: "live/bad/path" },
        { name: "other/drone-c" },
        { name: "live/%2e%2e" },
        { name: 7 },
      ] }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("测试 API 未监听端口");
    try {
      const port = createMediaPathPort({ apiPort: address.port });
      await expect(port.listPaths()).resolves.toEqual(["/live/drone-a", "/live/drone%20b"]);
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("用代次隔离 WHEP 首帧和致命事件，并通过固定频道通知渲染器", () => {
    const sent: Array<Readonly<{ readonly channel: string; readonly payload: unknown }>> = [];
    const bridge = createWhepPlaybackBridge((channel, payload) => { sent.push({ channel, payload }); });
    const ready: string[] = [];
    const fatal: string[] = [];
    bridge.port.setTarget({ deviceId: "drone-a", url: "http://127.0.0.1:8890/live/drone-a/whep" }, () => ready.push("a"), () => fatal.push("a"));
    const firstGeneration = (sent[0]?.payload as { generation: number }).generation;
    bridge.ready({ generation: firstGeneration });
    expect(ready).toEqual(["a"]);

    bridge.port.setTarget({ deviceId: "drone-b", url: "http://127.0.0.1:8890/live/drone-b/whep" }, () => ready.push("b"), () => fatal.push("b"));
    const secondGeneration = (sent[1]?.payload as { generation: number }).generation;
    bridge.fatal({ generation: firstGeneration });
    expect(fatal).toEqual([]);
    bridge.fatal({ generation: secondGeneration });
    expect(fatal).toEqual(["b"]);
    bridge.port.clear();
    bridge.ready({ generation: secondGeneration });
    expect(ready).toEqual(["a"]);
    expect(sent.map((item) => item.channel)).toEqual(["webrtc-player-select", "webrtc-player-select", "webrtc-player-clear"]);
  });
});
