import { MapSettings, type MapSettingsPatch, type MapSettingsValue } from "../src/modules/desktop-settings/map-settings/index.js";

declare const current: MapSettingsValue;
const patch: MapSettingsPatch = { basemap: "tianditu-image", credential: null };
const result = MapSettings.patch(current, patch);

// @ts-expect-error Map patches do not accept arbitrary basemap identifiers.
const invalidBasemap: MapSettingsPatch = { basemap: "open-street-map" };
// @ts-expect-error Map patches do not accept numeric credentials.
const invalidCredential: MapSettingsPatch = { credential: 7 };

void result;
void invalidBasemap;
void invalidCredential;
