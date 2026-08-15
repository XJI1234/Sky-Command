# desktop-test-host 二级模块契约

状态：已实现；只表示多中继 JVM 测试宿主可用，根验证模块是否通过以机器报告为准。
所属一级模块：`cross-runtime-e2e`

## 唯一职责

本模块只负责一个跨运行时验证场景的桌面测试进程生命周期：在随机回环端口启动正式 `NodeRuntime` Relay，启动独立 Kotlin/JVM `relay-test-harness` 子进程，等待真实 WebSocket 握手和设备上线，并在任何成功或失败路径中反向释放子进程、标准输入输出订阅、WebSocket 监听端口和定时等待。

本模块不实现 Relay 协议、不伪造手机帧、不复制业务状态机、不访问外网、不读取用户航线、不启动 Electron，也不把模拟 DJI 结果描述为真机结果。

## 公开接口

```text
DesktopTestHost.start(options) -> Promise<DesktopTestHostInstance>
host.relay -> RelayLinkInstance
host.startDevice(options) -> Promise<void>
host.waitForDevice(timeoutMs, deviceId?) -> Promise<RelayDeviceSnapshot>
host.sendControl(line, deviceId?) -> void
host.snapshot() -> DesktopTestHostSnapshot
host.close() -> Promise<void>
```

`start` 只能绑定 `127.0.0.1`，端口必须由操作系统动态选择。手机工程目录必须显式传入并包含 `gradlew.bat`。子进程只能运行 `:cross-runtime-e2e:relay-test-harness:run`，不得构建或安装 APK。

`waitForDevice` 必须有有限超时；失败时错误只包含安全摘要和子进程最近输出，不得包含完整 WebSocket 地址、用户文件内容或环境变量。`close` 必须幂等；先关闭手机宿主的标准输入并等待退出，超时后终止该测试子进程，最后停止 Relay。

## 验收边界

本模块通过只能证明 Node 与 Kotlin 两个独立进程通过真实 TCP/WebSocket 使用正式传输和协议完成协作。Android Activity、权限、USB、DJI SDK、遥控器、飞机和真实视频仍必须真机验收。
