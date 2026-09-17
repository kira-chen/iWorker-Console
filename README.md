# AI-Assistant（前端交互产品 Demo）

面向企业专业岗位的「AI 同事」应用 —— **管理后台前端交互 Demo**。

本仓库已于 2026-09-01 从「发布版本包（管理后台 + 后端服务 + 配置分发契约层）」**降级为纯前端交互的产品 demo**：后端（Spring Boot）、部署编排与数据库产物已整体移除，仅保留 Vue 3 管理后台前端，用于演示 FDE（前线部署工程师）编排岗位 / 技能 / 连接器（MCP·API）/ 知识库 / 记忆等能力的产品交互。

- **frontend/** —— Vue 3 管理后台（数字员工管理、技能编辑器、工具市场、发布审核等）；
- **docs/** —— 仅保留当前工作文档：`PRD/`（对齐基准长期正本，md 为唯一口径，git 直改）、`产品经理待办任务/`（跨人待办，按人一份）及各审查/决策目录（`PRD-review/` 日记录台账 2026-09-17 停用）；已归档的历史文档不随仓库分发（2026-09-10 起统一存负责人本机 `Archive/`，仓库侧可经 git 历史找回）。

> 注：demo 不含后端。管理后台各页面数据已由前端 mock 数据层（`frontend/src/api/xxxMock.js`）接管，交互闭环可用；并自 2026-09-02 起经 `mockPersist.js` 把 mock 数据镜像到浏览器 localStorage——**新建/编辑等操作在刷新、重开浏览器后仍然保留**（数据只存在本机浏览器内，按域名+端口隔离，不上传任何地方）。想回到初始演示数据：用 `http://localhost:5173/?resetMock=1` 打开一次，或在浏览器里清除该站点数据。

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | Vue 3（Composition API）+ Vite + Pinia + Element Plus + Axios |

## 目录结构

```
├── frontend/                 # Vue 3 管理后台（demo 主体）
│   └── src/  (views / components / stores / api / router / utils)
├── docs/
│   ├── README.md             # docs/ 目录规则与文档生命周期（一页纸）
│   ├── PRD/数字员工管理端PRD/ # PRD 对齐基准长期正本（各模块 md 为唯一口径 + 必填选填一览表；原型已退场）
│   ├── 产品经理待办任务/      # 跨人待办：slchen / clcao / dysun / yuepu 各一份，「待处理 / 已处理」两表
│   ├── 规范/                 # 长期参考：UI/ 设计图（仅视觉参考）、接口/ 接口规范
│   └── 调研讨论/             # 讨论稿（负责人指令才开，必须有结论段），闭环后进 已闭环/
├── scripts/todo.mjs          # 待办自动流转（commit 说明「关闭待办 人#序号」→ 搬行），.githooks/post-commit 调用
├── CLAUDE.md                 # 协同约定（技术栈约束、前端编码规范）
└── .claude/                  # Claude Code 技能（prd-import / test-audit 及各自视角清单）与项目权限配置
```

## 本地启动

前置依赖：Node.js LTS + npm。

```bash
git clone https://github.com/kira-chen/iWorker-Console.git
cd iWorker-Console/frontend
npm install
npm run dev          # http://localhost:5173
```

> **必须以开发模式（`npm run dev`）运行。** mock 数据层只在 DEV 模式启用；直接打开或静态托管 `frontend/dist/` 时 mock 关闭、所有 `/api` 请求会 404。

## 测试与构建

```bash
cd frontend
npm run test         # 单测（vitest）
npm run build        # 生产构建
```

## 提交代码

main 受分支保护，**不走直推、改动经 PR 合入**（2026-09-15 启用）：

```bash
git switch -c fix/xxx          # 开临时分支（类型/简述）
# 改代码；本地 npm run test 与 npm run build 须绿
git push -u origin fix/xxx
```

（`npm install` 会自动启用 `.githooks/`：commit 说明里写 `关闭待办 yuepu#2` 会自动把对应待办搬到「已处理」并并入该 commit。）

然后在 GitHub 上开 PR，点 **Enable auto-merge**——CI（单测 + 构建）绿则自动合并进 main、
临时分支自动删除；红则停住等修。CI 按 push 次数触发，故仍按「一个验证过的闭环批次一次推」攒着推。
完整约定见 `CLAUDE.md`「PR 流程与 CI」。

### PR 变红怎么办（2026-09-17 补，针对新需求 PR 大量报错）

先弄清 CI 卡的是什么：**它只检查「现有测试不能跑红 + 能构建出来」**，不检查「新功能有没有补测试」、没有覆盖率门槛。所以新增页面/字段/mock 数据通常直接绿；变红基本只有两种原因——

1. **改了现有行为**（改字段名、改校验规则、改 mock 种子或流程）→ 覆盖到这处的旧用例会红。这正是 CI 要拦的：红哪条改哪条，要么用例过期就更新它，要么代码改错就修代码。**不要为了变绿把用例 `skip` / 注释掉**，那等于拆掉报警器。
2. **代码本身有问题**（漏 import 白屏、语法错、只在新版 Node 上恰好能跑）→ 构建红或测试红，修代码。

对合作者的三条要求：

- **硬：推 PR 前本地跑 `npm run test` + `npm run build`，两个都绿再推**。本地红就不要推，推上去只是把同一个红搬到 GitHub 上多等 5 分钟。
- **硬：改了现有行为就同步改对应用例**。判据很简单——你把它跑红了就归你改，不用研究整个测试体系。
- **软：新功能顺手补用例**。鼓励但不作为合并门槛；缺口由 `/test-audit` 轮次统一补（报告落本地 `.review/`，不入库）。

两个常见坑：

- **CI 跑的是 Node 22，本机可能更高**（刻意如此，见 `.github/workflows/ci.yml` 注释）。本地绿、CI 红时先点进 CI 日志看具体哪条，贴出来问，不要盲改。
- **新增 mock 模块的持久化用例要显式清 localStorage key**（`beforeEach` 里清，PR #4 修的就是这个）；不清的话 mock 存量会在用例之间串，本地偶尔过、CI 稳定红。

## 文档索引

- PRD 对齐基准：`docs/PRD/数字员工管理端PRD/`（长期正本，git 直改、修订历史看 git log）——各模块 prd md（**唯一口径**；交互原型已退场，旧原型与截图仅历史参考）+《各模块必填选填字段一览表.md》
- 跨人待办：`docs/产品经理待办任务/<人>.md`（发现需他人处理的事就追加一行，对方处理完改状态）；改动记录看 git log（`docs/PRD-review/` 已停用，历史在负责人本机 Archive/）
- 历史文档（契约 / 架构 / 旧 PRD / 前端设计稿 / 更新日志等）：不随仓库分发，存负责人本机 `Archive/`，仓库侧经 git 历史找回
- docs/ 目录说明与文档生命周期规则：`docs/README.md`（一页纸；来龙去脉见 `docs/调研讨论/2026-09-17-docs文档产出与生命周期管理方案.md`）

## 基线表

流程起点只记在这里，不写在产出文件里（产出文件闭环后会归档到负责人本机，仓库里就没了）。每轮闭环时改对应一行。

| 流程 | 上轮终点 commit | 推进日期 | 说明 |
|---|---|---|---|
| `/prd-import` | `a694724` | 2026-09-17 | 首填：0916 实例管理批 + 浦月 09-14~17 六批（PR #2~#8、#10）合并后的 main |
| `/test-audit` | `36ff5a3` | 2026-09-12 | 09-12 首轮全量审计终点；下一次 `changed` 从这里起算 |
