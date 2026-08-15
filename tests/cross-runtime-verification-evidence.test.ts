import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VerificationEvidence } from "../src/modules/cross-runtime-e2e/verification-evidence.js";

const workspace = (): string => mkdtempSync(join(tmpdir(), "sky-command-evidence-"));

const coverage = (percent: number) => JSON.stringify({
  total: {
    lines: { total: 10, covered: percent === 100 ? 10 : 9, skipped: 0, pct: percent },
    statements: { total: 10, covered: percent === 100 ? 10 : 9, skipped: 0, pct: percent },
    functions: { total: 10, covered: percent === 100 ? 10 : 9, skipped: 0, pct: percent },
    branches: { total: 10, covered: percent === 100 ? 10 : 9, skipped: 0, pct: percent },
  },
});

const mutation = (killed: number, survived: number, noCoverage = 0) => JSON.stringify({
  schemaVersion: "1.0",
  files: {
    "src/modules/cross-runtime-e2e/workflow-model.ts": {
      mutants: [
        ...Array.from({ length: killed }, () => ({ status: "Killed" })),
        ...Array.from({ length: survived }, () => ({ status: "Survived" })),
        ...Array.from({ length: noCoverage }, () => ({ status: "NoCoverage" })),
      ],
    },
  },
});

describe("跨运行时验收证据门禁", () => {
  it("拒绝缺失、过期、未满覆盖或残存变异的证据", () => {
    const root = workspace();
    try {
      expect(VerificationEvidence.inspect({ root, startedAtMs: Date.now() })).toMatchObject({ ok: false, issues: ["coverage:missing", "mutation:missing"] });

      writeFileSync(join(root, "coverage-summary.json"), coverage(90));
      writeFileSync(join(root, "mutation.json"), mutation(1, 1));
      expect(VerificationEvidence.inspect({ root, startedAtMs: Date.now() + 1_000 })).toMatchObject({
        ok: false,
        issues: expect.arrayContaining(["coverage:stale", "mutation:stale", "coverage:branches:90", "mutation:survived:1"]),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("仅接受本轮完整覆盖且所有变异被杀死的报告", () => {
    const root = workspace();
    try {
      writeFileSync(join(root, "coverage-summary.json"), coverage(100));
      writeFileSync(join(root, "mutation.json"), mutation(3, 0));

      expect(VerificationEvidence.inspect({ root, startedAtMs: 0 })).toEqual({
        ok: true,
        coverage: { lines: 100, statements: 100, functions: 100, branches: 100 },
        mutation: { total: 3, killed: 3, survived: 0, noCoverage: 0 },
        issues: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("拒绝结构畸形、空变异和未覆盖变异报告", () => {
    const root = workspace();
    try {
      writeFileSync(join(root, "coverage-summary.json"), JSON.stringify({ total: { lines: { pct: null }, statements: { pct: 100 }, functions: { pct: 100 }, branches: { pct: 100 } } }));
      writeFileSync(join(root, "mutation.json"), JSON.stringify({ files: { "module.ts": { mutants: [] } } }));
      expect(VerificationEvidence.inspect({ root, startedAtMs: 0 })).toMatchObject({
        ok: false,
        issues: expect.arrayContaining(["coverage:invalid", "mutation:empty"]),
      });

      writeFileSync(join(root, "coverage-summary.json"), coverage(100));
      writeFileSync(join(root, "mutation.json"), mutation(1, 0, 1));
      expect(VerificationEvidence.inspect({ root, startedAtMs: 0 })).toMatchObject({
        ok: false,
        mutation: { total: 2, killed: 1, survived: 0, noCoverage: 1 },
        issues: ["mutation:no-coverage:1"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("拒绝不可解析的报告和非对象条目", () => {
    const root = workspace();
    try {
      writeFileSync(join(root, "coverage-summary.json"), "{");
      writeFileSync(join(root, "mutation.json"), JSON.stringify({ files: { "module.ts": { mutants: [{}] } } }));
      expect(VerificationEvidence.inspect({ root, startedAtMs: 0 })).toMatchObject({
        ok: false,
        issues: expect.arrayContaining(["coverage:missing", "mutation:invalid"]),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("接受修改时间恰好等于本轮开始时间的报告", () => {
    const root = workspace();
    try {
      const coveragePath = join(root, "coverage-summary.json");
      const mutationPath = join(root, "mutation.json");
      writeFileSync(coveragePath, coverage(100));
      writeFileSync(mutationPath, mutation(1, 0));
      const startedAtMs = Math.min(statSync(coveragePath).mtimeMs, statSync(mutationPath).mtimeMs);
      expect(VerificationEvidence.inspect({ root, startedAtMs })).toMatchObject({ ok: true, issues: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("对每个 JSON 结构等价类都安全拒绝而不抛出异常", () => {
    const root = workspace();
    try {
      const coveragePath = join(root, "coverage-summary.json");
      const mutationPath = join(root, "mutation.json");
      const coverageShapes = ["null", "1", "[]", "{\"total\":null}", "{\"total\":{\"lines\":null}}"];
      const mutationShapes = ["null", "1", "[]", "{\"files\":null}", "{\"files\":{\"module.ts\":null}}", "{\"files\":{\"module.ts\":{\"mutants\":null}}}", "{\"files\":{\"module.ts\":{\"mutants\":[null]}}}"];
      for (const rawCoverage of coverageShapes) {
        writeFileSync(coveragePath, rawCoverage);
        writeFileSync(mutationPath, mutation(1, 0));
        expect(() => VerificationEvidence.inspect({ root, startedAtMs: 0 })).not.toThrow();
        expect(VerificationEvidence.inspect({ root, startedAtMs: 0 }).ok).toBe(false);
      }
      for (const rawMutation of mutationShapes) {
        writeFileSync(coveragePath, coverage(100));
        writeFileSync(mutationPath, rawMutation);
        expect(() => VerificationEvidence.inspect({ root, startedAtMs: 0 })).not.toThrow();
        expect(VerificationEvidence.inspect({ root, startedAtMs: 0 }).ok).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
