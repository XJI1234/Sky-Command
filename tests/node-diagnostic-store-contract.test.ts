import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeDiagnosticStore } from "../src/adapters/node-diagnostic-store/index.js";

describe("node diagnostic store adapter", () => {
  it("appends verified diagnostic batches as compact NDJSON before reporting success", () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-command-diagnostic-"));
    const filePath = join(directory, "nested", "events.ndjson");
    try {
      const store = NodeDiagnosticStore.create({ filePath });
      expect(store.persist({ deviceId: "phone-1", runId: "run-1", events: [{ sequence: 1, timestampMillis: 1, level: "ERROR", module: "device-connection", eventCode: "SDK_FAILURE", operationId: "start-1", safeDetail: "registration failed" }] })).toBe(true);
      expect(store.persist({ deviceId: "phone-1", runId: "run-1", events: [{ sequence: 2, timestampMillis: 2, level: "INFO", module: "relay-gateway", eventCode: "RECOVERED", operationId: null, safeDetail: "connected" }] })).toBe(true);
      expect(readFileSync(filePath, "utf8")).toBe(
        "{\"deviceId\":\"phone-1\",\"runId\":\"run-1\",\"events\":[{\"sequence\":1,\"timestampMillis\":1,\"level\":\"ERROR\",\"module\":\"device-connection\",\"eventCode\":\"SDK_FAILURE\",\"operationId\":\"start-1\",\"safeDetail\":\"registration failed\"}]}\n" +
        "{\"deviceId\":\"phone-1\",\"runId\":\"run-1\",\"events\":[{\"sequence\":2,\"timestampMillis\":2,\"level\":\"INFO\",\"module\":\"relay-gateway\",\"eventCode\":\"RECOVERED\",\"operationId\":null,\"safeDetail\":\"connected\"}]}\n"
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
