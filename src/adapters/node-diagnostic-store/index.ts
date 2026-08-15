import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RelayDiagnosticSink } from "../../modules/relay-link/index.js";

export interface NodeDiagnosticStoreOptions { readonly filePath?: string; }

function defaultFilePath(): string {
  const localAppData = process.env.LOCALAPPDATA;
  return typeof localAppData === "string" && localAppData.trim().length > 0
    ? join(localAppData, "Sky Command", "diagnostics", "relay-events.ndjson")
    : join(process.cwd(), "diagnostics", "relay-events.ndjson");
}

function create(options: NodeDiagnosticStoreOptions = {}): RelayDiagnosticSink {
  const filePath = options.filePath ?? defaultFilePath();
  return Object.freeze({
    persist(input: Parameters<RelayDiagnosticSink["persist"]>[0]): boolean {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        appendFileSync(filePath, `${JSON.stringify(input)}\n`, "utf8");
        return true;
      } catch {
        return false;
      }
    }
  });
}

export const NodeDiagnosticStore = Object.freeze({ create });
