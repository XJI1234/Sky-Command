import { CapabilityGate } from "./capability-gate/index.js";
import { DeviceGuidance } from "./device-guidance/index.js";
import { DeviceSettingsPanel } from "./device-settings-panel/index.js";
import { LinkChain } from "./link-chain/index.js";
import { PairingController } from "./pairing-controller/index.js";

export { CapabilityGate } from "./capability-gate/index.js";
export type { CapabilityDecision, CapabilityDecisionResult, CapabilityReason, DeviceOperation } from "./capability-gate/index.js";
export { DeviceGuidance } from "./device-guidance/index.js";
export type { DeviceGuidanceAction, DeviceGuidanceCode, DeviceGuidanceFailureReason, DeviceGuidanceResult, DeviceGuidanceSnapshot } from "./device-guidance/index.js";
export { DeviceSettingsPanel } from "./device-settings-panel/index.js";
export type { CameraSettings, CameraSettingsPatch, DeviceSettingsPanelInstance, DeviceSettingsPort, DeviceSettingsResult, DeviceSettingsSnapshot, PortResult, TransmissionSettings, TransmissionSettingsPatch } from "./device-settings-panel/index.js";
export { LinkChain } from "./link-chain/index.js";
export type { LinkChainResult, LinkChainSnapshot, LinkChainTelemetry, LinkStatus } from "./link-chain/index.js";
export { PairingController } from "./pairing-controller/index.js";
export type { PairingAction, PairingControllerInstance, PairingRelayPort, PairingRequestResult, PairingRequestSnapshot } from "./pairing-controller/index.js";

// Stryker disable next-line ObjectLiteral: the ESM-static facade is instantiated before the transformed test module can re-import it; identity and descriptor behavior are nevertheless covered by the public contract test.
export const DeviceConsole = Object.freeze({ LinkChain, CapabilityGate, PairingController, DeviceGuidance, DeviceSettingsPanel });
