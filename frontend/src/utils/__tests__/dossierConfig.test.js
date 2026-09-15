import { describe, it, expect } from 'vitest'
import {
  defaultDossierConfig,
  hydrateDossierConfig,
  validateDossierConfig,
  normalizeDossierForSubmit,
  dossierSnapshot
} from '@/utils/dossierConfig'

/**
 * 工作档案配置工具（utils/dossierConfig）：hydrate 补全 / 轻校验点路径 / 提交归一化去冗余 / 快照稳定。
 * 对齐 md 岗位 §4.2.3 档案详情（reduceRules：规则名 / 规则描述 / 归纳方式）；原头注引用的「契约 §1.12」已随后端退役废止。
 * 2026-09-12 负责人决策 6（审计 J13）：md §4.2.1 的配置控件只有抽取方式 / 置信度阈值 / 用户确认，
 * checklist、policy.askTier、policy.pendingTtlDays 三套遗留模型已从工具与 mock 中清除，相关用例随之删除。
 */
describe('hydrateDossierConfig', () => {
  it('null → 全默认；缺键补默认（md §4.2.1 只剩三项配置 + reduceRules）', () => {
    const c = hydrateDossierConfig(null)
    expect(c).toEqual(defaultDossierConfig())
    const c2 = hydrateDossierConfig({ policy: { autoExtract: false }, reduceRules: [{ key: '预算', strategy: 'CONFLICTS' }] })
    expect(c2.policy.autoExtract).toBe(false)
    expect(c2.policy.writeTier).toBe('MID')
    expect(c2.reduceRules[0].params).toEqual({ n: 5, staleAfterDays: null, normalize: true })
  })
  it('已退役字段不再出现在结构里 → 无 checklist / askTier / pendingTtlDays（md §4.2.1）', () => {
    const c = hydrateDossierConfig(null)
    expect(c.checklist).toBeUndefined()
    expect(c.policy.askTier).toBeUndefined()
    expect(c.policy.pendingTtlDays).toBeUndefined()
  })
})

describe('validateDossierConfig', () => {
  it('默认配置通过', () => {
    expect(validateDossierConfig(defaultDossierConfig()).ok).toBe(true)
  })
  it('置信度阈值非法 → policy.writeTier（md §4.2.1 置信度阈值）', () => {
    const c = defaultDossierConfig()
    c.policy.writeTier = 'SUPER'
    const r = validateDossierConfig(c)
    expect(r.ok).toBe(false)
    expect(r.errors['policy.writeTier']).toBeTruthy()
  })
  it('规则：超过 8 条 → reduceRules；确认方式非法 → policy.confirmMode', () => {
    const c = hydrateDossierConfig({ reduceRules: Array.from({ length: 9 }, (_, i) => ({ key: 'k' + i, strategy: 'LATEST' })) })
    c.policy.confirmMode = 'MAYBE'
    const r = validateDossierConfig(c)
    expect(r.errors.reduceRules).toBeTruthy()
    expect(r.errors['policy.confirmMode']).toBeTruthy()
  })
  it('规则：重复键 / SUMMARY N 越界 / CONFLICTS 天数越界', () => {
    const c = hydrateDossierConfig({
      reduceRules: [
        { key: '预算', strategy: 'LATEST' },
        { key: '预算', strategy: 'LIST' },
        { key: '态势', strategy: 'SUMMARY', params: { n: 0 } },
        { key: '报价', strategy: 'CONFLICTS', params: { staleAfterDays: 400 } }
      ]
    })
    const r = validateDossierConfig(c)
    expect(r.errors['reduceRules[1].key']).toBeTruthy()
    expect(r.errors['reduceRules[2].params.n']).toBeTruthy()
    expect(r.errors['reduceRules[3].params.staleAfterDays']).toBeTruthy()
  })
})

describe('normalizeDossierForSubmit / dossierSnapshot', () => {
  it('去掉与条件 / 方式无关的冗余参数；ALWAYS 只留 type', () => {
    const c = hydrateDossierConfig({
      reduceRules: [
        { key: '客户态度', strategy: 'LATEST', params: { n: 3, normalize: true } },
        { key: '态势', strategy: 'SUMMARY', params: { n: 7, normalize: false } },
        { key: '预算', strategy: 'CONFLICTS', params: { n: 1, staleAfterDays: '' } }
      ]
    })
    const p = normalizeDossierForSubmit(c)
    expect(p.checklist).toBeUndefined()
    expect(p.policy.confirmMode).toBe('LOW_ONLY')
    expect(p.reduceRules[0].params).toBeNull()
    expect(p.reduceRules[0].desc).toBeNull()
    expect(p.reduceRules[1].params).toEqual({ n: 7 })
    expect(p.reduceRules[2].params).toEqual({ normalize: true })
  })
  it('快照对默认值差异不敏感（hydrate 前后一致）', () => {
    const raw = { policy: {}, reduceRules: [] }
    expect(dossierSnapshot(hydrateDossierConfig(raw))).toBe(dossierSnapshot(defaultDossierConfig()))
  })
})
