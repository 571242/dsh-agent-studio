# SOURCES

## 0.2.0 文件清单与职责

| 路径 | 职责 |
| --- | --- |
| `bin/studio.mjs` | 零依赖状态 CLI：`state.json` 账本、`BRIEF.md`、`withLock` 跨进程锁与原子写入；`config`/`reset-config`、`dispatch` 元数据与 BRIEF 锚点派工模板、0.1.x→0.2.0 `upgrade`；`init` 时复制到新项目的模板。 |
| `bin/start.mjs` | 交互启动器：询问项目文件夹与名称，转发到 `studio.mjs init` 或 `resume`。 |
| `cordis.patch.yml` | DSH 本地 bundle 启用补丁。 |
| `plugin/index.js` | DSH 服务端路由：`/agent-studio/api/project`（GET）与 `/agent-studio/api/action`（POST），本机同源校验、body 限制。 |
| `plugin/core.js` | 服务端核心：`snapshot(root)`（含归一化 `config` 与 `skills` 扫描）、`action`（`load`/`init`/`resume`/`feedback`/`pause`/`brief`/`config`/`reset-config`），复用 CLI 的 `normalizeConfig`/`resetConfig`，走同一把跨进程锁与临时文件原子写。 |
| `plugin/client.js` | Web 工作台前端（`window.__ModuleLoader__` + `React.createElement`）：四个标签页（任务 / 项目简报 / 反馈与交接 / 角色与路由）、任务卡执行元数据、角色与路由配置页、`configDirty` 与 refresh-input-safety 输入保护。 |
| `plugin/test/core.test.mjs` | 服务端行为测试（配置保存/重置/非法拒绝/并发、snapshot config+skills 等）。 |
| `plugin/test/client.test.mjs` | 客户端行为测试（四标签页、角色与路由配置、任务卡元数据、延迟刷新不覆盖输入、项目切换草稿保护）。 |
| `skills/project-director/SKILL.md` | 指挥官技能模板（主控零开发、双轨派工、15 行回执、BRIEF 锚点、验收分流、操作顺序）。 |
| `.agents/skills/project-director/SKILL.md`、`.claude/skills/project-director/SKILL.md` | 项目内注入副本，内容须与 `skills/` 主模板一致。 |
| `tests/studio.test.mjs` | CLI 行为测试（config 归一化/持久化/非法拒绝/重置、dispatch 元数据与锚点、0.1.x 升级、withLock 多进程并发与锁恢复等）。 |
| `examples/plan.json` | 任务清单示例。 |
| `README.md` / `SOURCES.md` / `VERIFICATION.md` | 使用说明、文件清单与职责、本轮真实验收结论。 |
| `启动.cmd` / `启动.command` / `启动.sh` | Windows / macOS / Linux 启动入口。 |
| `.studio/BRIEF.md`、`.studio/state.json`、`.studio/studio.mjs` | 项目目标锚点、任务/反馈/配置/交接账本、项目独立 CLI。 |

## 设计思路借鉴

以下项目仅提供**思路借鉴**（设计灵感），本仓库不复制其源码；具体实现均为原创。

- **get-shit-done** — https://github.com/gsd-build/get-shit-done
  - 版本：`bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815`
  - 借鉴：`templates/continue-here.md` 的结构化交接（现状/已完成/剩余/决策/阻塞/下一步），`templates/state.md` 的"活记忆"摘要式进度（读一次即知在哪）。

- **claude-quickstarts / autonomous-coding** — https://github.com/anthropics/claude-quickstarts
  - 版本：`8ef47d719eba5379ff8f38133f5defcc499e856f`
  - 借鉴：`prompts/coding_prompt.md` 的 fresh-context 任务循环（重新定位→验证→做一件→收尾）与 `initializer_prompt.md` 的清单即事实来源（feature_list 只改状态不改定义）。

注：版本号用 `git -C <repo> rev-parse HEAD` 取得，记录的是参考当时的快照。
