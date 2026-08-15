import { DeviceSettingsPanel, type DeviceSettingsPanelInstance, type DeviceSettingsSnapshot } from "../src/modules/device-console/device-settings-panel/index.js";

declare const panel: DeviceSettingsPanelInstance;
declare const snapshot: DeviceSettingsSnapshot;
void DeviceSettingsPanel;
void panel;
// @ts-expect-error 设置快照不可变。
snapshot.transmissionPending = true;
// @ts-expect-error 相机快照不可变。
snapshot.camera = null;
