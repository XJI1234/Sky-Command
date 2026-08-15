# 桌面设置模块契约

状态：已批准执行

模块标识：`desktop-settings`

## 1. 职责

`desktop-settings` 是 Sky Command 电脑端唯一的本地设置边界。它负责把不可信的
持久化数据变成不可变、已经校验的设置快照，并在保存前完成版本迁移和规范化。

它不建立 WebSocket，不枚举网卡，不请求底图，不启动 Electron，也不判断某项设置是否
让飞行操作可用。连接、地图与业务模块只消费它给出的设置值。

本版本只保存两类设置：

- 网络监听设置：WebSocket 中继口、RTMP 收流口，以及可选的手动 IP 覆盖；
- 地图设置：底图来源标识与其可选凭据。

未列出的设置字段不得被“顺手”加入；新增字段先更新此契约和根契约。

## 2. 二级模块与依赖

| 二级模块 | 唯一职责 | 允许依赖 | 不负责 |
| --- | --- | --- | --- |
| `network-settings` | 校验、规范化网络监听设置 | 纯 TypeScript | 文件、网卡、Socket、UI |
| `map-settings` | 校验、规范化地图设置与凭据副本 | 纯 TypeScript | 地图装载、HTTP、瓦片或模型 |
| `settings-store` | 原子读写、迁移、损坏恢复、版本选择 | 两个设置规则模块和注入的字节存储 | 解释业务可用性 |

`network-settings` 与 `map-settings` 是纯核心模块，不能互相导入；`settings-store`
只能从各自公开入口调用它们。一级入口是唯一面向其他一级模块的 seam。

## 3. 领域模型

### 3.1 设置快照

```ts
type SettingsSnapshot = Readonly<{
  version: 1;
  network: Readonly<{
    listenPort: number;
    relayPort: number;
    manualHost: string | null;
  }>;
  map: Readonly<{
    basemap: "tianditu-vector" | "tianditu-image";
    credential: string | null;
  }>;
}>;
```

默认快照固定为：

```ts
{
  version: 1,
  network: { listenPort: 19500, relayPort: 8080, manualHost: null },
  map: { basemap: "tianditu-vector", credential: null }
}
```

所有公开结果及其嵌套对象都必须冻结；调用者改变输入对象、返回对象或返回数组都不能
改变模块内部状态或后续结果。凭据仅作为字符串值保存和返回，不写日志、不拼进错误信息。

### 3.2 网络设置语义

- `listenPort` 是 RTMP 收流端口，必须是 1024 至 65535 的安全整数。
- `relayPort` 是手机连接的 WebSocket 中继端口，同样必须是 1024 至 65535 的安全整数；缺省为 `8080`，与手机端地址提示一致。
- `listenPort` 与 `relayPort` 是两个独立服务，不得把其中一个当成另一个。
- `manualHost` 是 `null` 或单个 IPv4/IPv6 地址；不接受域名、协议前缀、端口、
  CIDR、通配符、空白或控制字符。
- IPv4 接受私网与回环地址；IPv6 接受回环、唯一本地和链路本地地址。公网地址明确拒绝，
  因为此设置只描述本机局域网连接入口。
- IPv6 可接受方括号输入，但快照存储和返回时不含方括号，且使用小写压缩表示。IPv4
  去除前导零并规范化为十进制点分格式。
- `manualHost: null` 的含义是由后续网络适配器自行选择可用局域网地址；本模块不做
  网卡枚举。

### 3.3 地图设置语义

- `basemap` 只能是以上两个稳定标识。它们是抽象选择，不是 URL。
- `credential` 为 `null` 或 1 到 256 个 Unicode 代码点的非空字符串，首尾空白会
  被去除；控制字符、换行和空白字符串拒绝。
- 凭据不可由此模块推断、请求、验证有效性或写入诊断信息。

## 4. 一级公开接口

```ts
DesktopSettings.create(storage, options?) -> SettingsResult<DesktopSettingsInstance>

instance.load() -> Promise<SettingsLoadResult>
instance.snapshot() -> SettingsSnapshot
instance.updateNetwork(input) -> SettingsResult<SettingsSnapshot>
instance.updateMap(input) -> SettingsResult<SettingsSnapshot>
instance.save() -> Promise<SettingsResult<SettingsSnapshot>>
```

