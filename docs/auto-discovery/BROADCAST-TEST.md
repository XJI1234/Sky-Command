# 如何验证当前校园 Wi-Fi 的广播可行性

状态：2026-10-13 已连接无线 ADB，并构建、安装独立 Android 前台接收探针；当前校园位置完成 UDP 对照及 WebSocket 握手。结果及未覆盖范围见 NETWORK-RESULTS.md。2026-10-14 生产自动发现源码已接线并通过测试/打包，APK 未安装；以下网络测试仍需在正式 App 复测。

## 测试要回答的问题

1. 电脑发出的单播 UDP 是否能被手机应用收到？
2. 在相同监听端口上，电脑发出的广播 UDP 是否能被手机应用收到？
3. 手机收到公告后，能否直接访问电脑提供的 WebSocket 服务并完成现有握手？

无线 ADB/mDNS 能发现手机、电脑能 ping 手机、电脑打印“发送成功”，都不能代替这三项证据。单播与广播要使用相同接收器和端口，才能作为对照。

## 准备

- 电脑和手机保持当前校园 Wi-Fi，记录手机 IPv4；相同网络名称不保证相同 AP、VLAN 或允许广播。
- 用本机网卡 IPv4 和子网掩码计算定向广播地址。不能默认把最后一个字节改为 255。
- 在 Android 上使用 MSDK-Relay 的 `tools/network-probe` 独立测试 App（构建安装见其 README）：申请 INTERNET 权限，监听 UDP 39081，记录来源 IP、测试标识、序号和接收时间。先前台测试，不连接 DJI、不发送飞行命令。39081 仅为本测试选定的临时端口，生产端口尚未决定。
- 发送器绑定实际 WLAN IPv4。只向手机单播、当前 WLAN 定向广播及必要的有限广播发送小测试包，不枚举或扫描校园所有设备。
- 电脑防火墙如有拦截，记录当前网络类别和应用/端口的实际拦截信息；不以关闭整个防火墙作为测试步骤。

ADB 自带的 am broadcast 是 Android 进程内的 Intent 广播，不是 UDP 网络广播，不能用来验证这个方案。未安装网络接收器时，下面的电脑发送命令没有手机接收证据，不足以得出结论。

## 操作顺序

1. 启动手机测试接收器，记录“UDP 39081 监听成功”。
2. 对手机当前 IPv4 单播发送 20 个带唯一测试标识的包，间隔 1 秒；记录实际收到的序号。
3. 使用同样接收器，向电脑 WLAN 定向广播地址发送另一组 20 个包。
4. 如定向广播未收到，再单独测试 255.255.255.255；为各组使用不同测试标识，避免混淆。
5. 重复至少三轮。覆盖手机/电脑重连 Wi-Fi；实际部署若会跨 AP，追加不同 AP 下的验证。
6. 打开 Sky Command，手机直接访问其实际 IPv4 的 8080/relay，记录 WebSocket 开启和合法 hello/paired。现有协议使用二进制帧承载 UTF-8 JSON；探针需发送二进制 hello 并接收二进制 paired，不能使用文本帧代替。测试连接完成后关闭该测试会话，不下发业务命令。
7. 网络可行后，另行测试 Android 后台和锁屏；前台能收到包不代表锁屏也可靠。

## 电脑侧测试发送示例

接收器准备好后，在普通 PowerShell 运行。先核对网卡，再按提示填写当前地址；定向广播地址由当前 IPv4 和子网掩码计算。测试单播时，目标填写手机当前 IPv4。

可在 Sky-Command 根目录运行已保存的发送脚本，参数中的地址使用本机当前值；每组默认 20 包、间隔 1 秒，输出 testId 和发送数量。mode 用于记录目标类型，不自动选择网卡或计算广播地址。

```powershell
./scripts/send-network-probe.ps1 -LocalIPv4 '<电脑WLAN_IP>' -DestinationIPv4 '<手机IP>' -Mode unicast
./scripts/send-network-probe.ps1 -LocalIPv4 '<电脑WLAN_IP>' -DestinationIPv4 '<当前子网广播地址>' -Mode directed-broadcast
./scripts/send-network-probe.ps1 -LocalIPv4 '<电脑WLAN_IP>' -DestinationIPv4 '255.255.255.255' -Mode limited-broadcast
```

```powershell
$wlanIp = Read-Host '电脑当前 WLAN IPv4'
$destination = Read-Host '目标 IPv4（手机单播 / 当前子网广播 / 255.255.255.255）'
$probePort = 39081
$testId = [guid]::NewGuid().ToString()
$localEndpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse($wlanIp), 0)
$udpClient = [System.Net.Sockets.UdpClient]::new($localEndpoint)
$udpClient.EnableBroadcast = $true
try {
    for ($sequence = 1; $sequence -le 20; $sequence++) {
        $payload = @{
            kind = 'SKY_COMMAND_NETWORK_PROBE'
            testId = $testId
            sequence = $sequence
        } | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $sent = $udpClient.Send($bytes, $bytes.Length, $destination, $probePort)
        Write-Host "已发送测试包 $sequence，字节数 $sent；是否送达以手机接收记录为准"
        Start-Sleep -Seconds 1
    }
} finally {
    $udpClient.Dispose()
}
```

这只是网络探针消息，不是正式自动发现协议。现场测试记录保存在本机，提交总结时只记录必要结果，不提交配对码或密钥。

## 如何解释结果

| 观察 | 能得出的结论 / 下一步 |
| --- | --- |
| 单播能收到，广播不能收到 | 接收器基本可用；继续区分网卡选错、广播目标错误和校园 AP/VLAN 广播过滤 |
| 单播与广播都收不到 | 不能直接认定校园网禁止广播；先检查监听、手机当前 IP、设备隔离和网络权限 |
| 广播收到，WebSocket 失败 | 发现路径可达，控制连接仍不可达；检查电脑监听与入站防火墙规则 |
| 前台全部通过，锁屏失败 | 网络基本可用；Android 生命周期、Wi-Fi/省电策略尚未解决 |
| 多轮收到广播且 WebSocket 握手成功 | 支持在已测试校园位置/AP 上继续实现最小方案；不代表校园所有区域都可用 |

每组记录测试时间、设备/Android 版本、网卡/网络环境、目标类型、发送数量、接收数量、首包延迟和 WebSocket 结果。上线方案的通过标准和重试周期需要基于实际数据确定，不把任意丢包率当成已批准标准。
