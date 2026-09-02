import { describe, it, expect } from 'vitest'
import {
  defaultDossierConfig,
  hydrateDossierConfig,
  validateDossierConfig,
  normalizeDossierForSubmit,
  dossierSnapshot
} from '@/utils/dossierConfig'

/**
 * 工作档案配置工具（§1.12）：hydrate 补全 / 轻校验点路径与后端一致 / 提交归一化去冗余 / 快照稳定。
 */
describe('hydrateDossierConfig', () => {
  it('null → 全默认；缺键补默认', () => {
    const c = hydrateDossierConfig(null)
    expect(c).toEqual(defaultDossierConfig())
    const c2 = hydrateDossierConfig({ policy: { autoExtract: false }, checklist: [{ key: '决策人' }], reduceRules: [{ key: '预算', strategy: 'CONFLICTS' }] })
    expect(c2.policy.autoExtract).toBe(false)
    expect(c2.policy.writeTier).toBe('MID')
    expect(c2.checklist[0].when).toEqual({ type: 'ALWAYS', field: '', value: '', values: [], days: 30 })
    expect(c2.reduceRules[0].params).toEqual({ n: 5, staleAfterDays: null, normalize: true })
  })
})

describe('validateDossierConfig', () => {
  it('默认配置通过', () => {
    expect(validateDossierConfig(defaultDossierConfig()).ok).toBe(true)
  })
  it('先问后写线高于入档线 → policy.askTier', () => {
    const c = defaultDossierConfig()
    c.policy.askTier = 'HIGH'
    const r = validateDossierConfig(c)
    expect(r.ok).toBe(false)
    expect(r.errors['policy.askTier']).toBeTruthy()
  })
  it('保留天数越界 → policy.pendingTtlDays', () => {
    const c = defaultDossierConfig()
    c.policy.pendingTtlDays = 0
    expect(validateDossierConfig(c).errors['policy.pendingTtlDays']).toBeTruthy()
  })
  it('清单：空键 / 重复键 / 条件缺值 — 点路径与后端一致', () => {
    const c = hydrateDossierConfig({
      checklist: [
        { key: ' ' },
        { key: '报价', when: { type: 'EQUALS', field: '阶段标签' } },
        { key: '报价', when: { type: 'IN', field: '阶段标签', values: [] } },
        { key: '招标', when: { type: 'KEY_DATE_WITHIN', field: '', days: 0 } }
      ]
    })
    const r = validateDossierConfig(c)
    expect(r.errors['checklist[0].key']).toBeTruthy()
    expect(r.errors['checklist[1].when.value']).toBeTruthy()
    expect(r.errors['checklist[2].key']).toContain('重复')
    expect(r.errors['checklist[2].when.values']).toBeTruthy()
    expect(r.errors['checklist[3].when.field']).toBeTruthy()
    expect(r.errors['checklist[3].when.days']).toBeTruthy()
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
      checklist: [{ key: ' 决策人 ', when: { type: 'ALWAYS', field: 'x', value: 'y' }, hint: ' ' }],
      reduceRules: [
        { key: '客户态度', strategy: 'LATEST', params: { n: 3, normalize: true } },
        { key: '态势', strategy: 'SUMMARY', params: { n: 7, normalize: false } },
        { key: '预算', strategy: 'CONFLICTS', params: { n: 1, staleAfterDays: '' } }
      ]
    })
    const p = normalizeDossierForSubmit(c)
    expect(p.checklist[0]).toEqual({ key: '决策人', when: { type: 'ALWAYS' }, hint: null })
    expect(p.policy.confirmMode).toBe('LOW_ONLY')
    expect(p.reduceRules[0].params).toBeNull()
    expect(p.reduceRules[0].desc).toBeNull()
    expect(p.reduceRules[1].params).toEqual({ n: 7 })
    expect(p.reduceRules[2].params).toEqual({ normalize: true })
  })
  it('快照对默认值差异不敏感（hydrate 前后一致）', () => {
    const raw = { policy: {}, checklist: [], reduceRules: [] }
    expect(dossierSnapshot(hydrateDossierConfig(raw))).toBe(dossierSnapshot(defaultDossierConfig()))
  })
})
