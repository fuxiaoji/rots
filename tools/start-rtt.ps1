[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Restart', 'Status')]
    [string]$Action = 'Start',

    [switch]$Rebuild,

    [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'

$GameRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = 'D:\desktop\rots-runtime-pve'
$NodeExe = 'C:\Users\fwj\tools\node-v22.23.2-win-x64\node.exe'
$ServerScript = Join-Path $RuntimeRoot 'server.js'
$StdoutLog = Join-Path $RuntimeRoot 'rtt-stdout.log'
$StderrLog = Join-Path $RuntimeRoot 'rtt-stderr.log'

function Get-RttListener {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Get-ProcessCommandLine([int]$ProcessId) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($process) { return [string]$process.CommandLine }
    return ''
}

function Test-IsRttProcess([int]$ProcessId) {
    $commandLine = Get-ProcessCommandLine $ProcessId
    if (-not $commandLine) { return $false }
    return $commandLine -match [regex]::Escape('node') -and
        $commandLine -match [regex]::Escape('server.js')
}

function Show-RttStatus {
    $listener = Get-RttListener
    if (-not $listener) {
        Write-Host "RTT 未运行（端口 $Port 无监听进程）。" -ForegroundColor Yellow
        return
    }

    $commandLine = Get-ProcessCommandLine $listener.OwningProcess
    Write-Host "RTT/端口状态：" -ForegroundColor Cyan
    Write-Host "  端口：$Port"
    Write-Host "  PID：$($listener.OwningProcess)"
    Write-Host "  RTT 进程：$(Test-IsRttProcess $listener.OwningProcess)"
    Write-Host "  地址：http://localhost:$Port/"
    Write-Host "  命令行：$commandLine"

    try {
        $response = Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/" -TimeoutSec 5
        Write-Host "HTTP $($response.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Warning "端口正在监听，但 HTTP 检查失败：$($_.Exception.Message)"
    }
}

function Build-RttGame {
    Write-Host '重新生成伊拉斯谟图表、节点映射和内联运行文件……' -ForegroundColor Cyan
    Push-Location $GameRoot
    try {
        & $NodeExe tools/rules/build_erasmus_pages.js
        if ($LASTEXITCODE) { throw 'build_erasmus_pages.js 失败。' }
        & $NodeExe tools/rules/build_erasmus_graph.js
        if ($LASTEXITCODE) { throw 'build_erasmus_graph.js 失败。' }
        & $NodeExe tools/rules/build_erasmus_implementation_map.js
        if ($LASTEXITCODE) { throw 'build_erasmus_implementation_map.js 失败。' }
        & $NodeExe tools/inline.js
        if ($LASTEXITCODE) { throw 'inline.js 失败。' }
    } finally {
        Pop-Location
    }
}

function Stop-Rtt {
    $listener = Get-RttListener
    if (-not $listener) {
        Write-Host 'RTT 已停止。' -ForegroundColor Yellow
        return
    }

    $processId = [int]$listener.OwningProcess
    if (-not (Test-IsRttProcess $processId)) {
        $commandLine = Get-ProcessCommandLine $processId
        throw "端口 $Port 被非 RTT 进程占用，拒绝停止。PID=$processId；命令行=$commandLine"
    }

    Write-Host "正在停止 RTT（PID $processId）……" -ForegroundColor Cyan
    Stop-Process -Id $processId
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-RttListener) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if (Get-RttListener) { throw "RTT PID $processId 未在 10 秒内释放端口 $Port。" }
    Write-Host 'RTT 已停止。' -ForegroundColor Green
}

function Start-Rtt {
    $listener = Get-RttListener
    if ($listener) {
        if (Test-IsRttProcess $listener.OwningProcess) {
            Write-Host "RTT 已在运行（PID $($listener.OwningProcess)）。" -ForegroundColor Yellow
            Show-RttStatus
            return
        }
        $commandLine = Get-ProcessCommandLine $listener.OwningProcess
        throw "端口 $Port 已被其他进程占用。PID=$($listener.OwningProcess)；命令行=$commandLine"
    }

    foreach ($required in @($RuntimeRoot, $NodeExe, $ServerScript)) {
        if (-not (Test-Path -LiteralPath $required)) { throw "缺少启动依赖：$required" }
    }

    $junction = Join-Path $RuntimeRoot 'public\empire-of-the-sun'
    $junctionItem = Get-Item -LiteralPath $junction -ErrorAction Stop
    $resolvedTarget = [System.IO.Path]::GetFullPath([string]$junctionItem.Target)
    $resolvedGameRoot = [System.IO.Path]::GetFullPath($GameRoot)
    if ($junctionItem.LinkType -ne 'Junction' -or $resolvedTarget -ne $resolvedGameRoot) {
        throw "游戏目录 Junction 不正确：$junction -> $($junctionItem.Target)；期望 $resolvedGameRoot"
    }

    Write-Host '正在后台启动 RTT……' -ForegroundColor Cyan
    $process = Start-Process -FilePath $NodeExe -ArgumentList 'server.js' `
        -WorkingDirectory $RuntimeRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog

    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 250
        $listener = Get-RttListener
        if ($process.HasExited) {
            $errorTail = if (Test-Path -LiteralPath $StderrLog) {
                (Get-Content -LiteralPath $StderrLog -Tail 30) -join [Environment]::NewLine
            } else { '无错误日志。' }
            throw "RTT 启动失败，退出码 $($process.ExitCode)。`n$errorTail"
        }
    } until ($listener -or (Get-Date) -ge $deadline)

    if (-not $listener) { throw "RTT 已启动进程，但 20 秒内未监听端口 $Port。" }
    Write-Host "RTT 启动成功：http://localhost:$Port/（PID $($listener.OwningProcess)）" -ForegroundColor Green
    Show-RttStatus
}

if ($Rebuild) { Build-RttGame }

switch ($Action) {
    'Start' { Start-Rtt }
    'Stop' { Stop-Rtt }
    'Restart' {
        Stop-Rtt
        Start-Rtt
    }
    'Status' { Show-RttStatus }
}
