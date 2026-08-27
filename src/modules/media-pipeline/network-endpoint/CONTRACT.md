# network-endpoint 二级模块契约

状态：已批准实施

## 唯一职责

`network-endpoint` 从注入的本机网卡事实中筛选可被 Android 手机访问的局域网 IPv4 地址，并结合已校验的 `listenPort` 生成 RTMP 接收端点。它不读取系统网卡、不保存设置、不监听端口、不建立网络连接，也不决定 RTMP 服务是否启动。

## 对外接口

```ts
NetworkEndpoint.create(port) -> NetworkEndpointInstance
instance.resolve(interfaces, manualHost) -> EndpointResult
```

`port` 必须来自 `desktop-settings` 已验证的 `listenPort`（1024..65535）。`interfaces` 是由平台适配器提供的冻结网卡快照，每个项至少包含名称、启用状态、IPv4 地址、内部地址标志以及适配器类别。`manualHost` 必须是 `desktop-settings` 已验证的私网或回环 IPv4，或为 `null`。

## 选择规则

1. `manualHost` 非空时始终优先，生成可按设备构造 `rtmp://{manualHost}:{port}/live/{deviceId}` 的接收端点，不枚举候选网卡。
2. 自动选择时，仅接受启用、非内部、物理或 Wi-Fi 类别、且地址属于 `10/8`、`172.16/12`、`192.168/16` 或 Tailscale 网格 CGNAT `100.64/10` 的 IPv4 网卡。
3. 必须排除虚拟机、容器、通用 VPN/隧道、蓝牙、回环、链路本地 `169.254/16`、多播、未指定和公网地址；适配器名称只用于排除，绝不作为正向信任条件。`100.64/10` 地址本身视为手机可达的网格局域网，不因“像 VPN”而拒绝。
4. 候选按地址四段的数值升序选择，保证不同枚举顺序得到相同端点。
5. 无可用候选时返回 `NO_LOCAL_ENDPOINT`，不猜测公网、主机名或 IPv6 地址。

## 安全与验收

结果仅暴露 `host`、`port`、来源 `manual|automatic` 和 `rtmpUrlFor(deviceId)`；设备标识必须为 1 至 128 字符、非空白且不含 NUL 的字符串，生成的路径段必须使用 `encodeURIComponent`。成功 URL 形如 `rtmp://{host}:{port}/live/{encodedDeviceId}`；非法设备标识返回稳定 `INVALID_DEVICE_ID`。所有结果均为冻结副本；不暴露网卡名称、MAC、系统路径、原始配置或异常。非法输入返回稳定 `INVALID_INPUT`，不得抛出异常或影响后续调用。

测试覆盖人工覆盖优先、私网范围、每类拒绝网卡、候选排序、空候选、畸形输入、冻结副本和输入隔离。实现必须是纯 TypeScript 核心，不导入 Node、Electron、网络库、FFmpeg、UI 或其他二级模块，并满足 100% 行/分支/函数/变异覆盖。
