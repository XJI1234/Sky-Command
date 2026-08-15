import { chdir } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
chdir(projectRoot);
await import("../src/production/electron-host/launch.ts");
