param(
  [ValidateSet('dev', 'start')]
  [string]$Mode = 'dev',
  [int]$Port = 3000,
  [string]$HostName = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# Node's fetch does not automatically inherit the Windows Internet Settings proxy.
# Read the already-configured system proxy and apply it only to this LibreTV process.
$settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
if ($settings -and $settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
  $rawProxy = [string]$settings.ProxyServer
  $proxyAddress = $rawProxy
  if ($rawProxy -match 'https=([^;]+)') {
    $proxyAddress = $Matches[1]
  } elseif ($rawProxy -match 'http=([^;]+)') {
    $proxyAddress = $Matches[1]
  }
  if ($proxyAddress -notmatch '^https?://') {
    $proxyAddress = 'http://' + $proxyAddress
  }
  try {
    $proxyUri = [Uri]$proxyAddress
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $connect = $client.ConnectAsync($proxyUri.Host, $proxyUri.Port)
      if (-not $connect.Wait(1500) -or -not $client.Connected) {
        throw 'The configured Windows proxy is not listening.'
      }
    } finally {
      $client.Dispose()
    }
    $env:HTTP_PROXY = $proxyAddress
    $env:HTTPS_PROXY = $proxyAddress
    $env:ALL_PROXY = $proxyAddress
    $env:LIBRETV_PROVIDER_PROXY = $proxyAddress
    $env:NODE_USE_ENV_PROXY = '1'
    Write-Host ('LibreTV only: using the existing Windows proxy ' + $proxyUri.Host + ':' + $proxyUri.Port) -ForegroundColor Green
  } catch {
    Write-Warning ('Could not use the Windows system proxy: ' + $_.Exception.Message)
    Write-Warning 'The app will start, but remote free-resource searches may fail until outbound network access is available.'
  }
} else {
  Write-Host 'No Windows system proxy is enabled; LibreTV will use the normal network route.' -ForegroundColor Yellow
}

$env:PORT = [string]$Port
$env:HOST = $HostName
$localOrigin = "http://$($HostName):$($Port)"
if (-not $env:PASSWORD -and -not (Test-Path (Join-Path $projectRoot '.env')) -and -not (Test-Path (Join-Path $projectRoot '.env.local'))) {
  $env:PASSWORD = 'libretv'
  Write-Host 'Local mode: no .env found, using default local password: libretv' -ForegroundColor Yellow
}
if (-not $env:DEFAULT_SOURCES) {
  $env:DEFAULT_SOURCES = "[{`"name`":`"内置双语开放影视库（5472+ 公版经典 / 国会图书馆直连 / 开源动画 / NASA / 韦伯 / 哈勃 / ESO 1080p）`",`"url`":`"$localOrigin/api/open-media?short=1&zh=1`",`"detail`":`"$localOrigin`"}]"
}
if (-not $env:DEFAULT_LIVE_SOURCES) {
  $env:DEFAULT_LIVE_SOURCES = "[{`"name`":`"内置双阶实测超清直播（8985 台卫视 / 电影 / 动漫 / 纪实）`",`"url`":`"$localOrigin/open-live-channels.m3u`"}]"
}
Write-Host ('Starting 自由影视 LibreTV (' + $Mode + ') at ' + $localOrigin) -ForegroundColor Cyan
if ($Mode -eq 'dev') {
  & npm.cmd run dev -- --hostname $HostName --port $Port
} else {
  & npm.cmd run start -- --hostname $HostName --port $Port
}
exit $LASTEXITCODE
