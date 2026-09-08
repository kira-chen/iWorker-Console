/**
 * 用户技能审核 · 模块词表与判定（2026-09-08 PRD-20260908 对齐，整页重做）。
 *
 * 权威来源：prd.用户技能审核.md §2（检测项 / 结果等级 / 触发条件）、§4.1（状态与尺度标签色）、
 * §7.2（各检测项可选等级集合 + 三套尺度默认值表）；原型 user-skill-audit 层 L4463–4467 常量。
 * 列表页 / 查看技能抽屉 / 风险设置抽屉 / mock 层四处共用，避免同一词表四处漂移。
 *
 * 【命名裁决】审核状态词全站统一「待审核」（负责人 2026-09-08 第 7 项②；md 仍写"待审批"，按裁决）。
 * 等级用 md §2.2 五档「检测通过 / 低风险 / 中风险 / 高风险 / 严重风险」；原型 L4476/L4505
 * 用旧命名（低危险 / 致命）致卡片不上色属原型缺陷，不搬。
 */

/* ---------------- 审核状态 / 审核尺度 ---------------- */

/** 审核状态：值为 mock/接口枚举，label 为展示词，tone 为标签色档（md §4.1：黄 / 绿 / 红） */
export const AUDIT_STATUS = [
  { value: 'PENDING', label: '待审核', tone: 'yellow' },
  { value: 'APPROVED', label: '已通过', tone: 'green' },
  { value: 'REJECTED', label: '已驳回', tone: 'red' }
]
export const auditStatusLabel = (v) => AUDIT_STATUS.find((s) => s.value === v)?.label || v || '—'
export const auditStatusTone = (v) => AUDIT_STATUS.find((s) => s.value === v)?.tone || 'grey'

/** 审核尺度（筛选下拉顺序 md §三：宽松 / 通用 / 严格；标签色 md §4.1：绿 / 蓝 / 红） */
export const AUDIT_SCALES = ['宽松', '通用', '严格']
const SCALE_TONE = { 宽松: 'green', 通用: 'blue', 严格: 'red' }
export const auditScaleTone = (s) => SCALE_TONE[s] || 'grey'

/** 风险设置 · 当前审查尺度单选顺序（md §7.1：通用、严格、宽松；默认「通用」） */
export const CURRENT_SCALE_OPTIONS = ['通用', '严格', '宽松']
export const DEFAULT_CURRENT_SCALE = '通用'

/* ---------------- 检测项 ---------------- */

/** 检测项固定顺序（md §2.1 / §5.3）。内部标识"敏感信息明文凭证"，页面展示"敏感信息"（md §2.1 注）。 */
export const DETECTION_ITEMS = ['对外动作', '敏感信息明文凭证', '权限范围', '危险操作']
export const detectionItemLabel = (item) => (item === '敏感信息明文凭证' ? '敏感信息' : item)

/** 检测项说明（md §2.1 表；风险设置表格「说明」列） */
export const ITEM_DESC = {
  对外动作: '技能中包含向外部系统发送请求或传输数据的操作',
  敏感信息明文凭证: '代码或配置中存在明文密码、API Key、Token 等敏感凭证',
  权限范围: '申请的权限超出业务场景所需的最小权限范围',
  危险操作: '包含可能造成不可逆影响的操作，如批量删除、全量更新等'
}

/* ---------------- 检测结果等级 ---------------- */

/** 五档结果（md §2.2，严重程度递增）；tone 为标签色档：绿 / 中性灰 / 橙黄 / 红 / 深红 */
export const RISK_LEVELS = [
  { value: '检测通过', tone: 'pass', severity: 1 },
  { value: '低风险', tone: 'low', severity: 2 },
  { value: '中风险', tone: 'medium', severity: 3 },
  { value: '高风险', tone: 'high', severity: 4 },
  { value: '严重风险', tone: 'fatal', severity: 5 }
]
export const RISK_LEVEL_NAMES = RISK_LEVELS.map((l) => l.value)
export const riskLevelTone = (level) => RISK_LEVELS.find((l) => l.value === level)?.tone || 'grey'
export const riskLevelSeverity = (level) => RISK_LEVELS.find((l) => l.value === level)?.severity || 0
export const isRiskLevel = (level) => RISK_LEVEL_NAMES.includes(level)

/** 检测通过时的依据文案（md §5.3：不代入内部名，四项统一） */
export const PASS_DETAIL = '未检测到该项相关风险'

/**
 * 把上报的风险列表补齐为固定 4 项（md §2.1：未命中的项也要展示"检测通过"）。
 * 输出顺序 = DETECTION_ITEMS；每项 { item, label, level, location, code, detail }。
 */
export function fullDetectionResults(risks = []) {
  return DETECTION_ITEMS.map((item) => {
    const hit = (risks || []).find((x) => x && x.item === item)
    if (hit && isRiskLevel(hit.level) && hit.level !== '检测通过') {
      return {
        item,
        label: detectionItemLabel(item),
        level: hit.level,
        location: hit.location || '',
        code: hit.code || '',
        detail: hit.detail || ''
      }
    }
    return { item, label: detectionItemLabel(item), level: '检测通过', location: '', code: '', detail: PASS_DETAIL }
  })
}

/* ---------------- 风险设置 · 模板 ---------------- */

export const NO_AUDIT = '不进入审核'

/** 各检测项可选的「触发审核的最低风险等级」（md §7.2 表一，顺序照表） */
export const ITEM_RISK_OPTIONS = {
  对外动作: ['严重风险', '高风险', '中风险', NO_AUDIT],
  敏感信息明文凭证: ['严重风险', '高风险', NO_AUDIT],
  权限范围: ['高风险', '中风险', '低风险', NO_AUDIT],
  危险操作: ['严重风险', '高风险', '中风险', '低风险', NO_AUDIT]
}

/** 三套尺度默认值（md §7.2 表二） */
export const DEFAULT_RISK_TEMPLATES = {
  宽松: { 对外动作: NO_AUDIT, 敏感信息明文凭证: NO_AUDIT, 权限范围: NO_AUDIT, 危险操作: NO_AUDIT },
  通用: { 对外动作: '高风险', 敏感信息明文凭证: '严重风险', 权限范围: '高风险', 危险操作: '高风险' },
  严格: { 对外动作: '中风险', 敏感信息明文凭证: '严重风险', 权限范围: '中风险', 危险操作: '中风险' }
}

/** 深拷贝一套模板（对象只有一层，逐项复制即可） */
export const cloneTemplate = (tpl) => Object.fromEntries(DETECTION_ITEMS.map((i) => [i, tpl?.[i] ?? NO_AUDIT]))

/**
 * 是否触发人工审核（md §2.3）：任一检测项结果严重程度 ≥ 该项配置的最低等级即触发；
 * 配置为「不进入审核」的项不参与。原型 L4476 因键名用旧命名而恒 false，此处按 md 实现。
 * @param {Array} results fullDetectionResults 的输出
 * @param {Object} template 某一尺度的模板 { [item]: level | NO_AUDIT }
 */
export function needsManualAudit(results, template) {
  return (results || []).some((r) => {
    const threshold = template?.[r.item]
    if (!threshold || threshold === NO_AUDIT) return false
    return riskLevelSeverity(r.level) >= riskLevelSeverity(threshold)
  })
}
