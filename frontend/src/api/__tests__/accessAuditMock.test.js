// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { opsRecords, appendOpsRecord, resetAccessAuditMock } from '../accessAuditMock'
import * as skillMock from '../unifiedSkillMock'
import { listApisSync } from '../apiConnectorMock'

/**
 * accessAuditMock「管理端操作」记录：种子 + 运行期写入（2026-09-20，版本管理发布 / 停用写记录）。
 * 对齐 prd.访问审计.md §6.2（操作对象 / 变更内容）与 prd.版本管理.md §八「审计」。
 *
 * 2026-09-30 起新增（4125917）：§6.2 强制回收 / 用户技能审核 / 岗位分配三类记录；appendOpsRecord 的 version 可选字段。
 *
 * 2026-10-12 口径：强制回收记录由各业务 mock 在“停用审核通过、回收生效”时才 appendOpsRecord（PRD 访问审计 §6.2），
 * 本文件只验记录本身的形状；“提交时不写 / 驳回撤回不写 / 通过时只写强制回收不写停用”的联动见 reviewFlowIntegration.test.js。
 *
 * 2026-10-09 起新增：存储空间记录（§6.2 存储空间记录块）——5 条存储空间审计种子（与 storageSpaceMock 种子一一对应，由 storageSpaceMock.test.js 守）。
 *
 * 2026-10-16：客户端通知改由管理端在管理员操作时直接生成，审计记录只服务页面展示——原 §6.5 落给客户端的数据层
 * （at / objectId / meta 字段与 listClientFacingOps）已删除，本文件改为守「记录只存页面字段」。
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

describe('持久化（mockPersist v3，key iworker-demo-mock:accessAuditOps）', () => {
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
    expect(snap().v).toBe(3)
    expect(snap().data.live).toHaveLength(1)
    expect(Object.keys(snap().data).sort()).toEqual(['live', 'opsSeq'])

    vi.resetModules()
    const reloaded = await import('../accessAuditMock')
    expect(reloaded.opsRecords).toHaveLength(seedCount + 1)
    expect(reloaded.opsRecords[0]).toMatchObject({ operator: 'xiaomei', target: 'Windows v1.3.0', live: true })
    // 计数接着走，不与已有新增记录撞 id
    expect(reloaded.appendOpsRecord({ operator: 'a', module: '版本管理', action: '停用', target: 'x' }).id).toBe(101)
  })

  it('快照里残留旧字段（at / objectId / meta）的 live 记录照常恢复，不抛错（多余字段无害，页面不读）', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 3, data: { opsSeq: 101, live: [{ id: 100, time: '2026-09-20 10:00', operator: 'x', module: '岗位分配', action: '变更', target: 'li.na', detail: 'A → B', at: '2026-09-20 10:00:05', objectId: 202, meta: { userId: 202 }, live: true }] } }))
    const legacy = await import('../accessAuditMock')
    expect(legacy.opsRecords[0]).toMatchObject({ id: 100, target: 'li.na', detail: 'A → B', live: true })
  })

  it('存储空间的 live 记录落盘后刷新仍在', async () => {
    const m = await import('../accessAuditMock')
    m.appendOpsRecord({ operator: 'a', module: '存储空间', action: '拒绝扩容', target: 'chenyu', detail: '先清理' })
    expect(snap().data.live[0]).toMatchObject({ module: '存储空间', action: '拒绝扩容' })
    vi.resetModules()
    const reloaded = await import('../accessAuditMock')
    expect(reloaded.opsRecords[0]).toMatchObject({ module: '存储空间', action: '拒绝扩容', target: 'chenyu', detail: '先清理', live: true })
  })

  it('存量快照形状不合法 → 兜底：忽略坏快照、只剩种子，不抛错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 3, data: { opsSeq: 100, live: 'oops' } }))
    const m = await import('../accessAuditMock')
    expect(m.opsRecords.some((r) => r.live)).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('记录只存页面展示的字段（2026-10-16：客户端通知改由管理端操作时直接生成，审计不再为客户端多存字段）', () => {
  const PAGE_KEYS = ['action', 'detail', 'id', 'module', 'operator', 'target', 'time']

  it('appendOpsRecord 写入的记录只有页面字段（+ live 标记，带版本号时 + version）；调用方多传的 at / objectId / meta 不落库', () => {
    const a = appendOpsRecord({ operator: 'a', module: '技能', action: '强制回收', target: 'x', detail: '原因', version: 'v2', objectId: 'sk_1', meta: { k: 1 }, at: '2026-01-01 00:00:00' })
    expect(Object.keys(opsRecords.find((r) => r.id === a.id)).sort()).toEqual([...PAGE_KEYS, 'live', 'version'].sort())
    const b = appendOpsRecord({ operator: 'a', module: '版本管理', action: '发布', target: 'Windows v1.3.0' })
    expect(Object.keys(b).sort()).toEqual([...PAGE_KEYS, 'live'].sort())
  })

  it('种子记录都不带 at / objectId / meta', () => {
    for (const r of opsRecords) {
      expect(r).not.toHaveProperty('at')
      expect(r).not.toHaveProperty('objectId')
      expect(r).not.toHaveProperty('meta')
    }
  })

  it('种子：用户技能审核两条，操作对象 =「提交人 / 技能名」，驳回带原因、通过为空；岗位分配「分配 / 变更」各一条，detail =「原岗位 → 新岗位」', () => {
    const reviews = opsRecords.filter((r) => r.module === '用户技能审核')
    expect(reviews.map((r) => r.target).sort()).toEqual(['sun.hao / 财税合规助手', 'wang.fang / 合同管理助手'])
    expect(reviews.find((r) => r.action === '审核驳回').detail).toBe('岗位与技能权限范围不匹配')
    expect(reviews.find((r) => r.action === '审核通过').detail).toBe('')
    const assigns = opsRecords.filter((r) => r.module === '岗位分配')
    expect(assigns.map((r) => r.action).sort()).toEqual(['分配', '变更'])
    expect(assigns.find((r) => r.action === '分配')).toMatchObject({ target: 'chenyu', detail: '未绑定 → 经营分析岗' })
    expect(assigns.find((r) => r.action === '变更')).toMatchObject({ target: 'li.na', detail: '客户成功岗 → 财务审核岗' })
  })

  it('种子：存储空间五条（调整容量 / 同意扩容 / 三条拒绝扩容），拒绝扩容的变更内容 = 拒绝原因', () => {
    const sq = opsRecords.filter((r) => r.module === '存储空间')
    expect(sq.map((r) => r.action).sort()).toEqual(['同意扩容', '拒绝扩容', '拒绝扩容', '拒绝扩容', '调整容量'])
    expect(sq.find((r) => r.action === '调整容量')).toMatchObject({ target: 'xulin', detail: '5 GB → 8 GB' })
    expect(sq.find((r) => r.action === '同意扩容')).toMatchObject({ target: 'zhaomin', detail: '5 GB → 10 GB' })
    expect(sq.find((r) => r.target === 'liuqiang')).toMatchObject({ action: '拒绝扩容', detail: '申请说明过于简单，请补充使用场景和预计增量后重新提交。' })
  })
})

describe('强制回收种子与「已回收」样例对象一一对应（待办 yuepu#83：demo 打开即能看到已回收标签 / 访问审计记录）', () => {
  const seedRevokes = () => opsRecords.filter((r) => r.action === '强制回收' && !r.live)

  it('种子里有技能与 API 各一条强制回收记录：操作对象 = 对象名称，变更内容 = 回收原因', () => {
    expect(seedRevokes().map((r) => [r.module, r.target]).sort()).toEqual([
      ['API', '新增客户跟进'],
      ['技能', '公文润色']
    ])
    for (const r of seedRevokes()) expect(r.detail).toBeTruthy()
  })

  it('技能 sk_306：未发布且带 revoked，回收原因 / 版本号与审计记录一致', async () => {
    const rec = seedRevokes().find((r) => r.module === '技能')
    const detail = await skillMock.getSkillDetail('sk_306')
    expect(detail.name).toBe(rec.target)
    expect(detail.revoked).toMatchObject({ reason: rec.detail })
    expect(detail.versionLabel).toBe(rec.version) // 回收时保留的线上版本号
    const row = (await skillMock.listUnifiedSkills({ keyword: rec.target, size: 10 })).list.find((r) => r.id === 'sk_306')
    expect(row.revoked.reason).toBe(rec.detail)
    expect(row.publications.every((p) => p.status !== 'PUBLISHED')).toBe(true) // 已回到未发布
  })

  it('API api_1104：未发布且带 revoked，回收原因 / 名称与审计记录一致；仍被 402 岗位引用（引用关系保留）', () => {
    const rec = seedRevokes().find((r) => r.module === 'API')
    const row = listApisSync().find((a) => a.id === 'api_1104')
    expect(row.status).toBe('NOT_PUBLISHED')
    expect(row.name).toBe(rec.target)
    expect(row.revoked).toMatchObject({ reason: rec.detail })
    expect(row.referencedByPositions.map((p) => p.positionId)).toEqual([402])
  })
})

describe('种子记录的变更内容符合 §6.2「仅七类」（2026-10-09 /prd-import Q27）', () => {
  it('业务系统「发布」记录不在六类内 → 变更内容为空（页面显示「—」）', () => {
    const rec = opsRecords.find((r) => r.module === '业务系统' && r.action === '发布')
    expect(rec).toBeTruthy()
    expect(rec.detail).toBe('')
  })
})
