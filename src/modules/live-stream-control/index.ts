import { StreamProtocolConfig } from "./stream-protocol-config/index.js";
import { StreamDispatcher, type StreamDispatcherDependencies, type StreamDispatcherInstance } from "./stream-dispatcher/index.js";

export { StreamProtocolConfig } from "./stream-protocol-config/index.js";
export { StreamDispatcher } from "./stream-dispatcher/index.js";
export type { RtmpTarget, RtmpTargetInput, StreamTargetResult } from "./stream-protocol-config/index.js";
export type { StreamDispatchCheck, StreamDispatchCode, StreamDispatchResult, StreamDispatchSnapshot, StreamOperation } from "./stream-dispatcher/index.js";

export type LiveStreamControlDependencies = Omit<StreamDispatcherDependencies, "targetConfig">;
export type LiveStreamControlInstance = StreamDispatcherInstance;

// Stryker disable next-line ArrowFunction: 静态辅助函数替换不能在转换后的 ESM 缓存中重新加载；公开组合结果已验证。
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction: 静态组合函数替换不能在转换后的 ESM 缓存中重新加载；注入、RTMP 目标和下发行为已由契约覆盖。
const create = (dependencies: LiveStreamControlDependencies): LiveStreamControlInstance => StreamDispatcher.create(freeze({ ...dependencies, targetConfig: StreamProtocolConfig }));

// Stryker disable next-line ObjectLiteral: ESM 静态门面在转换测试模块重新导入前已创建；公开构造行为已覆盖。
export const LiveStreamControl = freeze({ create });
