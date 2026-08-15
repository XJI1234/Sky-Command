# 地图设置模块契约

状态：已批准实施

## 职责

`map-settings` 只负责校验并规范化桌面设置模块消费的地图设置。它是纯 TypeScript 模块，不加载瓦片、不请求天地图、不检查网络、不读取环境变量，也不持久化凭据。

## 对外接口

```ts
type MapBasemap = "tianditu-vector" | "tianditu-image";
type MapSettingsValue = Readonly<{ basemap: MapBasemap; credential: string | null }>;
type MapSettingsPatch = Readonly<Partial<MapSettingsValue>>;

MapSettings.create(input: unknown): MapSettingsResult<MapSettingsValue>;
MapSettings.patch(current: MapSettingsValue, update: unknown): MapSettingsResult<MapSettingsValue>;
```

只有 `create` 能生成可供 `patch` 信任的当前值；通过类型断言或对象展开伪造的值必须拒绝，防止调用方绕过不变量。所有结果及其嵌套值、错误均为冻结副本。

## 值和更新规则

默认值为 `{ basemap: "tianditu-vector", credential: null }`。底图只接受两个稳定标识。凭据可以是 `null`，或最多 256 个 Unicode 码点的非空字符串；先移除首尾 Unicode 空白，再拒绝内部空白或控制字符。凭据是透明字符串，本模块绝不验证其是否真的可用。

`patch` 只接受对象。缺失字段与显式 `undefined` 都保留当前值；只有 `credential` 的 `null` 有业务含义。失败更新不改变当前值。输入属性只能读取一次，恶意 getter 返回结构化错误而不是异常，错误中不得回显输入或凭据。

## 错误和边界

错误码只有 `INVALID_CONFIGURATION`、`INVALID_MAP_SETTINGS`；详情只允许稳定的字段名和原因，例如 `invalid-type`、`unsupported-basemap`、`credential-empty`、`credential-too-long`、`credential-unsafe-text`、`unreadable`、`untrusted`。

禁止导入 HTTP、瓦片、Cesium、天地图、Electron、Node 或文件系统；不选择地理位置，不持久化/验证密钥，也不耦合网络设置、航线或 UI 状态。

## 验证要求

测试只穿过公开接口，覆盖所有接受/拒绝形状、规范化、不可变性、部分更新、恶意输入和错误保密。语句、分支、函数、行覆盖率及有效变异杀灭率均须为 100%。