`create` 只建立会话，不读文件。初始 `snapshot()` 是默认快照。

`load()` 的结果为：

```ts
type SettingsLoadResult =
  | { status: "loaded"; snapshot: SettingsSnapshot }
  | { status: "recovered"; snapshot: SettingsSnapshot; reason: "missing" | "corrupt" | "unsupported-version" };
```

- 缺失文件、无效 JSON、非对象根、不可读字段或不支持版本不会抛异常；返回默认快照和
  `recovered`，并且不会覆盖原文件，直到调用方显式 `save()`。
- 已知旧版本必须先在内存中迁移到 v1，再完整校验；迁移后的加载结果仍为 `loaded`。
- `updateNetwork` 与 `updateMap` 只改变内存快照，失败时保持前一个快照不变。
- `save()` 对当前完整快照进行一次原子写入。成功后返回新的不可变副本；失败返回错误，
  内存快照保持不变，旧磁盘文件也必须仍可读取。

每个更新接口采用部分更新语义：未提供的字段沿用当前值；提供 `undefined` 与未提供
等价，提供 `null` 只有字段契约明确允许时才有效。

## 5. 存储适配器契约

```ts
interface SettingsStorage {
  read(): Promise<Uint8Array | null>;
  writeAtomically(bytes: Uint8Array): Promise<void>;
}
```

`settings-store` 不导入 Node `fs` 或 Electron；生产组合根负责提供真实文件适配器，
测试使用内存适配器。读取的 `Uint8Array` 一律先复制；写入前产生新的 UTF-8 JSON
字节，适配器不得得到模块内部可变缓冲区。

同一实例中 `load()` 与 `save()` 不能并发交错：后发操作排队，按调用顺序完成。更新
操作是同步的，在异步读写期间仍可调用，但 `save()` 必须捕获调用开始时的完整快照，
不能把稍后更新混入同一次写入。

## 6. 错误契约

```ts
type SettingsErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_NETWORK_SETTINGS"
  | "INVALID_MAP_SETTINGS"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED";
```

错误包含稳定的 `code` 和只含安全字段名、原因码及数值边界的 `details`；不得包含
凭据、原始 JSON 内容、绝对文件路径或底层异常消息。

同步参数错误用 `SettingsResult = { ok: true; value } | { ok: false; error }` 返回。
任何公开接口都不得因不可信输入或存储适配器异常而把异常泄漏给调用方。

## 7. 迁移与序列化

磁盘 JSON 必须使用固定字段顺序：

```json
{"version":1,"network":{"listenPort":19500,"relayPort":8080,"manualHost":null},"map":{"basemap":"tianditu-vector","credential":null}}
```

v0 到 v1 的唯一迁移：v0 的顶级 `port` 和 `host` 分别映射到
`network.listenPort` 与 `network.manualHost`；缺失的 `relayPort` 与地图字段使用默认值。其余字段不保留。
将来版本只允许新增单向迁移，不能改变既有 v1 的语义。

## 8. 测试与验收

每个二级模块都先有自己的 `CONTRACT.md`，再有实现和测试。测试仅从公开入口调用：

- 网络：端口上下界、整数性、IPv4/IPv6 正规化、拒绝公网/域名/端口/控制字符；
- 地图：全部来源、凭据正规化、长度、控制字符、敏感信息不出现在错误中；
- 存储：缺失、损坏、旧版本迁移、未知版本、读写异常、原子失败、并发顺序和字节副本；
- 一级组合：默认值、部分更新、更新失败不污染状态、加载恢复和保存往返；
- 架构：核心代码不得导入 Node 文件系统、Electron、WebSocket、地图或其他一级模块；
- 类型：公开接口、错误闭集、只读快照和适配器边界受编译器约束。

本模块及其二级模块要求 statements、branches、functions、lines 均为 100%；每个稳定错误
码有直接测试；有效变异体 100% killed 或 timeout，无 survivor/no-coverage；性能测试覆盖
最大合法凭据和大量连续更新的线性行为；`npm run check` 与
`npm audit --audit-level=high` 必须通过。
