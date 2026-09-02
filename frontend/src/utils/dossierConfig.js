/**
 * 工作档案·对象类型配置（沉淀策略 / 应沉淀清单 / 归纳规则）常量 + 默认值 + 前端轻校验 + 提交归一化。
 *
 * 与后端 DossierConfigService / DossierConfigVO 同口径（契约 §1.12）；后端是 schema 唯一守门人，
 * 前端只做「能一眼定位到行」的轻校验，错误 key 与后端 data.field 的点路径一致
 * （如 checklist[2].key / reduceRules[0].params.n / policy.pendingTtlDays）。
 */

/** 置信度档位（设计 §4.1 / §8.1）。 */
export const TIERS = [
  { value: 'HIGH', label: '高', hint: '原文直述 / 用户给出（目标撤销率 ≤ 10%）' },
  { value: 'MID', label: '中', hint: '一步推理（目标撤销率 ≤ 30%）' },
  { value: 'LOW', label: '低', hint: '语气推断（本来就要问）' }
]
const TIER_ORDER = ['LOW', 'MID', 'HIGH']

/** 归纳方式（设计 §6）。 */
export const REDUCE_STRATEGIES = [
  { value: 'LATEST', label: '取最新', hint: '会被替换的状态：客户态度、下次跟进、阶段标签' },
  { value: 'LIST', label: '累积成列表', hint: '只增不减的清单：决策人、竞争对手、痛点' },
  { value: 'SUMMARY', label: '摘要最近 N 条', hint: '看趋势的叙述性字段：竞争态势、风险' },
  { value: 'CONFLICTS', label: '保留冲突并列', hint: '变化即信号的数值 / 承诺：预算、报价、交付日期' }
]

/** 应沉淀项适用条件类型（设计 §1.5）。 */
export const CONDITION_TYPES = [
  { value: 'ALWAYS', label: '总是' },
  { value: 'EQUALS', label: '某卡位 = 值' },
  { value: 'IN', label: '某卡位 ∈ 取值' },
  { value: 'HAS', label: '档案里已有某键名' },
  { value: 'KEY_DATE_WITHIN', label: '关键日期在 N 天内' }
]

/** 用户确认方式（2026-08-28 管理端三选一）。 */
export const CONFIRM_MODES = [
  { value: 'LOW_ONLY', label: '低置信度需确认（推荐）', hint: '有把握的直接记；没把握的先问你' },
  { value: 'ALL', label: '全部需要确认', hint: '每一条都先问你再记' },
  { value: 'NONE', label: '不需要确认', hint: '达到阈值就直接记，低于阈值丢弃' }
]
/** 抽取方式（自动抽取 / 指定触发），对应 policy.autoExtract。 */
export const EXTRACT_MODES = [
  { value: true, label: '自动抽取', hint: '对话与任务过程中自动识别并沉淀，写入后在会话里告知并可撤销' },
  { value: false, label: '指定触发', hint: '只有用户明确要求「沉淀到 X」时才写入' }
]
/** 业务规则上限（与卡片字段对称，2026-08-28）。 */
export const MAX_RULES = 8

export const TTL_RANGE = { min: 1, max: 90 }
export const SUMMARY_N_RANGE = { min: 1, max: 50 }
export const STALE_DAYS_RANGE = { min: 1, max: 365 }
export const MAX_ITEMS = 50
export const MAX_KEY_LEN = 64
export const MAX_HINT_LEN = 500

export function defaultPolicy() {
  return {
    autoExtract: true,
    writeTier: 'MID',
    askTier: 'LOW',
    dropIfQuoteMissing: true,
    confirmSlotChange: true,
    confirmNewKey: false,
    pendingTtlDays: 7,
    confirmMode: 'LOW_ONLY'
  }
}

export function defaultDossierConfig() {
  return { policy: defaultPolicy(), checklist: [], reduceRules: [] }
}

export function emptyCondition(type = 'ALWAYS') {
  return { type, field: '', value: '', values: [], days: 30 }
}

export function emptyChecklistItem() {
  return { key: '', when: emptyCondition(), hint: '' }
}

export function emptyReduceRule() {
  return { key: '', desc: '', strategy: 'LATEST', params: { n: 5, staleAfterDays: null, normalize: true } }
}

