export type VerificationRequirementCategory =
  | "finite-state"
  | "finite-enum"
  | "input-equivalence"
  | "network-session"
  | "dji-fault"
  | "mission-ordering"
  | "multi-device"
  | "resource-recovery"
  | "protocol-security"
  | "generative"
  | "mutation-sensitivity";

export interface VerificationRequirement {
  readonly id: string;
  readonly category: VerificationRequirementCategory;
  readonly description: string;
}

const requirement = (
  category: VerificationRequirementCategory,
  id: string,
  description: string,
): VerificationRequirement => Object.freeze({ id, category, description });

const finiteStateRequirements = [
  "source-finite-state-inventory",
  "desktop-mission-phase-cartesian",
  "desktop-public-contract-branches",
  "mobile-public-contract-branches",
].map((id) => requirement("finite-state", id, `穷尽状态与事件笛卡尔积：${id}`));

const finiteEnumRequirements = [
  "source-finite-enum-inventory",
  "relay-command-name-enum",
  "protocol-frame-type-enum",
  "mission-execution-signal-enum",
  "dji-fault-mode-enum",
].map((id) => requirement("finite-enum", id, `穷尽封闭枚举：${id}`));

export const relayCommandNames = Object.freeze([
  "telemetry.read",
  "pairing.start", "pairing.stop", "pairing.status",
  "live-stream.start", "live-stream.stop",
  "flight.takeoff", "flight.land", "flight.confirm-landing", "flight.return-home", "flight.stop-takeoff", "flight.stop-auto-landing",
  "device.settings.camera.read", "device.settings.camera.write",
  "device.settings.transmission.read", "device.settings.transmission.write",
  "wayline.upload", "wayline.start", "wayline.pause", "wayline.resume", "wayline.stop",
] as const);

const inputClasses = Object.freeze([
  "declared-shape", "missing-required", "extra-field", "wrong-type", "boundary",
] as const);

const inputRequirements = relayCommandNames.flatMap((command) => inputClasses.map((inputClass) =>
  requirement("input-equivalence", `input:${command}:${inputClass}`, `${command} 输入等价类 ${inputClass}`),
));

const networkRequirements = [
  "initial-connect", "disconnect-before-hello", "handshake-timeout", "session-replacement",
  "send-failure", "concurrent-read-write", "stale-generation", "reconnect",
  "desktop-first-close", "mobile-first-close", "repeated-close",
].map((id) => requirement("network-session", `network:${id}`, `网络与会话：${id}`));

const djiSeams = ["flight", "mission-upload", "mission-control", "settings", "stream"] as const;
const djiFaults = ["normal", "reject", "throw", "timeout", "duplicate", "late"] as const;
const djiRequirements = djiSeams.flatMap((seam) => djiFaults.map((fault) =>
  requirement("dji-fault", `dji-${seam}-${fault}`, `DJI ${seam} 接缝 ${fault}`),
));

const missionRequirements = [
  "stage", "upload", "start", "executing", "pause", "resume", "stop", "complete", "fail",
  "illegal-before-stage", "illegal-before-upload", "illegal-after-terminal", "mission-generation-mismatch",
  "device-generation-mismatch", "sequence-regression", "duplicate-sequence", "late-phase",
].map((id) => requirement("mission-ordering", `mission:${id}`, `航线时序：${id}`));

const multiDeviceRequirements = [
  "parallel-connect", "different-missions", "settings-isolation", "stream-isolation",
  "telemetry-isolation", "failure-and-reconnect-isolation",
].map((id) => requirement("multi-device", `multi-device:${id}`, `多设备隔离：${id}`));

const resourceRequirements = [
  "success-cleanup", "failure-cleanup", "timeout-cleanup", "forced-mobile-stop",
  "desktop-stop", "websocket-cleanup", "timer-cleanup", "repeatable-two-runs",
].map((id) => requirement("resource-recovery", `resource:${id}`, `资源恢复：${id}`));

const protocolRequirements = [
  "all-valid-frame-types", "text-frame", "truncated-frame", "oversized-frame", "unknown-frame",
  "duplicate-field", "missing-field", "extra-field", "wrong-field-type", "invalid-utf8",
  "invalid-json", "diagnostic-redaction", "raw-payload-not-reported",
].map((id) => requirement("protocol-security", `protocol:${id}`, `协议与安全：${id}`));

const generativeRequirements = [
  "fixed-seed", "independent-oracle", "bounded-action-sequence", "failure-shrinking",
].map((id) => requirement("generative", `generative:${id}`, `模型驱动生成式验证：${id}`));

const mutationRequirements = [
  "workflow-model-mutants-killed", "coverage-gate-mutants-killed",
].map((id) => requirement("mutation-sensitivity", `mutation:${id}`, `变异敏感性：${id}`));

export const verificationRequirements: readonly VerificationRequirement[] = Object.freeze([
  ...finiteStateRequirements,
  ...finiteEnumRequirements,
  ...inputRequirements,
  ...networkRequirements,
  ...djiRequirements,
  ...missionRequirements,
  ...multiDeviceRequirements,
  ...resourceRequirements,
  ...protocolRequirements,
  ...generativeRequirements,
  ...mutationRequirements,
]);

const ids = new Set(verificationRequirements.map(({ id }) => id));
if (ids.size !== verificationRequirements.length) throw new Error("Verification requirement IDs must be unique");

export const VerificationCatalog = Object.freeze({
  requirements: verificationRequirements,
  contains: (id: string): boolean => ids.has(id),
});
