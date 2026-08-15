# 桌面运行时装配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不创建或设计渲染界面的前提下，建立桌面端生产运行时组合根，统一启动、停止并暴露中继、媒体与直播控制模块。

**Architecture:** 新增 `desktop-runtime` 作为生产装配模块。它只拥有生命周期顺序、跨模块只读快照和资源回收；飞行、航线、设备与媒体规则留在既有模块。Node WebSocket 传输使用既有适配器，媒体与系统能力继续通过明确端口注入。

**Tech Stack:** TypeScript、Node.js、`ws`、Vitest、既有模块契约。

## 全局约束

- 所有新增契约为中文，先写契约与失败测试，再写实现。
- 组合根不导入 Electron、DOM、DJI SDK 或前端框架。
- 启动顺序固定为中继监听、媒体服务；停止顺序固定为直播命令终止、媒体停止、中继停止。
- 公开快照与结果必须为冻结副本，异常不得穿过公开接口。
- 本阶段不新增窗口、IPC 方法、HTML、React/Vue 或任何页面实现。

---

### Task 1: 建立桌面运行时契约与失败测试

**Files:**
- Create: `src/production/desktop-runtime/CONTRACT.md`
- Create: `tests/desktop-runtime-contract.test.ts`
- Create: `tests/desktop-runtime-architecture.test.ts`
- Create: `tests/desktop-runtime-type-contract.ts`
- Create: `tests/desktop-runtime-performance.perf.ts`
- Create: `stryker.desktop-runtime.config.json`

**Interface:** `DesktopRuntime.create(dependencies, options)` 产生仅含 `start`、`stop`、`snapshot`、`services` 与 `subscribe` 的实例。

- [ ] 写入失败测试，断言中继先启动、媒体随后启动、媒体失败时中继回滚停止。
- [ ] 运行 `npx vitest run tests/desktop-runtime-contract.test.ts`，确认因模块不存在而失败。
- [ ] 写入中文契约、架构、类型和性能测试骨架。

### Task 2: 实现桌面运行时生命周期组合根

**Files:**
- Create: `src/production/desktop-runtime/index.ts`
- Modify: `tests/desktop-runtime-contract.test.ts`

- [ ] 为重复启动、启动回滚、反向停止、订阅隔离和冻结快照写失败测试。
- [ ] 运行局部测试，确认失败原因是缺少实现。
- [ ] 实现最小生命周期组合根，不把业务决策移入组合根。
- [ ] 运行 `npx vitest run tests/desktop-runtime-contract.test.ts tests/desktop-runtime-architecture.test.ts`。

### Task 3: 建立实际 Node WebSocket 中继工厂

**Files:**
- Create: `src/production/node-runtime/CONTRACT.md`
- Create: `src/production/node-runtime/index.ts`
- Create: `tests/node-runtime-contract.test.ts`
- Create: `tests/node-runtime-architecture.test.ts`
- Create: `tests/node-runtime-type-contract.ts`
- Create: `tests/node-runtime-performance.perf.ts`
- Create: `stryker.node-runtime.config.json`

**Interface:** `NodeRuntime.createRelay(options)` 固定使用 `NodeWebSocketRelayTransport` 创建 `RelayLinkInstance`，不启动服务、不创建媒体服务、不实现业务规则。

- [ ] 写失败测试，确认工厂输出的中继能按既有 `RelayLink` 接口启动。
- [ ] 运行局部测试，确认模块不存在而失败。
- [ ] 实现 Node 工厂并执行局部契约、架构、类型和性能测试。

### Task 4: 执行质量门禁与全量回归

**Files:**
- Modify: `vitest.config.ts`

- [ ] 把两个生产模块纳入全局覆盖率。
- [ ] 运行两个局部覆盖率和 Stryker 配置，阈值均为 100%。
- [ ] 运行 `npm test`、`npm run test:types`、`npm run test:coverage`、`npm run test:performance`。
