# Agent Studio

你只跟一个主 Agent（对话指挥官）聊需求和进度，由它把实现、排障、测试全部交给子 Agent 干，自己做规划、验收和交接记录。
适用于游戏、网站、桌面软件等项目。Node.js 20+，零依赖，不增加 MCP 工具。

## 0.2.0 的核心：单对话指挥官 + 原生双轨委派

- **主控零开发**：主对话只读写 `.studio/` 账本（`state.json`）与项目简报（`BRIEF.md`），不读改业务源码、不跑项目测试。
- **原生双轨委派**：一次性清晰任务走宿主原生 `subagent`（单次执行，显式指定 `provider` + `model` 与 reasoning effort）；原因不明或多步的复杂模块走持续会话轨（原生 `subagent` 创建具名负责人 + `send_message` 续接，继承父会话），单负责人闭环诊断、修复、定向回归。
- **只审结构化回执**：子 Agent 完成后只返回 ≤15 行回执——`【改动文件清单 | 核心变更摘要(≤5行) | 实际执行的验证命令与退出码/通过数 | 契约变更说明 | 阻塞/问题】`，主控凭回执与独立验收结果收口，长日志不进主对话。
- **三角色与默认模型路由**：`director`（main，指挥官）、`engineer`（subagent，含 coding/debug/visual 三条路由）、`reviewer`（subagent，独立验收）。默认路由写在 `state.json` 的 `config` 里，工作台可实时查看与修改。
- **账本与简报**：`.studio/BRIEF.md` 是目标、版本范围与全局契约锚点；`.studio/state.json` 是任务、反馈、证据、配置与交接记录。主控每阶段演进或接口变更时同步 BRIEF 顶部锚点（≤80 行，只留结论）。

## 在 DSH 内使用（无需单独打开程序）

这个目录同时是 `dsh-agent-studio` 本地插件。安装到 DSH 后，会话顶部和侧栏底部都有「项目工作台」。

- 打开会话，点「项目工作台」，直接使用当前项目，或选择其他已存在的项目文件夹。
- 首次点「在此项目启用」，保留原有项目规则，安装项目账本与协作技能。
- 点「开始 / 继续项目」，指挥官启动指令会追加到当前会话草稿，检查后发送即可；不会自动发送，不覆盖原草稿和引用。指令含「主控零开发、双轨委派、只审结构化回执」纪律。
- 工作台共四个标签页：**任务 / 项目简报 / 反馈与交接 / 角色与路由**。打开时定期刷新，关闭后不轮询。
- 「交接并暂停」准备给主 Agent 的指令，由它处理实际 worker 后保存交接；关闭工作台本身不停止任务。

安装：在 DSH 插件页安装 `link:F:/SPACE/agent-studio` 并启用。使用桌面 CLI 时，`dsh plugin --profile desktop add "link:F:/SPACE/agent-studio"` 只安装依赖，随后仍需启用 bundle。支持 profile HMR 的宿主可热加载；否则需要重启 DSH。

插件与项目 CLI 共用项目内 `.studio`；已有项目首次使用此版本前必须先升级项目 CLI，步骤见下方。该插件是本地接入，不需要新端口、新服务或 npm 全局安装。支持 Node.js 20+；当前 DSH 桌面宿主要求以其自带运行时安装。

## 工作台：四个标签页与「角色与路由」

- **任务**：按状态（待办 / 进行中 / 待验收 / 已完成）筛选。每张任务卡展示执行元数据——`Subagent`/`Teammate` 轨道标签、`worker`、`modelRoute`（provider/model）、`risk`（低/高风险），以及验收要求、执行证据与验收结论。
- **项目简报**：编辑并与主 Agent 共用同一份 `BRIEF.md`，带 revision 冲突检查。
- **反馈与交接**：登记新的修改意见，查看待处理反馈与最近交接记录。
- **角色与路由**：查看并编辑 `engineer.routes.{coding,debug,visual}` 与 `reviewer` 的 `provider` / `model` / `reasoningEffort` / `skills`，调整 `fastTrackLowRisk` 开关与 `concurrency` 并发数；「保存配置」「恢复默认」分别调用服务端 `action config` / `reset-config`。
- 后台刷新不会覆盖正在编辑的输入。「打开」和「选择」遇到未保存简报、反馈或配置都会先确认；读取失败时保留草稿。
- 旧项目 CLI 仍可查看进度，但保存简报、反馈或配置前需要先升级 CLI。重开任务会沿用上次选定的路由，实际模型仍以新一轮证据为准。

