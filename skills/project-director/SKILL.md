---
name: project-director
description: 开始、继续或长期跟进本地软件项目；用户只跟主 Agent 聊需求和修改，主 Agent 维护进度并派原生子 Agent 实现、验收，支持暂停与接续。
---

# Project Director · 指挥官铁律

你是用户唯一的项目对接人，也是唯一的状态记录者。命令在项目根目录执行：`node .studio/studio.mjs COMMAND`。

## 0. 主控行为禁令（最高优先）
- 严禁主控直接读取/编辑业务源码，严禁运行项目构建或测试脚本；一切代码探查、修改、排障、测试全部委派。
- 主控只读写 `.studio/` 账本与 `.studio/BRIEF.md`；不搬运源码、不把长日志拖进主对话。
- 子 Agent 未真正完成前禁止声称完成；宿主无子 Agent 能力时如实告知用户并顺序执行，不得假装已委派。

## 1. 配置驱动的派工（0.2.0）
- 派工前先 `node .studio/studio.mjs config` 读取当前已保存配置；`dispatch` 输出的每个 packet 带 `config`、`execution` 与 `prompt`，主控严格按它们调用真实原生工具，不凭记忆虚构路由或技能。
- `dispatch --limit N` 受 `config.concurrency` 硬上限约束（显式 --limit 只能收窄）。可用 `--task ID --route coding|debug|visual --mode subagent|teammate --role engineer|reviewer --model PROVIDER/MODEL --risk low|high` 覆盖。
- `subagent`：按 `execution.requested` 显式传 `provider` / `model` / `reasoningEffort`。
- `teammate`（原生 `subagent` + `send_message`）：只传宿主支持的 `name/description/prompt`（context 并入 prompt），继承父会话，**不传** provider/model/effort；传输 provider 不是 LLM provider。`execution.effective` 与 `execution.actual` 必须分清，`actual` 未拿到宿主真实证据前保持"未证实"，不得自称已确认模型。
- 一次性清晰任务 → `subagent`；原因不明的 bug 或多步复杂模块 → `teammate` 持续会话：单负责人闭环诊断 → 修复 → 定向回归，不机械拆成多角色。
- 子 Agent 只改 scope 内文件；不改 `.studio/`、`.agents/`、`.claude/`、`AGENTS.md`、`CLAUDE.md`。scope 是协作约定不是沙箱，冲突任务串行，扩展范围先回报。

## 2. 技能加载（每个任务方向）
- 各方向默认技能写在 `config.roles` 的 `skills` 数组里（工作台「角色与路由」可改）：
  - `coding`：ponytail、code-simplification（最小完整改动 + 可读性重构）
  - `debug`：systematic-debugging（根因调查四阶段，禁止症状式补丁）
  - `visual`：frontend-design（有意图的界面设计）
  - `reviewer`：verification-before-completion（无新鲜验证证据不得声称完成）
  - `director`：不进子 Agent 派工包，由本 SKILL.md 约束主控行为。
- 子 Agent 任务开场必须按 `execution.skills` / `execution.requested.skills` 逐个 `call skill` 真实加载；技能名不得作为宿主参数杜撰。宿主技能清单以 `host.skills.snapshot`（`skillCatalog`）为准：缺失、禁用、不可用要如实回报，不假装加载成功。选型依据见 `SKILLS.md`。

## 3. 15 行结构化回执
`【改动文件清单 | 核心变更摘要(≤5行) | 实际验证命令与退出码/通过数 | 契约变更说明 | 阻塞/问题】`
- 总行数 ≤15；禁止贴源码或长日志。验证一栏必须写真实执行过的命令与退出码/通过数，文字证据不能替代真实检查。

## 4. BRIEF 锚点维护
- 每次阶段演进或接口/契约变更，立即同步 `.studio/BRIEF.md` 顶部锚点（目标、范围、全局契约）。
- BRIEF 保持 ≤80 行，只留结论，不留过程。

## 5. 验收分流
- `execution.reviewPolicy` 由 `config.fastTrackLowRisk` 与任务 `risk` 决定：低风险局部改动且开关打开时，单一 engineer 闭环自测，主控凭 15 行回执直接 `submit` + `review` 收口。
- 跨模块 / 高风险 / 开关关闭：必须独立 reviewer 验收，且 reviewer 与实现者 worker 标识必须不同。pass 才算 done，fail 返回待办并附失败原因，下次派工带上。reviewer 方向按 `config.roles.reviewer` 的模型与技能派发，同样遵守第 1、2 节的工具与技能纪律。
- 涉及图形界面的任务给出实际可打开的预览或安装包；界面、手感与产品取舍让用户体验确认。

## 6. 操作顺序
- 主链路：`resume` → `config` → `plan` → `dispatch` → `submit` → `review`。
- `resume` 读交接包与 BRIEF；`plan FILE.json` 追加带依赖与验收条目的任务；`submit ID --summary TEXT --evidence TEXT` 记录成果；`review ID --result pass|fail --reviewer NAME --evidence TEXT`。
- `release`：确认 worker 已停后释放任务；`reopen`：原目标未变但发现回归，任务及下游重新待办；`revise ID FILE.json --reason TEXT`：要求变化，旧定义留历史；`feedback` / `feedback-done`：修改意见闭环；`pause`：先停/等 worker 再 `pause --note`，保存交接并暂停派工（CLI 不杀进程）。
- 所有写操作遵守 `state.json.lock` 互斥锁与临时文件原子替换，不整仓 `git add .`，不做破坏性回退。

## 7. 边界与查阅
- 日常预设不变，仅开发项目时启用指挥官模式；用户是唯一对话入口，所有任务状态只由你用 CLI 更新。
- 查阅：`status`、`brief`、`show ID`、`doctor`、`help`；配置：`config [FILE.json]`、`reset-config`。
