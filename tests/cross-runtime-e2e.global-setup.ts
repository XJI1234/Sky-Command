import { resolve } from "node:path";
import { DesktopTestHost } from "../src/modules/cross-runtime-e2e/desktop-test-host/index.js";

export default async function prepareCrossRuntimeHarness(): Promise<void> {
  const mobileProjectRoot = resolve(
    process.env.MSDK_RELAY_PROJECT_ROOT ?? resolve(process.cwd(), "..", "MSDK-relay"),
  );
  await DesktopTestHost.prepare(mobileProjectRoot);
}
