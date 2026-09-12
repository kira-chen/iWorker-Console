// @vitest-environment jsdom
// （skillReviewMock → request.js → router 链路触达 window，故用 jsdom，同 domainExpertMock.test.js）
// 用户技能审核 mock 单测（2026-09-08 PRD-20260908 对齐重写：新记录结构 + 通过/驳回两接口 + 风险设置）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listReviewApplications,
  getReviewApplication,
  approveReviewApplication,
  rejectReviewApplication,
  reviewApplication,
  getRiskConfig,
  setCurrentScale,
  saveRiskTemplate,
  __resetSkillReviewMock
} from '../skillReviewMock'
import {
  fullDetectionResults,
  needsManualAudit,
  DEFAULT_RISK_TEMPLATES,
  DETECTION_ITEMS,
  PASS_DETAIL,
  ITEM_RISK_OPTIONS
} from '@/utils/userSkillAuditMeta'

beforeEach(() => __resetSkillReviewMock())

describe('skillReviewMock · 审核记录', () => {
  // 2026-09-12 测试审计 T22：种子恒 7 条（与下方分页用例 total=7 一致），「≥7」放宽无意义，改精确值
  it('种子恒 7 条，覆盖三种状态 × 三种尺度；行含页面消费的关键字段', async () => {
    const { list, total } = await listReviewApplications({ page: 1, size: 50 })
    expect(total).toBe(7)
    expect(new Set(list.map((r) => r.status))).toEqual(new Set(['PENDING', 'APPROVED', 'REJECTED']))
    expect(new Set(list.map((r) => r.scale))).toEqual(new Set(['宽松', '通用', '严格']))
    for (const k of ['id', 'skillName', 'description', 'submitter', 'submittedAt', 'status', 'scale', 'skillMd', 'risks', 'reviewer', 'reviewedAt', 'rejectReason']) {
      expect(list[0]).toHaveProperty(k)
    }
    // 已完成记录带审核人与时间；驳回记录带原因
    const rejected = list.find((r) => r.status === 'REJECTED')
    expect(rejected.reviewer).toBeTruthy()
    expect(rejected.reviewedAt).toBeTruthy()
    expect(rejected.rejectReason).toBeTruthy()
  })

  it('列表默认按提交时间倒序；sort=asc 切正序', async () => {
    const desc = (await listReviewApplications({})).list
    for (let i = 1; i < desc.length; i++) expect(desc[i - 1].submittedAt >= desc[i].submittedAt).toBe(true)
    const asc = (await listReviewApplications({ sort: 'asc' })).list
    for (let i = 1; i < asc.length; i++) expect(asc[i - 1].submittedAt <= asc[i].submittedAt).toBe(true)
  })

  it('列表筛选：keyword（名称 / 描述 / 提交人模糊）、scale、status 均生效且可组合', async () => {
    expect((await listReviewApplications({ keyword: '邮件' })).total).toBe(1) // 名称
    expect((await listReviewApplications({ keyword: 'Excel' })).total).toBe(1) // 描述
    expect((await listReviewApplications({ keyword: 'LISI' })).total).toBe(1) // 提交人（大小写不敏感）
    expect((await listReviewApplications({ scale: '严格' })).total).toBe(3)
    expect((await listReviewApplications({ status: 'PENDING' })).total).toBe(3)
    expect((await listReviewApplications({ status: 'PENDING', scale: '通用' })).total).toBe(2)
    expect((await listReviewApplications({ keyword: '不存在的技能' })).total).toBe(0)
  })

  it('分页：page/size 切片，total 为筛选后总数', async () => {
    const p1 = await listReviewApplications({ page: 1, size: 3 })
    const p3 = await listReviewApplications({ page: 3, size: 3 })
    expect(p1.list.length).toBe(3)
    expect(p1.total).toBe(7)
    expect(p3.list.length).toBe(1)
  })

  it('详情：risks 项形状 {item,level,location,code,detail}，等级为 md 五档命名；补齐后固定 4 项', async () => {
    const d = await getReviewApplication('usr_1')
    expect(d.risks.length).toBe(2)
    for (const r of d.risks) {
      for (const k of ['item', 'level', 'location', 'code', 'detail']) expect(r).toHaveProperty(k)
      expect(['检测通过', '低风险', '中风险', '高风险', '严重风险']).toContain(r.level)
    }
    const full = fullDetectionResults(d.risks)
    expect(full.map((x) => x.item)).toEqual(DETECTION_ITEMS)
    expect(full.map((x) => x.label)).toEqual(['对外动作', '敏感信息', '权限范围', '危险操作'])
    expect(full[0].level).toBe('中风险')
    expect(full[1].level).toBe('高风险')
    expect(full[2]).toMatchObject({ level: '检测通过', detail: PASS_DETAIL, location: '', code: '' })
    expect(full[3].level).toBe('检测通过')
    // 返回值是拷贝，改动不污染内部数据
    d.risks[0].level = '严重风险'
    expect((await getReviewApplication('usr_1')).risks[0].level).toBe('中风险')
  })

  it('通过：记录审核人与时间，状态 APPROVED；重复审核被拒', async () => {
    const d = await approveReviewApplication('usr_1', { reviewer: 'audit.admin' })
    expect(d.status).toBe('APPROVED')
    expect(d.reviewer).toBe('audit.admin')
    expect(d.reviewedAt).toMatch(/\+08:00$/)
    await expect(approveReviewApplication('usr_1', {})).rejects.toMatchObject({ message: '该记录已审核，不能重复操作' })
    await expect(rejectReviewApplication('usr_1', { reason: 'x' })).rejects.toMatchObject({ code: 40900 })
  })

  it('驳回：原因必填 ≤500 字；记录审核人 / 时间 / 原因，状态 REJECTED', async () => {
    await expect(rejectReviewApplication('usr_4', { reason: '   ' })).rejects.toMatchObject({ message: '请填写驳回原因' })
    await expect(rejectReviewApplication('usr_4', { reason: 'x'.repeat(501) })).rejects.toMatchObject({
      message: '驳回原因不能超过 500 字'
    })
    const d = await rejectReviewApplication('usr_4', { reviewer: 'audit.admin', reason: ' 请缩小权限范围 ' })
    expect(d.status).toBe('REJECTED')
    expect(d.reviewer).toBe('audit.admin')
    expect(d.rejectReason).toBe('请缩小权限范围')
    expect(d.reviewedAt).toMatch(/\+08:00$/)
  })

  it('旧签名兼容 reviewApplication({approved,comment}) 映射到通过 / 驳回', async () => {
    expect((await reviewApplication('usr_1', { approved: true })).status).toBe('APPROVED')
    expect((await reviewApplication('usr_4', { approved: false, comment: '原因' })).rejectReason).toBe('原因')
  })

  it('不存在的记录：详情 / 通过 / 驳回均报 40400', async () => {
    await expect(getReviewApplication('usr_999')).rejects.toMatchObject({ code: 40400 })
    await expect(approveReviewApplication('usr_999')).rejects.toMatchObject({ code: 40400 })
    await expect(rejectReviewApplication('usr_999', { reason: 'x' })).rejects.toMatchObject({ code: 40400 })
  })
})

