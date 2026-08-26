# http-flv-server 二级模块契约

状态：已批准实施

## 唯一职责

`http-flv-server` 管理一个仅绑定本机回环地址的 HTTP-FLV 分发生命周期，并为合法 `streamId` 生成可交给播放器的本地播放地址。实际监听、写出和关闭由注入适配器负责。

它不启动 FFmpeg、不创建 HLS 片段、不接收 RTMP、不管理设备或流集合、不播放视频、不读取文件系统或网络配置、不绑定局域网地址。视频就绪与超时仍由 `stream-health` 判定。

## 公开接口

```ts
interface HttpFlvServerPort {
  readonly listen: (input: Readonly<{ readonly host: "127.0.0.1"; readonly port: number; readonly rootDirectory: string }>) => void;
  readonly close: () => void;
}

interface HttpFlvServerSnapshot {
  readonly phase: "idle" | "listening" | "failed";
  readonly revision: number;
  readonly port: number | null;
  readonly diagnostic: string | null;
}

type StartResult =
  | Readonly<{ readonly ok: true; readonly value: HttpFlvServerSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_LISTENING" | "LISTEN_FAILED"; readonly value: HttpFlvServerSnapshot }>;

type StopResult =
  | Readonly<{ readonly ok: true; readonly value: HttpFlvServerSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "NOT_LISTENING" | "CLOSE_FAILED"; readonly value: HttpFlvServerSnapshot }>;

type PlaybackResult =
  | Readonly<{ readonly ok: true; readonly value: Readonly<{ readonly streamId: string; readonly url: string }> }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "NOT_LISTENING"; readonly value: HttpFlvServerSnapshot }>;

interface HttpFlvServerInstance {
  readonly start: (input: unknown) => StartResult;
  readonly stop: () => StopResult;
  readonly playback: (streamId: unknown) => PlaybackResult;
  readonly snapshot: () => HttpFlvServerSnapshot;
}
```

`create(port)` 要求注入对象同时拥有 `listen` 与 `close` 两个函数，否则同步抛出 `TypeError`。服务启动输入包含 `port` 和 `rootDirectory`：端口为 1024 至 65535 的安全整数；根目录为非空、去除首尾空白后仍非空的字符串。主机固定为 `127.0.0.1`，不是调用者可配置项。生产 HTTP-FLV 适配器可不使用根目录内容，但仍须通过该入参校验。

## 生命周期与播放地址

1. 初始为 `idle`、修订号 0、无端口、无诊断。
2. `idle` 或 `failed` 可 `start`；成功后为 `listening`，并且只以 `{ host: "127.0.0.1", port, rootDirectory }` 调用 `listen` 一次。
3. `listen` 抛出时进入 `failed`，返回 `LISTEN_FAILED` 和稳定诊断；不泄露根目录或原始异常。
4. `listening` 再次 `start` 返回 `ALREADY_LISTENING`，且不得触及端口适配器。
5. `stop` 只在 `listening` 时调用 `close`。成功转为 `idle`；`close` 抛出时保持 `listening`，返回 `CLOSE_FAILED` 和稳定诊断。非监听状态返回 `NOT_LISTENING`。
6. `playback(streamId)` 只在 `listening` 时有效，返回 `http://127.0.0.1:{port}/live/{encodeURIComponent(streamId)}.flv`。它不检查流是否已有发布者。
7. `streamId` 必须为 1 至 128 个字符的字符串，去除首尾空白后非空，且不得含 NUL。URL 必须使用 `encodeURIComponent`，因此 `/`、`?`、`#`、空格和百分号都只能作为路径段数据，不能改变服务路由。

## 错误与隐私契约

| 场景 | 诊断 |
| --- | --- |
| 监听失败 | `无法启动本地 HTTP-FLV 服务。请检查端口与桌面端权限。` |
| 停止失败 | `无法停止本地 HTTP-FLV 服务。请检查桌面端权限。` |

除 `listening` 外，快照的 `port` 为 `null`。成功、空闲与关闭状态的诊断为 `null`。公开快照、结果和错误文本不得包含 `rootDirectory`、文件名、原始异常、请求地址、令牌或任何局域网接口地址。

## 依赖与验收

本模块是同步、有界状态机；不能导入 Node、Electron、HTTP 库、文件系统、网络、FFmpeg、UI 或 `media-pipeline` 的其他二级实现。它只保存已验证的端口值，不缓存根目录，也不持有任何文件句柄。

测试必须覆盖：启动入参、固定回环绑定、端口边界、监听失败、重复启动、停止与停止失败、关闭后行为、播放地址编码、播放前后边界、输入不变性、冻结、诊断脱敏、装配错误和多实例隔离。实现必须通过架构测试、类型检查、100% 行/分支/函数/语句覆盖率和 100% 变异测试。
