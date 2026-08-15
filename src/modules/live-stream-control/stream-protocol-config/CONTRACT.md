# RTMP 图传配置二级模块契约

状态：已批准实施

## 唯一职责

`stream-protocol-config` 只把一个已验证的局域网接收端点和一个设备标识转换为手机端 `live-stream.start` 所需的 RTMP 目标，并验证该目标符合双方契约。

它不读取媒体服务状态、不下发命令、不保存上一次配置、不访问网络、不解析 DNS、不接收视频，也不允许调用方提交任意 RTMP 地址。接收端点属于 `media-pipeline`；命令与状态属于 `stream-dispatcher`。

## 公开接口

```ts
StreamProtocolConfig.createRtmpTarget(input: unknown) -> StreamTargetResult
```

输入必须为：

```ts
{
  deviceId: string;
  endpoint: { host: string; port: number };
}
```

成功结果为冻结对象：

```ts
{
  ok: true;
  value: {
    protocol: "rtmp";
    rtmpUrl: string;
  };
}
```

失败结果固定为 `{ ok: false, code }`，其中 `code` 只能是 `INVALID_INPUT`、`INVALID_DEVICE_ID`、`INVALID_ENDPOINT_HOST`、`INVALID_ENDPOINT_PORT` 或 `INVALID_TARGET`；失败结果绝不包含原始对象、地址、令牌或异常。

## 构造与校验规则

1. `deviceId` 为 1..128 个 Unicode 码点，去空白后非空，且不含控制字符。其路径片段必须使用 `encodeURIComponent(deviceId)`；不得直接拼接原始标识。
2. `host` 为 1..253 个码点，不含空白、控制字符、`/`、`?`、`#`、`@` 或 `:`；IPv6 不是当前媒体端点公开格式，因此必须拒绝，不能猜测方括号规则。
3. `port` 必须是 1024..65535 的安全整数。
4. 唯一目标格式为 `rtmp://{host}:{port}/live/{encodedDeviceId}`，没有用户信息、查询或 fragment。最终 URL 必须再次经本模块 RTMP 语法检查后才能成功返回。
5. RTMP URL 总长度不能超过手机端已实现限制 2048 个 Unicode 码点；含控制字符、用户信息、空主机、无路径、错误 scheme、fragment 或无效端口的目标必须拒绝。

模块是纯函数、无状态、同步、确定且线程安全。每次返回的对象均为冻结新副本；修改任何输入或此前结果不能影响后续调用。

## 扩展规则

新协议不能通过向此接口塞入可选字段来实现。手机端实际增加协议契约后，必须为新协议建立独立配置模型和校验规则，并由组合根显式选择；RTMP 的字段、命令名和路径规则不得因此改变。

## 验收

测试覆盖合法主机、端口边界、设备标识编码、全部失败码、Unicode 长度边界、控制字符、恶意 getter、冻结副本和输入隔离。模块不导入 Node、Electron、WebSocket、FFmpeg、媒体管线、设备控制或 UI，且必须通过类型、架构、100% 覆盖率、性能和 100% Stryker 变异测试。
