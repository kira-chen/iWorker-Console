# 曹春林（clcao · GitHub godness4ccl-sudo）的待办

> 用法：任何人发现**需要 曹春林 处理**的事项，往「待处理」表追加一行（序号 = 两表现有最大序号 + 1，状态填「未处理」）。
> 处理完后**不要手改这份文件**——在完成那次 commit 的说明里写 `关闭待办 clcao#序号`（或 `closes clcao#序号`），
> post-commit 钩子会自动把该行搬到「已处理」表并并入本次提交；CI 会核验搬没搬。
> 问题详述要写清：现状 / 依据（md 章节或 commit）/ 期望结果，让人不用回头找上下文就能动手。
> 追加前先 `git pull`，避免序号撞车；撞了以先合入 main 的为准，后者改号。

## 待处理

| 序号 | 状态 | 发起人 | 问题详述 |
|---|---|---|---|
| 1 | 未处理 | 陈森亮（2026-09-17） | **配额与限流（04 运行）没有 PRD 定义，请补写 md 或明确不做。** 现状：路由里是「规划中」占位页，`docs/PRD/数字员工管理端PRD/04运行/配额与限流/` 是空目录。依据：CLAUDE.md「md 为唯一口径」；04 运行模块归你（09-17 负责人分工）。期望：近期要做就补一份 `prd.配额与限流.md`（页面结构、字段、交互、状态）并按 md 落地页面；近期不做请回复「不做」，我们把占位路由和菜单项一起摘掉。来源：`docs/04-待补需求定义/补定义需求清单-20260907.md` 第 3 项。 |
| 2 | 未处理 | 陈森亮（2026-09-18） | **R3 · 实例管理状态机缺两条边 + 操作记录不展示（04 运行）。** 现状：对任一可操作实例点重启 / 重建 / 回收后，`instanceMock.js:71-76` 只置 `STARTING/RECYCLING + operable=false`，`listInstances`（`:33-50`）从不推进状态，`AdminInstances.vue:82-85`【刷新状态】只是重拉同一数据 → 实例永远「启动中 / 回收中」、再也不可操作，回收的实例永不从列表移除，且状态被 persist，只有 `?resetMock=1` 能解；`instanceMock.js:76` 写入的 `records` 从未展示，`AdminInstances.vue:158` 操作记录区渲染的是两条固定文案；`AdminInstances.vue:63` 「规格待生效」指标卡点第二次不取消筛选（`query.pending` 恒 true），页面也没有【清空筛选】。依据：`prd.实例管理.md` §九.2「提交后进入启动中」之后应回运行中 / 空闲、§九.4「回收成功后从列表移除」、§三.2「只展示仍存在的实例」、§八.5 操作记录须含类型 / 操作者 / 时间 / 结果、§五.2「再次点击当前筛选取消该条件」、§十【清空筛选】。期望：mock 补 STARTING→RUNNING/IDLE（延时或下次 list 时推进）与 RECYCLING→移除两条边；详情读 `records`；指标卡 toggle + 清空筛选。 |
| 3 | 未处理 | 陈森亮（2026-09-18） | **R5 · 运行规格与用户 / 岗位的引用关系是幽灵（04 运行）。** ①`runtimeSpecMock.js:23` `directUsers` 以 username 存关系，`adminUserMock.js:200-211` 删用户不级联：删 zhaomin 后规格「重」生效用户列表已不含他、usedCount=0，但 `deleteRuntimeSpec`（`:253`）仍被「存在 1 个个人配置」拦住，配置范围窗里看不到、无法解除——死锁；②`runtimeSpecMock.js:97` `resolveUser` 用 `positionIds` 继承但不看岗位是否存在 / 已发布，`:108-109` 只查已发布岗位名，`:252` 删除按 `positionIds.length` 拦而页面 `AdminRuntimeSpecs.vue:120` 按 `positionCount` 拦：删岗 401 后规格「重」列「未指定」、positionCount=0、页面放行删除弹二次确认 → mock 却报「已配置给 1 个岗位」；已删岗位继续被 zhangwei 按「岗位 · 重」继承；③`:122-126` `occupyPositions` 把岗位从原规格摘掉不更新其 `updatedAt`（md §三.2）；④`:78-79,106` 生效用户计入停用用户（md §三.1「仅当前实际使用」，**疑似口径问题请裁**）；⑤`AdminRuntimeSpecs.vue:30` 传 `pageSize: 10` 误用 `useAdminList` 的 fixedPageSize，切每页条数不重拉；⑥`RuntimeSpecUserDialog.vue:41-48` 配置范围搜索不匹配岗位名（md §三.3.4）；⑦实例名册 / 生效规格与运行规格模块零联查（`instanceMock.js:12-18`，md 实例 §三.2「用户当前生效规格」定义权在运行规格模块；若有意静态化请在 md 或代码头注明）。期望：关系按 userId 存并在用户删除时级联；positionIds 过滤已删岗位、页面与 mock 判定同源；occupy 更新 updatedAt；pageSize 走动态；搜索补 positionName；④⑦请裁。 |

## 已处理

| 序号 | 状态 | 发起人 | 问题详述 |
|---|---|---|---|
