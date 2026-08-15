import { describe, expect, it } from "vitest";
import { buildCrossRuntimeVerificationReport } from "../src/modules/cross-runtime-e2e/report.js";

describe("跨运行时验证报告", () => {
  it("未被场景明确映射的生产模块必须显示为未覆盖", () => {
    const report = buildCrossRuntimeVerificationReport([
      { scenario: "核心中继链路", passed: true, modules: ["relay-link", "relay-gateway"] },
    ]);

    expect(report.modules.find((entry) => entry.module === "relay-link")?.status).toBe("covered");
    expect(report.modules.find((entry) => entry.module === "route-library")?.status).toBe("not-covered");
    expect(report.overallStatus).toBe("incomplete");
  });

  it("失败场景不能将其涉及模块报告为已覆盖", () => {
    const report = buildCrossRuntimeVerificationReport([
      { scenario: "图传超时", passed: false, modules: ["live-stream", "live-stream-control"] },
    ]);

    expect(report.modules.find((entry) => entry.module === "live-stream")?.status).toBe("failed");
    expect(report.overallStatus).toBe("failed");
  });

  it("任何未被场景明确映射的全面情形矩阵都阻止整体通过", () => {
    const report = buildCrossRuntimeVerificationReport([
      {
        scenario: "有限故障矩阵",
        passed: true,
        modules: [],
        matrices: ["state-transitions", "input-equivalence"],
      },
    ]);

    expect(report.matrices.find((entry) => entry.matrix === "state-transitions")?.status).toBe("covered");
    expect(report.matrices.find((entry) => entry.matrix === "network-session")?.status).toBe("not-covered");
    expect(report.overallStatus).toBe("incomplete");
  });

  it("DJI 每个外部接缝的六类行为必须分别覆盖", () => {
    const report = buildCrossRuntimeVerificationReport([
      {
        scenario: "只有飞控接缝完整",
        passed: true,
        modules: [],
        matrices: [
          "dji-flight-normal",
          "dji-flight-reject",
          "dji-flight-throw",
          "dji-flight-timeout",
          "dji-flight-duplicate",
          "dji-flight-late",
        ],
      },
    ]);

    expect(report.matrices.find((entry) => entry.matrix === "dji-flight-late")?.status).toBe("covered");
    expect(report.matrices.find((entry) => entry.matrix === "dji-mission-upload-normal")?.status).toBe("not-covered");
    expect(report.matrices.find((entry) => entry.matrix === "dji-stream-late")?.status).toBe("not-covered");
    expect(report.overallStatus).toBe("incomplete");
  });

  it("同名模块必须使用运行时限定证据而不能互相冒充", () => {
    const report = buildCrossRuntimeVerificationReport([
      { scenario: "只验证桌面飞控", passed: true, modules: ["desktop:flight-control"] },
    ]);

    expect(report.modules.find((entry) => entry.runtime === "desktop" && entry.module === "flight-control")?.status).toBe("covered");
    expect(report.modules.find((entry) => entry.runtime === "mobile" && entry.module === "flight-control")?.status).toBe("not-covered");
  });

  it("报告逐项列出原子需求并拒绝未知证据", () => {
    const report = buildCrossRuntimeVerificationReport([
      {
        scenario: "伪造聚合覆盖",
        passed: true,
        modules: [],
        requirements: ["dji-all", "unknown-requirement"],
      } as never,
    ]);
    const requirements = (report as typeof report & {
      requirements: readonly { requirement: string; status: string }[];
      invalidEvidence: readonly string[];
    });

    expect(requirements.requirements.length).toBeGreaterThan(38);
    expect(requirements.invalidEvidence).toEqual(["dji-all", "unknown-requirement"]);
    expect(report.overallStatus).toBe("incomplete");
  });
});
