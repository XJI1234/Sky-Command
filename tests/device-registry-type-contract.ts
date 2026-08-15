import { DeviceRegistry, type DeviceRegistration, type DeviceRegistrySnapshot } from "../src/modules/relay-link/device-registry/index.js";

declare const registration: DeviceRegistration;
declare const snapshot: DeviceRegistrySnapshot;
const registry = DeviceRegistry.create();
const result = registry.register(registration);
registry.subscribe((value) => void value);
void registry.getByConnection("connection");
void registry.getByDevice("device");
void registry.removeByConnection("connection");
void registry.removeByDevice("device");
void registry.snapshot();
void snapshot;
void result;

// @ts-expect-error Registration requires all three identity fields.
registry.register({ connectionId: "connection", deviceId: "device" });