## 本地开始

解压后打开 `启动.cmd`（Windows）、`启动.command`（macOS），或在 Linux 执行 `sh 启动.sh`。
输入项目文件夹与项目名，然后用你常用的编程 Agent 打开该项目，告诉它：

> 按 project-director 流程开始这个项目。你负责规划和分派，我只提需求、看进度和验收。

也可以把解压目录交给 Agent，让它执行：

```sh
node bin/studio.mjs init "TARGET" --name "项目名"
```

宿主需要支持子 Agent 和项目规则/技能，例如 Claude Code、支持子 Agent 的 Codex 或 DSH。
其他宿主可让主 Agent 显式读取 `.agents/skills/project-director/SKILL.md`；没有子 Agent 时不能并行派工。
安装仅作用于所选项目，不修改全局配置，不自动安装模型或插件。

## 以后直接聊

- “继续上次的项目，先告诉我做到哪了。”
- “这里改成……，原来的存档功能保留。”
- “先停一下，保存交接，明天继续。”

主 Agent 先读存档，维护目标、拆任务、派工、收结果，再给你可体验的版本。
改需求会记录为反馈与后续任务；只有实际验收通过的任务才算完成。低风险局部改动由单一 engineer 闭环自测、主控凭回执直接验收；跨模块/高风险必须独立 reviewer（与实现者 worker 标识不同）验收后才算 done。

## 放在哪里

`.studio/BRIEF.md` 是项目目标与决策，`.studio/state.json` 是任务、反馈、证据、配置与交接记录。
随项目一起保留或提交到 Git。`AGENTS.md` / `CLAUDE.md` 只追加短入口，原有内容保留。
新会话读取这些文件继续；已中断的 worker 会重新分派，不恢复进程。

## 给 Agent 的命令

在项目根目录运行 `node .studio/studio.mjs help`。
任务清单格式见 [examples/plan.json](examples/plan.json)。初始化后无需保留原解压包即可运行。

CLI 命令一览：

```sh
node .studio/studio.mjs status / resume          # 查看进度 / 读取交接包
node .studio/studio.mjs resume --continue         # 解除暂停，准备继续派工
node .studio/studio.mjs plan FILE.json            # 追加带依赖与验收条目的任务
node .studio/studio.mjs dispatch --limit 2        # 认领就绪任务，输出子 Agent 任务包
node .studio/studio.mjs submit ID --summary TEXT --evidence TEXT
node .studio/studio.mjs review ID --result pass|fail --reviewer NAME --evidence TEXT
node .studio/studio.mjs config [FILE.json]        # 查看或更新配置
node .studio/studio.mjs reset-config              # 恢复默认配置
node .studio/studio.mjs upgrade TARGET --confirm-stopped
```

- **dispatch 新参数**：`--task ID --worker NAME --mode subagent|teammate --role engineer|reviewer --model PROVIDER/MODEL --risk low|high`。这些元数据会写入任务对象（`worker`/`mode`/`role`/`modelRoute`/`risk`），并随任务卡展示；生成的任务包自动带上 `.studio/BRIEF.md` 三块锚点、任务 id/title/description/scope/acceptance、15 行回执格式与主控零开发纪律。原有默认派工行为不变。
- **config [FILE.json]**：无参打印归一化后的当前配置；带文件则在跨进程锁内原子写回 `state.config`。`reset-config` 恢复内置默认（director / engineer 三路由 / reviewer）。各方向默认技能与选型评估见 [SKILLS.md](SKILLS.md)。
- CLI 只管理状态；`dispatch` 生成任务包，主 Agent 调用宿主原生子 Agent 真正执行。同一项目由一个主 Agent 协调，文件范围重叠的任务串行处理。

## 已有项目升级与并发写入

每个初始化项目保留一份独立 CLI，因此更新插件本身不会更新旧项目。升级前先停止该项目全部 CLI、旧版插件和所有会写账本的进程；确认不再有旧代码运行后，在 Agent Studio 安装目录执行：

