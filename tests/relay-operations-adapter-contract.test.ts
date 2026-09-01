import { describe, expect, it } from "vitest";
import { RelayOperationsAdapter } from "../src/production/relay-operations-adapter/index.js";

type JsonValue =
  | Readonly<{ readonly kind: "null" }>
  | Readonly<{ readonly kind: "string"; readonly value: string }>
  | Readonly<{ readonly kind: "number"; readonly value: string }>
  | Readonly<{ readonly kind: "boolean"; readonly value: boolean }>
  | Readonly<{ readonly kind: "object"; readonly fields: Readonly<Record<string, JsonValue>> }>;

const text = (value: string): JsonValue => Object.freeze({ kind: "string" as const, value });
const bool = (value: boolean): JsonValue => Object.freeze({ kind: "boolean" as const, value });
const numeric = (value: string): JsonValue => Object.freeze({ kind: "number" as const, value });
const nil: JsonValue = Object.freeze({ kind: "null" as const });
const object = (fields: Readonly<Record<string, JsonValue>>): JsonValue => Object.freeze({ kind: "object" as const, fields: Object.freeze({ ...fields }) });

function relayFixture() {
  const sent: unknown[] = [];
  let ingress: unknown = null;
  let ingressThrows = false;
  let current = Object.freeze({
    state: "listening" as const,
    endpoint: Object.freeze({ host: "0.0.0.0", port: 9000 }),
    devices: Object.freeze([Object.freeze({ deviceId: "relay-1", sessionId: "session-1" })]),
    telemetry: Object.freeze([Object.freeze({
      deviceId: "relay-1",
      sessionId: "session-1",
      receivedAtMs: 1_725_000_000_000,
      payload: object({
        sdkAvailability: text("READY"),
        remoteController: text("CONNECTED"),
        flightController: text("CONNECTED"),
        aircraft: text("CONNECTED"),
        airLink: text("CONNECTED"),
        camera: text("CONNECTED"),
        isFlying: bool(false),
        motorsOn: bool(false),
        batteryPercent: Object.freeze({ kind: "number" as const, value: "87" })
      }),
      capabilities: object({
        liveVideo: bool(true),
        waypointMission: bool(true),
        waypointMissionSupport: text("SUPPORTED")
      })
    })]),
    missionPhases: Object.freeze([]),
    pendingCommands: Object.freeze([]),
    pendingMissions: Object.freeze([])
  });
  const listeners = new Set<(snapshot: typeof current) => void>();
  const relay = {
    devices: () => current.devices,
    latestTelemetry: (deviceId: string) => current.telemetry.find((item) => item.deviceId === deviceId) ?? null,
    ingressAddress: () => { if (ingressThrows) throw new Error("socket metadata unavailable"); return ingress; },
    sendMission: async (_deviceId: string, payload: unknown) => Object.freeze({ deviceId: "relay-1", missionId: (payload as { missionId: string }).missionId, status: "succeeded" as const, detail: "accepted" }),
    sendCommand: async (deviceId: string, request: unknown) => {
      sent.push(Object.freeze({ deviceId, request }));
      return Object.freeze({ deviceId, commandId: "command-1", status: "succeeded" as const, detail: "accepted" });
    },
    subscribe: (listener: (snapshot: typeof current) => void) => { listeners.add(listener); return () => listeners.delete(listener); }
  };
  return {
    relay,
    sent,
    replaceTelemetry: (payload: JsonValue, capabilities: JsonValue) => {
      current = Object.freeze({ ...current, telemetry: Object.freeze([Object.freeze({ deviceId: "relay-1", sessionId: "session-1", payload, capabilities })]) });
      for (const listener of [...listeners]) listener(current);
    },
    setIngress: (value: unknown, throws = false) => { ingress = value; ingressThrows = throws; },
  };
}

