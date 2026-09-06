import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeDiagnosticStore } from "../src/adapters/node-diagnostic-store/index.js";

describe("node diagnostic store adapter", () => {
  it("appends verified diagnostic batches asynchronously before reporting success", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-command-diagnostic-"));
    const filePath = join(directory, "nested", "events.ndjson");
    try {
      const store = NodeDiagnosticStore.create({ filePath });
      await expect(store.persist({ deviceId: "phone-1", runId: "run-1", events: [{ sequence: 1, timestampMillis: 1, level: "ERROR", module: "device-connection", eventCode: "SDK_FAILURE", operationId: "start-1", safeDetail: "registration failed" }] })).resolves.toBe(true);
      await expect(store.persist({ deviceId: "phone-1", runId: "run-1", events: [{ sequence: 2, timestampMillis: 2, level: "INFO", module: "relay-gateway", eventCode: "RECOVERED", operationId: null, safeDetail: "connected" }] })).resolves.toBe(true);
      expect(readFileSync(filePath, "utf8")).toBe(
        "{\"deviceId\":\"phone-1\",\"runId\":\"run-1\",\"events\":[{\"sequence\":1,\"timestampMillis\":1,\"level\":\"ERROR\",\"module\":\"device-connection\",\"eventCode\":\"SDK_FAILURE\",\"operationId\":\"start-1\",\"safeDetail\":\"registration failed\"}]}\n" +
        "{\"deviceId\":\"phone-1\",\"runId\":\"run-1\",\"events\":[{\"sequence\":2,\"timestampMillis\":2,\"level\":\"INFO\",\"module\":\"relay-gateway\",\"eventCode\":\"RECOVERED\",\"operationId\":null,\"safeDetail\":\"connected\"}]}\n"
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("异步报告文件写入失败且不抛出底层错误", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-command-diagnostic-"));
    try {
      const store = NodeDiagnosticStore.create({ filePath: directory });
      const persisted = store.persist({ deviceId: "phone-1", runId: "run-1", events: [{ sequence: 1, timestampMillis: 1, level: "ERROR", module: "device-connection", eventCode: "SDK_FAILURE", operationId: "start-1", safeDetail: "registration failed" }] });
      let settled = false;
      void persisted.then(() => { settled = true; });

      expect(settled).toBe(false);
      await expect(persisted).resolves.toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