/** 把后端返回（可能缺键 / null）整形成编辑态完整结构，便于 v-model 直接绑。 */
export function hydrateDossierConfig(raw) {
  const d = defaultDossierConfig()
  const src = raw || {}
  const policy = { ...d.policy, ...(src.policy || {}) }
  const checklist = (src.checklist || []).map((it) => {
    const w = it?.when || {}
    return {
      key: it?.key || '',
      when: {
        type: w.type || 'ALWAYS',
        field: w.field || '',
        value: w.value || '',
        values: Array.isArray(w.values) ? w.values.slice() : [],
        days: w.days ?? 30
      },
      hint: it?.hint || ''
    }
  })
  const reduceRules = (src.reduceRules || []).map((r) => {
    const p = r?.params || {}
    return {
      key: r?.key || '',
      desc: r?.desc || '',
      strategy: r?.strategy || 'LATEST',
      params: { n: p.n ?? 5, staleAfterDays: p.staleAfterDays ?? null, normalize: p.normalize ?? true }
    }
  })
  return { policy, checklist, reduceRules }
}

/**
 * 轻校验。返回 { ok, errors: { [dotPath]: msg } }。
 * dotPath 与后端 data.field 一致，组件按路径取错回显。
 */
export function validateDossierConfig(cfg) {
  const errors = {}
  const err = (path, msg) => {
    errors[path] = msg
  }
  const p = cfg?.policy || {}
  if (!TIER_ORDER.includes(p.writeTier)) err('policy.writeTier', '请选择直接入档线')
  if (!TIER_ORDER.includes(p.askTier)) err('policy.askTier', '请选择先问后写线')
  if (TIER_ORDER.includes(p.writeTier) && TIER_ORDER.includes(p.askTier)
    && TIER_ORDER.indexOf(p.askTier) > TIER_ORDER.indexOf(p.writeTier)) {
    err('policy.askTier', '先问后写线不能高于直接入档线')
  }
  if (!CONFIRM_MODES.some((m) => m.value === p.confirmMode)) err('policy.confirmMode', '请选择用户确认方式')
  const ttl = Number(p.pendingTtlDays)
  if (!Number.isInteger(ttl) || ttl < TTL_RANGE.min || ttl > TTL_RANGE.max) {
    err('policy.pendingTtlDays', `须为 ${TTL_RANGE.min}–${TTL_RANGE.max} 的整数`)
  }

  const seenKeys = new Set()
  ;(cfg?.checklist || []).forEach((it, i) => {
    const key = (it?.key || '').trim()
    if (!key) err(`checklist[${i}].key`, '应沉淀项不能为空')
    else if (key.length > MAX_KEY_LEN) err(`checklist[${i}].key`, `不超过 ${MAX_KEY_LEN} 字`)
    else if (seenKeys.has(key)) err(`checklist[${i}].key`, `重复：${key}`)
    seenKeys.add(key)
    const w = it?.when || { type: 'ALWAYS' }
    if (w.type && w.type !== 'ALWAYS') {
      if (!(w.field || '').trim()) err(`checklist[${i}].when.field`, '请选择条件引用的卡位/键名')
      if (w.type === 'EQUALS' && !(w.value || '').trim()) err(`checklist[${i}].when.value`, '请填比较值')
      if (w.type === 'IN' && !(w.values || []).some((v) => String(v).trim())) err(`checklist[${i}].when.values`, '至少一个取值')
      if (w.type === 'KEY_DATE_WITHIN') {
        const d = Number(w.days)
        if (!Number.isInteger(d) || d < 1 || d > STALE_DAYS_RANGE.max) err(`checklist[${i}].when.days`, `须为 1–${STALE_DAYS_RANGE.max} 的整数`)
      }
    }
    if ((it?.hint || '').length > MAX_HINT_LEN) err(`checklist[${i}].hint`, `不超过 ${MAX_HINT_LEN} 字`)
  })

  const seenRules = new Set()
  if ((cfg?.reduceRules || []).length > MAX_RULES) err('reduceRules', `业务规则最多 ${MAX_RULES} 条`)
  ;(cfg?.reduceRules || []).forEach((r, i) => {
    if ((r?.desc || '').length > 200) err(`reduceRules[${i}].desc`, '规则描述不超过 200 字')
    const key = (r?.key || '').trim()
    if (!key) err(`reduceRules[${i}].key`, '键名不能为空')
    else if (key.length > MAX_KEY_LEN) err(`reduceRules[${i}].key`, `不超过 ${MAX_KEY_LEN} 字`)
    else if (seenRules.has(key)) err(`reduceRules[${i}].key`, `同一键名只能配一条：${key}`)
    seenRules.add(key)
    if (!REDUCE_STRATEGIES.some((s) => s.value === r?.strategy)) err(`reduceRules[${i}].strategy`, '请选择归纳方式')
    if (r?.strategy === 'SUMMARY') {
      const n = Number(r?.params?.n)
      if (!Number.isInteger(n) || n < SUMMARY_N_RANGE.min || n > SUMMARY_N_RANGE.max) {
        err(`reduceRules[${i}].params.n`, `N 须为 ${SUMMARY_N_RANGE.min}–${SUMMARY_N_RANGE.max} 的整数`)
      }
    }
    if (r?.strategy === 'CONFLICTS') {
      const s = r?.params?.staleAfterDays
      if (s !== null && s !== undefined && s !== '') {
        const n = Number(s)
        if (!Number.isInteger(n) || n < STALE_DAYS_RANGE.min || n > STALE_DAYS_RANGE.max) {
          err(`reduceRules[${i}].params.staleAfterDays`, `须为 ${STALE_DAYS_RANGE.min}–${STALE_DAYS_RANGE.max} 的整数`)
        }
      }
    }
  })
  return { ok: Object.keys(errors).length === 0, errors }
}

