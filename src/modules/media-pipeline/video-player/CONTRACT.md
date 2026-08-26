# video-player 二级模块契约

状态：已批准实施

## 唯一职责

`video-player` 只把组合根提供的、已经生成的本机播放地址（HLS `index.m3u8` 或 HTTP-FLV `.flv`）交给播放器适配器，并把播放器报告的致命故障转换为脱敏诊断。它不创建播放器、不读取 DOM、不导入 Electron、不启动或停止 RTMP、转码和 HLS/FLV 服务，也不负责判断媒体是否已经就绪。

## 对外接口

```ts
interface VideoPlayerPort {
  readonly setSource: (input: Readonly<{ readonly deviceId: string; readonly url: string }>, onFatalError: (error: unknown) => void) => void;
  readonly clear: () => void;
}

interface VideoPlayerSnapshot {
  readonly phase: "idle" | "playing" | "failed";
  readonly deviceId: string | null;
  readonly revision: number;
  readonly diagnostic: string | null;
}

type SelectResult =
  | Readonly<{ readonly ok: true; readonly value: VideoPlayerSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "SOURCE_FAILED"; readonly value: VideoPlayerSnapshot }>;

type ClearResult =
  | Readonly<{ readonly ok: true; readonly value: VideoPlayerSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "CLEAR_FAILED"; readonly value: VideoPlayerSnapshot }>;

interface VideoPlayerInstance {
  readonly select: (input: unknown) => SelectResult;
  readonly clear: () => ClearResult;
  readonly snapshot: () => VideoPlayerSnapshot;
}
```

`VideoPlayer.create(port)` 只接受同时具有 `setSource` 和 `clear` 函数的播放器适配器；装配错误同步抛出 `TypeError`。所有公开结果、快照和播放器输入均为冻结副本。`select` 和 `clear` 同步执行，不创建定时器或后台任务。

## 输入与播放规则

`select` 的输入必须是对象，包含：

- `deviceId`：1 至 128 个字符，去除首尾空白后非空，不得包含 NUL；原值交给适配器，不由模块改写。
- `url`：合法的 `http` 或 `https` URL；不得包含用户名、密码、查询串或片段，路径必须以 `/index.m3u8` 结尾。模块不访问该地址，只做格式校验。

调用 `select` 会替换当前设备和地址。模块先使本次选择成为当前代次，再调用 `setSource`；适配器同步报告的致命错误也必须归入本次选择。适配器抛出异常时返回 `SOURCE_FAILED`，公开诊断固定为：`播放器无法加载视频源。请检查图传流与本地 HLS 服务。`，不泄露 URL、设备标识、异常文本或堆栈。

## 清理与陈旧回调

初始状态为 `idle`、`deviceId: null`、修订号 0、无诊断。`clear` 使当前代次失效后调用适配器 `clear`；成功回到 `idle`，失败进入 `failed`，并返回固定诊断：`播放器无法清理当前视频源。请检查播放器状态。`。

每次 `select` 或 `clear` 都会产生新的内部代次。旧代次的致命回调必须被静默忽略，不能改写新设备的快照。当前代次只有在 `playing` 状态收到致命回调时才进入 `failed`，诊断固定为：`播放器报告了致命错误。请检查图传流与本地 HLS 服务。`；同一故障不会抛出原始异常，也不会泄露敏感输入。`failed` 状态仍可重新 `select` 或 `clear`。

## 依赖与验收

本模块只能依赖语言标准能力，不导入 Node、Electron、浏览器 DOM、网络库、FFmpeg、文件系统或 `media-pipeline` 的其他二级实现。测试必须覆盖适配器装配、URL 和设备标识边界、替换播放源、同步致命回调、源加载失败、清理成功与失败、陈旧回调、重选和多实例隔离，并满足类型检查、行/分支/函数/语句覆盖率 100%、100% 变异测试和架构边界测试。
