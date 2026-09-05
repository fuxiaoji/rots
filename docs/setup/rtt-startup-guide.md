# RTT 本地启动指南（Windows）

## 目录关系

- 游戏源码：`D:\desktop\rots`
- RTT 平台运行目录：`D:\desktop\rots-runtime-pve`
- 平台公开目录中的 `public\empire-of-the-sun` 是指向游戏源码的 Junction。不要复制旧 ZIP 代码覆盖它。
- 默认地址：`http://localhost:8080/`

## 首次检查

在 PowerShell 中确认 Node 和目录：

```powershell
& 'C:\Users\fwj\tools\node-v22.23.2-win-x64\node.exe' --version
Get-Item 'D:\desktop\rots-runtime-pve\public\empire-of-the-sun' |
  Format-List FullName,LinkType,Target
```

正常情况下 `LinkType` 为 `Junction`，`Target` 为 `D:\desktop\rots`。平台依赖已安装在 `D:\desktop\rots-runtime-pve\node_modules`；若目录缺失，可在平台目录运行 `corepack pnpm install --frozen-lockfile` 按锁文件重新安装依赖。

## 修改规则后的构建

`js\*` 是源码真源。修改规则、图表或客户端后，在游戏源码目录运行：

```powershell
Set-Location 'D:\desktop\rots'
$node = 'C:\Users\fwj\tools\node-v22.23.2-win-x64\node.exe'
& $node tools/rules/build_erasmus_pages.js
& $node tools/rules/build_erasmus_graph.js
& $node tools/rules/build_erasmus_implementation_map.js
& $node tools/inline.js
```

这会同步逐页文档、`data\erasmus\charts.json`、运行时图表数据、节点实现映射以及根目录 `rules.js`/`play.js`。

## 推荐：使用启动脚本

在 PowerShell 中运行：

```powershell
Set-Location 'D:\desktop\rots'

# 启动（默认动作）
.\tools\start-rtt.ps1

# 查看状态
.\tools\start-rtt.ps1 -Action Status

# 停止或重启
.\tools\start-rtt.ps1 -Action Stop
.\tools\start-rtt.ps1 -Action Restart

# 先重建规则/图表，再重启
.\tools\start-rtt.ps1 -Action Restart -Rebuild
```

脚本会检查 Node、运行目录和游戏目录 Junction，后台启动服务器，等待 8080 端口并执行 HTTP 健康检查。日志写入 `D:\desktop\rots-runtime-pve\rtt-stdout.log` 和 `rtt-stderr.log`。停止时只处理实际占用 8080 且命令行为本项目 `server.js` 的进程。

如果系统执行策略阻止 `.ps1`，可以仅对本次进程放行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-rtt.ps1
```

## 前台启动（便于看日志）

```powershell
Set-Location 'D:\desktop\rots-runtime-pve'
& 'C:\Users\fwj\tools\node-v22.23.2-win-x64\node.exe' server.js
```

保持窗口打开，然后访问 `http://localhost:8080/`。AI 每次钉选战略时会在控制台输出 `AI STRATEGY` JSON，包含阵营、阶段、战略、首要目标和推进指标。

## 后台启动

```powershell
$runtime = 'D:\desktop\rots-runtime-pve'
$node = 'C:\Users\fwj\tools\node-v22.23.2-win-x64\node.exe'
Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $runtime `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$runtime\rtt-stdout.log" `
  -RedirectStandardError "$runtime\rtt-stderr.log"
```

## 健康检查

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen |
  Select-Object LocalAddress,LocalPort,OwningProcess
Invoke-WebRequest -UseBasicParsing 'http://localhost:8080/' |
  Select-Object StatusCode
Get-Content 'D:\desktop\rots-runtime-pve\rtt-stdout.log' -Tail 40
Get-Content 'D:\desktop\rots-runtime-pve\rtt-stderr.log' -Tail 40
```

期望 HTTP 状态为 200。登录后可建立 `1942-1945 (The Shortened Campaign)` 的 PvE 对局，选择人类阵营，机器人选择 `erasmus-v2`。

## 停止与重启

先精确取得占用 8080 的进程，再停止它：

```powershell
$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction Stop |
  Select-Object -First 1
Get-Process -Id $listener.OwningProcess
Stop-Process -Id $listener.OwningProcess
```

然后按“前台启动”或“后台启动”重新运行。不要按进程名批量结束所有 Node 进程。

## 常见问题

- **页面仍是旧逻辑**：先执行四条构建命令，再重启平台服务并强制刷新浏览器。
- **8080 已被占用**：用 `Get-NetTCPConnection` 查明 PID；确认它确实是本项目后再停止。
- **游戏资源 404**：检查 Junction 的 `Target`，不要手工复制整个游戏目录。
- **AI 停止**：查看 `rtt-stderr.log`、浏览器 AI 决策轨迹和最后一个 replay。未知谓词/非法动作应显式报错，不应静默降级。
- **需要核对版本**：浏览器 AI 轨迹的 `policy` 应与 `js\server\bots\erasmus.js` 中 `ERASMUS_VERSION` 一致。
