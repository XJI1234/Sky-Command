# 航线规划一级模块完成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 完成 `route-planning` 的工作区编排能力，使已验证的纯规划能力能够通过地图取点形成、预览、定位和清除航点计划。

**架构：** `plan-workspace` 作为唯一的工作区适配器，依赖一个狭窄的规划器端口和地图端口。规划几何继续留在 `planning-domain`，工作区只保存不可变的 UI 草案状态，绝不接触文件、地图引擎、网络或任务下发。

**技术栈：** TypeScript、Vitest、V8 覆盖率、Stryker。

## 全局约束

- 所有模块契约使用中文，先写契约与失败测试，再写实现。
- 对外状态和命令结果必须是冻结副本；适配器或监听器异常不得向调用方泄漏。
- 不依赖 Electron、Vue、Cesium、Node 文件系统、网络、`route-library`、`relay-link` 或 DJI SDK。
- 保持全局类型检查、覆盖率、性能检查和本模块 100% 变异测试门槛。

---

### Task 1: PlanWorkspace 契约与 RED 测试

**Files:**
- Create: `src/modules/route-planning/plan-workspace/CONTRACT.md`
- Create: `tests/plan-workspace-contract.test.ts`

**Interfaces:**
- Consumes: `planner.planOrbit(input) -> PlanningResult<OrbitPlan>`。
- Produces: `PlanWorkspace.create({ planner, map }) -> PlanWorkspaceInstance`。

- [x] **Step 1: 写入工作区契约**

规定 `setCenter`、`setEdge`、`setParameters`、`buildOrbit`、`locatePlan`、`clear`、`snapshot`、`subscribe` 的输入、输出、状态、错误隔离和依赖限制。

- [x] **Step 2: 写失败的合同测试**

```ts
const workspace = PlanWorkspace.create({ planner, map });
workspace.setCenter({ longitude: 120, latitude: 30 });
workspace.setEdge({ longitude: 120, latitude: 30.001 });
expect(workspace.buildOrbit()).toEqual({ ok: true });
```

- [x] **Step 3: 运行失败测试**

Run: `npx vitest run tests/plan-workspace-contract.test.ts`
Expected: FAIL，因为公开模块尚不存在。

### Task 2: PlanWorkspace 最小实现

**Files:**
- Create: `src/modules/route-planning/plan-workspace/index.ts`

**Interfaces:**
- Consumes: Task 1 中冻结的规划器和地图端口。
- Produces: 无框架、可独立创建的工作区实例。

- [x] **Step 1: 实现不可变快照和状态更新**
- [x] **Step 2: 实现取点、参数更新、规划、预览、定位和清除**
- [x] **Step 3: 隔离端口与监听器异常并保持旧计划**
- [x] **Step 4: 运行合同测试并确认通过**

### Task 3: 一级模块组装和机械化验证

**Files:**
- Modify: `src/modules/route-planning/index.ts`
- Modify: `src/modules/route-planning/CONTRACT.md`
- Modify: `tests/route-planning-contract.test.ts`
- Modify: `vitest.config.ts`
- Create: `tests/route-planning-architecture.test.ts`
- Create: `stryker.plan-workspace.config.json`

- [x] **Step 1: 用失败测试规定一级门面暴露工作区创建能力**
- [x] **Step 2: 组装入口并更新中文总契约的职责表**
- [x] **Step 3: 添加导入隔离测试和覆盖率配置**
- [x] **Step 4: 运行类型、覆盖、性能、模块变异以及完整测试集**
