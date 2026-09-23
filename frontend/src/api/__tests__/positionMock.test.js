// @vitest-environment jsdom
// （positionMock → request.js → router 链路触达 window，故用 jsdom；同 fieldDictMock.test）
// 2026-09-12 测试审计 T53：补 persist v4 读回（真 localStorage + vi.resetModules 重新 import）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import { setUserPosition, __resetPositionAssignmentMock } from '../positionAssignmentMock'
// positionAssignmentMock 分配表 2026-09-23 待办 yuepu#11③ 起同源自 adminUserMock 真实用户列表，
// 须一并重置，否则领用数/绑定校验可能读到其它用例改剩的用户状态
import { __resetOrgMock } from '../adminUserMock'
// 静态顶层导入（不用 await import()）：本文件末尾的「持久化读回」块会 vi.resetModules()，
// 动态 import 在那之后拿到的会是另一个模块实例，跟 positionMock 内部静态 import 的
// sampleTaskMock/dataTableMock/runtimeSpecMock 对不上，删岗级联的效果就验证不到
// （2026-09-23 待办 yuepu#9⑥，回归排查记录）。
import { listSampleTasks, __resetSampleTaskMock } from '../sampleTaskMock'
import { listDataTables, __resetDataTableMock } from '../dataTableMock'
import { getRuntimeSpec, __resetRuntimeSpecMock } from '../runtimeSpecMock'

// vitest 用例随机顺序执行：每例前重置种子，杜绝状态顺序依赖
beforeEach(() => {
  __resetOrgMock()
  __resetPositionMock()
  __resetPositionAssignmentMock()
})

describe('positionMock —— 岗位列表页 mock（2026-09-01 PRD 对齐轮）', () => {
  it('种子 4 条照原型：默认按最近更新时间降序，含计数/最新版本字段；市场研究岗无版本', async () => {
    const { list, total } = await listPositions()
    expect(total).toBe(4)
    expect(list.map((p) => p.name)).toEqual(['经营分析岗', '财务审核岗', '客户成功岗', '市场研究岗'])
    const [biz] = list
    // claimedUserCount 2026-09-23 待办 yuepu#9①起实时派生自 positionAssignmentMock 的分配表
    // （不再是静态种子）：401 种子绑了 2 人（zhangwei 启用 + zhouming 停用，领用关系不看账号启停）
    expect(biz).toMatchObject({ skillCount: 1, agentCount: 3, claimedUserCount: 2, latestVersion: 'v2.1.0', status: 'published' })
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
    // md §二.1「最新版本」只记审核通过并正式发布的版本，不展示待审核版本号：
    // MINOR 进位后的 v1.5.0 只进 pendingVersion，latestVersion 仍是已发布的 v1.4.0
    expect(row.pendingVersion).toBe('v1.5.0')
    expect(row.latestVersion).toBe('v1.4.0')
    await withdrawPosition(402)
    row = (await listPositions({ keyword: '客户成功岗' })).list[0]
    expect(row.pendingAction).toBeNull()
    expect(row.latestVersion).toBe('v1.4.0') // 撤回后回落已通过的最新快照
    // 402 种子被 li.na（userId 202）领用，停用前先解绑——本用例测的是发布状态机，不是领用拦截
    // （领用拦截见下方专用用例，2026-09-23 待办 yuepu#9①）
    await setUserPosition(202, null)
    // 停用 → 提交停用审核（展示层审核中）
    await unpublishPosition(402)
    row = (await listPositions({ keyword: '客户成功岗' })).list[0]
    expect(row.pendingAction).toBe('DELIST')
    // mock 层不做完整性门（原「§6.5 不参与发布阻断」口径已被 09-09 Q11 推翻）：发布门在页面层
    // computeCompletenessMissing（positionModel.js）；404 种子自 2026-09-09 起六项齐备，故 mock 直接放行提交发布
    await publishPosition(404, { releaseNotes: 'x' })
    row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.pendingAction).toBe('PUBLISH')
    expect(row.pendingVersion).toBe('v1.0.0') // 首发固定 v1.0.0，且只进 pendingVersion
    expect(row.latestVersion).toBe('') // 尚无审核通过的发布 → 列表显示「—」
  })

  it('删除与联动取名（Q10：岗位名单一真相源）', async () => {
    expect(getPositionNameById(401)).toBe('经营分析岗')
    await deletePosition(404)
    const { total } = await listPositions()
    expect(total).toBe(3)
    expect(getPositionNameById(404)).toBe('')
  })

  it('领用数实时派生（md §3.5 L90 / §3.6 L98，2026-09-23 待办 yuepu#9①）：解绑后停用/删除放行，绑定时仍拦', async () => {
    // 402 种子被 li.na（userId 202）领用：停用 / 删除均应被拦
    await expect(unpublishPosition(402)).rejects.toThrow('已被 1 个用户领用')
    await expect(deletePosition(402)).rejects.toThrow('已被 1 个用户领用')
    let row = (await listPositions({ keyword: '客户成功岗' })).list[0]
    expect(row.claimedUserCount).toBe(1)
    // 解绑后领用数回落到 0，两个操作都放行
    await setUserPosition(202, null)
    row = (await listPositions({ keyword: '客户成功岗' })).list[0]
    expect(row.claimedUserCount).toBe(0)
    await expect(unpublishPosition(402)).resolves.toEqual({})
  })

  it('删岗级联清理自动化任务 / 工作档案 / 运行规格引用（2026-09-23 待办 yuepu#9⑥）', async () => {
    __resetSampleTaskMock()
    __resetDataTableMock()
    __resetRuntimeSpecMock()

    // 402 种子自带自动化任务 + 工作档案；运行规格种子 id=1 的 positionIds 含 402
    expect((await listSampleTasks(402)).total).toBeGreaterThan(0)
    expect((await listDataTables(402)).total).toBeGreaterThan(0)
    expect((await getRuntimeSpec(1)).positionIds).toContain(402)

    await setUserPosition(202, null) // 402 种子被 li.na 领用，先解绑才能删
    await deletePosition(402)

    expect((await listSampleTasks(402)).total).toBe(0)
    expect((await listDataTables(402)).total).toBe(0)
    expect((await getRuntimeSpec(1)).positionIds).not.toContain(402)
  })
})

describe('positionMock · 持久化读回（mockPersist v4，写点 → 刷新后仍在）', () => {
  // 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（Node 22+ 自带的实验性 localStorage 占位，
  // mockPersist 探测后走纯内存模式），故与 mockPersist.test 同款：注入内存版存储，
  // 用 vi.resetModules + 动态 import 模拟「写入 → 刷新页面 → 重新加载模块」。
  const KEY = 'iworker-demo-mock:position'
  const makeStorage = () => {
    const map = new Map()
    return {
      get length() { return map.size },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear()
    }
  }
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })

  it('deletePosition 落盘（v=5）→ 重新 import 模块（模拟刷新）→ 列表只剩 3 条、被删岗位不再出现', async () => {
    const first = await import('../positionMock')
    await first.deletePosition(404)
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    expect(snap.v).toBe(6) // v6：claimedUserCount 改派生 + 404 改引 sk_305（2026-09-23 待办 yuepu#9①⑤）
    expect(snap.data.positions.map((p) => p.positionId)).toEqual([401, 402, 403])
    vi.resetModules()
    const fresh = await import('../positionMock')
    const { list, total } = await fresh.listPositions()
    expect(total).toBe(3)
    expect(list.map((p) => p.name)).not.toContain('市场研究岗')
  })
})
