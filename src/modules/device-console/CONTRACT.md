# 设备控制台一级模块契约

状态：已实施

## 1. 职责

`device-console` 是电脑端设备管理能力的唯一一级导入 seam。它向上层统一公开以下五个职责单一的二级模块：

- `LinkChain`：根据中继遥测计算电脑、手机、遥控器和飞行器之间的链路快照。
- `CapabilityGate`：根据链路和设备能力决定某项操作是否允许开始。
- `PairingController`：经注入端口发送遥控器配对开始、停止和刷新命令，并维护请求状态。
- `DeviceGuidance`：将链路与配对状态转换为面向操作者的下一步引导。
- `DeviceSettingsPanel`：经注入端口读取或写入已确认的图传和相机设置快照。

一级模块只维护稳定的公共导入位置和命名，不创建二级模块实例，不保存状态，不调用 DJI SDK、WebSocket、Node、Electron 或界面框架，不组合跨模块业务流程，也不替调用方绕过能力门禁。

## 2. 对外接口

```ts
import {
  DeviceConsole,
  LinkChain,
  CapabilityGate,
  PairingController,
  DeviceGuidance,
  DeviceSettingsPanel
} from "./src/modules/device-console/index.js";

DeviceConsole.LinkChain === LinkChain
DeviceConsole.CapabilityGate === CapabilityGate
DeviceConsole.PairingController === PairingController
DeviceConsole.DeviceGuidance === DeviceGuidance
DeviceConsole.DeviceSettingsPanel === DeviceSettingsPanel
```

入口必须同时再导出上述五个模块各自公开的 TypeScript 类型。调用方只能从本入口依赖一级模块；二级目录路径不构成上层稳定接口。

`DeviceConsole`、五个再导出的模块对象及其已有的公开返回值必须保持不可变。一级门面不得包装、替换或复制模块对象，因此严格相等比较必须成立。

## 3. 使用顺序

一级门面不强制流程；调用方负责按照业务流程使用二级模块：

1. 将手机中继遥测交给 `LinkChain.evaluate`，得到链路事实。
2. 将链路事实与设备能力交给 `CapabilityGate.evaluate`，确认对应操作可用。
3. 仅当门禁允许时，调用 `PairingController` 或未来的图传、航线适配器。
4. 用 `DeviceGuidance.evaluate` 显示当前应执行的连接或配对步骤。
5. 仅当对应设置能力可用且手机端设置适配器已经注入时，创建并使用 `DeviceSettingsPanel`。

一级模块不得把第 2 步的拒绝结果转换为命令调用，也不得把第 5 步的写入请求伪装成飞行器已经应用设置。

## 4. 错误与生命周期

一级门面没有独立错误、状态或生命周期。所有错误码、并发规则、超时处理、不可变快照和资源释放责任完全保留在相应的二级模块契约中。入口导入本身不得产生网络连接、定时器、文件访问或设备命令。

## 5. 依赖与验证

实现只能导入本一级模块目录内的五个二级模块公开入口。它不得依赖其他一级模块、适配器或运行时平台包。

测试必须验证：全部值和类型可由一级入口获得；门面对象冻结、无多余成员且与二级模块对象严格相等；经门面访问仍保留二级模块的真实委托行为；源码不导入平台实现或其他一级模块；类型、覆盖率、性能和 100% Stryker 均通过。
