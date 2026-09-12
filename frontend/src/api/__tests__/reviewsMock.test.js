import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listReviews,
  getReview,
  approveReview,
  rejectReview,
  submitReviewRow,
  cancelReviewRow,
  resetReviewsMock
} from '../reviewsMock'

/**
 * 审核中心 mock 层回归保护（2026-09-12 对齐 md `prd.审核中心.md` §二 / §3.1 / §5.1 / §5.2 / §六）：
 * 种子 = 8 条待审记录 + 1 条知识库待审记录（2026-09-09 PRD 复核·G3G6 · A6）；列表只出待审核（md §六 L88）；
 * 业务类型八项筛选（md §二.2，含知识库；MCP/API 由 TOOL+subType 拆分）；申请类型筛选（md §二.3）；
 * submittedAt 排序默认 desc（md §3.1）；通过（含停用申请 → 已下架，md §5.2 L80）/ 驳回后记录离开待审列表（md §5.1 L71 / §5.2 L82）。
 * 2026-09-12 测试审计 T56：补提交端接线（submitReviewRow 覆盖在审行、新 id 避开种子 / cancelReviewRow 静默，md §六 L92）；F9 补 restore 形状守卫。
 */
describe('reviewsMock · 审核中心内存 mock', () => {
  beforeEach(() => resetReviewsMock())

  it('默认列表：9 条全待审（含知识库 A6 新增行），按 submittedAt desc', async () => {
    const { list, total } = await listReviews()
    expect(total).toBe(9)
    expect(list.every((r) => r.status === 'PENDING_REVIEW')).toBe(true)
    const times = list.map((r) => r.submittedAt)
    expect(times).toEqual([...times].sort().reverse())
    expect(list[0].name).toBe('法规与标准库') // 2026-08-28 11:02 最新（A6 知识库行）
  })

  it('申请类型补丁：id 3/6=停用 v2.0.0，id 1/4/8=首次发布 —，其余=新版本发布 v1.2.0', async () => {
    const { list } = await listReviews()
    const byId = Object.fromEntries(list.map((r) => [r.id, r]))
    expect(byId[3].requestAction).toBe('DELIST')
    expect(byId[3].version).toBe('v2.0.0')
    expect(byId[1].requestAction).toBe('FIRST_PUBLISH')
    expect(byId[1].version).toBe('—')
    expect(byId[2].requestAction).toBe('VERSION_PUBLISH')
    expect(byId[2].version).toBe('v1.2.0')
  })

  it('业务类型筛选：CONNECTOR_MCP / CONNECTOR_API 由 TOOL+subType 拆分', async () => {
    const mcp = await listReviews({ type: 'CONNECTOR_MCP' })
    expect(mcp.list.map((r) => r.id)).toEqual([8])
    const api = await listReviews({ type: 'CONNECTOR_API' })
    expect(api.list.map((r) => r.id)).toEqual([1])
    const skill = await listReviews({ type: 'SKILL' })
    expect(skill.list.map((r) => r.id).sort()).toEqual([2, 7])
    const biz = await listReviews({ type: 'CONNECTOR_BIZ' })
    expect(biz.list.map((r) => r.id)).toEqual([3])
  })

  it('2026-09-08 原型复刻批次 2B（G-4）：POSITION 行 5 refId 接线岗位 mock 403（借财务审核岗示意）', async () => {
    const row = await getReview(5)
    expect(row.type).toBe('POSITION')
    expect(row.refId).toBe(403)
  })

  it('keyword 过滤域 = 名称/描述/提交人（搜提交人 zhangwei 命中技能行）', async () => {
    const { list } = await listReviews({ keyword: 'zhangwei' })
    expect(list.map((r) => r.id)).toEqual([7])
  })

  it('申请类型筛选 + 升序排序', async () => {
    // 取 VERSION_PUBLISH 做多行样本：DELIST 自 2026-09-09 起只剩 id 3 一条（原 id 6 改指
    // 在审的专家 204、方向为 VERSION_PUBLISH），单行验证不出排序。按提交时间升序：
    // 5(08-27 14:05) → 7(08-28 08:55) → 2(08-28 09:18) → 6(08-28 10:18)
    const { list } = await listReviews({ requestAction: 'VERSION_PUBLISH', sortDir: 'asc' })
    expect(list.map((r) => r.id)).toEqual([5, 7, 2, 6])
    // DELIST 仍可筛出且只此一条
    const delist = await listReviews({ requestAction: 'DELIST' })
    expect(delist.list.map((r) => r.id)).toEqual([3])
  })

  it('通过发布申请 → PUBLISHED 并移出待审列表', async () => {
    const row = await approveReview(1)
    expect(row.status).toBe('PUBLISHED')
    const { total } = await listReviews()
    expect(total).toBe(8)
  })

  it('通过停用申请 → DELISTED（md §5.2 L80「停用申请通过后，对象变为未发布 / 已下架」）', async () => {
    const row = await approveReview(3)
    expect(row.status).toBe('DELISTED')
  })

  it('驳回：原因必填，成功后 REJECTED 带 rejectReason', async () => {
    await expect(rejectReview(2, '   ')).rejects.toThrow('请输入驳回原因')
    const row = await rejectReview(2, '描述不完整')
    expect(row.status).toBe('REJECTED')
    expect(row.rejectReason).toBe('描述不完整')
    const { total } = await listReviews()
    expect(total).toBe(8)
  })

  // 2026-09-09 PRD 复核·G3G6 · A6（Q265③「知识库也需要发布审核」；md `prd.审核中心.md` §二.2/§3.1）
  it('A6 知识库：种子含 KNOWLEDGE_BASE 待审行，可按业务类型筛出，refId 指向 kb_3', async () => {
    const { list } = await listReviews({ type: 'KNOWLEDGE_BASE' })
    expect(list.map((r) => r.id)).toEqual([9])
    expect(list[0].refId).toBe('kb_3')
    expect(list[0].requestAction).toBe('FIRST_PUBLISH')
    // 其它类型筛选不被知识库行污染
    const skill = await listReviews({ type: 'SKILL' })
    expect(skill.list.every((r) => r.type === 'SKILL')).toBe(true)
  })

  it('getReview：按 id 取单条；不存在抛 404', async () => {
    const row = await getReview(5)
    // 2026-09-09 PRD 复核·G2 顺修：种子名对齐 refId 所指实体（403 财务审核岗），
    // 原「合同审阅专员」只出自已退役原型 html、与所指岗位不同名（refId 借名缺陷）
    expect(row.name).toBe('财务审核岗')
    expect(row.refId).toBe(403)
    await expect(getReview(999)).rejects.toMatchObject({ code: 404 })
  })

  /* ---------------- 提交端接线（2026-09-12 测试审计 T56 补缺口；reviewsMock.js:114-140） ---------------- */

  it('submitReviewRow：同一对象已在审（同 type+refId）→ 覆盖原行不新建（md §六 L92「同一对象同一时间只允许存在一条待审核申请」）', async () => {
    // 种子 id 8 = TOOL/MCP knowledge_hub 在审
    const written = submitReviewRow({
      type: 'TOOL',
      subType: 'MCP',
      refId: 'knowledge_hub',
      name: '企业知识库 MCP',
      description: '重新提交后的描述',
      requestAction: 'VERSION_PUBLISH',
      version: 'v3.5.0',
      submittedAt: '2026-08-29 09:00'
    })
    expect(written.id).toBe(8) // 沿用原行 id
    const { list, total } = await listReviews()
    expect(total).toBe(9) // 不多出一行
    const row = list.find((r) => r.id === 8)
    expect(row.description).toBe('重新提交后的描述')
    expect(row.version).toBe('v3.5.0')
    expect(row.status).toBe('PENDING_REVIEW')
  })

  it('submitReviewRow：新对象 → 新建行，id 避开种子 1..9（取现有最大 id + 1），带默认提交人与「—」版本', async () => {
    const written = submitReviewRow({
      type: 'EXPERT',
      refId: 205,
      name: '合规审阅专家',
      requestAction: 'FIRST_PUBLISH',
      submittedAt: '2026-08-29 09:00'
    })
    expect(written.id).toBe(10)
    expect(written).toMatchObject({ status: 'PENDING_REVIEW', submitterName: 'config.admin', version: '—' })
    const { list, total } = await listReviews()
    expect(total).toBe(10)
    expect(list[0].name).toBe('合规审阅专家') // 08-29 比种子最新的 08-28 11:02 更晚，倒序排第一
  })

  it('cancelReviewRow：命中在审行即摘掉（撤回后离开待审列表）；无匹配对象静默、列表不变', async () => {
    cancelReviewRow('TOOL', 'api_1103') // 种子 id 1
    expect((await listReviews()).list.some((r) => r.id === 1)).toBe(false)
    expect((await listReviews()).total).toBe(8)
    expect(() => cancelReviewRow('EXPERT', 99999)).not.toThrow()
    expect((await listReviews()).total).toBe(8)
  })
})