describe("RelayOperationsAdapter", () => {
  it("将 Android 遥测枚举投影为桌面业务模块需要的受限事实", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });

    expect(adapter.telemetry("relay-1")).toEqual({
      deviceId: "relay-1",
      receivedAtMs: 1_725_000_000_000,
      payload: {
        sdkAvailability: "READY",
        sdkRegistered: true,
        remoteController: "CONNECTED",
        flightController: "CONNECTED",
        aircraft: "CONNECTED",
        airLink: "CONNECTED",
        camera: "CONNECTED",
        remoteControllerConnected: true,
        flightControllerConnected: true,
        connected: true,
        isFlying: false,
        motorsOn: false,
        batteryPercent: 87
      },
      capabilities: {
        liveVideo: true,
        waypointMission: true,
        waypointMissionSupport: "supported"
      }
    });
    expect(adapter.devices()).toEqual([{ deviceId: "relay-1", sessionId: "session-1" }]);
  });

  it("一对一保留 MSDK 连接 Key 的未知状态，不将其折叠成兼容布尔值", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });

    fixture.replaceTelemetry(object({
      sdkAvailability: text("STARTING"),
      remoteController: text("UNKNOWN"),
      flightController: text("DISCONNECTED"),
      aircraft: text("CONNECTED"),
      airLink: text("DISCONNECTED"),
      camera: text("UNKNOWN"),
      pairing: text("UNKNOWN"),
    }), object({}));

    expect(adapter.telemetry("relay-1")?.payload).toEqual({
      sdkAvailability: "STARTING",
      sdkRegistered: false,
      remoteController: "UNKNOWN",
      flightController: "DISCONNECTED",
      flightControllerConnected: false,
      aircraft: "CONNECTED",
      connected: true,
      airLink: "DISCONNECTED",
      camera: "UNKNOWN",
      pairing: "UNKNOWN",
      pairingState: "UNKNOWN",
    });
  });

  it("投影设备页所需的已验证飞机与当前图传事实", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });
    fixture.replaceTelemetry(
      object({
        aircraftModel: text("Matrice 4T"),
        remoteControllerModel: text("DJI RC Plus"),
        flightMode: text("GPS_NORMAL"),
        lowBatteryRthState: text("IDLE"),
        remainingFlightTimeSeconds: numeric("1085"),
        liveStreaming: bool(true),
        liveResolution: text("1920x1080"),
        liveFps: numeric("29.97"),
        liveVideoBitrateKbps: numeric("1802"),
        liveRttMillis: numeric("42"),
        livePacketLoss: numeric("6"),
        livePacketCacheLength: numeric("108"),
      }),
      object({}),
    );

    expect(adapter.telemetry("relay-1")?.payload).toEqual({
      aircraftModel: "Matrice 4T",
      remoteControllerModel: "DJI RC Plus",
      flightMode: "GPS_NORMAL",
      lowBatteryRthState: "IDLE",
      remainingFlightTimeSeconds: 1085,
      liveStreaming: true,
      liveResolution: "1920x1080",
      liveFps: 29.97,
      liveVideoBitrateKbps: 1802,
      liveRttMillis: 42,
      livePacketLoss: 6,
      livePacketCacheLength: 108,
    });
  });

  it("丢弃畸形图传指标，并在未直播时清除可能陈旧的图传细节", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });
    fixture.replaceTelemetry(
      object({
        aircraftModel: text(" "),
        remoteControllerModel: text("DJI\u0000 RC"),
        flightMode: text(" "),
        lowBatteryRthState: text("UNKNOWN"),
        remainingFlightTimeSeconds: numeric("0"),
        liveStreaming: bool(true),
        liveResolution: text("\u0000"),
        liveFps: numeric("240.1"),
        liveVideoBitrateKbps: numeric("100000.1"),
        liveRttMillis: numeric("1.5"),
      }),
      object({}),
    );
    expect(adapter.telemetry("relay-1")?.payload).toEqual({ liveStreaming: true });

    fixture.replaceTelemetry(
      object({
        liveStreaming: bool(false),
        liveResolution: text("1920x1080"),
        liveFps: numeric("30"),
        liveVideoBitrateKbps: numeric("1802"),
        liveRttMillis: numeric("42"),
      }),
      object({}),
    );
    expect(adapter.telemetry("relay-1")?.payload).toEqual({ liveStreaming: false });
  });

  it("only exposes a valid private relay ingress address to the stream command gateway", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });
    fixture.setIngress("172.20.10.12");
    expect(adapter.streamGateway().ingressAddress?.("relay-1")).toBe("172.20.10.12");
    expect(adapter.streamGateway().ingressAddress?.("missing")).toBeNull();

    for (const value of ["8.8.8.8", "999.20.10.12", null]) {
      fixture.setIngress(value);
      expect(adapter.streamGateway().ingressAddress?.("relay-1")).toBeNull();
    }
    fixture.setIngress(null, true);
    expect(adapter.streamGateway().ingressAddress?.("relay-1")).toBeNull();
  });

  it("透传经校验的位姿和配对状态，且高度不受 0..100 电池解析器限制", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });
    fixture.replaceTelemetry(
      object({
        sdkAvailability: text("READY"),
        pairing: text("PAIRED"),
        batteryPercent: Object.freeze({ kind: "number" as const, value: "87" }),
        altitudeMeters: Object.freeze({ kind: "number" as const, value: "250.5" }),
        latitude: Object.freeze({ kind: "number" as const, value: "31.2" }),
        longitude: Object.freeze({ kind: "number" as const, value: "-122.4" })
      }),
      object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") })
    );

    expect(adapter.telemetry("relay-1")).toMatchObject({
      payload: {
        pairingState: "PAIRED",
        batteryPercent: 87,
        altitudeMeters: 250.5,
        latitude: 31.2,
        longitude: -122.4
      }
    });
  });

  it("成对保留合法坐标，丢弃越界、残缺或非有限位姿，且不把 JSON null 当成 0", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });
    fixture.replaceTelemetry(
      object({
        pairing: text("UNKNOWN_STATE"),
        altitudeMeters: Object.freeze({ kind: "number" as const, value: "1e500" }),
        latitude: Object.freeze({ kind: "number" as const, value: "91" }),
        longitude: Object.freeze({ kind: "number" as const, value: "0" })
      }),
      object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") })
    );
    expect(adapter.telemetry("relay-1")).toEqual({
      deviceId: "relay-1",
      receivedAtMs: null,
      payload: {},
      capabilities: { liveVideo: true, waypointMission: true, waypointMissionSupport: "supported" }
    });

    fixture.replaceTelemetry(
      object({
        pairing: text("IDLE"),
        altitudeMeters: nil,
        latitude: Object.freeze({ kind: "number" as const, value: "30" }),
        longitude: nil
      }),
      object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") })
    );
    expect(adapter.telemetry("relay-1")).toMatchObject({
      payload: { pairingState: "IDLE" }
    });
    expect(adapter.telemetry("relay-1")?.payload).not.toHaveProperty("latitude");
    expect(adapter.telemetry("relay-1")?.payload).not.toHaveProperty("longitude");
    expect(adapter.telemetry("relay-1")?.payload).not.toHaveProperty("altitudeMeters");

    fixture.replaceTelemetry(
      object({
        altitudeMeters: Object.freeze({ kind: "number" as const, value: "-12.5" }),
        latitude: Object.freeze({ kind: "number" as const, value: "30" }),
        longitude: Object.freeze({ kind: "number" as const, value: "181" })
      }),
      object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") })
    );
    expect(adapter.telemetry("relay-1")?.payload).toEqual({ altitudeMeters: -12.5 });

    fixture.replaceTelemetry(
      object({
        latitude: Object.freeze({ kind: "number" as const, value: "-91" }),
        longitude: Object.freeze({ kind: "number" as const, value: "0" })
      }),
      object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") })
    );
    expect(adapter.telemetry("relay-1")?.payload).toEqual({});

    fixture.replaceTelemetry(
      object({
        latitude: Object.freeze({ kind: "number" as const, value: "90" }),
        longitude: Object.freeze({ kind: "number" as const, value: "-180" })
      }),
      object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") })
    );
    expect(adapter.telemetry("relay-1")?.payload).toEqual({ latitude: 90, longitude: -180 });

    fixture.replaceTelemetry(
      object({
        latitude: Object.freeze({ kind: "number" as const, value: "-90" }),
        longitude: Object.freeze({ kind: "number" as const, value: "180" })
      }),
      object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") })
    );
    expect(adapter.telemetry("relay-1")?.payload).toEqual({ latitude: -90, longitude: 180 });
  });

  it("将 pairing.status 的结构化 result 原样交给配对端口", async () => {
    const result = object({
      pairingState: text("PAIRED"),
      aircraftConnected: bool(true),
      flightControllerConnected: bool(true),
      aircraftModel: text("DJI Mini 4 Pro"),
      motorsOn: bool(false),
      sdkRegistered: bool(true)
    });
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [],
      latestTelemetry: () => null,
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async () => ({ status: "succeeded", detail: "ok", result })
    } });

    await expect(adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.status", fields: {} })).resolves.toEqual({
      status: "accepted",
      detail: "succeeded",
      result
    });
  });

  it("pairing.status 失败时不附带结构化 result，且桌面不得下发 pairing.start/stop", async () => {
    const result = object({ pairingState: text("PAIRED") });
    const sent: string[] = [];
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [],
      latestTelemetry: () => null,
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async (_deviceId: string, request: { readonly name: string }) => {
        sent.push(request.name);
        return request.name === "pairing.status"
          ? { status: "rejected", detail: "unavailable", result }
          : { status: "succeeded", detail: "ok", result };
      }
    } });

    await expect(adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.status", fields: {} })).resolves.toEqual({
      status: "rejected",
      detail: "rejected"
    });
    await expect(adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.start", fields: {} })).resolves.toEqual({
      status: "rejected",
      detail: "请到手机上开始或停止对频。"
    });
    await expect(adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.stop", fields: {} })).resolves.toEqual({
      status: "rejected",
      detail: "请到手机上开始或停止对频。"
    });
    expect(sent).toEqual(["pairing.status"]);
  });

  it("通过 telemetry.read 请求一次遥测刷新，成功不代表链路已就绪", async () => {
    const sent: unknown[] = [];
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [],
      latestTelemetry: () => null,
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async (deviceId: string, request: unknown) => {
        sent.push(Object.freeze({ deviceId, request }));
        return Object.freeze({ status: "succeeded" as const, detail: "accepted" });
      }
    } });
    await expect(adapter.refreshTelemetry("relay-1")).resolves.toEqual({ status: "succeeded" });
    expect(sent).toEqual([{ deviceId: "relay-1", request: { name: "telemetry.read", fields: {} } }]);
    expect(adapter.telemetry("relay-1")).toBeNull();
  });

  it("未注入时钟时使用系统时钟记录 telemetry.read 的当前会话观察", async () => {
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [{ deviceId: "relay-1", sessionId: "session-1" }],
      latestTelemetry: () => null,
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async () => ({ status: "succeeded", result: object({
        deviceRevision: numeric("1"), sdkAvailability: text("READY"), remoteController: text("CONNECTED"), flightController: text("CONNECTED"), aircraft: text("CONNECTED"), capabilities: object({}),
      }) }),
    } });

    await expect(adapter.refreshTelemetry("relay-1")).resolves.toMatchObject({ status: "succeeded" });
    expect(adapter.controlTelemetry("relay-1")?.receivedAtMs).toEqual(expect.any(Number));
  });

  it("让显示与门禁共同使用当前会话的 MSDK 观察，稳定事实不因时间流逝失效", async () => {
    let sessionId = "session-1";
    let now = 1_000;
    let rawTelemetry: unknown = null;
    const result = object({
      deviceRevision: numeric("1"),
      sdkAvailability: text("READY"),
      remoteController: text("CONNECTED"),
      flightController: text("CONNECTED"),
      aircraft: text("CONNECTED"),
      isFlying: bool(false),
      motorsOn: bool(false),
      batteryPercent: numeric("80"),
      capabilities: object({ waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") }),
    });
    const adapter = RelayOperationsAdapter.create({
      relay: {
        devices: () => [{ deviceId: "relay-1", sessionId }],
        latestTelemetry: () => rawTelemetry,
        sendCommand: async () => ({ status: "succeeded" as const, result }),
      },
      now: () => now,
    } as never);

    await expect(adapter.refreshTelemetry("relay-1")).resolves.toMatchObject({ status: "succeeded" });
    const initial = adapter.telemetry("relay-1");
    expect(initial).toMatchObject({
      deviceId: "relay-1",
      receivedAtMs: 1_000,
      payload: {
        deviceRevision: 1,
        sdkRegistered: true,
        remoteControllerConnected: true,
        flightControllerConnected: true,
        connected: true,
        isFlying: false,
        motorsOn: false,
        batteryPercent: 80,
      },
      capabilities: { waypointMission: true, waypointMissionSupport: "supported" },
    });
    expect(adapter.controlTelemetry("relay-1")).toBe(initial);

    now += 86_400_000;
    expect(adapter.controlTelemetry("relay-1")).toBe(initial);

    rawTelemetry = {
      sessionId: "session-1",
      receivedAtMs: now + 1,
      payload: object({
        deviceRevision: numeric("2"),
        sdkAvailability: text("READY"),
        remoteController: text("CONNECTED"),
        flightController: text("DISCONNECTED"),
        aircraft: text("DISCONNECTED"),
        isFlying: bool(false),
        motorsOn: bool(false),
        batteryPercent: numeric("80"),
      }),
      capabilities: object({ waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") }),
    };
    const afterEvent = adapter.telemetry("relay-1");
    expect(afterEvent).toMatchObject({ payload: { deviceRevision: 2, flightController: "DISCONNECTED", aircraft: "DISCONNECTED" } });
    expect(adapter.controlTelemetry("relay-1")).toStrictEqual(afterEvent);

    sessionId = "session-2";
    expect(adapter.controlTelemetry("relay-1")).toBeNull();
  });

  it("同一会话的迟到完整遥测不能覆盖较新的 MSDK 状态", () => {
    let rawTelemetry: unknown = {
      sessionId: "session-1",
      receivedAtMs: 1_000,
      payload: object({
        telemetrySequence: numeric("11"),
        deviceRevision: numeric("7"),
        sdkAvailability: text("READY"),
        remoteController: text("CONNECTED"),
        flightController: text("CONNECTED"),
        aircraft: text("CONNECTED"),
        batteryPercent: numeric("80"),
      }),
      capabilities: object({ liveVideo: bool(true) }),
    };
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [{ deviceId: "relay-1", sessionId: "session-1" }],
      latestTelemetry: () => rawTelemetry,
    } });

    expect(adapter.telemetry("relay-1")).toMatchObject({ payload: { batteryPercent: 80 } });
    rawTelemetry = {
      sessionId: "session-1",
      receivedAtMs: 1_001,
      payload: object({
        telemetrySequence: numeric("12"),
        deviceRevision: numeric("7"),
        sdkAvailability: text("READY"),
        remoteController: text("CONNECTED"),
        flightController: text("CONNECTED"),
        aircraft: text("CONNECTED"),
        batteryPercent: numeric("81"),
      }),
      capabilities: object({ liveVideo: bool(true) }),
    };
    expect(adapter.telemetry("relay-1")).toMatchObject({ payload: { batteryPercent: 81 } });

    rawTelemetry = {
      sessionId: "session-1",
      receivedAtMs: 1_002,
      payload: object({
        telemetrySequence: numeric("11"),
        deviceRevision: numeric("7"),
        sdkAvailability: text("READY"),
        remoteController: text("CONNECTED"),
        flightController: text("CONNECTED"),
        aircraft: text("CONNECTED"),
        batteryPercent: numeric("1"),
      }),
      capabilities: object({ liveVideo: bool(true) }),
    };

    expect(adapter.telemetry("relay-1")).toMatchObject({ payload: { batteryPercent: 81 } });
  });

  it("本次 telemetry.read 结果畸形时不覆盖当前会话的已确认观察", async () => {
    let calls = 0;
    const complete = object({
      deviceRevision: numeric("1"),
      sdkAvailability: text("READY"),
      remoteController: text("CONNECTED"),
      flightController: text("CONNECTED"),
      aircraft: text("CONNECTED"),
      capabilities: object({ waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") }),
    });
    const incomplete = object({
      deviceRevision: numeric("2"),
      sdkAvailability: text("READY"),
      remoteController: text("CONNECTED"),
      flightController: text("CONNECTED"),
      capabilities: object({ waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") }),
    });
    const adapter = RelayOperationsAdapter.create({
      relay: {
        devices: () => [{ deviceId: "relay-1", sessionId: "session-1" }],
        latestTelemetry: () => null,
        sendCommand: async () => ({ status: "succeeded" as const, result: ++calls === 1 ? complete : incomplete }),
      },
      now: () => 1_000,
    } as never);

    await expect(adapter.refreshTelemetry("relay-1")).resolves.toMatchObject({ status: "succeeded" });
    const observed = adapter.controlTelemetry("relay-1");
    expect(observed).not.toBeNull();
    await expect(adapter.refreshTelemetry("relay-1")).resolves.toMatchObject({ status: "succeeded" });
    expect(adapter.controlTelemetry("relay-1")).toBe(observed);
  });

  it("序列缺失时仍按设备修订号拒绝同一会话的旧完整事实", () => {
    let revision = 2;
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [{ deviceId: "relay-1", sessionId: "session-1" }],
      latestTelemetry: () => ({
        sessionId: "session-1",
        payload: object({
          deviceRevision: numeric(String(revision)),
          sdkAvailability: text("READY"),
          remoteController: text("CONNECTED"),
          flightController: text("CONNECTED"),
          aircraft: text("CONNECTED"),
          batteryPercent: numeric(String(revision === 2 ? 80 : 1)),
        }),
        capabilities: object({ liveVideo: bool(true) }),
      }),
    } });

    expect(adapter.controlTelemetry("relay-1")).toMatchObject({ payload: { deviceRevision: 2, batteryPercent: 80 } });
    revision = 1;
    expect(adapter.controlTelemetry("relay-1")).toMatchObject({ payload: { deviceRevision: 2, batteryPercent: 80 } });
  });

  it("把读取时钟异常和畸形 telemetry.read 能力对象隔离为无控制快照", async () => {
    const clockFailure = RelayOperationsAdapter.create({
      relay: {
        devices: () => [{ deviceId: "relay-1", sessionId: "session-1" }],
        latestTelemetry: () => null,
        sendCommand: async () => ({ status: "succeeded", result: object({
          deviceRevision: numeric("1"), sdkAvailability: text("READY"), remoteController: text("CONNECTED"), flightController: text("CONNECTED"), aircraft: text("CONNECTED"), capabilities: object({}),
        }) }),
      },
      now: () => { throw new Error("clock unavailable"); },
    } as never);
    await expect(clockFailure.refreshTelemetry("relay-1")).resolves.toMatchObject({ status: "succeeded" });
    expect(clockFailure.controlTelemetry("relay-1")).toBeNull();

    const invalidClock = RelayOperationsAdapter.create({
      relay: {
        devices: () => [{ deviceId: "relay-1", sessionId: "session-1" }],
        latestTelemetry: () => null,
        sendCommand: async () => ({ status: "succeeded", result: object({
          deviceRevision: numeric("1"), sdkAvailability: text("READY"), remoteController: text("CONNECTED"), flightController: text("CONNECTED"), aircraft: text("CONNECTED"), capabilities: object({}),
        }) }),
      },
      now: () => Number.NaN,
    });
    await expect(invalidClock.refreshTelemetry("relay-1")).resolves.toMatchObject({ status: "succeeded" });
    expect(invalidClock.controlTelemetry("relay-1")).toBeNull();

    const malformedCapabilities = RelayOperationsAdapter.create({
      relay: {
        devices: () => [{ deviceId: "relay-1", sessionId: "session-1" }],
        latestTelemetry: () => null,
        sendCommand: async () => ({ status: "succeeded", result: object({
          deviceRevision: numeric("1"), sdkAvailability: text("READY"), remoteController: text("CONNECTED"), flightController: text("CONNECTED"), aircraft: text("CONNECTED"), capabilities: text("not-an-object"),
        }) }),
      },
    } as never);
    await expect(malformedCapabilities.refreshTelemetry("relay-1")).resolves.toMatchObject({ status: "succeeded" });
    expect(malformedCapabilities.controlTelemetry("relay-1")).toBeNull();
    await expect(malformedCapabilities.refreshTelemetry(" ")).resolves.toMatchObject({ status: "rejected" });
  });

  it("丢弃 telemetry.read 返回前已经更换会话的迟到控制快照", async () => {
    let sessionId = "session-1";
    let resolve!: (value: unknown) => void;
    const adapter = RelayOperationsAdapter.create({
      relay: {
        devices: () => [{ deviceId: "relay-1", sessionId }],
        latestTelemetry: () => null,
        sendCommand: async () => new Promise((done) => { resolve = done; }),
      },
      now: () => 1_000,
    } as never);

    const pending = adapter.refreshTelemetry("relay-1");
    sessionId = "session-2";
    resolve({
      status: "succeeded",
      result: object({
        sdkAvailability: text("READY"),
        remoteController: text("CONNECTED"),
        flightController: text("CONNECTED"),
        aircraft: text("CONNECTED"),
        capabilities: object({ waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") }),
      }),
    });

    await expect(pending).resolves.toMatchObject({ status: "succeeded" });
    expect(adapter.controlTelemetry("relay-1")).toBeNull();
  });

  it("保留经校验的任务终态和文件名，供任务控制安全对账", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });

    fixture.replaceTelemetry(
      object({
        sdkAvailability: text("READY"),
        remoteController: text("CONNECTED"),
        flightController: text("CONNECTED"),
        aircraft: text("CONNECTED"),
        missionExecution: text("FINISHED"),
        missionFileName: text("survey.kmz"),
        missionRevision: numeric("7"),
        missionDeviceGeneration: numeric("3"),
      }),
      object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") }),
    );

    expect(adapter.telemetry("relay-1")).toMatchObject({
      payload: {
        missionExecution: "FINISHED",
        missionFileName: "survey.kmz",
        missionRevision: 7,
        missionDeviceGeneration: 3,
      },
    });
  });

  it("完整转发当前任务的阶段代际事实，并丢弃无法进入任务状态机的不安全事实", () => {
    let publish: ((snapshot: unknown) => void) | undefined;
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [],
      latestTelemetry: () => null,
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async () => ({ status: "rejected" }),
      subscribe: (listener: (snapshot: unknown) => void) => {
        publish = listener;
        return () => undefined;
      },
    } });

    publish?.({
      missionPhases: [
        { deviceId: "relay-1", missionRevision: 3, deviceGeneration: 2, sequence: 7, phase: "ROUTE_EXECUTION_STARTED", fileName: "survey.kmz" },
        { deviceId: "relay-1", missionRevision: 3, deviceGeneration: 2, sequence: 8, phase: "ROUTE_EXECUTION_STARTED", fileName: "../unsafe.kmz" },
      ],
    });

    expect(adapter.snapshot().missionPhases).toEqual([
      { deviceId: "relay-1", missionRevision: 3, deviceGeneration: 2, sequence: 7, phase: "ROUTE_EXECUTION_STARTED", fileName: "survey.kmz" },
    ]);
  });

  it("将中继异常、超时、断连和畸形遥测收敛为稳定业务结果", async () => {
    const sent: string[] = [];
    let publish: ((snapshot: unknown) => void) | undefined;
    const payload = object({
      sdkAvailability: text("STARTING"),
      remoteController: text("DISCONNECTED"),
      flightController: text("DISCONNECTED"),
      aircraft: text("DISCONNECTED"),
      isFlying: bool(true),
      motorsOn: bool(true),
      batteryPercent: Object.freeze({ kind: "number" as const, value: "1e500" }),
      missionExecution: text("NOT_STARTED"),
      missionFileName: text("../unsafe.kmz"),
    });
    const capabilities = object({ liveVideo: bool(false), waypointMission: bool(false), waypointMissionSupport: text("UNSUPPORTED") });
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [{ deviceId: "relay-1" }, { deviceId: "relay-1" }, { deviceId: " " }],
      latestTelemetry: () => ({ payload, capabilities }),
      sendMission: async () => { throw new Error("offline"); },
      sendCommand: async (_deviceId: string, request: { readonly name: string }) => {
        sent.push(request.name);
        if (request.name === "wayline.upload") return { status: "timed-out" };
        if (request.name === "live-stream.stop") return { status: "disconnected" };
        if (request.name === "pairing.stop") return { status: "timed-out" };
        if (request.name === "flight.land") return { status: "transport-failed" };
        if (request.name === "device.settings.camera.read") return { status: "rejected", detail: "denied" };
        throw new Error("transport failure");
      },
      subscribe: (listener: (snapshot: unknown) => void) => {
        publish = listener;
        return () => { throw new Error("teardown failure"); };
      },
    } });

    expect(adapter.devices()).toEqual([{ deviceId: "relay-1" }]);
    expect(adapter.telemetry("relay-1")).toEqual({
      deviceId: "relay-1",
      receivedAtMs: null,
      payload: {
        sdkAvailability: "STARTING",
        sdkRegistered: false,
        remoteController: "DISCONNECTED",
        remoteControllerConnected: false,
        flightController: "DISCONNECTED",
        flightControllerConnected: false,
        aircraft: "DISCONNECTED",
        connected: false,
        isFlying: true,
        motorsOn: true,
        missionExecution: "NOT_STARTED",
      },
      capabilities: { liveVideo: false, waypointMission: false, waypointMissionSupport: "unsupported" },
    });
    expect((await adapter.missionGateway().sendCommand("relay-1", { name: "wayline.upload", fields: { confirm: true } })).status).toBe("timed-out");
    expect((await adapter.streamGateway().sendCommand("relay-1", { name: "live-stream.stop", fields: {} })).status).toBe("disconnected");
    expect((await adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.stop", fields: {} })).status).toBe("rejected");
    expect((await adapter.flightGateway().sendCommand("relay-1", { name: "flight.land", fields: { confirm: true } })).status).toBe("transport-failed");
    expect(await adapter.settingsGateway().sendCommand("relay-1", { name: "device.settings.camera.read", fields: {} })).toMatchObject({ status: "rejected", detail: "denied" });
    expect((await adapter.missionGateway().sendMission("relay-1", { missionId: "mission-1", fileName: "survey.kmz", size: 1, sha256: "a".repeat(64), bytes: new Uint8Array([1]) })).status).toBe("transport-failed");

    const received: unknown[] = [];
    adapter.subscribe(() => { throw new Error("listener failure"); });
    adapter.subscribe((snapshot) => received.push(snapshot));
    publish?.({ missionPhases: "invalid" });
    expect(received).toHaveLength(1);
    adapter.dispose();
    expect(sent).toEqual(["wayline.upload", "live-stream.stop", "flight.land", "device.settings.camera.read"]);
  });

  it("在中继端口缺失、抛出或返回畸形快照时保持本地故障隔离", async () => {
    const missing = RelayOperationsAdapter.create({ relay: {} });
    expect(missing.devices()).toEqual([]);
    expect(missing.telemetry("relay-1")).toBeNull();
    expect((await missing.streamGateway().sendCommand("relay-1", { name: "live-stream.stop", fields: {} })).status).toBe("rejected");
    missing.dispose();

    const throwing = RelayOperationsAdapter.create({ relay: {
      devices: () => { throw new Error("devices failed"); },
      latestTelemetry: () => { throw new Error("telemetry failed"); },
      sendMission: async () => ({ status: "unknown", detail: 1 }),
      sendCommand: async () => { throw new Error("command failed"); },
      subscribe: () => { throw new Error("subscription failed"); },
    } });
    expect(throwing.devices()).toEqual([]);
    expect(throwing.telemetry("relay-1")).toBeNull();
    expect((await throwing.missionGateway().sendMission("relay-1", { missionId: "mission-1", fileName: "survey.kmz", size: 1, sha256: "a".repeat(64), bytes: new Uint8Array([1]) })).status).toBe("transport-failed");
    expect((await throwing.flightGateway().sendCommand("relay-1", { name: "flight.takeoff", fields: { confirm: true } })).status).toBe("transport-failed");
    expect((await throwing.settingsGateway().sendCommand("relay-1", { name: "device.settings.transmission.read", fields: {} })).status).toBe("transport-failed");
    throwing.dispose();
  });

  it("逐一编码所有允许的控制命令，并在释放后拒绝新的订阅和发送", async () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });

    await adapter.missionGateway().sendCommand("relay-1", { name: "wayline.pause", fields: { confirm: true } });
    await adapter.missionGateway().sendCommand("relay-1", { name: "wayline.resume", fields: { confirm: true } });
    await adapter.missionGateway().sendCommand("relay-1", { name: "wayline.stop", fields: { confirm: true } });
    await adapter.flightGateway().sendCommand("relay-1", { name: "flight.takeoff", fields: { confirm: true } });
    expect((await adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.start", fields: {} })).status).toBe("rejected");
    await adapter.settingsGateway().sendCommand("relay-1", { name: "device.settings.camera.write", fields: { autoExposureLockEnabled: bool(true) } });
    await adapter.settingsGateway().sendCommand("relay-1", { name: "device.settings.transmission.write", fields: { bandwidth: text("BANDWIDTH_10MHZ") } });

    expect(fixture.sent.map((entry) => (entry as { request: { name: string } }).request.name)).toEqual([
      "wayline.pause", "wayline.resume", "wayline.stop", "flight.takeoff", "device.settings.camera.write", "device.settings.transmission.write",
    ]);
    adapter.dispose();
    expect((await adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.start", fields: {} })).status).toBe("rejected");
    expect(adapter.subscribe(() => undefined)()).toBeUndefined();
  });

  it("拒绝不可读取的中继字段与不完整快照，并在处置后静默丢弃迟到快照", async () => {
    let lateSnapshot: ((value: unknown) => void) | undefined;
    const unreadableTelemetry = new Proxy({}, { get() { throw new Error("unreadable"); } });
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [{ deviceId: "relay-1" }],
      latestTelemetry: (deviceId: string) => deviceId === "relay-1" ? null : unreadableTelemetry,
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async () => ({ status: "succeeded" }),
      subscribe: (listener: (snapshot: unknown) => void) => {
        lateSnapshot = listener;
        return () => undefined;
      },
    } });
    const events: unknown[] = [];
    adapter.subscribe((snapshot) => events.push(snapshot));
    expect(adapter.snapshot().telemetry).toEqual([]);
    expect(adapter.telemetry("other")).toBeNull();
    adapter.dispose();
    lateSnapshot?.({ missionPhases: [] });
    expect(events).toEqual([]);

    const malformed = RelayOperationsAdapter.create({ relay: {
      devices: () => ({}),
      latestTelemetry: (deviceId: string) => deviceId === "number"
        ? { payload: object({ batteryPercent: Object.freeze({ kind: "number" as const, value: "not-a-number" }) }), capabilities: object({}) }
        : { payload: { kind: "string", value: "not-an-object" }, capabilities: { kind: "object", fields: {} } },
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async () => ({ status: "succeeded" }),
    } });
    expect(malformed.devices()).toEqual([]);
    expect(malformed.telemetry("relay-1")).toBeNull();
    expect(malformed.telemetry("number")).toEqual({ deviceId: "number", receivedAtMs: null, payload: {}, capabilities: {} });

    const settings = RelayOperationsAdapter.create({ relay: {
      devices: () => [],
      latestTelemetry: () => null,
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async () => ({ status: "succeeded" }),
    } });
    expect(await settings.settingsGateway().sendCommand(" ", { name: "device.settings.camera.read", fields: {} })).toMatchObject({ status: "rejected" });
    expect(await settings.settingsGateway().sendCommand("relay-1", { name: "device.settings.transmission.read", fields: {} })).toMatchObject({ status: "succeeded" });
  });

  it("拒绝未知枚举、null 和无效数值，不将其推断为成功", () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });
    fixture.replaceTelemetry(
      object({ sdkAvailability: text("UNKNOWN"), remoteController: nil, batteryPercent: Object.freeze({ kind: "number" as const, value: "101" }) }),
      object({ waypointMissionSupport: text("UNKNOWN"), liveVideo: text("yes") })
    );

    expect(adapter.telemetry("relay-1")).toEqual({ deviceId: "relay-1", receivedAtMs: null, payload: {}, capabilities: {} });
  });

  it("以手机端注册的精确名称和字段发送航线、图传、配对与飞控命令", async () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });

    await adapter.missionGateway().sendCommand("relay-1", { name: "wayline.start", fields: { confirm: true } });
    await adapter.streamGateway().sendCommand("relay-1", { name: "live-stream.start", fields: { rtmpUrl: "rtmp://127.0.0.1/live/relay-1" } });
    await adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.status", fields: {} });
    await adapter.refreshTelemetry("relay-1");
    await adapter.flightGateway().sendCommand("relay-1", { name: "flight.return-home", fields: { confirm: true } });

    expect(fixture.sent).toEqual([
      { deviceId: "relay-1", request: { name: "wayline.start", fields: { confirm: bool(true) } } },
      { deviceId: "relay-1", request: { name: "live-stream.start", fields: { rtmpUrl: text("rtmp://127.0.0.1/live/relay-1") } } },
      { deviceId: "relay-1", request: { name: "pairing.status", fields: {} } },
      { deviceId: "relay-1", request: { name: "telemetry.read", fields: {} } },
      { deviceId: "relay-1", request: { name: "flight.return-home", fields: { confirm: bool(true) } } }
    ]);
  });

  it("为设置模块保留已验证的结构化结果，且不接受未知设置命令", async () => {
    const result = object({ domain: text("camera"), settings: object({ autoExposureLockEnabled: bool(true), focusMode: text("AUTO"), cameraIndex: text("DEFAULT") }) });
    const sent: unknown[] = [];
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [],
      latestTelemetry: () => null,
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async (deviceId: string, request: unknown) => {
        sent.push({ deviceId, request });
        return { deviceId, commandId: "setting-1", status: "succeeded", detail: "ok", result };
      },
      subscribe: () => () => undefined
    } });

    const outcome = await adapter.settingsGateway().sendCommand("relay-1", { name: "device.settings.camera.read", fields: {} });
    const rejected = await adapter.settingsGateway().sendCommand("relay-1", { name: "device.settings.unknown", fields: {} });

    expect(outcome).toMatchObject({ status: "succeeded", result });
    expect(rejected).toMatchObject({ status: "rejected" });
    expect(sent).toEqual([{ deviceId: "relay-1", request: { name: "device.settings.camera.read", fields: {} } }]);
  });

  it("隔离订阅、处置和无效端口请求，且不把本地拒绝发送给手机", async () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });
    const events: unknown[] = [];
    const unsubscribe = adapter.subscribe((snapshot) => events.push(snapshot));
    fixture.replaceTelemetry(object({ sdkAvailability: text("STOPPED") }), object({}));
    expect(events).toHaveLength(1);

    const mission = await adapter.missionGateway().sendMission("relay-1", { missionId: "mission-1", fileName: "survey.kmz", size: 1, sha256: "a".repeat(64), bytes: new Uint8Array([1]) });
    expect(mission.status).toBe("succeeded");
    expect((await adapter.missionGateway().sendCommand("relay-1", { name: "unexpected" as never, fields: { confirm: true } })).status).toBe("rejected");
    expect((await adapter.streamGateway().sendCommand("relay-1", { name: "live-stream.start", fields: { rtmpUrl: "" } })).status).toBe("rejected");
    expect((await adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.start", fields: { unexpected: "value" } as never })).status).toBe("rejected");
    expect((await adapter.flightGateway().sendCommand("relay-1", { name: "flight.takeoff", fields: { confirm: false } as never })).status).toBe("rejected");
    expect((await adapter.settingsGateway().sendCommand("relay-1", { name: "unknown" as never, fields: {} })).status).toBe("rejected");
    expect(fixture.sent).toHaveLength(0);

    adapter.dispose();
    adapter.dispose();
    unsubscribe();
    unsubscribe();
    expect(adapter.devices()).toEqual([]);
    expect(adapter.telemetry("relay-1")).toBeNull();
    expect((await adapter.missionGateway().sendMission("relay-1", { missionId: "mission-1", fileName: "survey.kmz", size: 1, sha256: "a".repeat(64), bytes: new Uint8Array([1]) })).status).toBe("rejected");
  });

  it("只接受私网 192.168 中继地址，并稳定拒绝无效的对频查询", async () => {
    const fixture = relayFixture();
    const adapter = RelayOperationsAdapter.create({ relay: fixture.relay });
    fixture.setIngress("192.168.50.8");
    expect(adapter.streamGateway().ingressAddress("relay-1")).toBe("192.168.50.8");
    expect((await adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.status", fields: { extra: true } as never })).status).toBe("rejected");
    adapter.dispose();
    expect((await adapter.pairingGateway().sendCommand("relay-1", { name: "pairing.status", fields: {} })).status).toBe("rejected");

    const timedOut = RelayOperationsAdapter.create({ relay: {
      devices: () => [],
      latestTelemetry: () => null,
      sendCommand: async () => ({ status: "timed-out" }),
    } });
    expect(await timedOut.pairingGateway().sendCommand("relay-1", { name: "pairing.status", fields: {} })).toMatchObject({ status: "timeout", detail: "timed-out" });
  });
});
