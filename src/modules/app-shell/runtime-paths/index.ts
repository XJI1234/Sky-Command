export interface RuntimePathsInput {
  readonly userData: string;
  readonly appRoot: string;
  readonly rendererEntry: string;
  readonly packaged: boolean;
}
export interface RuntimePathsSnapshot extends RuntimePathsInput {}
export type RuntimePathsResult = Readonly<{ readonly ok: true; readonly value: RuntimePathsSnapshot }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" }>;

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function invalid(): RuntimePathsResult { return Object.freeze({ ok: false as const, code: "INVALID_INPUT" as const }); }
function absolutePath(value: unknown): value is string { return typeof value === "string" && /^(?:[A-Za-z]:[\\/]|\/)/.test(value) && value.trim().length > 3; }
function rendererPath(value: unknown): value is string { return typeof value === "string" && /^(?:https?:\/\/|file:\/\/\/)/.test(value) && value.trim().length > 10; }

function resolve(input: unknown): RuntimePathsResult {
  try {
    if (Object.prototype.toString.call(input) !== "[object Object]") return invalid();
    const value = input as RuntimePathsInput;
    if (!absolutePath(value.userData) || !absolutePath(value.appRoot) || !rendererPath(value.rendererEntry) || typeof value.packaged !== "boolean") return invalid();
    return freeze({ ok: true as const, value: freeze({ userData: value.userData, appRoot: value.appRoot, rendererEntry: value.rendererEntry, packaged: value.packaged }) });
  } catch { return invalid(); }
}

class RuntimePathsApi {
  readonly resolve = resolve;
}

export const RuntimePaths = freeze(new RuntimePathsApi());
