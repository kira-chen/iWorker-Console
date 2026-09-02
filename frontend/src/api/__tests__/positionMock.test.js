// @vitest-environment jsdom
// （positionMock → request.js → router 链路触达 window，故用 jsdom；同 fieldDictMock.test）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listPositions,
  publishPosition,
  withdrawPosition,
  unpublishPosition,
  deletePosition,
  getNextVersionLabel,
  listPositionPublications,
  delistPositionPublication,
  relistPositionPublication,
  getPositionNameById,
  __resetPositionMock
} from '../positionMock'

// vitest 用例随机顺序执行：每例前重置种子，杜绝状态顺序依赖
beforeEach(() => __resetPositionMock())

describe('positionMock —— 岗位列表页 mock（2026-09-01 PRD 对齐轮）', () => {
  it('种子 4 条照原型：默认按最近更新时间降序，含计数/最新版本字段；市场研究岗无版本', async () => {
    const { list, total } = await listPositions()
    expect(total).toBe(4)
    expect(list.map((p) => p.name)).toEqual(['经营分析岗', '财务审核岗', '客户成功岗', '市场研究岗'])
    const [biz] = list
    expect(biz).toMatchObject({ skillCount: 1, agentCount: 3, claimedUserCount: 26, latestVersion: 'v2.1.0', status: 'published' })
    expect(list[3].latestVersion).toBe('')
    // 升序排序参数
    const asc = await listPositions({ sort: 'asc' })
    expect(asc.list[0].name).toBe('市场研究岗')
  })

  it('keyword 覆盖岗位描述；status 三态筛选按展示口径（未发布/审核中/已发布）', async () => {
    const byDesc = await listPositions({ keyword: '报销材料' })
    expect(byDesc.list.map((p) => p.name)).toEqual(['财务审核岗'])
    const reviewing = await listPositions({ status: 'reviewing' })
    expect(reviewing.list.map((p) => p.name)).toEqual(['财务审核岗']) // draft + pendingAction=PUBLISH → 审核中
    const published = await listPositions({ status: 'published' })
    expect(published.list.map((p) => p.name)).toEqual(['经营分析岗', '客户成功岗'])
    const draft = await listPositions({ status: 'draft' })
    expect(draft.list.map((p) => p.name)).toEqual(['市场研究岗'])
  })

  it('版本历史：含大小/发布人/发布时间/禁用时间/升级说明；最后一个启用版本禁用被拦', async () => {
    const rows = await listPositionPublications(401)
    expect(rows.map((r) => r.versionLabel)).toEqual(['v2.1.0', 'v2.0.0'])
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', sizeBytes: 7782, publishedBy: '管理员', releaseNotes: '当前线上版本' })
    expect(rows[1].delistedAt).toBeTruthy()
    // v2.1.0 是唯一 ACTIVE → 禁用被拦（原型护栏文案）
    await expect(delistPositionPublication(401, 2)).rejects.toThrow('最后一个启用版本')
  })

  it('启用互斥：启用历史版本后其余 ACTIVE 自动转禁用，最新版本列跟随', async () => {
    await relistPositionPublication(401, 1) // 启用 v2.0.0
    const rows = await listPositionPublications(401)
    expect(rows.find((r) => r.version === 1).status).toBe('ACTIVE')
    expect(rows.find((r) => r.version === 2).status).toBe('DELISTED') // 原 ACTIVE 被互斥禁用
    expect(rows.find((r) => r.version === 2).delistedAt).toBeTruthy()
    // 此时 v2.0.0 成为唯一 ACTIVE，可再把 v2.1.0 启用回来（互斥反向）
    await relistPositionPublication(401, 2)
    const back = await listPositionPublications(401)
    expect(back.find((r) => r.version === 2).status).toBe('ACTIVE')
    expect(back.find((r) => r.version === 1).status).toBe('DELISTED')
  })

  it('发布/撤回/停用流转：提交发布进审核、撤回回修改前状态、停用提交停用审核', async () => {
    // 建议版本号 = 最新历史 patch+1
    expect(await getNextVersionLabel(402)).toBe('v1.4.1')
    await publishPosition(402, { bump: 'MINOR', releaseNotes: '新增能力' })
    let row = (await listPositions({ keyword: '客户成功岗' })).list[0]
    expect(row.pendingAction).toBe('PUBLISH')
    expect(row.latestVersion).toBe('v1.5.0') // MINOR 进位
    await withdrawPosition(402)
    row = (await listPositions({ keyword: '客户成功岗' })).list[0]
    expect(row.pendingAction).toBeNull()
    expect(row.latestVersion).toBe('v1.4.0') // 撤回后回落已通过的最新快照
    // 停用 → 提交停用审核（展示层审核中）
    await unpublishPosition(402)
    row = (await listPositions({ keyword: '客户成功岗' })).list[0]
    expect(row.pendingAction).toBe('DELIST')
    // 无岗位私有技能不可发布（Q3 前置校验的 mock 兜底）
    await expect(publishPosition(404, { releaseNotes: 'x' })).rejects.toThrow('至少关联 1 个岗位私有技能')
  })

  it('删除与联动取名（Q10：岗位名单一真相源）', async () => {
    expect(getPositionNameById(401)).toBe('经营分析岗')
    await deletePosition(404)
    const { total } = await listPositions()
    expect(total).toBe(3)
    expect(getPositionNameById(404)).toBe('')
  })
})