/* ---------------- F9：restore 形状守卫（reviewsMock.js:155-157；mockPersist 兜底回种子） ---------------- */
describe('reviewsMock · 持久化 restore 形状守卫', () => {
  // 本仓 node/jsdom 环境均无可用 localStorage（mockPersist 探测后走纯内存模式），
  // 与 positionMock.test / mockPersist.test 同款：注入内存版存储 + vi.resetModules + 动态 import 模拟「刷新后重新加载模块」。
  const KEY = 'iworker-demo-mock:reviews'
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
    globalThis.localStorage = makeStorage()
    vi.resetModules()
  })
  afterEach(() => {
    delete globalThis.localStorage
    vi.resetModules()
  })

  it('存量快照版本对但 reviews 不是数组 → 启动时抛「快照形状不合法」被兜底：回种子 9 条、坏 key 被清掉', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 5, data: { reviews: 'oops' } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('../reviewsMock')
    expect((await fresh.listReviews()).total).toBe(9)
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reviews 存量数据不可用'), expect.any(Error))
    warn.mockRestore()
  })

  it('对照：形状合法的存量快照（v=5）会被读回——列表按快照而非种子', async () => {
    const seedOnly = [{ id: 42, name: '快照里的唯一行', type: 'MODEL', refId: 'md_104', requestAction: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-09-01 10:00', status: 'PENDING_REVIEW' }]
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 5, data: { reviews: seedOnly } }))
    const fresh = await import('../reviewsMock')
    const { list, total } = await fresh.listReviews()
    expect(total).toBe(1)
    expect(list[0].name).toBe('快照里的唯一行')
  })
})
