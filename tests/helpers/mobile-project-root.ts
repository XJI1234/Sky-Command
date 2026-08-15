import { resolve } from "node:path";

export const mobileProjectRoot = resolve(
  process.env.MSDK_RELAY_PROJECT_ROOT ?? resolve(process.cwd(), "..", "MSDK-relay"),
);
