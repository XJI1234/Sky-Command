import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VerificationEvidence } from "./verification-evidence.js";

describe("跨运行时验收工具证据", () => {
  const gate = process.env.CROSS_RUNTIME_VERIFICATION_STARTED_AT === undefined ? it.skip : it;

  gate("工作流模型和验收证据门禁的全部变异均被杀死", () => {
    const startedAt = Number(process.env.CROSS_RUNTIME_VERIFICATION_STARTED_AT);
    expect(Number.isFinite(startedAt), "最终验收命令必须提供本轮开始时间").toBe(true);

    const evidence = VerificationEvidence.inspect({
      root: resolve(process.cwd()),
      startedAtMs: startedAt,
      coverageFileName: "coverage/coverage-summary.json",
      mutationFileName: "reports/mutation/cross-runtime-verification.json",
    });

    expect(evidence.issues).toEqual([]);
    expect(evidence.ok).toBe(true);
  });
});
