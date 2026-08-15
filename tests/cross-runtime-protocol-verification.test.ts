import { describe, expect, it } from "vitest";
import {
  RelayFrameCodec,
  type RelayFrame,
} from "../src/modules/relay-link/protocol-core/index.js";

const encoder = new TextEncoder();

const validFrames: readonly RelayFrame[] = Object.freeze([
  { type: "hello", deviceId: "relay-1", protocolVersion: "1" },
  { type: "paired", sessionId: "session-1", protocolVersion: "1" },
  { type: "telemetry", payload: { kind: "object", fields: {} }, capabilities: { kind: "object", fields: {} } },
  { type: "command", id: "command-1", command: { name: "telemetry.read", fields: {} } },
  { type: "command-result", id: "command-1", ok: true, detail: "accepted" },
  { type: "mission-begin", id: "mission-1", fileName: "route.kmz", size: 1, sha256: "a".repeat(64) },
  { type: "mission-chunk", id: "mission-1", data: new Uint8Array([1]) },
  { type: "mission-complete", id: "mission-1" },
  { type: "mission-result", id: "mission-1", ok: true, detail: "accepted" },
  { type: "mission-phase", missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED", fileName: "route.kmz" },
  { type: "diagnostic-report", runId: "run-1", events: [{ sequence: 1, timestampMillis: 0, level: "INFO", module: "relay", eventCode: "READY", operationId: null, safeDetail: "ready" }] },
  { type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: 1 },
]);

describe("跨运行时协议原子验证", () => {
  it("穷尽编解码所有已声明的有效帧类型", () => {
    const observed = new Set<string>();
    for (const frame of validFrames) {
      const encoded = RelayFrameCodec.encode(frame);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) continue;
      const decoded = RelayFrameCodec.decode(encoded.value);
      expect(decoded.kind).toBe("decoded");
      if (decoded.kind === "decoded") observed.add(decoded.frame.type);
    }
    expect([...observed].sort()).toEqual([
      "command", "command-result", "diagnostic-ack", "diagnostic-report", "hello", "mission-begin",
      "mission-chunk", "mission-complete", "mission-phase", "mission-result", "paired", "telemetry",
    ]);
  });

  it("拒绝重复字段缺失字段和错误字段类型并忽略兼容额外字段", () => {
    const invalid = [
      '{"type":"hello","deviceId":"a","deviceId":"b","protocolVersion":"1"}',
      '{"type":"hello","deviceId":"relay-1"}',
      '{"type":"hello","deviceId":1,"protocolVersion":"1"}',
    ];
    for (const source of invalid) expect(RelayFrameCodec.decode(encoder.encode(source)).kind).toBe("rejected");
    expect(RelayFrameCodec.decode(encoder.encode('{"type":"hello","deviceId":"relay-1","protocolVersion":"1","future":true}'))).toMatchObject({ kind: "decoded", frame: { type: "hello", deviceId: "relay-1" } });
  });

  it("拒绝无效 UTF-8 和无效 JSON 且诊断不泄露原始载荷", () => {
    const secret = "raw-secret-payload";
    const results = [
      RelayFrameCodec.decode(new Uint8Array([0xc3, 0x28])),
      RelayFrameCodec.decode(encoder.encode(`{\"type\":\"hello\",\"deviceId\":\"${secret}\"`)),
      RelayFrameCodec.decode(encoder.encode(`{\"type\":\"hello\",\"deviceId\":\"${secret}\",\"protocolVersion\":\"2\"}`)),
    ];
    expect(results.every((result) => result.kind === "rejected")).toBe(true);
    expect(JSON.stringify(results)).not.toContain(secret);
  });
});
