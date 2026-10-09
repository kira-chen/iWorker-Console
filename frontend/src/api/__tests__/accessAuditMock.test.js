// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { opsRecords, appendOpsRecord, resetAccessAuditMock, listClientFacingOps } from '../accessAuditMock'

/**
 * accessAuditMock「管理端操作」记录：种子 + 运行期写入（2026-09-20，版本管理发布 / 停用写记录）。
 * 对齐 prd.访问审计.md §6.2（操作对象 / 变更内容）与 prd.版本管理.md §八「审计」。
 *
 * 2026-09-30 起新增（4125917）：§6.2 强制回收 / 用户技能审核 / 岗位分配三类记录；§6.5.1–6.5.3 落给客户端的数据层
 * （appendOpsRecord 的 at / objectId / meta / version 可选字段，listClientFacingOps 的 since 增量、排序、旧种子无 at 兜底）。
 */

beforeEach(() => resetAccessAuditMock())

describe('版本管理种子记录', () => {
  const seeds = () => opsRecords.filter((r) => r.module === '版本管理' && !r.live)

  it('含各版本的历史发布记录：动作均为「发布」，操作人是登录用户名，操作对象为「终端 + 版本号」', () => {
    expect(seeds().map((r) => r.target).sort()).toEqual(
      ['Mac v1.0.0', 'Mac v1.1.0', 'Windows v1.0.0', 'Windows v1.1.0', 'Windows v1.2.0']
    )
    for (const r of seeds()) {
      expect(r.action).toBe('发布')
      expect(r.operator).toMatch(/^[a-z]+(\.[a-z]+)?$/) // 用户名（zhang.wei / li.na），不是姓名
      expect(r.target).toMatch(/^(Windows|Mac) v\d+\.\d+\.\d+$/)
      expect(r.detail).toBeTruthy() // 发布记录的变更内容 = 更新说明
    }
  })

  it('操作对象名称里已含版本号，故记录本身不带 version 字段（页面不再附灰色版本号小标签）', () => {
    for (const r of seeds()) expect(r).not.toHaveProperty('version')
  })

  it('种子 id 与其它模块不冲突', () => {
    const ids = opsRecords.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('appendOpsRecord（运行期写入）', () => {
  it('新记录插在最前，id 从 100 起递增，时间精确到分钟，带 live 标记；返回副本', () => {
    const before = opsRecords.length
    const a = appendOpsRecord({ operator: 'xiaomei', module: '版本管理', action: '发布', target: 'Windows v1.3.0', detail: '更新说明' })
    const b = appendOpsRecord({ operator: 'xiaomei', module: '版本管理', action: '停用', target: 'Windows v1.3.0' })
    expect(opsRecords.length).toBe(before + 2)
    expect(opsRecords[0]).toMatchObject({ id: b.id, action: '停用', detail: '' }) // detail 缺省为空串
    expect(opsRecords[1]).toMatchObject({ id: a.id, operator: 'xiaomei', module: '版本管理', target: 'Windows v1.3.0', detail: '更新说明', live: true })
    expect(a.id).toBeGreaterThanOrEqual(100)
    expect(b.id).toBe(a.id + 1)
    expect(a.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    a.detail = '被改了' // 返回的是副本，不影响库内数据
    expect(opsRecords[1].detail).toBe('更新说明')
  })

  it('resetAccessAuditMock 只清运行期新增记录，种子不动，id 计数回到 100', () => {
    const seedCount = opsRecords.filter((r) => !r.live).length
    appendOpsRecord({ operator: 'a', module: '版本管理', action: '发布', target: 'Mac v9.9.9' })
    resetAccessAuditMock()
    expect(opsRecords.some((r) => r.live)).toBe(false)
    expect(opsRecords.length).toBe(seedCount)
    expect(appendOpsRecord({ operator: 'a', module: '版本管理', action: '发布', target: 'x' }).id).toBe(100)
  })
})

describe('持久化（mockPersist v1，key iworker-demo-mock:accessAuditOps）', () => {
  const KEY = 'iworker-demo-mock:accessAuditOps'
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
  const snap = () => JSON.parse(globalThis.localStorage.getItem(KEY))

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })

  it('只落盘运行期新增记录（不含种子）；刷新（重新加载模块）后新增记录仍在最前，种子仍以代码为准', async () => {
    const m = await import('../accessAuditMock')
    const seedCount = m.opsRecords.length
    m.appendOpsRecord({ operator: 'xiaomei', module: '版本管理', action: '发布', target: 'Windows v1.3.0', detail: '说明' })
    expect(snap().v).toBe(1)
    expect(snap().data.live).toHaveLength(1)
    expect(Object.keys(snap().data).sort()).toEqual(['live', 'opsSeq'])

    vi.resetModules()
    const reloaded = await import('../accessAuditMock')
    expect(reloaded.opsRecords).toHaveLength(seedCount + 1)
    expect(reloaded.opsRecords[0]).toMatchObject({ operator: 'xiaomei', target: 'Windows v1.3.0', live: true })
    // 计数接着走，不与已有新增记录撞 id
    expect(reloaded.appendOpsRecord({ operator: 'a', module: '版本管理', action: '停用', target: 'x' }).id).toBe(101)
  })

  it('新字段 at / objectId / meta 随 live 记录一起落盘并在刷新后恢复；不带新字段的旧快照照常恢复', async () => {
    const m = await import('../accessAuditMock')
    m.appendOpsRecord({ operator: 'a', module: '岗位分配', action: '变更', target: 'li.na', detail: 'A → B', objectId: 202, meta: { userId: 202, username: 'li.na', fromPosition: { id: 1, name: 'A' }, toPosition: { id: 2, name: 'B' } } })
    expect(snap().data.live[0]).toMatchObject({ objectId: 202, meta: { username: 'li.na' } })
    expect(snap().data.live[0].at).toMatch(/:\d{2}$/)
    vi.resetModules()
    const reloaded = await import('../accessAuditMock')
    expect(reloaded.opsRecords[0]).toMatchObject({ objectId: 202, meta: { toPosition: { id: 2, name: 'B' } } })
    expect(reloaded.listClientFacingOps().some((r) => r.username === 'li.na' && r.type === '变更')).toBe(true)

    // 旧快照：live 记录没有新字段
    vi.resetModules()
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: { opsSeq: 101, live: [{ id: 100, time: '2026-09-20 10:00', operator: 'x', module: '版本管理', action: '发布', target: 'Mac v1.0.1', detail: '', live: true }] } }))
    const legacy = await import('../accessAuditMock')
    expect(legacy.opsRecords[0]).toMatchObject({ id: 100, target: 'Mac v1.0.1' })
  })

  it('存量快照形状不合法 → 兜底：忽略坏快照、只剩种子，不抛错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: { opsSeq: 100, live: 'oops' } }))
    const m = await import('../accessAuditMock')
    expect(m.opsRecords.some((r) => r.live)).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('§6.5 数据层字段：at / objectId / meta（页面不展示但必须保存）', () => {
  it('at 精确到秒且与 time 同一时刻（time = at 截到分钟）', () => {
    const r = appendOpsRecord({ operator: 'a', module: '技能', action: '强制回收', target: 'x', detail: '原因' })
    expect(r.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(r.at.slice(0, 16)).toBe(r.time)
  })

  it('objectId / meta 传入即落库（meta 深拷贝）；旧调用不传则不带这两个键', () => {
    const meta = { reviewId: 'usr_9', submitter: 'zs', skillName: '技能A' }
    const a = appendOpsRecord({ operator: 'a', module: '用户技能审核', action: '审核通过', target: 'zs / 技能A', objectId: 'usr_9', meta })
    meta.skillName = '被改了'
    expect(opsRecords.find((r) => r.id === a.id)).toMatchObject({ objectId: 'usr_9', meta: { reviewId: 'usr_9', submitter: 'zs', skillName: '技能A' } })
    const b = appendOpsRecord({ operator: 'a', module: '版本管理', action: '发布', target: 'Windows v1.3.0' })
    expect(b).not.toHaveProperty('objectId')
    expect(b).not.toHaveProperty('meta')
  })

  it('种子：用户技能审核两条带 objectId + meta；岗位分配「分配 / 变更」各一条，detail =「原岗位 → 新岗位」', () => {
    const reviews = opsRecords.filter((r) => r.module === '用户技能审核')
    expect(reviews).toHaveLength(2)
    for (const r of reviews) {
      expect(r.objectId).toBeTruthy()
      expect(r.target).toBe(`${r.meta.submitter} / ${r.meta.skillName}`)
      expect(r.meta.reviewId).toBe(r.objectId)
    }
    const assigns = opsRecords.filter((r) => r.module === '岗位分配')
    expect(assigns.map((r) => r.action).sort()).toEqual(['分配', '变更'])
    expect(assigns.find((r) => r.action === '分配').detail).toMatch(/^未绑定 → /)
    expect(assigns.find((r) => r.action === '分配').meta.fromPosition).toBeNull()
    expect(assigns.find((r) => r.action === '变更').meta.fromPosition).toMatchObject({ id: expect.anything(), name: expect.any(String) })
  })
})

describe('listClientFacingOps（§6.5 落给客户端的数据）', () => {
  it('只含强制回收 / 用户技能审核 / 岗位分配 / 存储空间四类；不含操作人；发布 / 停用 / 版本管理等不读取', () => {
    appendOpsRecord({ operator: 'a', module: '版本管理', action: '发布', target: 'Windows v1.3.0' })
    appendOpsRecord({ operator: 'a', module: '技能', action: '发布', target: '某技能', version: 'v1' })
    const list = listClientFacingOps()
    expect(new Set(list.map((r) => r.kind))).toEqual(new Set(['skillReview', 'positionAssign', 'storageQuota']))
    for (const r of list) expect(r).not.toHaveProperty('operator')
    expect(list.every((r) => r.recordId != null && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.at))).toBe(true)
    expect(new Set(list.map((r) => r.recordId)).size).toBe(list.length)
  })

  it('强制回收视图（§6.5.1）：对象类型 = 模块、对象标识、对象名称、回收原因；五个模块都覆盖，无版本号 / 操作人', () => {
    for (const module of ['技能', '专家', 'MCP', 'API', '业务系统']) {
      appendOpsRecord({ operator: 'admin', module, action: '强制回收', target: `${module}X`, detail: '安全问题', version: 'v2', objectId: `id-${module}` })
    }
    const revokes = listClientFacingOps().filter((r) => r.kind === 'forceRevoke')
    expect(revokes.map((r) => r.objectType).sort()).toEqual(['API', 'MCP', '专家', '业务系统', '技能'])
    expect(revokes.find((r) => r.objectType === 'MCP')).toEqual({
      kind: 'forceRevoke', recordId: expect.any(Number), at: expect.any(String),
      objectType: 'MCP', objectId: 'id-MCP', objectName: 'MCPX', reason: '安全问题'
    })
  })

  it('用户技能审核视图（§6.5.2）：审核结果 / 审核单标识 / 提交人 / 技能名称 / 驳回原因（通过为空）', () => {
    const list = listClientFacingOps().filter((r) => r.kind === 'skillReview')
    const rejected = list.find((r) => r.result === '审核驳回')
    expect(rejected).toEqual({
      kind: 'skillReview', recordId: expect.any(Number), at: '2026-08-27 16:08:00',
      result: '审核驳回', reviewId: 'usr_hist_2', submitter: 'sun.hao', skillName: '财税合规助手', rejectReason: '岗位与技能权限范围不匹配'
    })
    expect(list.find((r) => r.result === '审核通过')).toMatchObject({ submitter: 'wang.fang', skillName: '合同管理助手', rejectReason: '' })
  })

  it('岗位分配视图（§6.5.3）：类型 / 用户 / 原岗位（分配时为 null）/ 新岗位', () => {
    const list = listClientFacingOps().filter((r) => r.kind === 'positionAssign')
    expect(list.find((r) => r.type === '分配')).toMatchObject({ username: 'chenyu', userId: 203, fromPosition: null, toPosition: { id: 401, name: '经营分析岗' } })
    expect(list.find((r) => r.type === '变更')).toMatchObject({
      username: 'li.na', fromPosition: { id: 402, name: '客户成功岗' }, toPosition: { id: 403, name: '财务审核岗' }
    })
  })

  it('since 增量：只返回操作时间严格晚于 since 的记录；按时间正序；不受页面 90 天窗口限制', () => {
    const all = listClientFacingOps()
    for (let i = 1; i < all.length; i++) expect(all[i - 1].at <= all[i].at).toBe(true)
    expect(all[0].at).toBe('2026-08-25 16:20:00') // 老记录（远早于 90 天窗口）仍在
    const cut = listClientFacingOps({ since: '2026-08-28 10:50:37' })
    // 08-28 11:10:24 的岗位分配 + 存储空间种子（调整容量 / 同意 / 拒绝扩容，hidden 的也在，页面不展示但客户端要读）
    expect(cut.map((r) => r.at)).toEqual(['2026-08-28 11:10:24', '2026-09-20 14:05:19', '2026-09-28 11:40:30', '2026-10-05 15:18:07', '2026-10-07 16:02:41', '2026-10-08 14:30:12'])
    const fresh = appendOpsRecord({ operator: 'a', module: 'API', action: '强制回收', target: 'A1', objectId: 'api-1' })
    expect(listClientFacingOps({ since: '2099-01-01 00:00:00' })).toEqual([])
    const later = listClientFacingOps({ since: '2026-10-08 14:30:12' }) // 严格晚于最后一条存储空间种子
    expect(later.map((r) => r.recordId)).toEqual([fresh.id])
  })

  it('存储空间视图（§6.5.4）：种子里的调整容量 / 同意扩容 / 拒绝扩容都在（hidden 的也读得到），字段齐全且不含操作人', () => {
    const sq = listClientFacingOps().filter((r) => r.kind === 'storageQuota')
    expect(sq.map((r) => r.type).sort()).toEqual(['同意扩容', '拒绝扩容', '拒绝扩容', '拒绝扩容', '调整容量'])
    const adjust = sq.find((r) => r.type === '调整容量')
    expect(adjust).toMatchObject({ username: 'xulin', userId: 212, requestId: null, newTotalGb: 8, rejectReason: '' })
    const approve = sq.find((r) => r.type === '同意扩容')
    expect(approve).toMatchObject({ username: 'zhaomin', userId: 208, requestId: 'ER-1002', newTotalGb: 10 })
    const reject = sq.find((r) => r.requestId === 'ER-0999')
    expect(reject).toMatchObject({ type: '拒绝扩容', username: 'liuqiang', rejectReason: '申请说明过于简单，请补充使用场景和预计增量后重新提交。' })
    for (const r of sq) expect(r).not.toHaveProperty('operator')
  })

  it('旧快照记录（没有 at / objectId / meta）也不抛错：at 按分钟补 :00', () => {
    opsRecords.unshift({ id: 900, time: '2026-09-01 08:00', operator: 'a', module: '用户技能审核', action: '审核驳回', target: 'u1 / S1', detail: 'r', live: true })
    const r = listClientFacingOps().find((x) => x.recordId === 900)
    expect(r).toMatchObject({ at: '2026-09-01 08:00:00', submitter: 'u1', skillName: 'S1', reviewId: null, rejectReason: 'r' })
  })
})

describe('种子记录的变更内容符合 §6.2「仅六类」（2026-10-09 /prd-import Q27）', () => {
  it('业务系统「发布」记录不在六类内 → 变更内容为空（页面显示「—」）', () => {
    const rec = opsRecords.find((r) => r.module === '业务系统' && r.action === '发布')
    expect(rec).toBeTruthy()
    expect(rec.detail).toBe('')
  })
})
