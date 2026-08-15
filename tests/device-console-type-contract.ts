import { DeviceConsole, type CapabilityDecision, type DeviceSettingsPanelInstance, type LinkChainSnapshot, type PairingControllerInstance } from "../src/modules/device-console/index.js";

declare const snapshot: LinkChainSnapshot;
declare const decision: CapabilityDecision;
declare const pairing: PairingControllerInstance;
declare const settings: DeviceSettingsPanelInstance;

void DeviceConsole;
void decision;
void pairing;
void settings;
// @ts-expect-error 链路快照不可变。
snapshot.overall = "ready";
