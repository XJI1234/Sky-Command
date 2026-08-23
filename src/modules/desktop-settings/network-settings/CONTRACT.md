# 网络设置模块契约

模块标识：`desktop-settings/network-settings`

## 1. 唯一职责

本模块把不可信的网络设置输入转换为不可变的、规范化的 `NetworkSettings`。它不保存
数据、不读取环境变量、不枚举网络接口、不创建服务器，也不知道手机、飞机或业务命令。

## 2. 公开接口

```ts
NetworkSettings.create(input) -> SettingsResult<NetworkSettings>
NetworkSettings.patch(current, patch) -> SettingsResult<NetworkSettings>
```

```ts
type NetworkSettings = Readonly<{
  listenPort: number;
  relayPort: number;
  manualHost: string | null;
}>;
```

`create` 要求完整输入，`patch` 使用已验证的当前值补全未提供字段。两个接口都复制并
冻结结果，绝不保留输入对象引用。

## 3. 输入、规范化与失败

- 端口只接受 1024..65535 的安全整数。`listenPort` 是 RTMP 收流口；`relayPort` 是
  WebSocket 中继口，缺省 `8080`。两者独立校验，缺省 `relayPort` 不得改写 `listenPort`。
- `manualHost` 只接受 `null` 或合法私网 IPv4。回环地址（`127.0.0.1`）不是给手机
  推流用的主机。IPv6（含唯一本地、链路本地、回环、映射地址和带端口的文本）不是当前
  RTMP/WHIP 端点格式，必须拒绝，不得猜测方括号规则。
- 字符串必须不含空白与控制字符；不接受主机名、URL、CIDR 或公网地址。
- 任何无效字段返回 `INVALID_NETWORK_SETTINGS`，详情只含 `field` 和稳定 `reason`，
  不回显原始字符串。
- `fallback` 必须已是本模块创建的值；伪造或不可读 fallback 返回
  `INVALID_CONFIGURATION`。

## 4. 不变量

成功结果总是冻结，`manualHost` 要么为 `null`，要么为一个已规范化且仍满足私网
范围的 IPv4 文本。失败不会修改 `fallback`，不抛出异常，也不访问任何外部资源。

## 5. 测试要求

从此公开入口覆盖每一个端口边界、IPv4 类别、IPv6 拒绝、全部拒绝输入类型、不可读 getter、
伪造 fallback、输出冻结和输入隔离。分支覆盖与变异测试均必须达到 100%。
