import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IncidentJournal, sanitizeDetail, wrapGateway, wrapPhoneDiagnostics } from "../src/production/electron-host/incident-journal.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("事故日志", () => {
  it("脱敏路径、口令和 URL 查询，并截断超长详情", () => {
    expect(sanitizeDetail("token=secret C:\\Users\\a\\secret ws://user:pass@host/path?x=1")).toContain("[REDACTED]");
    expect(sanitizeDetail("a".repeat(600)).length).toBe(512);
  });

  it("把操作台拦住的动作和手机诊断写进同一份事故文件", () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    const recorded: unknown[] = [];
    const gateway = wrapGateway({
      invoke: async () => ({ ok: true as const, value: { phase: "running" } }),
      snapshot: () => ({}),
      subscribe: () => () => undefined,
      dispose: () => undefined,
    }, journal);
    const sink = wrapPhoneDiagnostics({ persist: (input) => { recorded.push(input); return true; } }, journal);

    return Promise.resolve().then(async () => {
      await expect(gateway.invoke("diagnostics.record", { action: "mission-start", reason: "等待飞机" })).resolves.toEqual({ ok: true, value: true });
      await expect(gateway.invoke("state.snapshot", undefined)).resolves.toMatchObject({ ok: true });
      expect(sink.persist({
        deviceId: "phone-1",
        runId: "run-1",
        events: [{ sequence: 1, timestampMillis: 0, level: "WARN", module: "wayline-mission", eventCode: "WAYLINE_UPLOAD_REJECTED", operationId: "cmd-1", safeDetail: "wayline.upload Aircraft is not connected" }],
      })).toBe(true);
      const log = readFileSync(journal.logPath, "utf8");
      expect(log).toContain("CONSOLE_BLOCKED");
      expect(log).toContain("mission-start");
      expect(log).not.toContain("state.snapshot");
      expect(log).toContain("WAYLINE_UPLOAD_REJECTED");
      expect(recorded).toHaveLength(1);
    });
  });

  it("命令超时记为下行 WARN，刷新图传不写日志", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    const gateway = wrapGateway({
      invoke: async (method) => method === "mission.start"
        ? { ok: true as const, value: { ok: true, value: { status: "timed-out", detail: "Command timed out" } } }
        : { ok: true as const, value: true },
      snapshot: () => ({}),
      subscribe: () => () => undefined,
      dispose: () => undefined,
    }, journal);
    await gateway.invoke("mission.start", { deviceId: "phone-1" });
    await gateway.invoke("stream.refresh", undefined);
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toContain("MISSION_START_TIMED_OUT");
    expect(log).toContain("downlink");
    expect(log).not.toContain("STREAM_REFRESH");
  });
});
