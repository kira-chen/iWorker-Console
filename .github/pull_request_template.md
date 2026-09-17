<!-- 提交前自检（勾不上的先别开 PR）。规则见 CLAUDE.md「PR 流程与 CI」与 README「PR 变红怎么办」 -->

- [ ] 本地 `npm run test` + `npm run build` 都绿
- [ ] 改了现有行为的，对应旧用例已同步改（没有 `skip` 掉）
- [ ] 改了 `docs/PRD/` 的：本地跑过 `/prd-import`，收口 commit 有 `review: prd-import … ok` 签名
- [ ] 改了 `frontend/src/` 的：本地跑过 `/test-audit changed`，收口 commit 有 `review: test-audit … ok` 签名
- [ ] 需要别人处理的事已写进 `docs/产品经理待办任务/<人>.md`；处理完的待办在 commit 说明里写了 `关闭待办 人#序号`
- [ ] 一件事一条 commit；推前已 `git fetch` 核过与 main 无分叉

<!-- 一句话说明这个 PR 做了什么（可留空，commit 说明已写清） -->
