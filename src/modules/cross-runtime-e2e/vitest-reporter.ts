import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Reporter } from "vitest/reporters";
import { buildCrossRuntimeVerificationReport, type CrossRuntimeScenarioResult, type CrossRuntimeVerificationReport } from "./report.js";
import { relayCommandNames } from "./verification-catalog.js";

export interface RecordedCrossRuntimeTest {
  readonly name: string;
  readonly state: "passed" | "failed" | "skipped";
}

interface ScenarioCoverage {
  readonly modules: readonly string[];
  readonly matrices?: readonly string[];
  readonly requirements?: readonly string[];
}

const inputRequirements = relayCommandNames.flatMap((command) =>
  ["declared-shape", "missing-required", "extra-field", "wrong-type", "boundary"].map((inputClass) => `input:${command}:${inputClass}`));

const coverage: Readonly<Record<string, ScenarioCoverage>> = Object.freeze({
  "桌面设置和无 Electron 外壳通过正式公开接口完成生命周期": { modules: ["desktop-settings", "app-shell"] },
  "运行时生成的合格 KMZ 经正式航线库和任务控制上传到手机": { modules: ["operation-workflow", "route-library", "geo-map", "mission-control", "relay-link", "relay-settings", "relay-gateway", "device-connection", "telemetry", "wayline-mission", "app-runtime", "node-runtime", "relay-operations-adapter"], matrices: ["state-transitions", "mission-ordering", "dji-mission-upload-normal", "dji-mission-control-normal"], requirements: ["mission:stage", "mission:upload", "mission:start", "mission:executing", "mission:pause", "mission:resume", "mission:stop", "mission:complete", "mission:fail", "dji-mission-upload-normal", "dji-mission-control-normal"] },
  "手机诊断事件经正式网关到达桌面并收到确认": { modules: ["relay-link", "relay-gateway", "runtime-diagnostics"] },
  "桌面设备设置面板通过正式适配器读取手机相机设置": { modules: ["device-console", "device-settings", "relay-operations-adapter"], matrices: ["dji-settings-normal"], requirements: ["dji-settings-normal"] },
  "两台中继并行工作时一个故障不会污染另一台": { modules: ["relay-link", "relay-gateway", "telemetry"], matrices: ["multi-device-isolation", "network-session"], requirements: ["multi-device:parallel-connect", "multi-device:different-missions", "multi-device:settings-isolation", "multi-device:stream-isolation", "multi-device:telemetry-isolation", "multi-device:failure-and-reconnect-isolation", "network:concurrent-read-write"] },
  "手机断线重连更换会话并隔离旧会话迟到结果": { modules: ["relay-link", "relay-gateway", "app-runtime"], matrices: ["network-session", "resource-recovery"], requirements: ["network:session-replacement", "network:stale-generation", "network:reconnect"] },
  "非法 WebSocket 帧被隔离且不影响合法手机会话": { modules: ["relay-link", "relay-gateway", "node-runtime"], matrices: ["protocol-security"], requirements: ["protocol:text-frame", "protocol:truncated-frame", "protocol:oversized-frame", "protocol:unknown-frame", "protocol:invalid-utf8", "protocol:invalid-json", "protocol:raw-payload-not-reported"] },
  "握手前断开和握手超时均被回收且不影响合法会话": { modules: ["relay-link", "relay-gateway", "node-runtime"], matrices: ["network-session", "resource-recovery", "protocol-security"], requirements: ["network:disconnect-before-hello", "network:handshake-timeout", "resource:websocket-cleanup"] },
  "固定种子动作序列隔离非法输入并保持正式会话可恢复": { modules: ["relay-link", "relay-gateway", "device-settings", "telemetry"], matrices: ["input-equivalence", "fixed-seed-generative"], requirements: ["generative:fixed-seed", "generative:bounded-action-sequence"] },
  "全部正式中继命令跨真实 WebSocket 覆盖输入等价类与边界": { modules: ["relay-link", "relay-gateway", "device-settings", "telemetry", "wayline-mission", "live-stream", "desktop:flight-control", "mobile:flight-control"], requirements: ["relay-command-name-enum", "desktop-public-contract-branches", "mobile-public-contract-branches", ...inputRequirements] },
  "穷尽编解码所有已声明的有效帧类型": { modules: ["relay-link", "relay-gateway"], requirements: ["protocol-frame-type-enum", "protocol:all-valid-frame-types"] },
  "拒绝重复字段缺失字段和错误字段类型并忽略兼容额外字段": { modules: ["relay-link", "relay-gateway"], requirements: ["protocol:duplicate-field", "protocol:missing-field", "protocol:extra-field", "protocol:wrong-field-type"] },
  "拒绝无效 UTF-8 和无效 JSON 且诊断不泄露原始载荷": { modules: ["relay-link", "relay-gateway", "runtime-diagnostics"], requirements: ["protocol:invalid-utf8", "protocol:invalid-json", "protocol:diagnostic-redaction", "protocol:raw-payload-not-reported"] },
  "两端生产源码的公开有限集合必须与审阅基线完全一致": { modules: [], requirements: ["source-finite-state-inventory", "source-finite-enum-inventory"] },
  "DJI 拒绝相机设置写入时桌面收到失败且原设置不被污染": { modules: ["device-console", "device-settings"], matrices: ["dji-settings-reject"], requirements: ["dji-settings-reject"] },
  "航线上传等待 DJI 回调超时时不会把已暂存航线误报为已上传": { modules: ["mission-control", "wayline-mission"], matrices: ["dji-mission-upload-timeout", "mission-ordering"], requirements: ["dji-mission-upload-timeout"] },
  "航线上传隔离拒绝抛出重复和迟到 DJI 回调": { modules: ["mission-control", "wayline-mission"], matrices: ["dji-mission-upload-reject", "dji-mission-upload-throw", "dji-mission-upload-duplicate", "dji-mission-upload-late"], requirements: ["dji-mission-upload-reject", "dji-mission-upload-throw", "dji-mission-upload-duplicate", "dji-mission-upload-late"] },
  "航线控制隔离拒绝抛出超时重复和迟到 DJI 回调": { modules: ["mission-control", "wayline-mission"], matrices: ["dji-mission-control-reject", "dji-mission-control-throw", "dji-mission-control-timeout", "dji-mission-control-duplicate", "dji-mission-control-late"], requirements: ["dji-mission-control-reject", "dji-mission-control-throw", "dji-mission-control-timeout", "dji-mission-control-duplicate", "dji-mission-control-late"] },
  "设置接缝隔离抛出超时重复和迟到 DJI 回调": { modules: ["device-console", "device-settings"], matrices: ["dji-settings-throw", "dji-settings-timeout", "dji-settings-duplicate", "dji-settings-late"], requirements: ["dji-settings-throw", "dji-settings-timeout", "dji-settings-duplicate", "dji-settings-late"] },
  "图传接缝隔离拒绝抛出重复和迟到 DJI 回调": { modules: ["live-stream-control", "live-stream"], matrices: ["dji-stream-reject", "dji-stream-throw", "dji-stream-duplicate", "dji-stream-late"], requirements: ["dji-stream-reject", "dji-stream-throw", "dji-stream-duplicate", "dji-stream-late"] },
  "图传启动超时时桌面收到失败而不是媒体已就绪": { modules: ["live-stream-control", "live-stream"], matrices: ["dji-stream-timeout"], requirements: ["dji-stream-timeout"] },
  "正式媒体流水线为图传控制生成目标并驱动手机开始停止": { modules: ["desktop-runtime", "media-pipeline", "live-stream-control", "live-stream", "relay-operations-adapter"], matrices: ["dji-stream-normal"], requirements: ["dji-stream-normal"] },
  "DJI 同步拒绝起飞时不会阻塞后续飞控命令": { modules: ["desktop:flight-control", "mobile:flight-control"], matrices: ["dji-flight-reject"], requirements: ["dji-flight-reject"] },
  "DJI 抛出重复和迟到回调均被隔离且不会污染后续命令": { modules: ["desktop:flight-control", "mobile:flight-control"], matrices: ["dji-flight-throw", "dji-flight-duplicate", "dji-flight-late"], requirements: ["dji-flight-throw", "dji-flight-duplicate", "dji-flight-late"] },
  "桌面正式飞控必须显式确认后才经手机执行": { modules: ["desktop:flight-control", "mobile:flight-control", "device-console"], matrices: ["state-transitions", "dji-flight-normal"], requirements: ["dji-flight-normal"] },
  "通过真实 WebSocket 发现 Kotlin 中继并读取正式遥测": { modules: ["relay-link", "relay-settings", "relay-gateway", "device-connection", "telemetry", "wayline-mission", "live-stream", "desktop:flight-control", "mobile:flight-control", "device-settings", "app-runtime"], matrices: ["state-transitions"], requirements: ["network:initial-connect", "protocol:all-valid-frame-types", "dji-fault-mode-enum", "mission-execution-signal-enum"] },
  "DJI 无回调会有限超时且关闭操作幂等": { modules: ["desktop:flight-control", "mobile:flight-control", "app-runtime"], matrices: ["dji-flight-timeout", "resource-recovery"], requirements: ["dji-flight-timeout", "resource:timeout-cleanup", "network:repeated-close"] },
  "桌面关闭会解除在途命令而不留下挂起 Promise": { modules: ["desktop-runtime", "relay-link", "relay-gateway", "app-runtime"], matrices: ["network-session", "resource-recovery"], requirements: ["network:desktop-first-close", "network:send-failure", "network:repeated-close", "resource:desktop-stop", "resource:failure-cleanup"] },
  "手机进程先退出会移除设备并解除在途命令": { modules: ["desktop-runtime", "relay-link", "relay-gateway", "app-runtime"], matrices: ["network-session", "resource-recovery"], requirements: ["network:mobile-first-close", "resource:forced-mobile-stop"] },
  "逐项比较航线生产状态机的全部状态与事件组合": { modules: ["mission-control"], requirements: ["desktop-mission-phase-cartesian", "mission:illegal-before-stage", "mission:illegal-before-upload", "mission:illegal-after-terminal"] },
  "相同种子产生相同动作序列且不同种子发生分歧": { modules: [], requirements: ["generative:fixed-seed", "generative:bounded-action-sequence", "generative:independent-oracle"] },
  "失败序列缩减器得到仍可复现失败的一项最小序列": { modules: [], requirements: ["generative:failure-shrinking"] },
  "拒绝旧任务修订和旧设备代次但允许新任务从序号一重新开始": { modules: ["relay-link"], requirements: ["mission:mission-generation-mismatch", "mission:device-generation-mismatch"] },
  "同一任务拒绝重复和倒退序号": { modules: ["relay-link"], requirements: ["mission:sequence-regression", "mission:duplicate-sequence", "mission:late-phase"] },
  "成功关闭会回收子进程定时器和 WebSocket，且同一套件可连续运行两次": { modules: ["desktop-runtime", "relay-link", "relay-gateway", "app-runtime"], requirements: ["resource:success-cleanup", "resource:timer-cleanup", "resource:repeatable-two-runs"] },
  "工作流模型和验收证据门禁的全部变异均被杀死": { modules: [], requirements: ["mutation:workflow-model-mutants-killed", "mutation:coverage-gate-mutants-killed"] },
});

