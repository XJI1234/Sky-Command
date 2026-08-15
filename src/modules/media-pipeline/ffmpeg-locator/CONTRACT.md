# ffmpeg-locator 二级模块契约

状态：已批准实施

## 唯一职责

`ffmpeg-locator` 在组合根提供的、已按优先级排序的候选项中，借助注入的文件事实，找出第一条可执行的 FFmpeg 路径；找不到时返回稳定、可直接显示且不泄露本机路径的诊断。

它不启动或停止 FFmpeg，不创建子进程，不读取环境变量、注册表、配置文件或 Electron 全局对象，不修改候选数组，也不探测网络、RTMP、HLS、设备或视频状态。真实文件系统访问只能存在于组合根所注入的适配器中。

## 公开接口

```ts
type FfmpegSource = "configured" | "bundled" | "system";

interface FfmpegCandidate {
  readonly source: FfmpegSource;
  readonly executablePath: string;
}

interface FileFacts {
  readonly isExecutableFile: (path: string) => boolean;
}

type LocateResult =
  | Readonly<{ readonly ok: true; readonly value: Readonly<{ readonly executablePath: string; readonly source: FfmpegSource }> }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "FFMPEG_NOT_FOUND" | "INSPECTION_FAILED"; readonly diagnostic: string }>;

interface FfmpegLocatorInstance {
  readonly locate: (candidates: unknown) => LocateResult;
}

const FfmpegLocator: Readonly<{
  readonly create: (fileFacts: FileFacts) => FfmpegLocatorInstance;
}>;
```

`create(fileFacts)` 必须要求 `isExecutableFile` 是函数；否则同步抛出 `TypeError`。这是开发者装配错误，不能伪装成运行时“未找到”。

`locate(candidates)` 接受未知输入以隔离配置、系统探测和打包路径适配器的缺陷。成功时只返回候选项原样提供的路径和来源；返回对象及其成功值必须冻结。模块绝不改写、规范化或暴露未选中的路径。

## 候选项与选择规则

1. `candidates` 必须是数组，数组中每一项必须是非空对象。
2. 每项的 `source` 只能是 `configured`、`bundled` 或 `system`；`executablePath` 必须是非空、去除首尾空白后仍不为空的字符串。
3. 每项路径在整个数组中只能出现一次。重复路径表示组合根的来源策略冲突，返回 `INVALID_INPUT`。
4. 按数组既有顺序依次调用 `isExecutableFile(executablePath)`；首个返回 `true` 的候选即为结果。模块不自行排序，因此“配置路径优先于打包路径，打包路径优先于系统路径”的策略由组合根显式提供。
5. 某项检查返回 `false` 时继续下一项；所有检查均为 `false` 时返回 `FFMPEG_NOT_FOUND`。
6. 文件事实适配器抛出任何异常时，立即返回 `INSPECTION_FAILED`，不继续尝试其他路径，不透传原始异常、路径或堆栈。

## 错误契约

| 错误码 | 公开诊断 | 触发条件 |
| --- | --- | --- |
| `INVALID_INPUT` | `FFmpeg 候选配置无效。请检查桌面端安装配置。` | 候选不是合法、唯一的候选序列 |
| `FFMPEG_NOT_FOUND` | `未找到可用的 FFmpeg。请安装 FFmpeg 或检查桌面端配置。` | 所有合法候选都不可执行 |
| `INSPECTION_FAILED` | `无法检查 FFmpeg 可执行文件。请检查桌面端权限与安装状态。` | 文件事实适配器抛出异常 |

诊断文本是产品契约。它不得包含候选路径、用户名、磁盘名、原始异常、命令行参数或其他本机敏感信息。

## 依赖、并发与所有权

本模块是同步、无状态的 TypeScript 核心。它只能依赖语言标准能力；不得导入 Node、Electron、子进程、文件系统、网络、FFmpeg、UI、其他一级模块或 `media-pipeline` 的其他二级模块。

调用方拥有候选数组和文件事实适配器。模块只读取它们，不缓存结果，因此配置更新、FFmpeg 安装或权限变化后，调用方重新调用 `locate` 即可获得新的事实。调用之间没有共享状态，不会相互影响。

## 验收

测试必须覆盖：配置顺序优先、首个可用项、前项不可用后的回退、全部不可用、每类非法输入、重复路径、适配器异常、输入不变性、结果冻结、诊断脱敏和跨调用独立性。实现必须满足类型检查、行/分支/函数/语句覆盖率 100%、变异测试 100%，并以架构测试证明没有越过本模块边界。
