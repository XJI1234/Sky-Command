import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IncidentJournal, sanitizeDetail, watchApplication, wrapGateway, wrapPhoneDiagnostics } from "../src/production/electron-host/incident-journal.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("事故日志", () => {
  it("没有待写记录时刷新立即完成", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);

    await expect(journal.flush()).resolves.toBeUndefined();
  });

  it("诊断积压满时保留新的错误并报告被丢弃的普通记录", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    for (let index = 0; index < 513; index += 1) {
      journal.record({ link: "uplink", level: "INFO", event: `SAMPLE_${index}`, detail: "normal fact" });
    }
    journal.record({ link: "uplink", level: "ERROR", event: "IMPORTANT_FAILURE", detail: "must remain visible" });

    await journal.flush();

    const lines = readFileSync(journal.logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(513);
    expect(lines.some((line) => line.includes("IMPORTANT_FAILURE"))).toBe(true);
    expect(lines.find((line) => line.includes("IMPORTANT_FAILURE"))).toContain("dropped=1");
    expect(lines.some((line) => line.includes("SAMPLE_0"))).toBe(true);
    expect(lines.some((line) => /\bSAMPLE_1\b/.test(line))).toBe(false);
  });

  it("在错误详情达到上限时仍保留普通日志的丢弃计数", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    for (let index = 0; index < 513; index += 1) {
      journal.record({ link: "uplink", level: "INFO", event: `SAMPLE_${index}`, detail: "normal fact" });
    }
    journal.record({ link: "uplink", level: "ERROR", event: "IMPORTANT_FAILURE", detail: "x".repeat(600) });

    await journal.flush();

    const important = readFileSync(journal.logPath, "utf8").split("\n").find((line) => line.includes("IMPORTANT_FAILURE"));
    expect(important).toContain("dropped=1");
  });

  it("在调用者不直接写文件时刷出已排队的事故记录", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    journal.record({ link: "phone-pc", level: "WARN", event: "RELAY_INTERRUPTED", detail: "Phone session ended" });

    await journal.flush();

    expect(readFileSync(journal.logPath, "utf8")).toContain("RELAY_INTERRUPTED");
  });

  it("脱敏路径、口令和 URL 查询，并截断超长详情", () => {
    expect(sanitizeDetail("token=secret C:\\Users\\a\\secret ws://user:pass@host/path?x=1")).toContain("[REDACTED]");
    expect(sanitizeDetail("a".repeat(600)).length).toBe(512);
  });

  it("把操作台拦住的动作和手机诊断写进同一份事故文件", async () => {
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
    const sink = wrapPhoneDiagnostics({ persist: async (input) => { recorded.push(input); return true; } }, journal);

    await expect(gateway.invoke("diagnostics.record", { action: "mission-start", reason: "等待飞机" })).resolves.toEqual({ ok: true, value: true });
    await expect(gateway.invoke("state.snapshot", undefined)).resolves.toMatchObject({ ok: true });
    await expect(sink.persist({
      deviceId: "phone-1",
      runId: "run-1",
      events: [{ sequence: 1, timestampMillis: 0, level: "WARN", module: "wayline-mission", eventCode: "WAYLINE_UPLOAD_REJECTED", operationId: "cmd-1", safeDetail: "wayline.upload Aircraft is not connected" }],
    })).resolves.toBe(true);
    await journal.flush();
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toContain("CONSOLE_BLOCKED");
    expect(log).toContain("mission-start");
    expect(log).not.toContain("state.snapshot");
    expect(log).toContain("WAYLINE_UPLOAD_REJECTED");
    expect(recorded).toHaveLength(1);
  });

  it("命令超时记为上行 WARN，渲染器高频图传轮询不写日志", async () => {
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
    await gateway.invoke("stream-refresh", undefined);
    await gateway.invoke("video-playback", { deviceId: "phone-1" });
    await gateway.invoke("video.playback", { deviceId: "phone-1" });
    await journal.flush();
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toContain("MISSION_START_TIMED_OUT");
    expect(log).toContain("uplink");
    expect(log).not.toContain("STREAM_REFRESH");
    expect(log).not.toContain("VIDEO_PLAYBACK");
  });

  it("把嵌套的任务失败记为上行 WARN，而不是成功", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    const gateway = wrapGateway({
      invoke: async () => ({
        ok: true as const,
        value: {
          ok: true,
          value: { ok: false, operation: "upload", code: "WAYLINE_UPLOAD_FAILED", state: null },
        },
      }),
      snapshot: () => ({}),
      subscribe: () => () => undefined,
      dispose: () => undefined,
    }, journal);

    await gateway.invoke("mission.upload", { deviceId: "phone-1" });

    await journal.flush();
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toMatch(/WARN uplink MISSION_UPLOAD_WAYLINE_UPLOAD_FAILED/);
    expect(log).toContain("WAYLINE_UPLOAD_FAILED");
  });

  it("把 DJI 拒绝航线启动的错误码和说明写入事故日志", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    const gateway = wrapGateway({
      invoke: async () => ({
        ok: true as const,
        value: {
          ok: false,
          operation: "start",
          code: "WAYLINE_ACTION_REJECTED",
          platformError: { code: "WAYPOINT_MISSION_BUSY", description: "The mission manager is busy" },
        },
      }),
      snapshot: () => ({}),
      subscribe: () => () => undefined,
      dispose: () => undefined,
    }, journal);

    await gateway.invoke("mission.start", { deviceId: "phone-1", confirmationId: "confirm-1" });

    await journal.flush();
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toMatch(/WARN uplink MISSION_START_WAYLINE_ACTION_REJECTED/);
    expect(log).toContain("djiErrorCode=WAYPOINT_MISSION_BUSY");
    expect(log).toContain("djiErrorDescription=The mission manager is busy");
  });

  it("把低延迟控制记为下行，并忽略低延迟周期刷新", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    const gateway = wrapGateway({
      invoke: async (method) => method === "webrtc.start"
        ? { ok: true as const, value: { ok: true, value: { phase: "running" } } }
        : { ok: true as const, value: true },
      snapshot: () => ({}),
      subscribe: () => () => undefined,
      dispose: () => undefined,
    }, journal);
    await gateway.invoke("webrtc.start", undefined);
    await gateway.invoke("webrtc.refresh", undefined);
    await journal.flush();
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toContain("WEBRTC_START_OK");
    expect(log).toContain("downlink");
    expect(log).not.toContain("WEBRTC_REFRESH");
  });

  it("把图传画面变化记为下行，把任务阶段记为上行", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    let listener: ((snapshot: unknown) => void) | undefined;
    const stop = watchApplication({
      snapshot: () => ({
        workflow: { devices: [{ deviceId: "phone-1", mission: { phase: "idle" }, stream: { phase: "idle" }, video: { phase: "idle" } }] },
        runtime: { media: { streams: [{ deviceId: "phone-1", phase: "idle" }] } }
      }),
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      }
    }, journal);
    listener?.({
      workflow: { devices: [{ deviceId: "phone-1", mission: { phase: "running" }, stream: { phase: "live" }, video: { phase: "playing" } }] },
      runtime: { media: { streams: [{ deviceId: "phone-1", phase: "publisher-ready" }] } }
    });
    await journal.flush();
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toMatch(/uplink MISSION_RUNNING/);
    expect(log).toMatch(/downlink STREAM_LIVE/);
    expect(log).toMatch(/downlink VIDEO_PLAYING/);
    expect(log).toMatch(/downlink MEDIA_PUBLISHER_READY/);
    stop();
  });

  it("把航线中断原因和当前航点记为上行", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    let listener: ((snapshot: unknown) => void) | undefined;
    const stop = watchApplication({
      snapshot: () => ({
        workflow: {
          devices: [{
            deviceId: "phone-1",
            connection: { missionExecution: "EXECUTING", missionDjiExecutionState: "EXECUTING", currentWaypointIndex: 11 },
            mission: { phase: "running" },
            stream: { phase: "idle" },
            video: { phase: "idle" },
          }],
        },
        runtime: {},
      }),
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    }, journal);
    listener?.({
      workflow: {
        devices: [{
          deviceId: "phone-1",
          connection: {
            missionExecution: "FAILED",
            missionDjiExecutionState: "INTERRUPTED",
            currentWaypointIndex: 12,
            waylineInterruptErrorCode: "RC_PAUSE_STOP",
            waylineInterruptErrorDescription: "flight pause",
          },
          mission: { phase: "failed" },
          stream: { phase: "idle" },
          video: { phase: "idle" },
        }],
      },
      runtime: {},
    });
    await journal.flush();
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toMatch(/uplink MISSIONDJIEXECUTIONSTATE_INTERRUPTED/);
    expect(log).toMatch(/uplink WAYLINE_WAYPOINT_12/);
    expect(log).toMatch(/WARN uplink WAYLINE_INTERRUPT/);
    expect(log).toContain("djiErrorCode=RC_PAUSE_STOP");
    expect(log).toContain("djiErrorDescription=flight pause");
    stop();
  });

  it("把手机任务执行状态和 DJI 原始航线状态记为上行", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    let listener: ((snapshot: unknown) => void) | undefined;
    const stop = watchApplication({
      snapshot: () => ({
        workflow: {
          devices: [{
            deviceId: "phone-1",
            connection: { missionExecution: "NOT_STARTED", missionDjiExecutionState: "READY" },
            mission: { phase: "uploaded" },
            stream: { phase: "idle" },
            video: { phase: "idle" },
          }],
        },
        runtime: {},
      }),
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    }, journal);
    listener?.({
      workflow: {
        devices: [{
          deviceId: "phone-1",
          connection: { missionExecution: "STARTING", missionDjiExecutionState: "ENTER_WAYLINE" },
          mission: { phase: "starting" },
          stream: { phase: "idle" },
          video: { phase: "idle" },
        }],
      },
      runtime: {},
    });
    await journal.flush();
    const log = readFileSync(journal.logPath, "utf8");
    expect(log).toMatch(/uplink MISSIONEXECUTION_STARTING/);
    expect(log).toMatch(/uplink MISSIONDJIEXECUTIONSTATE_ENTER_WAYLINE/);
    stop();
  });

  it("连接类事实需连续两次一致才落盘，unknown 不写 WARN", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-incident-"));
    directories.push(directory);
    const journal = IncidentJournal.create(directory);
    let listener: ((snapshot: unknown) => void) | undefined;
    const device = (aircraft: string) => ({
      deviceId: "phone-1",
      connection: { sdk: "ready", remoteController: "connected", flightController: "connected", aircraft, pairingState: "PAIRED" },
      mission: { phase: "idle" },
      stream: { phase: "idle" },
      video: { phase: "idle" },
    });
    const stop = watchApplication({
      snapshot: () => ({ workflow: { devices: [device("connected")] }, runtime: {} }),
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    }, journal);
    listener?.({ workflow: { devices: [device("disconnected")] }, runtime: {} });
    await journal.flush();
    expect(readFileSync(journal.logPath, "utf8")).not.toContain("AIRCRAFT_DISCONNECTED");
    listener?.({ workflow: { devices: [device("disconnected")] }, runtime: {} });
    await journal.flush();
    expect(readFileSync(journal.logPath, "utf8")).toContain("AIRCRAFT_DISCONNECTED");
    listener?.({ workflow: { devices: [device("unknown")] }, runtime: {} });
    await journal.flush();
    expect(readFileSync(journal.logPath, "utf8")).not.toMatch(/WARN .*AIRCRAFT_UNKNOWN/);
    stop();
  });
});
