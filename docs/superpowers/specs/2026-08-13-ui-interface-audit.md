# UI 接口对账审计

状态：进行中

范围：Sky Command 桌面端与 MSDK Relay Android 端之间，所有将被设备、航线和飞行工作区消费的展示事实、操作命令与反馈结果。

## 已验证的模块事实

- Sky Command 已通过 132 个测试文件、1306 个测试；TypeScript 类型检查通过。
- MSDK Relay 已实现并注册遥测、配对、航线、图传、起飞/降落/返航和相机/图传设置命令。
- 两端均使用 Relay v1 帧协议；`command-result.result` 可承载结构化设置快照，`mission-phase` 可承载 `START_POINT_REACHED` 与 `ROUTE_EXECUTION_STARTED`。

这些结果证明模块内规则与帧编解码正确，不证明生产装配或 DJI 真机已经成功。

## UI 能力对账结果

| UI 事实或操作 | 手机端实际协议/事实 | 桌面端当前状态 | 结论 |
| --- | --- | --- | --- |
| 设备链路状态 | `sdkAvailability`、`remoteController`、`flightController`、`aircraft` 枚举 | 门禁与链路视图读取旧布尔字段 | 阻塞：需要统一遥测投影 |
| 航线可用性 | `capabilities.waypointMission=true`、`waypointMissionSupport="SUPPORTED"` | 门禁只接受小写 `supported` | 阻塞：正常机型会被错误拒绝 |
| 航线暂存/上传/启动 | `mission-result`、`wayline.*`、`ROUTE_EXECUTION_STARTED` | 启动后保持 `starting`，收到阶段事实后转 `running` | 可用，但契约需更正术语 |
| 暂停/继续/停止反馈 | 手机只在 DJI 终态回调后回传命令结果 | 桌面在等待命令结果时就写入 `paused` 或恢复执行 | 阻塞：UI 会短暂显示未经确认的事实 |
| 图传开关 | `live-stream.start { rtmpUrl }`、`live-stream.stop {}` | 业务模块命令语义匹配，但尚无 Node RTMP/HLS 生产适配器 | 协议可接，现场运行尚不可声明 |
| 起飞/降落/返航 | 仅三条 `flight.*`，每条必须 `{ confirm: true }` | 桌面仍发送空字段，并暴露手机端不存在的取消命令 | 阻塞：会被手机端拒绝 |
| 相机/图传设置 | `command-result.result` 返回完整快照 | 专用桌面适配器已可读取结构化结果 | 可接入，待统一装配 |
| 任务与图传多设备隔离 | 每个 Android Relay 代表一架当前飞机 | 各业务模块按 `deviceId` 隔离 | 可用，装配层必须保留该边界 |
| 三维地图 | 路线预览模型与地图引擎端口 | 尚无 Cesium/天地图生产引擎适配器 | 不能声明为可运行 |
| 桌面窗口与 IPC | app-shell 的纯端口与测试替身 | 尚无 Electron 生产适配器和业务白名单装配 | 不能声明为可运行 |

## 必须先完成的修复

1. 新建协议适配组合层，把 `RelayLink` 的 `JsonValue` 帧对象转换为受类型保护的桌面遥测与业务端口；业务模块和 UI 均不得直接解析协议 JSON。
2. 修正飞控命令集合与 `confirm: true` 字段，删除未被手机端注册的取消类命令。
3. 将航线暂停、继续和停止拆为“请求中”与“手机/DJI 已确认”两个事实，禁止乐观显示。
4. 为生产 Electron、地图和媒体端口建立独立适配器，并做本地集成验证；在此之前 UI 必须显示“桌面服务未装配”，而不是可用。
5. 完成实际组合根的跨端测试，至少覆盖遥测投影、全部命令字段、命令拒绝、断连、迟到结果和多 Relay 隔离。

## 结论

当前模块质量足以作为修复基础，但尚不能诚实地说“每个 UI 按钮都能在现场工作”。以上阻塞项完成并通过跨端组合测试前，界面只可展示相应的未装配或实机待验证状态。

## 2026-08-13 修复进展

已完成并通过桌面端全量类型与契约测试的修复：

1. 新增 `relay-operations-adapter`，将 Android 的 `READY`、`CONNECTED`、`SUPPORTED` 等遥测枚举投影为桌面端既有的布尔和小写能力事实；未知枚举、`null`、畸形数值均不会被推断为成功。
2. 航线、图传、配对、飞控和设置命令均经该适配层发送。三条飞控命令严格限定为 `flight.takeoff`、`flight.land`、`flight.return-home`，且一律携带 `{ confirm: true }`。
3. `direct-flight` 已成为正式能力门禁操作，不再被错误判定为无效输入。
4. 航线暂停和继续增加 `pausing`、`resuming` 请求中阶段；只有手机端完成对应 DJI 调用后才显示 `paused` 或 `running`。

验证证据：`npm run test:types`、`npm test` 和 `npm run test:coverage` 均通过；全量测试为 133 个测试文件、1310 项测试。现有全局覆盖率清单尚未纳入新增适配器，因此其独立覆盖率门禁仍待生产组合模块完成后一起补入。

仍未完成的阻塞项：实际业务组合根尚未把 `RelayOperationsAdapter` 与设备、航线、图传、飞控、设置模块装配成一个可由 UI 调用的单一门面；地图、媒体和 Electron 的生产端口也尚未形成实机可运行组合。因此界面设计可以以这些已验证的一级能力为依据，但不得将这些能力展示成“本机服务已就绪”或“飞机操作已现场验证”。
