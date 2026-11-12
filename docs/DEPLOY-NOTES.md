# 圆桌 v2 改造包（已部署到小新新目录，未覆盖旧版）

> 2026-10-31 凌晨部署实况：已备份 D:\圆桌会议 与 D:\Codex\apps\roundtable-meeting（后缀 -bak-20261031-v2），v2 复制到 D:\Codex\apps\roundtable-meeting-v2（不覆盖旧版），小新上 tests 18/18 PASS，真实 meetings.json 副本 topics 读出 6 条（先读不写真实数据），桥 127.0.0.1:3176 临时起停测试通过（version 正常，测试后已停，未留常驻进程）。部署中修了一个真兼容问题：现行 meetings.json 顶层是数组、字段是 topic/order/turnIndex，不是 {meetings: []}/title/seats，v2 已改成兼容数组格式保存，旧 CLI/WebUI 仍可读。旧版 CLI v0.5 与 WebUI 重做任务仍在原目录，未动；何时把主通道切到 v2（停旧 WebUI 计划任务、只留一个写方），由用户/Codex 手动拍板。
>
> 2026-10-31 凌晨切换实况（用户说 WebUI 任务不重要就切）：WebUI 计划任务 RoundtableMeeting 本来就已是 Disabled（上次运行 10/29 18:20，动作是旧 start-hidden.ps1，3175 已空），不是在跑的服务，旧代码已备份、可回滚；3 个 node 进程经查是 Codex artifact-tool / cua-repl / cua server.mjs，与圆桌无关，未杀。切换前补了文件夹同步缺口（新议题建 01_议题夹、发言同步 02_会议记录/04_成果），本地模拟总基地测试通过。切换后：主通道 = v2 CLI + 3176 桥（start-v2.ps1 已起、version 正常、3176 Listen、3175 仍空、RoundtableMeeting 仍 Disabled），标记在 v2 目录 CURRENT-CHANNEL.md；CLI 与桥不能同时写，重启后如需再起桥重新跑 start-v2.ps1（未建新计划任务）。
>
> worktree 隔离替代说明：隔离本身不需要 Orca。Git 原生 worktree（git worktree add）就是 Orca 用的那套机制，Orca 只是包了个桌面 + 手机 UI；文件夹隔离（v2 已有）对非代码任务更轻；Docker 每席位隔离最强但最重。详见第 6 节。

## 第 0 节：先提醒——Orca REA 提醒（worktree 隔离触发条件）

**在把 worktree 隔离部署到小新之前，须先提醒用户：叫 Codex 用 REA 拆 Orca。**

- REA 做法：分析 Orca 的功能行为、写成自己的需求文档、按需求重写可复用部分；不直接抄 Orca 实现、不破解、不碰授权校验、MIT 留出处；整理成自己的文档与代码以省 token。
- 手机收发功能也要包含在 REA 拆解范围内。
- 提醒文件（小新）：`D:\圆桌会议\06_工具\待提醒\Orca-REA提醒.md`。
- 本包的 worktree 隔离是“点子借鉴”（每 Agent 一个隔离文件夹、只合并赢家、合并前用户看 diff），不是 Orca 代码复制，现阶段不装 Orca 本体，不整体装 Orca（Orca 与圆桌编排重复，会造成第二套任务/工作区/真相源，与单一数据源、本地不公开、总结+深链铁律冲突）。

## 1. 这次改造综合了哪些工具和技能

| 来源 | 怎么综合进圆桌，不是什么 |
|---|---|
| 现有圆桌 CLI v0.5 + 文件夹链路 | 保留：事实源仍是 meetings.json + 总基地（01 议题、02 会议记录、03 任务分工、04 成果、05 铁律、06 工具）；CLI 命令兼容 v0.5；CLI 与 WebUI/桥不能同时写同一个 meetings.json |
| ClawChat 管线 + UI（第 1、2 个） | 抄管线思路：connect.challenge → connect → hello-ok 握手、message.ack、heartbeat 退避重连、权限门 permission_result、入站过滤链、/stop 队列优先；抄 UI 思路：发言人颜色/标识、思考中/回复中状态、会话标签、Chat UI 与终端双视图、源码控制审 diff、Quick Commands。真相仍是文件夹，聊天记录不是真相 |
| Orca（只借 2 个点子） | 借：① 每 Agent 一个 worktree 隔离文件夹，互不覆盖；② diff 按行批注、只合并赢家、合并前用户看 diff。会议数据不进 worktree；不装 Orca 本体、不抄 Orca 代码 |
| Orca 手机通道 | 借：手机 App 是遥控器（看状态、看回放、回短消息、审源码控制、跑 Quick Commands、切换账号看用量），桌面永远是事实源；连接优先 Tailscale（小火箭 Tailscale 模组），备用 Orca Relay |
| Impeccable / Ponytail / security-audit | 以技能形式纳入，分工：设计 / 精简 / 安全；技能简报只放 skills/README.md，不放技能本体代码，删 .md 即除；Impeccable hook 不自动装，security-audit 只在无网络沙箱、只审自有代码 |
| Graphify | 只作只读索引、永不当真相；先做门槛测试，再决定是否长期用；不开 --strict 与 git hook，私有代码不开 --deep 除非用户另批 |
| Tailscale（小火箭） | 手机通道的隧道：小火箭 2.2.89+ 自带 Tailscale 全局隧道模组，填 Auth Key、加 ts.net 规则、删 100.64.0.0 冲突规则，内网与正常翻墙并行；小新侧 Clash：100.64/10、ts.net 走 DIRECT / NO_PROXY |

## 2. 包里有什么