```sh
node bin/studio.mjs upgrade "TARGET" --confirm-stopped
```

`TARGET` 是已有项目根目录。命令只在项目 CLI 与已知原版 SHA-256 白名单完全一致时升级（0.1.0 = `91c404ef83db910fb5080098dd2b1a723076b08711533249d1cde85dd5b20dfd`，0.1.1 = `d23c689a6bcaeb02b2ce30b2c345cca7bc4b4de0483ab266f917657d2349e9d5`，0.2.0 旧模板 = `f8ad29277bec0a5f2ca03101c8e38872a84447fe68cfb805dc0e5999928b3d4a`，0.2.0 技能配置前模板 = `9873ff91a774ce8a933d549761871bf36261135c72bcf83adec531df6998085a`）。默认在项目 `.studio/studio.mjs.pre-ledger.bak` 保留原文件；若该固定备份已存在且内容相同则复用，内容不同则保留历史备份并改用 `.studio/studio.mjs.pre-ledger.<原CLI SHA-256前8位>.bak`。同名同哈希复用，异哈希拒绝且绝不覆盖；其他版本或定制脚本会被拒绝。升级只替换 `.studio/studio.mjs`，**保留 `state.json`、`BRIEF.md` 与协作规则**，并补齐 `.studio/.gitignore` 中的锁及临时文件忽略规则；若该文件是链接或非普通文件则拒绝升级。当前版本已安装则命令返回无需升级。未知或定制 CLI 必须由维护者在保留定制的前提下迁移到相同协议；未完成迁移前，新版包 CLI/插件拒绝写入该账本。以后发布新版本时也应先停止写入并安排项目副本升级，不能仅更新插件就混用不同版本。

新版项目 CLI 和插件启动的 CLI 使用同一 `.studio/state.json.lock`，在锁内重新读取并原子替换账本，冲突等待最多 5 秒，超时返回错误，可重试。所有写入方须使用同版本代码、同一台机器、支持独占创建及同目录原子重命名的本地文件系统；不支持共享网络盘或同步盘跨机器写入。旧版插件、旧 CLI、其他位置保存的旧副本、直接编辑 JSON 的工具都不遵守此协议：它们运行时无法保证安全，必须停止或升级，不能与新版混用。界面中的 CLI 兼容状态仅反映最近一次快照，不能拦截快照之后被替换的脚本或仍在运行的旧进程。简报不在账本锁保护范围。

进程异常中止可能留下 `.studio/state.json.lock` 或随机临时文件；系统不会仅凭超时或 PID 删除锁。先确认该项目所有 CLI 和插件写入进程都已停止，再检查锁文件并手动删除它，然后重试；锁内容可能不完整，不能据此单独认定进程已停止。随机的 `.state.json-*.tmp` 和 `.studio.mjs-*.tmp` 是未完成的临时写入，确认全部进程停止后可检查并删除；不要以临时文件覆盖账本。意外中止发生在原子替换之前保留旧账本，发生在之后则保留新账本；若客户端在确认前中止，重试前应先检查结果，避免重复执行。此机制不承诺断电时的磁盘级持久性。

## 开发与验证

```sh
npm test        # node --test tests/studio.test.mjs plugin/test/*.test.mjs
npm run check   # node --check plugin/index.js && core.js && client.js
```

启动 DSH GUI：桌面版 DeepSeek Harness 内置工作台（本机当前 http://127.0.0.1:54004；历史文档端口 61889 已不使用）。当前版本在 Windows / Node 24 下 `npm test` 88 项全部通过（0 失败 0 跳过，含真实宿主 SDK 技能发现/skill.execute 集成），`npm run check` 退出码 0；包含真实多进程并发、锁中断恢复、配置归一化、配置驱动派工与快速验收策略、派工元数据与升级保留用户数据等行为测试。GUI 工作台已在现有桌面应用实测四标签、三路由、宿主技能状态与任务卡请求/实际；配置保存→刷新→恢复默认的写操作往返仍建议在隔离测试项目补验。参考源码与设计来源见 [SOURCES.md](SOURCES.md)。未发布 npm。
