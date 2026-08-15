import { expect, it } from "vitest";
import { CapabilityGate, DeviceConsole, DeviceGuidance, DeviceSettingsPanel, LinkChain, PairingController } from "../src/modules/device-console/index.js";
import { CapabilityGate as DirectCapabilityGate } from "../src/modules/device-console/capability-gate/index.js";
import { DeviceGuidance as DirectDeviceGuidance } from "../src/modules/device-console/device-guidance/index.js";
import { DeviceSettingsPanel as DirectDeviceSettingsPanel } from "../src/modules/device-console/device-settings-panel/index.js";
import { LinkChain as DirectLinkChain } from "../src/modules/device-console/link-chain/index.js";
import { PairingController as DirectPairingController } from "../src/modules/device-console/pairing-controller/index.js";

it("通过冻结的一级门面稳定公开全部设备控制台二级模块", () => {
  expect(Object.isFrozen(DeviceConsole)).toBe(true);
  expect(Object.keys(DeviceConsole)).toEqual(["LinkChain", "CapabilityGate", "PairingController", "DeviceGuidance", "DeviceSettingsPanel"]);
  expect(DeviceConsole.LinkChain).toBe(LinkChain);
  expect(DeviceConsole.CapabilityGate).toBe(CapabilityGate);
  expect(DeviceConsole.PairingController).toBe(PairingController);
  expect(DeviceConsole.DeviceGuidance).toBe(DeviceGuidance);
  expect(DeviceConsole.DeviceSettingsPanel).toBe(DeviceSettingsPanel);
  expect(LinkChain).toBe(DirectLinkChain);
  expect(CapabilityGate).toBe(DirectCapabilityGate);
  expect(PairingController).toBe(DirectPairingController);
  expect(DeviceGuidance).toBe(DirectDeviceGuidance);
  expect(DeviceSettingsPanel).toBe(DirectDeviceSettingsPanel);
  expect(Object.getOwnPropertyDescriptor(DeviceConsole, "LinkChain")).toEqual({ value: LinkChain, enumerable: true, writable: false, configurable: false });
});
