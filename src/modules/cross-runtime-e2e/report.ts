import { VerificationCatalog, type VerificationRequirementCategory } from "./verification-catalog.js";

export type CrossRuntimeModuleStatus = "covered" | "failed" | "not-covered" | "excluded";

export interface CrossRuntimeScenarioResult {
  readonly scenario: string;
  readonly passed: boolean;
  readonly modules: readonly string[];
  readonly matrices?: readonly string[];
  readonly requirements?: readonly string[];
}

export interface CrossRuntimeModuleReport {
  readonly module: string;
  readonly runtime: "desktop" | "mobile";
  readonly status: CrossRuntimeModuleStatus;
}

export interface CrossRuntimeVerificationReport {
  readonly overallStatus: "passed" | "failed" | "incomplete";
  readonly modules: readonly CrossRuntimeModuleReport[];
  readonly matrices: readonly CrossRuntimeMatrixReport[];
  readonly scenarios: readonly CrossRuntimeScenarioResult[];
  readonly requirements: readonly CrossRuntimeRequirementReport[];
  readonly invalidEvidence: readonly string[];
}

export interface CrossRuntimeRequirementReport {
  readonly requirement: string;
  readonly category: VerificationRequirementCategory;
  readonly status: Exclude<CrossRuntimeModuleStatus, "excluded">;
}

export interface CrossRuntimeMatrixReport {
  readonly matrix: string;
  readonly status: Exclude<CrossRuntimeModuleStatus, "excluded">;
}

const requiredModules = [
  ["desktop-settings", "desktop"], ["relay-link", "desktop"], ["device-console", "desktop"],
  ["route-library", "desktop"], ["geo-map", "desktop"], ["mission-control", "desktop"],
  ["operation-workflow", "desktop"],
  ["flight-control", "desktop"], ["live-stream-control", "desktop"], ["media-pipeline", "desktop"],
  ["app-shell", "desktop"], ["desktop-runtime", "desktop"], ["node-runtime", "desktop"],
  ["relay-operations-adapter", "desktop"], ["relay-settings", "mobile"], ["relay-gateway", "mobile"],
  ["device-connection", "mobile"], ["telemetry", "mobile"], ["wayline-mission", "mobile"],
  ["live-stream", "mobile"], ["flight-control", "mobile"], ["device-settings", "mobile"],
  ["runtime-diagnostics", "mobile"], ["app-runtime", "mobile"],
] as const satisfies readonly (readonly [string, "desktop" | "mobile"])[];

const excludedModules = [
  ["route-planning", "desktop"], ["wpmz-generator", "mobile"],
] as const satisfies readonly (readonly [string, "desktop" | "mobile"])[];

const requiredMatrices = [
  "state-transitions",
  "input-equivalence",
  "network-session",
  "dji-flight-normal",
  "dji-flight-reject",
  "dji-flight-throw",
  "dji-flight-timeout",
  "dji-flight-duplicate",
  "dji-flight-late",
  "dji-mission-upload-normal",
  "dji-mission-upload-reject",
  "dji-mission-upload-throw",
  "dji-mission-upload-timeout",
  "dji-mission-upload-duplicate",
  "dji-mission-upload-late",
  "dji-mission-control-normal",
  "dji-mission-control-reject",
  "dji-mission-control-throw",
  "dji-mission-control-timeout",
  "dji-mission-control-duplicate",
  "dji-mission-control-late",
  "dji-settings-normal",
  "dji-settings-reject",
  "dji-settings-throw",
  "dji-settings-timeout",
  "dji-settings-duplicate",
  "dji-settings-late",
  "dji-stream-normal",
  "dji-stream-reject",
  "dji-stream-throw",
  "dji-stream-timeout",
  "dji-stream-duplicate",
  "dji-stream-late",
  "mission-ordering",
  "multi-device-isolation",
  "resource-recovery",
  "protocol-security",
  "fixed-seed-generative",
] as const;

const moduleKey = (runtime: "desktop" | "mobile", module: string): string => `${runtime}:${module}`;

export const buildCrossRuntimeVerificationReport = (
  scenarios: readonly CrossRuntimeScenarioResult[],
): CrossRuntimeVerificationReport => {
  const failed = new Set<string>();
  const covered = new Set<string>();
  const failedMatrices = new Set<string>();
  const coveredMatrices = new Set<string>();
  const failedRequirements = new Set<string>();
  const coveredRequirements = new Set<string>();
  const invalidEvidence: string[] = [];
  for (const scenario of scenarios) {
    for (const module of scenario.modules) {
      const separator = module.indexOf(":");
      const runtime = separator < 0 ? null : module.slice(0, separator);
      const name = separator < 0 ? module : module.slice(separator + 1);
      const known = requiredModules.filter(([knownName, knownRuntime]) =>
        knownName === name && (runtime === null || knownRuntime === runtime));
      if (known.length !== 1) {
        invalidEvidence.push(`module:${module}`);
        continue;
      }
      for (const [, runtime] of known) {
        const key = moduleKey(runtime, name);
        if (scenario.passed) covered.add(key); else failed.add(key);
      }
    }
    for (const matrix of scenario.matrices ?? []) {
      if (!requiredMatrices.includes(matrix as typeof requiredMatrices[number])) continue;
      if (scenario.passed) coveredMatrices.add(matrix); else failedMatrices.add(matrix);
    }
    for (const evidence of scenario.requirements ?? []) {
      if (!VerificationCatalog.contains(evidence)) {
        invalidEvidence.push(evidence);
        continue;
      }
      if (scenario.passed) coveredRequirements.add(evidence); else failedRequirements.add(evidence);
    }
  }
  const modules: CrossRuntimeModuleReport[] = [
    ...requiredModules.map(([module, runtime]) => {
      const key = moduleKey(runtime, module);
      const status: CrossRuntimeModuleStatus = failed.has(key) ? "failed" : covered.has(key) ? "covered" : "not-covered";
      return { module, runtime, status };
    }),
    ...excludedModules.map(([module, runtime]) => ({ module, runtime, status: "excluded" as const })),
  ];
  const matrices: CrossRuntimeMatrixReport[] = requiredMatrices.map((matrix) => ({
    matrix,
    status: failedMatrices.has(matrix) ? "failed" : coveredMatrices.has(matrix) ? "covered" : "not-covered",
  }));
  const requirements: CrossRuntimeRequirementReport[] = VerificationCatalog.requirements.map(({ id, category }) => ({
    requirement: id,
    category,
    status: failedRequirements.has(id) ? "failed" : coveredRequirements.has(id) ? "covered" : "not-covered",
  }));
  const hasFailure = failed.size > 0 || failedMatrices.size > 0 || failedRequirements.size > 0;
  const hasGap = invalidEvidence.length > 0 || modules.some(({ status }) => status === "not-covered") || matrices.some(({ status }) => status === "not-covered") || requirements.some(({ status }) => status === "not-covered");
  const overallStatus = hasFailure ? "failed" : hasGap ? "incomplete" : "passed";
  return Object.freeze({
    overallStatus,
    modules: Object.freeze(modules),
    matrices: Object.freeze(matrices),
    scenarios: Object.freeze([...scenarios]),
    requirements: Object.freeze(requirements),
    invalidEvidence: Object.freeze(invalidEvidence),
  });
};
