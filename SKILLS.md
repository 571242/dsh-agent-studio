# Agent Studio 技能配置评估（0.2.0）

日期：2026-11-09。对象：`F:\SPACE\agent-studio`（dsh-agent-studio 0.2.0）。数据来源：skills.sh 页面、`npx skills find/ls/update/add` 实测输出、本机 `C:\Users\admin\.agents\skills` 目录。安装数/星数为查询当时快照，会变化。

## 任务方向与落点

插件 `config.roles` 有 5 个 skill 槽位，但**只有 4 个会进子 Agent 派工包**：`engineer.routes.{coding,debug,visual}` 与 `reviewer`。`director` 是主控，不派生子 Agent，给它配 `config.skills` 不会生效——主控行为由插件自带的 `project-director` SKILL.md 约束。技能由 `dispatch` 写进 packet 的 `execution.skills / requested.skills`，主控在子代理开场 `call skill` 逐个加载；宿主实际可用性由 `host.skills.snapshot`（工作台 `skillCatalog`）呈现，缺失/禁用时如实回报，不假装加载。

| 方向 | 配置技能 | 来源 / 安装数 / stars / 审计 | 为什么配它 |
| --- | --- | --- | --- |
| `engineer.coding` | `ponytail` + `code-simplification` | [ponytail](https://skills.sh/DietrichGebert/ponytail/ponytail) 123.7K / 186.9K / 三项 Pass；[code-simplification](https://skills.sh/addyosmani/agent-skills/code-simplification) 72.3K / 114.1K / 三项 Pass | 默认已有 ponytail（最小完整改动，含"列出必须触及的调用方/测试/配置"）。加 code-simplification 补可读性重构：功能跑通、测试过后降低复杂度且行为不变，与 ponytail 互补不冲突。两者纯文本、零外部依赖、本机已装。 |
| `engineer.debug` | `systematic-debugging` | [obra/superpowers](https://skills.sh/obra/superpowers/systematic-debugging) 325.9K / 314.6K / Trust Hub Warn、Socket+Snyk Pass | 原为空。四阶段（根因调查→模式分析→假设验证→修复）+「三次修复失败即质疑架构」，与插件"原因不明的 bug 用 teammate 单负责人闭环诊断→修复→定向回归"完全对齐，禁止症状式补丁。 |
| `engineer.visual` | `frontend-design` | [anthropics/skills](https://skills.sh/anthropics/skills/frontend-design) 1.1M / 189.5K / 三项 Pass | 默认已有且评价确认好用。有意图的视觉方向、排版、配色、动效，拒绝模板化 AI 界面；纯指导、零依赖。保留。 |
| `reviewer` | `verification-before-completion` | [obra/superpowers](https://skills.sh/obra/superpowers/verification-before-completion) 269.6K / 314.6K / 三项 Pass | 原为空。铁律「无新鲜验证证据不得声称完成/通过/修复」，与插件"文字证据不能替代真实检查""pass 才算 done"直接对应，逼 reviewer 真跑命令、读退出码。 |
| `director` | 不配 `config.skills`；更新 `project-director` SKILL.md | 插件自带，三份副本字节一致 | 主控零开发、双轨委派、config 驱动派工、`execution.requested/effective/actual` 区分、技能加载、验收分流全部写进指挥官铁律。 |

## 评估过但未采用（都查了实证）

| 候选 | 实证 | 不用的理由 |
| --- | --- | --- |
| [mattpocock/code-review](https://skills.sh/mattpocock/skills/code-review) | 870.3K / 318.4K / Snyk Warn | 要求用户给 fixed point（commit/tag）+ issue tracker，并并行两个子 Agent 审 diff。插件 reviewer 审的是任务实际产物与测试证据，不是 git diff；与 CLI 的 submit/review 流程错位。 |
| [mattpocock/tdd](https://skills.sh/mattpocock/skills/tdd) 或 [obra/test-driven-development](https://skills.sh/obra/superpowers/test-driven-development) | 1.2M / 274.3K | 强制「先写测试、看它失败、删掉先于测试写的代码」，是编码方法论而非通用默认；会与 ponytail「最小改动」和某些存量任务定义打架。需要 TDD 的项目可在工作台按需加。 |
| [anthropics/webapp-testing](https://skills.sh/anthropics/skills/webapp-testing) | 201.1K / 189.5K / Socket+Snyk Warn | 依赖 Python Playwright 与 helper 脚本，需要浏览器环境；作为通用 visual 默认会引入未声明依赖。已有「图形界面任务给可打开预览」纪律，需要时按需加。 |
| [mattpocock/improve-codebase-architecture](https://skills.sh/mattpocock/skills/improve-codebase-architecture) | 1.2M / Snyk Warn | 面向跨模块架构重构，还要 GLOSSARY/ADR/并行子 Agent，超出单任务派工粒度。 |
| [mattpocock/handoff](https://skills.sh/mattpocock/skills/handoff)、[grill-me](https://skills.sh/mattpocock/skills/grill-me) | 1.1M / 1.5M | 插件自带 `pause` 交接包（`state.handoff`）与「关键产品选择才问用户」纪律，重复。 |

## 已装技能更新（本轮实测）

`npx skills update -g -y`：发现 3 个全局更新并成功写入（会话目录描述同步变化）：

| 技能 | 结果 | 备注 |
| --- | --- | --- |
| `ponytail` | 已更新 | coding 默认在用 |
| `code-simplification` | 已更新 | 会话目录 description 变长（新增"pasted inline / reduce nesting"触发） |
| `hypit` | 已更新 | 非本插件方向，顺带保持全局最新 |

`find-skills`、`computer-use`、`reverse-engineer-anything`、`h3-prompt-writing` 在 CLI 里标为 untracked（无远端来源），`npx skills update` 不覆盖它们——这是环境事实，不是本轮遗漏。

## 新装技能（本轮实测）

```sh
npx skills add https://github.com/obra/superpowers --skill systematic-debugging -g -y
npx skills add https://github.com/obra/superpowers --skill verification-before-completion -g -y
```

装到 `C:\Users\admin\.agents\skills\`，已验证 `SKILL.md` 存在且 `name:` 正确，会话技能目录已识别到两者。`--skill` 一次只接受一个名字（用逗号分隔会被当成整体，第一次调用报 `No matching skills found`，已拆两次重跑成功）。

## 代码与文档联动（保证配置真的生效）

改 `DEFAULT_CONFIG` 会改 `bin/studio.mjs` 字节，连带触发：

1. `bin/studio.mjs`、`plugin/client.js`、`tests/studio.test.mjs`、`plugin/test/core.test.mjs`、`plugin/test/client.test.mjs` 的默认技能与断言同步；
2. `originalCliHashes`（CLI 与服务端各一份）加入旧模板哈希 `9873ff91…`，使尚未升级的项目被识别为 `legacy` 而非 `custom`；README 升级白名单一并补充；
3. 真实项目 `F:\SPACE\agent-studio\.studio\studio.mjs` 用 `upgrade --confirm-stopped` 同步，`state.json` 里已保存的 `config` 按新默认值更新（保留用户自定义 `concurrency=5`）；
4. 三份 `project-director/SKILL.md` 字节一致（SHA-256 `01abe236…`），补 0.2.0 的 config/execution/技能加载/验收纪律；
5. README 加本文件入口。

## 使用与回滚

- 查看/改配置：工作台「角色与路由」，或 `node .studio/studio.mjs config` / `config FILE.json` / `reset-config`。
- 恢复旧默认：把 `config` 写回旧的 4 槽（coding `['ponytail']`、debug `[]`、visual `['frontend-design']`、reviewer `[]`），或 `reset-config`（会采用当前 `DEFAULT_CONFIG`）。项目内 CLI、三份 SKILL.md、白名单哈希可用 `.studio/studio.mjs.pre-ledger*.bak` 与版本库恢复。
- 边界：技能名只是配置字符串，真正可用性取决于宿主 `skill` 工具与 `host.skills.snapshot`；未加载/不可用时工作台显示状态，主控不得声称技能已生效。
