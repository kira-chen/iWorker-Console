import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listMyApplications,
  getMyApplication,
  withdrawMyApplication,
  resubmitMyApplication,
  submitApplicationRow,
  withdrawApplicationRow,
  resetMyApplicationsMock
} from '../myApplicationsMock'

/**
 * 我的申请 mock 层回归保护（2026-09-12 对齐 md `prd.我的申请.md` §二 / §3.1 / §4.3 / §五 / §六 / §七）：
 * 种子 = 10 条申请（7 类业务 × 4 种结果；2026-09-08 决议第 8 项：业务类型不含 OTHER）
 *        + 1 条知识库申请（2026-09-09 PRD 复核·G3G6 · A6）；
 * 撤回 → WITHDRAWN（md §五 L80）；重新提交 → PENDING + 刷新申请时间 + 清空审核人/审核时间/驳回原因（md §4.3 L66）。
 * 2026-09-12 测试审计 T56：补状态流转的拒绝边（撤回非待审 / 重提非驳回撤回 → 409）与提交端接线
 * （submitApplicationRow / withdrawApplicationRow）；F9 补 restore 形状守卫。
 */
describe('myApplicationsMock · 我的申请内存 mock', () => {
  beforeEach(() => resetMyApplicationsMock())

  it('默认列表：11 条（含知识库 A6 新增行），按 submittedAt desc', async () => {
    const { list, total } = await listMyApplications()
    expect(total).toBe(11)
    expect(list[0].id).toBe(511) // 2026-08-28 11:02 最新（A6 知识库行）
    const times = list.map((r) => r.submittedAt)
    expect(times).toEqual([...times].sort().reverse())
  })

  it('筛选：businessType / applicationType / result 组合', async () => {
    const expert = await listMyApplications({ businessType: 'EXPERT' })
    expect(expert.list.map((r) => r.id)).toEqual([502, 510])
    const delist = await listMyApplications({ applicationType: 'DELIST' })
    expect(delist.list.map((r) => r.id)).toEqual([505, 510])
    const rejected = await listMyApplications({ result: 'REJECTED' })
    expect(rejected.list.map((r) => r.id)).toEqual([503, 507])
  })

  // 2026-09-09 PRD 复核·G2：md `prd.我的申请.md` §四 L47「对应业务对象已被删除时…【查看】按钮置灰，
  // 列表行保留该条申请记录及其对象名称、业务类型、申请类型、申请版本、申请时间与审核结果」
  it('objectDeleted：默认 false；样例行 510 为 true，且行本身与六个信息字段照常保留', async () => {
    const { list, total } = await listMyApplications()
    expect(total).toBe(11) // 行未被剔除
    const deleted = list.find((r) => r.id === 510)
    expect(deleted.objectDeleted).toBe(true)
    // 六个信息字段仍在（md L47 明列）
    expect(deleted.objectName).toBe('法务审阅专家')
    expect(deleted.businessType).toBe('EXPERT')
    expect(deleted.applicationType).toBe('DELIST')
    expect(deleted.version).toBe('v1.3.0')
    expect(deleted.submittedAt).toBe('2026-08-24 10:18')
    expect(deleted.result).toBe('WITHDRAWN')
    // 其余行默认对象仍在
    expect(list.filter((r) => r.id !== 510).every((r) => r.objectDeleted === false)).toBe(true)
  })

  it('keyword 过滤域 = 申请对象名称/描述', async () => {
    const { list } = await listMyApplications({ keyword: '报销单' })
    expect(list.map((r) => r.id)).toEqual([509])
  })

  it('业务类型不含「其他」（2026-09-08 决议第 8 项）：种子 508 改为 SKILL 样例并接线 sk_304', async () => {
    const { list } = await listMyApplications({})
    expect(list.some((r) => r.businessType === 'OTHER')).toBe(false)
    const row = await getMyApplication(508)
    expect(row.businessType).toBe('SKILL')
    expect(row.refId).toBe('sk_304')
  })

  // 2026-09-09 PRD 复核·G3G6 · A6（Q265③；md `prd.我的申请.md` §二.2/§3.1 业务类型含知识库）
  it('A6 知识库：种子含 KNOWLEDGE_BASE 申请行 511，可按业务类型筛出，refId 指向 kb_3', async () => {
    const { list } = await listMyApplications({ businessType: 'KNOWLEDGE_BASE' })
    expect(list.map((r) => r.id)).toEqual([511])
    expect(list[0].refId).toBe('kb_3')
    expect(list[0].result).toBe('PENDING')
  })

  it('2026-09-08 原型复刻批次 2B（G-4）：POSITION 行 503 refId 接线岗位 mock 401 经营分析岗', async () => {
    const row = await getMyApplication(503)
    expect(row.businessType).toBe('POSITION')
    expect(row.refId).toBe(401)
  })

  it('撤回：result → WITHDRAWN，审核人置「—」', async () => {
    const row = await withdrawMyApplication(501)
    expect(row.result).toBe('WITHDRAWN')
    expect(row.reviewer).toBe('—')
  })

  it('重新提交：result → PENDING，刷新申请时间，清空审核人/审核时间/驳回原因', async () => {
    const before = await getMyApplication(503)
    expect(before.result).toBe('REJECTED')
    const row = await resubmitMyApplication(503)
    expect(row.result).toBe('PENDING')
    expect(row.submittedAt).not.toBe(before.submittedAt)
    expect(row.reviewer).toBe('')
    expect(row.reviewedAt).toBe('')
    expect(row.rejectReason).toBe('')
  })

  it('不存在的 id 抛 404', async () => {
    await expect(getMyApplication(999)).rejects.toMatchObject({ code: 404 })
  })

  /* ---------------- 状态流转的拒绝边（2026-09-12 测试审计 T56；md §五 L80-83 / §七 L99；aa7d251） ---------------- */

  it('撤回非待审核行（502 已通过）→ 409「该申请已被审核，无法撤回…」且状态不变（md §五 L81 已通过只可查看 / §七 L99）', async () => {
    await expect(withdrawMyApplication(502)).rejects.toMatchObject({
      code: 409,
      message: '该申请已被审核，无法撤回，请查看最新审核结果'
    })
    expect((await getMyApplication(502)).result).toBe('APPROVED')
  })

  it('重新提交待审核（501）/ 已通过（502）行 → 409「仅已驳回或已撤回的申请可重新提交」，状态不变（md §五 L80-81）', async () => {
    for (const [id, result] of [[501, 'PENDING'], [502, 'APPROVED']]) {
      await expect(resubmitMyApplication(id)).rejects.toMatchObject({ code: 409, message: '仅已驳回或已撤回的申请可重新提交' })
      expect((await getMyApplication(id)).result).toBe(result)
    }
  })

  it('重新提交已撤回行（504）→ PENDING、刷新申请时间、清空审核人 / 审核时间（md §五 L83 / §4.3 L66）', async () => {
    const before = await getMyApplication(504)
    expect(before.result).toBe('WITHDRAWN')
    expect(before.reviewer).toBe('—')
    const row = await resubmitMyApplication(504)
    expect(row.result).toBe('PENDING')
    expect(row.submittedAt).not.toBe(before.submittedAt)
    expect(row.reviewer).toBe('')
    expect(row.reviewedAt).toBe('')
    expect(row.rejectReason).toBe('')
  })

  /* ---------------- 提交端接线（2026-09-12 测试审计 T56；myApplicationsMock.js:136-169） ---------------- */

  it('submitApplicationRow：同一对象仍待审（同 businessType+refId）→ 覆盖原行不新建（md §六 L89）', async () => {
    // 种子 501 = API api_1103 PENDING
    const written = submitApplicationRow({
      businessType: 'API',
      refId: 'api_1103',
      objectName: '客户资料查询',
      applicationType: 'VERSION_PUBLISH',
      version: 'v1.1.0',
      submittedAt: '2026-08-29 09:00'
    })
    expect(written.id).toBe(501)
    const { list, total } = await listMyApplications()
    expect(total).toBe(11)
    const row = list.find((r) => r.id === 501)
    expect(row).toMatchObject({ applicationType: 'VERSION_PUBLISH', version: 'v1.1.0', result: 'PENDING', reviewer: '', rejectReason: '' })
  })

  it('submitApplicationRow：新对象 → 新建行，id 避开种子 501..511，objectDeleted=false、result=PENDING', async () => {
    const written = submitApplicationRow({
      businessType: 'MODEL',
      refId: 'md_101',
      objectName: '新模型',
      applicationType: 'FIRST_PUBLISH',
      submittedAt: '2026-08-29 09:00'
    })
    expect(written.id).toBe(512)
    expect(written).toMatchObject({ result: 'PENDING', objectDeleted: false, version: '—', submitter: 'config.admin' })
    const { list, total } = await listMyApplications()
    expect(total).toBe(12)
    expect(list[0].objectName).toBe('新模型') // 08-29 晚于种子最新的 08-28 11:02
  })

  it('withdrawApplicationRow：命中待审行 → 行保留、result=WITHDRAWN、审核人「—」（md §3.1 四态含已撤回、行不删）；无匹配静默', async () => {
    withdrawApplicationRow('API', 'api_1103') // 501
    const { list, total } = await listMyApplications()
    expect(total).toBe(11)
    const row = list.find((r) => r.id === 501)
    expect(row.result).toBe('WITHDRAWN')
    expect(row.reviewer).toBe('—')
    expect(row.reviewedAt).toBeTruthy()
    expect(() => withdrawApplicationRow('MODEL', 'nope')).not.toThrow()
    expect((await listMyApplications()).total).toBe(11)
  })
})

/* ---------------- F9：restore 形状守卫（myApplicationsMock.js:110-112；mockPersist 兜底回种子） ---------------- */
describe('myApplicationsMock · 持久化 restore 形状守卫', () => {
  // 本仓 node/jsdom 环境均无可用 localStorage（mockPersist 探测后走纯内存模式），
  // 与 positionMock.test 同款：注入内存版存储 + vi.resetModules + 动态 import 模拟「刷新后重新加载模块」。
  const KEY = 'iworker-demo-mock:myApplications'
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

  it('存量快照版本对但 applications 不是数组 → 启动时抛「快照形状不合法」被兜底：回种子 11 条、坏 key 被清掉', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 5, data: { applications: { not: 'array' } } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('../myApplicationsMock')
    expect((await fresh.listMyApplications()).total).toBe(11)
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('myApplications 存量数据不可用'), expect.any(Error))
    warn.mockRestore()
  })
})
