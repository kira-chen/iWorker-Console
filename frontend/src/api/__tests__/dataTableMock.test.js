// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listDataTables,
  getDataTable,
  createDataTable,
  updateDataTable,
  deleteDataTable,
  getTableDeleteImpact,
  saveDataTableFields,
  getDossierConfig,
  saveDossierConfig,
  __resetDataTableMock
} from '../dataTableMock'
import { validateFields } from '@/utils/dataTableTypes'
import { validateDossierConfig, hydrateDossierConfig } from '@/utils/dossierConfig'

beforeEach(() => __resetDataTableMock())

describe('dataTableMock · 工作档案（2026-09-02 岗位工作台补 mock）', () => {
  it('种子与岗位同源：401/402/403 各 1 份档案，404 空态；行含计数字段', async () => {
    const p401 = await listDataTables(401)
    expect(p401.total).toBe(1)
    expect(p401.list[0]).toMatchObject({ label: '经营复盘档案', recordCount: 12, refSkillCount: 1, status: 'active' })
    expect(p401.list[0].fieldCount).toBeGreaterThan(0)
    // 2026-09-12 审计 D6：用例名写了 402/403，原来只断了 401——补齐
    expect((await listDataTables(402)).total).toBe(1)
    expect((await listDataTables(403)).total).toBe(1)
    expect((await listDataTables(404)).list).toEqual([])
    expect((await listDataTables(404)).total).toBe(0)
  })

  it('详情含 uid 系统字段 + dossier；种子须通过前端轻校验（validateFields / validateDossierConfig）', async () => {
    const d = await getDataTable(401, 9001)
    expect(d.fields.find((f) => f.isSystem)?.fieldCode).toBe('uid')
    expect(validateFields(d.fields).ok).toBe(true)
    expect(validateDossierConfig(hydrateDossierConfig(d.dossier)).ok).toBe(true)
    expect(d.refSkills[0]).toMatchObject({ id: 'sk_301' })
    await expect(getDataTable(401, 777)).rejects.toThrow('不存在')
  })

  it('建表：tableCode 留空自动生成，重复被拦（TABLE_CODE_DUPLICATED）；改表元信息生效', async () => {
    const res = await createDataTable(404, {
      label: '研究选题档案',
      fields: [{ fieldCode: 'topic', label: '选题', fieldType: 'TEXT', required: true, isPrimary: true, slotRole: 'IDENTITY' }]
    })
    expect(res.id).toBeTruthy()
    expect(res.tableCode).toMatch(/^table_/)
    expect(res.fields.some((f) => f.isSystem)).toBe(true)
    await expect(createDataTable(401, { label: 'x', tableCode: 'business_review' })).rejects.toMatchObject({
      data: { errorCode: 'TABLE_CODE_DUPLICATED' }
    })
    await updateDataTable(404, res.id, { label: '选题库', status: 'disabled' })
    const row = (await listDataTables(404)).list[0]
    expect(row).toMatchObject({ label: '选题库', status: 'disabled' })
  })

  it('整表字段保存：删有数据字段须 confirm（FIELD_DELETE_NEED_CONFIRM 带 deleteFieldCodes），confirm 后生效', async () => {
    const d = await getDataTable(401, 9001)
    const biz = d.fields.filter((f) => !f.isSystem)
    const kept = biz.filter((f) => f.fieldCode !== 'stage')
    await expect(saveDataTableFields(401, 9001, kept, false)).rejects.toMatchObject({
      data: { errorCode: 'FIELD_DELETE_NEED_CONFIRM', affectedRows: 12, deleteFieldCodes: ['stage'] }
    })
    await saveDataTableFields(401, 9001, kept, true)
    const after = await getDataTable(401, 9001)
    expect(after.fields.filter((f) => !f.isSystem).map((f) => f.fieldCode)).toEqual(kept.map((f) => f.fieldCode))
  })

  it('无数据表（403）删字段不需要 confirm；卡位超 8 个被拦（SLOT_LIMIT_EXCEEDED）', async () => {
    await saveDataTableFields(403, 9003, [{ fieldCode: 'expense_no', label: '报销单号', fieldType: 'TEXT', required: true, isPrimary: true }], false)
    const after = await getDataTable(403, 9003)
    expect(after.fields.filter((f) => !f.isSystem)).toHaveLength(1)
    const nine = Array.from({ length: 9 }, (_, i) => ({ fieldCode: `f${i}`, label: `字段${i}`, fieldType: 'TEXT' }))
    await expect(saveDataTableFields(403, 9003, nine, false)).rejects.toMatchObject({ data: { errorCode: 'SLOT_LIMIT_EXCEEDED' } })
  })

  it('删表：影响预检回 affectedRows/refSkills/willSoftDelete，删除后列表移除', async () => {
    const impact = await getTableDeleteImpact(401, 9001)
    expect(impact).toMatchObject({ affectedRows: 12, willSoftDelete: true })
    expect(impact.refSkills).toHaveLength(1)
    await deleteDataTable(401, 9001)
    expect((await listDataTables(401)).total).toBe(0)
  })

  it('dossier 配置读写：保存回归一化配置，读回一致', async () => {
    const cfg = await getDossierConfig(403, 9003)
    expect(cfg.policy.confirmMode).toBe('LOW_ONLY')
    const saved = await saveDossierConfig(403, 9003, {
      policy: { ...cfg.policy, confirmMode: 'ALL' },
      checklist: [{ key: '风险点', when: { type: 'ALWAYS' }, hint: null }],
      reduceRules: [{ key: '风险点', strategy: 'LIST', params: { normalize: true }, desc: null }]
    })
    expect(saved.policy.confirmMode).toBe('ALL')
    const back = await getDossierConfig(403, 9003)
    expect(back.checklist).toHaveLength(1)
    expect(back.reduceRules[0]).toMatchObject({ key: '风险点', strategy: 'LIST' })
  })
})

