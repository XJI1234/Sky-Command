import { randomUUID } from "node:crypto";
import { NodeDiagnosticStore } from "../../adapters/node-diagnostic-store/index.js";
import { NodeWebSocketRelayTransport } from "../../adapters/node-websocket-relay/index.js";
import { RelayLink, type RelayDiagnosticSink, type RelayLinkInstance, type RelayLinkOptions } from "../../modules/relay-link/index.js";

export interface NodeRelayOptions {
  readonly address: RelayLinkOptions["address"];
  readonly handshakeTimeoutMs: RelayLinkOptions["handshakeTimeoutMs"];
  readonly maxConnections: RelayLinkOptions["maxConnections"];
  readonly commandTimeoutMs: RelayLinkOptions["commandTimeoutMs"];
  readonly missionTimeoutMs: RelayLinkOptions["missionTimeoutMs"];
  readonly diagnosticSink?: RelayDiagnosticSink;
}

// Stryker disable next-line ObjectLiteral: ESM 静态调度器在转换测试模块重新导入前已创建；真实握手已验证其公开行为。
const scheduler: RelayLinkOptions["scheduler"] = Object.freeze({
  // Stryker disable next-line ArrowFunction: 静态调度器方法不能在转换后的 ESM 缓存中重新加载；真实握手已经调用该方法。
  setTimeout: (callback: () => void, milliseconds: number): unknown => setTimeout(callback, milliseconds),
  // Stryker disable next-line BlockStatement: 配对后超时回调由 relay-server 的阶段守卫忽略；是否清除句柄不改变公开会话结果。
  clearTimeout: (handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>); }
});

function createRelay(options: NodeRelayOptions): RelayLinkInstance {
  return RelayLink.create({
    ...options,
    transport: NodeWebSocketRelayTransport.create(),
    scheduler,
    now: () => Date.now(),
    createConnectionId: randomUUID,
    createSessionId: () => randomUUID(),
    createCommandId: randomUUID,
    diagnosticSink: options.diagnosticSink ?? NodeDiagnosticStore.create()
  });
}

// Stryker disable next-line ObjectLiteral: ESM 静态门面在转换测试模块重新导入前已创建；公开工厂与实际握手均已覆盖。
export const NodeRuntime = Object.freeze({ createRelay });