export const buildReportFromRecordedTests = (
  tests: readonly RecordedCrossRuntimeTest[],
): CrossRuntimeVerificationReport => {
  const scenarios: CrossRuntimeScenarioResult[] = [];
  for (const test of tests) {
    const mapped = coverage[test.name];
    if (mapped === undefined || test.state === "skipped") continue;
    scenarios.push(Object.freeze({
      scenario: test.name,
      passed: test.state === "passed",
      modules: Object.freeze([...mapped.modules]),
      matrices: Object.freeze([...(mapped.matrices ?? [])]),
      requirements: Object.freeze([...(mapped.requirements ?? [])]),
    }));
  }
  return buildCrossRuntimeVerificationReport(scenarios);
};

export default class CrossRuntimeVitestReporter implements Reporter {
  private readonly tests: RecordedCrossRuntimeTest[] = [];

  onTestCaseResult(testCase: Parameters<NonNullable<Reporter["onTestCaseResult"]>>[0]): void {
    const moduleId = testCase.module.moduleId.replaceAll("\\", "/");
    if (
      !moduleId.endsWith("/tests/cross-runtime-e2e-contract.test.ts") &&
      !moduleId.endsWith("/tests/cross-runtime-workflow-model.test.ts") &&
      !moduleId.endsWith("/tests/cross-runtime-protocol-verification.test.ts") &&
      !moduleId.endsWith("/tests/cross-runtime-source-inventory.test.ts") &&
      !moduleId.endsWith("/tests/cross-runtime-mission-ordering.test.ts") &&
      !moduleId.endsWith("/tests/cross-runtime-resource-recovery.test.ts") &&
      !moduleId.endsWith("/cross-runtime-e2e/verification-evidence.test.ts")
    ) return;
    const state = testCase.result().state;
    this.tests.push({ name: testCase.name, state: state === "passed" ? "passed" : state === "failed" ? "failed" : "skipped" });
  }

  onTestRunEnd(): void {
    const report = buildReportFromRecordedTests(this.tests);
    writeFileSync(resolve(process.cwd(), "cross-runtime-verification-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`\nCrossRuntimeVerificationReport\n${JSON.stringify(report, null, 2)}\n`);
    if (report.overallStatus !== "passed") process.exitCode = 1;
  }
}
