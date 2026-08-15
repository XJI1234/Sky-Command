import type { CapabilityDecision, LinkChainSnapshot, PairingRequestSnapshot } from "../src/modules/device-console/index.js";

declare const capability: CapabilityDecision;
declare const link: LinkChainSnapshot;
declare const pairing: PairingRequestSnapshot;

// @ts-expect-error 能力决策不可变。
capability.enabled = false;
// @ts-expect-error 链路快照不可变。
link.computerToPhone = "disconnected";
// @ts-expect-error 配对请求快照不可变。
pairing.phase = "idle";
