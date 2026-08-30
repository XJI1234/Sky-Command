import { join } from "node:path";

export interface ElectronRuntimeDataPaths {
  readonly httpFlvRoot: string;
  readonly logPath: string;
}

/** Runtime outputs are deliberately separate from packaged, read-only app resources. */
export function runtimeDataPaths(userDataDirectory: string): ElectronRuntimeDataPaths {
  return Object.freeze({
    httpFlvRoot: join(userDataDirectory, "tmp-http-flv"),
    logPath: join(userDataDirectory, "tmp", "desktop-launch.log"),
  });
}
