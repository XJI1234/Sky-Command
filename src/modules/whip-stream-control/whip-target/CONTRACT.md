# whip-target 二级模块契约

状态：已封存的 WebRTC/WHIP/WHEP 旁路源码与独立测试；不纳入生产组合根。

> 封存规则：本模块只保留给历史低延迟旁路的源码和测试。生产 `desktop-application`、Electron 宿主、IPC 和操作台不得创建、调用或暴露它；重新启用必须先取得业务批准，并同步更新两端根契约、生产装配和跨端验证。

## 唯一职责

`whip-target` 是纯函数模块，把合法局域网媒体端点和设备标识转换为 WHIP 目标。它不读取网络、不发送命令、不保存配置、不接收视频。

## 对外接口

```text
WhipTarget.create({ deviceId, endpoint }) ->
  { ok: true, value: { protocol: "whip", whipUrl: string } }
  | { ok: false, code }
```

设备标识必须进行 `encodeURIComponent`，且编码后必须能往返解析。主机不得包含空白、控制字符、路径、查询、fragment、凭据或端口分隔符，也不得为回环主机（`localhost`、`127.0.0.0/8`）。端口必须是 1024..65535 的安全整数。URL 只能使用 HTTP 或 HTTPS，不能含查询串、fragment、用户名或密码。

## 验收

覆盖设备标识、主机、端口、URL 语法、编码往返、恶意 getter、冻结副本和所有固定失败码。
