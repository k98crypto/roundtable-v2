# 在 PowerShell 里跑，不要跑进 CMD。
# 圆桌 v2 部署脚本（小新用）：只做备份 + 复制到新目录 + 实测，不直接覆盖旧目录。
# 部署前必须：用户已拍板、Codex 手动执行、当前没有 CLI 和桥同时写同一个 meetings.json。
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$srcBase = 'D:\圆桌会议'
$srcApp = 'D:\Codex\apps\roundtable-meeting'
$dstApp = 'D:\Codex\apps\roundtable-meeting-v2'
Write-Host "第 1 步：备份（时间戳 $stamp）"
Copy-Item $srcBase -Destination "D:\圆桌会议-bak-$stamp" -Recurse
Copy-Item $srcApp -Destination "D:\Codex\apps\roundtable-meeting-bak-$stamp" -Recurse
Write-Host "第 2 步：核对备份（请人工核对大小和 meetings.json 条数，再继续）"
Get-ChildItem "D:\圆桌会议-bak-$stamp" -Recurse | Measure-Object Length -Sum
Write-Host "第 3 步：复制 v2 包到新目录（本脚本所在目录的上一级即 v2 包根目录，请先把 v2 包传到小新）"
if (-not (Test-Path $dstApp)) { New-Item -ItemType Directory -Path $dstApp | Out-Null }
Copy-Item "$PSScriptRoot\.." -Destination $dstApp -Recurse -Force
Write-Host "第 4 步：临时目录实测（全部 PASS 才继续）"
Set-Location $dstApp
node tests/test.mjs
Write-Host "实测通过后，再手动指到真实 data（先读不写），并按 README 第 4 节分开验收技能/worktree/手机三项。"
Write-Host "回滚：停新桥，恢复备份 meetings.json，回到旧目录即可，桥停了文件夹链路照样能走。"
