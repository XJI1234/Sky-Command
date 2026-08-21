# whip-target 二级模块契约

状态：实验设计，尚未实现。

## 唯一职责

`whip-target` 是纯函数模块，把合法局域网媒体端点和设备标识转换为 WHIP 目标。它不读取网络、不发送命令、不保存配置、不接收视频。

## 对外接口

```text
WhipTarget.create({ deviceId, endpoint }) ->
  { ok: true, value: { protocol: "whip", whipUrl: string } }
  | { ok: false, code }
```

设备标识必须进行 `encodeURIComponent`，且编码后必须能往返解析。主机不得包含空白、控制字符、路径、查询、fragment、凭据或端口分隔符。端口必须是 1024..65535 的安全整数。URL 只能使用 HTTP 或 HTTPS，不能含查询串、fragment、用户名或密码。

## 验收

覆盖设备标识、主机、端口、URL 语法、编码往返、恶意 getter、冻结副本和所有固定失败码。
