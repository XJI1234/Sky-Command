import { createError, type DomainResult } from "../../domain/index.js";

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const SEQUENCE = /^(?:0|[1-9][0-9]*)$/u;
const ABSOLUTE_PATH = /(?:^|[ \t\r\n,])(?:[A-Za-z]:[\\/]|\\\\|\/[^ \t\r\n,])/u;

export function summary(value: string): string {
  const bounded = Array.from(value).slice(0, 160).join("");
  return ABSOLUTE_PATH.test(bounded) ? "[redacted]" : bounded;
}

export function coordinateError(field: string, index: number, rawSummary: string, reason: string): DomainResult<never> {
  return Object.freeze({
    ok: false as const,
    error: createError("INVALID_COORDINATE", { field, index, reason, rawSummary: summary(rawSummary) })
  });
}

export function parseDecimal(value: unknown, field: string, index: number, rawSummary: string): DomainResult<number> {
  const text = value as string;
  if (!DECIMAL.test(text)) return coordinateError(field, index, rawSummary, "invalid-decimal");
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return coordinateError(field, index, rawSummary, "not-finite");
  return Object.freeze({ ok: true as const, value: parsed });
}

export function parseSequence(value: unknown, index: number, rawSummary: string): DomainResult<number> {
  const text = value as string;
  if (!SEQUENCE.test(text)) return coordinateError("sequence", index, rawSummary, "invalid-sequence");
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) return coordinateError("sequence", index, rawSummary, "not-safe-integer");
  return Object.freeze({ ok: true as const, value: parsed });
}
