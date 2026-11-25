# DSH Agent Studio 0.2.0 验证

日期：2026-11-09；宿主：Windows / Node.js v24.19.0；DSH GUI：http://127.0.0.1:61889。

## 结论（本轮真实验收）

零新增依赖、零额外端口。以下均为本轮实际执行所得，非文字推断。

| 项目 | 结果 |
| --- | --- |
| `node --test tests/studio.test.mjs` | 23/23 通过 |
| `node --test plugin/test/core.test.mjs` | 21/21 通过 |
| `node --test plugin/test/client.test.mjs` | 23/23 通过 |
| `npm test`（三文件合计） | 67/67 通过，退出码 0 |
| `npm run check`（index/core/client 语法检查） | 退出码 0 |
| 三份 `SKILL.md` 一致性 | `skills/`、`.agents/`、`.claude/` 三处 SHA-256 一致：`BBDFBB68FB8E74F36DB604DBA0D054A3756B0CA832C95FDACAC50F5FE862AB6E` |
| `.studio/studio.mjs` 与 `bin/studio.mjs` | SHA-256 一致：`F8AD29277BEC0A5F2CA03101C8E38872A84447FE68CFB805DC0E5999928B3D4A`（自身 CLI 已由主控升级） |
| 账本完整性 | `.studio/state.json` 8 个任务全部 `done`；`inbox` 5 条、顶层 `feedback` 数组 0 条；未改写 |

## 独立验收

- **CLI 协议**（`cli-config-protocol`）：独立 reviewer `reviewer-cli` pass——临时副本实测 config 默认/非法值拒绝/字段保留、dispatch 五项元数据与 BRIEF 锚点+15 行模板、0.1.0 与 0.1.1 双版本升级保留账本、定制 CLI 拒绝；withLock 多进程并发测试仍通过。
- **服务端配置 API**（`server-config-api`）：独立 reviewer `reviewer-server` pass——snapshot 空/已初始化均含 config+skills，action config 落盘/回读一致、reset 保留 tasks/inbox/handoff，11 类非法值 400 且字节级不改写，8 CLI+8 API 并发共享锁无损坏。
- **前端**（`client-routing-panel`）：经 `reviewer-client` 首轮 P1（配置草稿在项目切换时被静默丢弃）与 `reviewer-client-recheck` 二轮复审（追加发现 browse 同路径选择绕过守卫）两轮后，三处 P1 全部闭环；评审阶段独立复现脚本两轮均以真实断言验证，最终 25/25 通过（`.scratch/reviewer-client-recheck/review.test.mjs` 等评审临时产物已按「审查证据」保留、未删除）。

## 待补录 / 由主控执行

- **真实 DSH GUI 工作台实测尚未执行**，由主控后续单独任务进行：四个标签页可见、角色与路由页默认配置与保存/恢复默认、任务卡 mode/worker/modelRoute/risk 标签、后台刷新不覆盖配置输入。本文件不虚构 GUI 结果，待主控实测后追加。

## 边界

- 未对用户正式项目自动初始化、派工或发送消息。
- 渲染 HTML 的样式与交互细节、以及操作系统原生目录选择弹窗，仍需在真实 GUI 中覆盖。
- 简报具有 revision 冲突检查；插件内写入按真实项目路径串行。独立 CLI/外部编辑器不受同进程锁覆盖，应避免同时修改同一账本。
- 账本锁与原子写入仅保证同机本地、所有写入方使用同版本代码；不支持共享网络盘或跨机器同步盘写入。
