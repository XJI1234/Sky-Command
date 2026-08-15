import { NodeRuntime, type NodeRelayOptions } from "../src/production/node-runtime/index.js";

declare const options: NodeRelayOptions;
const relay = NodeRuntime.createRelay(options);
void relay.start();

const isolatedDiagnostics: NodeRelayOptions = {
  ...options,
  diagnosticSink: { persist: () => true },
};
NodeRuntime.createRelay(isolatedDiagnostics);

// @ts-expect-error 生产工厂不允许调用方注入 WebSocket 传输实现。
NodeRuntime.createRelay({ ...options, transport: {} });
