# 开发环境与 CI 说明

> 给团队里不熟悉前端工程链的人看的一页纸：CI 是什么、本机和 CI 有什么不一样、
> 撞上「CI 绿、本机红」先查什么。2026-09-23 增设（起因见文末案例）。

## CI 是什么

CI = Continuous Integration，持续集成。说人话：**GitHub 上的一台机器人，每次有人推代码上去，
它自动把测试和构建跑一遍，绿了才让合并进 main**。

- 定义文件：`.github/workflows/ci.yml`，任务名「单测 + 构建」
- 它做三件事：装依赖 → `npm test`（单元测试）→ `npm run build`（构建）
- 开 PR 后点了 **Enable auto-merge**，CI 绿就自动合并、临时分支自动删除；CI 红就停住等人修

它的意义是兜底：人可能忘了跑测试，或者只跑了改动的那部分，机器人不会忘，每次全量跑。
所以 CLAUDE.md 里写「本地 commit 前全量测试 + 构建须绿的规矩不变，PR 只是多一道兜底」——
本地是第一道，CI 是第二道，不能拿 CI 当第一道用。

**省额度提醒**：CI 按**推送次数**触发，不是按 commit 条数。本地攒 5 条 commit 一次推 = 跑 1 轮，
逐条推 = 跑 5 轮。所以「一个闭环批次攒够再推」这条要守。

## 本机和 CI 的环境差异

Node.js 是跑 JavaScript 的运行环境，前端这套工具（Vite / Vitest / npm）全靠它。它有版本号，
就像 Windows 有 10、11。

| | 用的 Node 版本 | 在哪定的 |
|---|---|---|
| CI（GitHub 机器人） | **22** | `.github/workflows/ci.yml` 的 `node-version: '22'` |
| 负责人本机 Mac | **26** | 系统装的最新版 |

两边版本不同是**刻意的**，不是失误——CI 固定版本才能保证结果可复现。但代价是：
同一份代码跑在两个不同版本的「地基」上，偶尔会出现**一边绿一边红**。

查自己本机版本：`node -v`

## 撞上「CI 绿、本机红」怎么办

先别急着改代码。按顺序确认：

1. **先确认 CI 真的是绿的**：`gh run list --branch main --limit 3`，看同一个 commit 的结论
2. **绿 = 代码逻辑没问题**，红的原因八成在环境差异，不在业务代码
3. **看报错像不像「某个浏览器能力没有」**：`localStorage`、`window`、`document`、`fetch` 这类
   东西报 undefined，基本都是环境问题
4. 确认清楚再动手，**不要用删用例或加 skip 糊过去**——那是把问题藏起来，下一个人还会撞

反过来「本机绿、CI 红」也一样：优先怀疑本机有而 CI 没有的东西（本地缓存、没提交的文件、
`node_modules` 里的残留）。

## 案例：Node 26 的 localStorage（2026-09-23）

**现象**：本机 `npm test` 11 条失败，集中在 `demoIdentity.test.js` 和 `versionMock.test.js`，
都报 `localStorage.clear()` 读 undefined；同一个 commit 在 CI 上是绿的。

**原因**：

- Node 26 自己内置了一个 `localStorage`，但**默认关着**，要加 `--localstorage-file` 参数才开
  （跑测试时 Node 会打 `ExperimentalWarning: localStorage is not available…`）
- 测试用的 jsdom（模拟浏览器的工具）新版本会想「既然 Node 自己有了，我就不重复造」，直接用 Node 的
- 结果拿到一个关着的 → 报错
- Node 22 没有内置 localStorage，jsdom 只好自己造一个，反而正常 → CI 绿

一句话：**不是代码写错了，是新版 Node 的一个新特性把测试绊了一下。**

**本仓的既有对策**：用到 localStorage 的单测**自己装桩**，不依赖环境提供。
参考 `frontend/src/api/__tests__/positionAssignmentMock.test.js:61-80`：

```js
// 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
// 用例要验证落盘就自己装一个 storage 桩
Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
```

其余落盘类 mock 用例都照这个模式走。新写用例如果要用 localStorage，照抄这段即可
（现在装桩代码在多份用例里重复，抽成公共 test helper 更好，已记浦月待办 #15）。

## 要不要统一两边的 Node 版本

可以，办法是在仓库加 `.nvmrc`（写一行 `22`）或在 `package.json` 写 `engines`，
让新同事一眼知道该用哪个版本、本机也能切过去跟 CI 保持一致。

代价是本机要装 nvm（Node 版本管理工具）——按 CLAUDE.md「不擅自新增技术栈」，
这事**须负责人点头**。当前未做，撞上差异时按上面的排查步骤处理即可。
