import { appendFile, mkdir } from "node:fs/promises";
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
  let writes: Promise<void> = Promise.resolve();
  return Object.freeze({
    persist(input: Parameters<RelayDiagnosticSink["persist"]>[0]): Promise<boolean> {
      let line: string;
      try {
        line = `${JSON.stringify(input)}\n`;
      } catch {
        return Promise.resolve(false);
      }
      const write = async (): Promise<boolean> => {
        try {
          await mkdir(dirname(filePath), { recursive: true });
          await appendFile(filePath, line, "utf8");
          return true;
        } catch {
          return false;
        }
      };
      const completed = writes.then(write, write);
      writes = completed.then(() => undefined, () => undefined);
      return completed;
    }
  });
}

export const NodeDiagnosticStore = Object.freeze({ create });
