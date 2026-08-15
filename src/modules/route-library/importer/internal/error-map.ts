import type { RouteErrorCode } from "../../domain/index.js";

export class ImporterPhaseError extends Error {
  readonly code: RouteErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean | null>> | undefined;

  constructor(code: RouteErrorCode, details?: Readonly<Record<string, string | number | boolean | null>>) {
    super();
    this.code = code;
    this.details = details;
  }
}

export class ImporterCancelled extends Error {
  constructor() {
    super();
  }
}
