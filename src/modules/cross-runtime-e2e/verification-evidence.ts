import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type CoverageMetric = "lines" | "statements" | "functions" | "branches";

export interface VerificationEvidenceInput {
  readonly root: string;
  readonly startedAtMs: number;
  readonly coverageFileName?: string;
  readonly mutationFileName?: string;
}

export interface VerificationEvidenceResult {
  readonly ok: boolean;
  readonly coverage: Readonly<Record<CoverageMetric, number>> | null;
  readonly mutation: Readonly<{ total: number; killed: number; survived: number; noCoverage: number }> | null;
  readonly issues: readonly string[];
}

const metrics = ["lines", "statements", "functions", "branches"] as const satisfies readonly CoverageMetric[];

const safelyReadJson = (path: string): unknown | null => {
  try {
    return JSON.parse(new TextDecoder().decode(readFileSync(path)));
  } catch {
    return null;
  }
};

const isFresh = (path: string, startedAtMs: number): boolean => statSync(path).mtimeMs >= startedAtMs;

const object = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const parseCoverage = (value: unknown): Readonly<Record<CoverageMetric, number>> | null => {
  const root = object(value);
  if (root === null) return null;
  const total = root.total;
  const totalObject = object(total);
  if (totalObject === null) return null;
  const result: Partial<Record<CoverageMetric, number>> = {};
  for (const metric of metrics) {
    const metricObject = object(totalObject[metric]);
    if (metricObject === null) return null;
    const percentage = metricObject.pct;
    if (!Number.isFinite(percentage)) return null;
    result[metric] = percentage as number;
  }
  return Object.freeze(result as Record<CoverageMetric, number>);
};

const parseMutation = (value: unknown): Readonly<{ total: number; killed: number; survived: number; noCoverage: number }> | null => {
  const root = object(value);
  if (root === null) return null;
  const files = root.files;
  const fileEntries = object(files);
  if (fileEntries === null) return null;
  let total = 0;
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  for (const file of Object.values(fileEntries)) {
    const fileObject = object(file);
    if (fileObject === null) return null;
    const mutants = fileObject.mutants;
    if (!Array.isArray(mutants)) return null;
    for (const mutant of mutants) {
      const mutantObject = object(mutant);
      if (mutantObject === null) return null;
      const status = mutantObject.status;
      if (typeof status !== "string") return null;
      total += 1;
      if (status === "Killed") killed += 1;
      if (status === "Survived") survived += 1;
      if (status === "NoCoverage") noCoverage += 1;
    }
  }
  return Object.freeze({ total, killed, survived, noCoverage });
};

const inspect = (input: VerificationEvidenceInput): VerificationEvidenceResult => {
  const coveragePath = join(input.root, input.coverageFileName ?? "coverage-summary.json");
  const mutationPath = join(input.root, input.mutationFileName ?? "mutation.json");
  const issues: string[] = [];
  const coverageRaw = safelyReadJson(coveragePath);
  const mutationRaw = safelyReadJson(mutationPath);
  const coverage = parseCoverage(coverageRaw);
  const mutation = parseMutation(mutationRaw);

  if (coverageRaw === null) issues.push("coverage:missing");
  else if (!isFresh(coveragePath, input.startedAtMs)) issues.push("coverage:stale");
  if (coverage === null && coverageRaw !== null) issues.push("coverage:invalid");
  if (coverage !== null) for (const metric of metrics) if (coverage[metric] !== 100) issues.push(`coverage:${metric}:${coverage[metric]}`);

  if (mutationRaw === null) issues.push("mutation:missing");
  else if (!isFresh(mutationPath, input.startedAtMs)) issues.push("mutation:stale");
  if (mutation === null && mutationRaw !== null) issues.push("mutation:invalid");
  if (mutation !== null && mutation.total === 0) issues.push("mutation:empty");
  if (mutation !== null && mutation.survived > 0) issues.push(`mutation:survived:${mutation.survived}`);
  if (mutation !== null && mutation.noCoverage > 0) issues.push(`mutation:no-coverage:${mutation.noCoverage}`);

  return Object.freeze({ ok: issues.length === 0, coverage, mutation, issues: Object.freeze(issues) });
};

export const VerificationEvidence = Object.freeze({ inspect });