/**
 * 2026-09-12 测试审计补缺口（F5）：dataTableMock 持久化零用例（mockPersist v1，6 个写点：
 * createDataTable / updateDataTable / deleteDataTable / saveDataTableFields / saveDossierConfig / __reset）。
 * 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
 * 故与 positionMock.test 同款：注入内存版存储 + vi.resetModules 动态 import，模拟「写入 → 刷新 → 重载」。
 */
describe('dataTableMock · 持久化（mockPersist v1）', () => {
  const KEY = 'iworker-demo-mock:dataTable'
  const makeStorage = () => {
    const map = new Map()
    return {
      get length() { return map.size },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: vi.fn((k, v) => map.set(k, String(v))),
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

  it('五个业务写点各落盘一次（setItem 计数逐一 +1），只读接口不落盘', async () => {
    const m = await import('../dataTableMock')
    const writes = () => globalThis.localStorage.setItem.mock.calls.filter(([k]) => k === KEY).length
    const base = writes()
    await m.listDataTables(401)
    await m.getDataTable(401, 9001)
    await m.getTableDeleteImpact(401, 9001)
    await m.getDossierConfig(401, 9001)
    expect(writes()).toBe(base)
    const created = await m.createDataTable(404, {
      label: '选题档案',
      fields: [{ fieldCode: 'topic', label: '选题', fieldType: 'TEXT' }]
    })
    expect(writes()).toBe(base + 1)
    await m.updateDataTable(404, created.id, { label: '选题库' })
    expect(writes()).toBe(base + 2)
    await m.saveDataTableFields(404, created.id, [{ fieldCode: 'topic', label: '选题名', fieldType: 'TEXT' }], false)
    expect(writes()).toBe(base + 3)
    const cfg = await m.getDossierConfig(404, created.id)
    await m.saveDossierConfig(404, created.id, { policy: cfg.policy, checklist: [], reduceRules: [] })
    expect(writes()).toBe(base + 4)
    await m.deleteDataTable(404, created.id)
    expect(writes()).toBe(base + 5)
    m.__resetDataTableMock()
    expect(writes()).toBe(base + 6)
  })

  it('建表落盘（v=1）→ 重新 import（模拟刷新）→ 404 岗位仍能读到新建的表，且 tableSeq 延续不撞号', async () => {
    const first = await import('../dataTableMock')
    const created = await first.createDataTable(404, {
      label: '选题档案',
      fields: [{ fieldCode: 'topic', label: '选题', fieldType: 'TEXT' }]
    })
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    expect(snap.v).toBe(1)
    expect(snap.data.tablesByPosition['404'].map((t) => t.label)).toEqual(['选题档案'])
    vi.resetModules()
    const fresh = await import('../dataTableMock')
    const { list, total } = await fresh.listDataTables(404)
    expect(total).toBe(1)
    expect(list[0]).toMatchObject({ id: created.id, label: '选题档案' })
    const again = await fresh.createDataTable(404, { label: '第二张', fields: [{ fieldCode: 'x', label: 'X', fieldType: 'TEXT' }] })
    expect(again.id).not.toBe(created.id)
  })

  it('存量快照版本不符（v=0）→ 丢弃并回种子：404 岗位回到空态', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 0, data: { tableSeq: 1, fieldSeq: 1, tablesByPosition: { 404: [{ id: 1, label: '旧数据', fields: [], refSkills: [] }] } } }))
    const m = await import('../dataTableMock')
    expect((await m.listDataTables(404)).list).toEqual([])
    expect((await m.listDataTables(401)).list[0].label).toBe('经营复盘档案')
  })

  it('存量快照形状不合法（缺 tablesByPosition）→ restore 抛错被兜底，回种子不白屏', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: { tableSeq: 1 } }))
    const m = await import('../dataTableMock')
    expect((await m.listDataTables(401)).total).toBe(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