- `lib/roundtable.mjs`：核心逻辑，CLI 和桥共用；席位闸、顺序闸、检查闸、返工上限 2、技能开关闸、总结+深链、worktree 路径。
- `lib/gateway.mjs`：ClawChat 式管线协议层（握手、回执、心跳、权限门、入站过滤），不做模型调用。
- `lib/mobile.mjs`：Orca 式手机通道（状态、回放、回复指引、主机配置、Tailscale 步骤）。
- `cli.mjs`：CLI v2，兼容 v0.5，新增 skill / worktree / mobile / review / summary。
- `server.mjs`：桥 v2，只监听 127.0.0.1:3176（与旧 3175 错开），零依赖，SSE 推总结+深链，不推全文。
- `public/index.html + app.js`：ClawChat 式 UI，只读总结+深链，技能按钮先审查再拍板。
- `skills/README.md`：4 技能简报与风险、单测范围。
- `worktrees/`：每席位 worktree 模板（README 含隔离规则）。
- `tests/test.mjs`：本地实测，全部 PASS 才算可用。
- `deploy/`：小新部署脚本（PowerShell），含备份与回滚，见第 4 节。

## 3. 本地实测（已跑，见 tests 输出）

在 PowerShell / bash 里跑（本包在 Linux 上实测，Node 24）：

```
node tests/test.mjs
node cli.mjs --base ./data-test topics
PORT=3176 ROUNDTABLE_BASE=./data-test node server.mjs
# 再开一个终端：curl http://127.0.0.1:3176/api/version
```

实测覆盖：默认席位、下一位推导、用户 say 不吃轮次、未勾选拦截、新增席位追赶摘要、检查人非原作者、技能未开拦截、自动提议不生效、人工拍板才开启、手动锁、检查通过、worktree 生成、网关握手三帧、敏感操作权限门、手机 read-mostly、总结深链。

## 4. 部署到小新（未执行，等你拍板，Codex 手动执行）

**为什么这次不直接部署：** ① 本机 cloudflared 本地代理当前未运行，SSH 到小新不通；② 小新现行版是 CLI v0.5 + WebUI 重做任务 4b6db4faa2a6（Codex 手动做），直接覆盖会撞任务、撞 meetings.json 写冲突；③ 服务器/圆桌改动铁律要求先提方案、用户拍板后由指定者执行，sshd 已冻结。

部署步骤（小新 PowerShell 里跑，命令已写进 deploy/deploy-roundtable-v2.ps1，不要跑进 CMD）：

1. 先备份：`D:\圆桌会议` 和 `D:\Codex\apps\roundtable-meeting` 各打一份时间戳备份，备份完先核对备份大小和 meetings.json 条数，再动原目录。
2. 停写：确认当前没有 CLI 和桥同时在写同一个 meetings.json，WebUI 计划任务保持禁用（3175 已空的状态不要动）。
3. 只复制新文件到新目录（例如 `D:\Codex\apps\roundtable-meeting-v2`），不直接覆盖旧目录；旧目录留作回滚。
4. 先在临时 data 目录跑 `node tests/test.mjs`，全部 PASS 再指到真实 data（先读不写，核对议题数、席位数、下一位）。
5. 技能开关、worktree 隔离、手机通道三项，分开验收：技能先审一页/小 diff/小测试库；worktree 先只隔离并行代码任务、只合并赢家、合并前用户看 diff；手机先在家里 WiFi 下用 Tailscale IP:3176 通，再用移动数据测 direct / DERP。
6. 回滚：任何一步验收不过，停新桥、回旧目录、恢复备份 meetings.json，桥停了文件夹链路照样能走。

## 6. worktree 隔离：不止 Orca 一条路（2026-10-31 用户追问的回答）

是的，worktree 隔离完全可以有其他办法，而且对圆桌来说有些办法比装 Orca 更合适：

1. **Git 原生 worktree（最推荐给代码任务）**：`git worktree add -b <席位>/<议题> ../worktree-<席位>`，每个席位一个独立工作目录、独立分支，互不覆盖，改完看 diff、只合并赢家、用完 `git worktree remove` + `git worktree prune` 清理。这是 Git 自带功能，Orca 只是把它包起来加了 UI，不用装 Orca、不用订阅、不用交匿名数据、Windows PowerShell 就能跑。
2. **文件夹隔离（v2 已有，最推荐给非代码任务）**：`worktrees/<议题>/<席位>/`，只写自己文件夹、不写别人、不写 shared/integration/final、不写 05_铁律、会议数据不进 worktree。轻、无依赖，缺点是没有版本历史，合并要人工看 diff。
3. **每席位一个分支（不推荐单独用）**：只分分支不分工作目录，两个席位在同一目录切来切去会互相顶掉、容易误提交，不如 worktree。
4. **Docker / devcontainer 每席位一个（最强但最重）**：依赖、端口、环境全隔离，适合要跑不同环境的代码任务，但小新上又慢又重，圆桌这种以文字、总结、审 diff 为主的任务用不上。

Orca 真正值钱的不是 worktree 这个机制，而是“每 Agent 一个会话 + 手机遥控 + 终端回放 + 源码控制 UI”那套。如果你只要隔离，选 1 或 2 就够了，不用 REA 拆 Orca；如果你以后还要 Orca 那套手机 + 会话 UI，REA 提醒仍然有效，要先拆 Orca 再按自己需求重写，不能直接抄。

## 5. 不做的事

- 不装 Orca 本体、不抄 Orca 代码、不整体装 Orca。
- 不恢复旧网页桥自动回传（Muse 席位 0 次成功）。
- 不把圆桌推到公网、不接 Stripe、不做对外产品通用栈。
- 不自动拉 Codex 后台跑任务（2026-10-30 已定，Codex 手动做）。
- 不改 sshd 配置、不改防火墙、不改现行 meetings.json 格式（任务只加 type/skill 字段，不改原有字段）。
