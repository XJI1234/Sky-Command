param(
    [Parameter(Mandatory = $true)] [string] $LocalIPv4,
    [Parameter(Mandatory = $true)] [string] $DestinationIPv4,
    [ValidateSet('unicast', 'directed-broadcast', 'limited-broadcast')] [string] $Mode = 'unicast',
    [ValidateRange(1, 20)] [int] $Count = 20,
    [ValidateRange(200, 5000)] [int] $IntervalMs = 1000,
    [ValidateRange(1024, 65535)] [int] $Port = 39081
)

$ErrorActionPreference = 'Stop'
foreach ($address in @($LocalIPv4, $DestinationIPv4)) {
    if ($address -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw '需要数字 IPv4 地址' }
    $parsed = [System.Net.IPAddress]::Parse($address)
    if ($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw '仅测试 IPv4' }
}

$testId = [guid]::NewGuid().ToString()
$endpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse($LocalIPv4), 0)
$udpClient = [System.Net.Sockets.UdpClient]::new($endpoint)
$udpClient.EnableBroadcast = $true
$sentCount = 0
$firstSendAtMs = $null
$lastSendAtMs = $null
try {
    for ($sequence = 1; $sequence -le $Count; $sequence++) {
        $sentAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        if ($null -eq $firstSendAtMs) { $firstSendAtMs = $sentAtMs }
        $payload = @{
            kind = 'SKY_COMMAND_NETWORK_PROBE'
            testId = $testId
            sequence = $sequence
        } | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $sentBytes = $udpClient.Send($bytes, $bytes.Length, $DestinationIPv4, $Port)
        if ($sentBytes -ne $bytes.Length) { throw '发送字节数不完整' }
        $sentCount++
        $lastSendAtMs = $sentAtMs
        Write-Host "测试 $Mode：已发送 $sequence/$Count，testId=$testId；送达以手机接收记录为准"
        if ($sequence -lt $Count) { Start-Sleep -Milliseconds $IntervalMs }
    }
} finally {
    $udpClient.Dispose()
}

[pscustomobject]@{
    mode = $Mode
    testId = $testId
    localIPv4 = $LocalIPv4
    destinationIPv4 = $DestinationIPv4
    port = $Port
    sentCount = $sentCount
    firstSendAtMs = $firstSendAtMs
    lastSendAtMs = $lastSendAtMs
}
