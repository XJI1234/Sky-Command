import { DesktopSettings, type SettingsSnapshot, type SettingsStorage } from "../src/modules/desktop-settings/index.js";

const storage: SettingsStorage = {
  read: async () => null,
  writeAtomically: async () => undefined
};
const snapshot: SettingsSnapshot = DesktopSettings.create(storage).snapshot();

// @ts-expect-error Snapshot version is a stable literal, not an arbitrary number.
snapshot.version = 2;

void snapshot;