describe('skillReviewMock · 风险设置', () => {
  it('默认：当前尺度「通用」，三套模板等于 md §7.2 默认值表', async () => {
    const cfg = await getRiskConfig()
    expect(cfg.currentScale).toBe('通用')
    expect(cfg.templates).toEqual(DEFAULT_RISK_TEMPLATES)
  })

  // 2026-09-12 测试审计 T29：09-09 起「当前审查尺度」改草稿制（md §7.1「点击【保存设置】后生效」），
  // 本函数由抽屉【保存设置】调用，不再是「选择即时生效」；用例名随口径改，断言不变
  it('setCurrentScale 写入后 getRiskConfig 读回新尺度（由【保存设置】调用，md §7.1）；非法值报「审核尺度不合法」', async () => {
    const cfg = await setCurrentScale('严格')
    expect(cfg.currentScale).toBe('严格')
    expect((await getRiskConfig()).currentScale).toBe('严格')
    await expect(setCurrentScale('随便')).rejects.toMatchObject({ message: '审核尺度不合法' })
  })

  it('saveRiskTemplate 只改指定尺度；选项须在该检测项可选集合内', async () => {
    const next = { 对外动作: '中风险', 敏感信息明文凭证: '高风险', 权限范围: '低风险', 危险操作: '不进入审核' }
    const cfg = await saveRiskTemplate('通用', next)
    expect(cfg.templates['通用']).toEqual(next)
    expect(cfg.templates['宽松']).toEqual(DEFAULT_RISK_TEMPLATES['宽松'])
    expect(cfg.templates['严格']).toEqual(DEFAULT_RISK_TEMPLATES['严格'])
    // 敏感信息 不允许 中风险（md §7.2 表一）
    expect(ITEM_RISK_OPTIONS['敏感信息明文凭证']).not.toContain('中风险')
    await expect(saveRiskTemplate('通用', { ...next, 敏感信息明文凭证: '中风险' })).rejects.toMatchObject({
      message: expect.stringContaining('不在可选范围内')
    })
    // 返回值是拷贝
    cfg.templates['通用']['对外动作'] = '严重风险'
    expect((await getRiskConfig()).templates['通用']['对外动作']).toBe('中风险')
  })

  it('needsManualAudit（md §2.3）：结果严重度 ≥ 配置最低等级即触发，「不进入审核」不参与', async () => {
    const d = await getReviewApplication('usr_1') // 对外动作 中风险 + 敏感信息 高风险
    const results = fullDetectionResults(d.risks)
    expect(needsManualAudit(results, DEFAULT_RISK_TEMPLATES['宽松'])).toBe(false)
    expect(needsManualAudit(results, DEFAULT_RISK_TEMPLATES['通用'])).toBe(false) // 敏感信息阈值 严重风险 > 高风险
    expect(needsManualAudit(results, DEFAULT_RISK_TEMPLATES['严格'])).toBe(true) // 对外动作阈值 中风险 ≤ 中风险
    const clean = fullDetectionResults([])
    expect(needsManualAudit(clean, DEFAULT_RISK_TEMPLATES['严格'])).toBe(false)
  })
})

/* ---------------- F9：restore 形状守卫（skillReviewMock.js:253-255；mockPersist 兜底回种子；2026-09-12 测试审计） ---------------- */
describe('skillReviewMock · 持久化 restore 形状守卫', () => {
  // 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
  // 与 positionMock.test 同款：注入内存版存储 + vi.resetModules + 动态 import 模拟「刷新后重新加载模块」。
  const KEY = 'iworker-demo-mock:skillReview'
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

  it('存量快照版本对但 riskConfig 缺失 → 启动时抛「快照形状不合法」被兜底：回种子 7 条 + 当前尺度「通用」、坏 key 被清掉', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 2, data: { reviews: [], riskConfig: null } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('../skillReviewMock')
    expect((await fresh.listReviewApplications({ page: 1, size: 50 })).total).toBe(7)
    expect((await fresh.getRiskConfig()).currentScale).toBe('通用')
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skillReview 存量数据不可用'), expect.any(Error))
    warn.mockRestore()
  })
})
