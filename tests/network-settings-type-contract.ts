import { NetworkSettings, type NetworkSettingsPatch, type NetworkSettingsValue } from "../src/modules/desktop-settings/network-settings/index.js";

declare const current: NetworkSettingsValue;
const patch: NetworkSettingsPatch = { listenPort: 19501, relayPort: 18080 };
const result = NetworkSettings.patch(current, patch);

// @ts-expect-error Network patches do not accept unrelated fields.
const invalidPatch: NetworkSettingsPatch = { host: "10.0.0.1" };

void result;
void invalidPatch;
