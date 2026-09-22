import { join } from "node:path";

export interface ElectronRuntimeDataPaths {
  readonly httpFlvRoot: string;
  readonly logPath: string;
  readonly photosRoot: string;
}

/** Runtime outputs are deliberately separate from packaged, read-only app resources. */
export function runtimeDataPaths(
  userDataDirectory: string,
  localAppDataDirectory = process.env.LOCALAPPDATA,
): ElectronRuntimeDataPaths {
  const localRoot = typeof localAppDataDirectory === "string" && localAppDataDirectory.trim().length > 0
    ? join(localAppDataDirectory, "Sky Command")
    : userDataDirectory;
  return Object.freeze({
    httpFlvRoot: join(userDataDirectory, "tmp-http-flv"),
    logPath: join(userDataDirectory, "tmp", "desktop-launch.log"),
    photosRoot: join(localRoot, "photos"),
  });
}
