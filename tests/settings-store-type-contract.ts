import { DesktopSettings, type SettingsStorage } from "../src/modules/desktop-settings/settings-store/index.js";

const storage: SettingsStorage = {
  read: async () => null,
  writeAtomically: async (_bytes) => undefined
};
const instance = DesktopSettings.create(storage);
const result = instance.updateMap({ basemap: "tianditu-vector", credential: null });

// @ts-expect-error Storage adapters must expose both async operations.
const incomplete: SettingsStorage = { read: async () => null };

void result;
void incomplete;
