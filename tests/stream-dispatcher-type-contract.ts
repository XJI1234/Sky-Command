import { StreamDispatcher, type StreamDispatcherDependencies, type StreamDispatchResult } from "../src/modules/live-stream-control/stream-dispatcher/index.js";

declare const dependencies: StreamDispatcherDependencies;
const dispatcher = StreamDispatcher.create(dependencies);
const result: Promise<StreamDispatchResult> = dispatcher.start("phone-1");
void result;

// @ts-expect-error 调度器开始操作只接受设备标识。
dispatcher.start({ deviceId: "phone-1" });
// @ts-expect-error 调度器依赖必须包含命令发送端口。
const invalidDependencies: StreamDispatcherDependencies = { media: { snapshot: () => null }, relay: { latestTelemetry: () => null }, capabilityGate: { evaluate: () => ({}) }, targetConfig: { createRtmpTarget: () => ({}) } };
void invalidDependencies;