/** 编辑态 → 提交 payload（去掉与条件/方式无关的冗余参数，避免后端归一化后出现"看起来没保存"的差异）。 */
export function normalizeDossierForSubmit(cfg) {
  const p = { ...defaultPolicy(), ...(cfg?.policy || {}) }
  const policy = {
    autoExtract: !!p.autoExtract,
    writeTier: p.writeTier,
    askTier: p.askTier,
    dropIfQuoteMissing: !!p.dropIfQuoteMissing,
    confirmSlotChange: !!p.confirmSlotChange,
    confirmNewKey: !!p.confirmNewKey,
    pendingTtlDays: Number(p.pendingTtlDays),
    confirmMode: p.confirmMode
  }
  const checklist = (cfg?.checklist || []).map((it) => {
    const w = it.when || { type: 'ALWAYS' }
    let when = { type: 'ALWAYS' }
    if (w.type === 'EQUALS') when = { type: 'EQUALS', field: (w.field || '').trim(), value: (w.value || '').trim() }
    else if (w.type === 'IN') when = { type: 'IN', field: (w.field || '').trim(), values: (w.values || []).map((v) => String(v).trim()).filter(Boolean) }
    else if (w.type === 'HAS') when = { type: 'HAS', field: (w.field || '').trim() }
    else if (w.type === 'KEY_DATE_WITHIN') when = { type: 'KEY_DATE_WITHIN', field: (w.field || '').trim(), days: Number(w.days) }
    return { key: (it.key || '').trim(), when, hint: (it.hint || '').trim() || null }
  })
  const reduceRules = (cfg?.reduceRules || []).map((r) => {
    const p2 = r.params || {}
    let params = null
    if (r.strategy === 'SUMMARY') params = { n: Number(p2.n) }
    else if (r.strategy === 'CONFLICTS') {
      params = { normalize: p2.normalize !== false }
      if (p2.staleAfterDays !== null && p2.staleAfterDays !== undefined && p2.staleAfterDays !== '') params.staleAfterDays = Number(p2.staleAfterDays)
    } else if (r.strategy === 'LIST') params = { normalize: p2.normalize !== false }
    return { key: (r.key || '').trim(), strategy: r.strategy, params, desc: (r.desc || '').trim() || null }
  })
  return { policy, checklist, reduceRules }
}

/** 用于脏检查的稳定快照（与 normalizeDossierForSubmit 同口径，避免默认值差异误报脏）。 */
export function dossierSnapshot(cfg) {
  return JSON.stringify(normalizeDossierForSubmit(cfg))
}
