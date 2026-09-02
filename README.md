# AI-Assistant（前端交互产品 Demo）

面向企业专业岗位的「AI 同事」应用 —— **管理后台前端交互 Demo**。

本仓库已于 2026-09-01 从「发布版本包（管理后台 + 后端服务 + 配置分发契约层）」**降级为纯前端交互的产品 demo**：后端（Spring Boot）、部署编排与数据库产物已整体移除，仅保留 Vue 3 管理后台前端，用于演示 FDE（前线部署工程师）编排岗位 / 技能 / 连接器（MCP·API）/ 知识库 / 记忆等能力的产品交互。

- **frontend/** —— Vue 3 管理后台（数字员工管理、技能编辑器、工具市场、发布审核等）；
- **docs/** —— 仅保留当前工作文档：`prd/PRD-20260828/`（对齐基准）与 `PRD-review/`（改动与对齐记录）；全部历史文档已打包为 `docs/历史文档归档-20260901.zip`（需要时解压查阅）。

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
│   ├── prd/PRD-20260828/     # PRD 对齐基准（模块 md + 根目录交互原型 v2 + 必填选填一览表）
│   ├── PRD-review/           # 改动与 PRD 对齐记录（含待拍板差异清单）
│   └── 历史文档归档-20260901.zip  # 全部历史文档（契约/架构/旧 PRD/设计稿/更新日志等）
├── CLAUDE.md                 # 协同约定（技术栈约束、前端编码规范）
└── .claude/                  # 可选：Claude Code 角色分工参考与项目权限配置
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

## 文档索引

- PRD 对齐基准：`docs/prd/PRD-20260828/`——各模块 prd md + 根目录《数字员工管理端-模型MCP用户-交互原型-v2.html》（两者应一致，截图仅参考）+《各模块必填选填字段一览表.md》
- 改动与 PRD 对齐记录：`docs/PRD-review/`（2026-09-01 起，含待拍板差异清单）
- 历史文档（契约 / 架构 / 旧 PRD / 前端设计稿 / 更新日志等）：`docs/历史文档归档-20260901.zip`，仅作参考、不再约束
