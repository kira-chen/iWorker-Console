/**
 * 岗位「工作档案 / 数据表」内存 mock（demo 数据层；开关同岗位工作台 VITE_POS_MOCK，见 dataTable.js 头注释）。
 *
 * 2026-09-02 岗位工作台补 mock：覆盖 PositionDetailTabs「工作档案」Tab（PositionDataTableStage）
 * 所调的全部端点：表列表/详情/建表/改表元信息/删表(含影响预检)/整表字段原子保存/工作档案配置读写。
 *
 * 种子与 positionMock 4 条岗位同源：401 经营分析岗、402 客户成功岗各 1 份档案（含卡位/规则/策略示意），
 * 403 财务审核岗 1 份空数据档案，404 市场研究岗无档案（空态演示）。字段/策略结构与
 * utils/dataTableTypes.js、utils/dossierConfig.js 校验口径一致（种子须能通过前端轻校验）。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const err = (message, { field = null, code = 40000, data = null } = {}) =>
  new ApiError({ code, message, field, data })

function nowIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`
  )
}

let tableSeq = 9101
let fieldSeq = 95001

const MAX_SLOTS = 8 // 与 utils/dataTableTypes MAX_SLOTS 同口径

/** uid 系统字段（后端建表自动追加；不参与业务校验与提交）。 */
function uidField() {
  return {
    id: fieldSeq++,
    fieldCode: 'uid',
    label: '记录ID',
    fieldType: 'TEXT',
    required: true,
    defaultValue: null,
    options: [],
    fieldDesc: '系统自动生成的记录唯一标识',
    slotRole: '',
    isPrimary: false,
    isSystem: true,
    sortOrder: 0
  }
}

function bizField(row, sortOrder) {
  return {
    id: fieldSeq++,
    fieldCode: row.fieldCode,
    label: row.label,
    fieldType: row.fieldType,
    required: !!row.required,
    defaultValue: row.defaultValue ?? null,
    options: Array.isArray(row.options) ? [...row.options] : [],
    fieldDesc: row.fieldDesc || '',
    slotRole: row.slotRole || '',
    isPrimary: !!row.isPrimary,
    isSystem: false,
    sortOrder
  }
}

function defaultPolicy() {
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

function buildSeed() {
  return {
    401: [
      {
        id: 9001,
        tableCode: 'business_review',
        label: '经营复盘档案',
        description: '按业务线沉淀经营数据结论与异常跟踪',
        status: 'active',
        recordCount: 12,
        refSkills: [{ id: 'sk_301', name: '日报周报生成' }],
        createdAt: '2026-08-14T10:00:00+08:00',
        updatedAt: '2026-08-25T15:40:00+08:00',
        fields: [
          uidField(),
          bizField({ fieldCode: 'biz_line', label: '业务线', fieldType: 'TEXT', required: true, slotRole: 'IDENTITY', isPrimary: true, fieldDesc: '档案对象名：业务线名称' }, 1),
          bizField({ fieldCode: 'owner', label: '负责人', fieldType: 'TEXT', required: true, slotRole: 'OWNER' }, 2),
          bizField({ fieldCode: 'review_date', label: '复盘日期', fieldType: 'DATE', required: false, slotRole: 'KEY_DATE' }, 3),
          bizField({ fieldCode: 'revenue', label: '当期营收（万元）', fieldType: 'DECIMAL', required: false, slotRole: 'AMOUNT' }, 4),
          bizField({ fieldCode: 'stage', label: '经营阶段', fieldType: 'ENUM', required: false, options: ['正常', '关注', '预警'], slotRole: 'LABEL' }, 5)
        ],
        dossier: {
          policy: defaultPolicy(),
          checklist: [
            { key: '异常指标', when: { type: 'ALWAYS' }, hint: '出现同比/环比异常时记录指标名与波动幅度' },
            { key: '整改动作', when: { type: 'EQUALS', field: 'stage', value: '预警' }, hint: '预警业务线必须沉淀整改动作与责任人' }
          ],
          reduceRules: [
            { key: '异常指标', desc: '只看最新一次异常结论', strategy: 'LATEST', params: { n: 5, staleAfterDays: null, normalize: true } },
            { key: '整改动作', desc: '累积形成整改清单', strategy: 'LIST', params: { n: 5, staleAfterDays: null, normalize: true } }
          ]
        }
      }
    ],
    402: [
      {
        id: 9002,
        tableCode: 'customer_visit',
        label: '客户拜访档案',
        description: '沉淀客户拜访过程、决策人及竞争信息',
        status: 'active',
        recordCount: 8,
        refSkills: [{ id: 'sk_305', name: '客户拜访准备' }],
        createdAt: '2026-08-16T09:30:00+08:00',
        updatedAt: '2026-08-24T11:20:00+08:00',
        fields: [
          uidField(),
          bizField({ fieldCode: 'customer_name', label: '客户名称', fieldType: 'TEXT', required: true, slotRole: 'IDENTITY', isPrimary: true }, 1),
          bizField({ fieldCode: 'owner', label: '客户负责人', fieldType: 'TEXT', required: true, slotRole: 'OWNER' }, 2),
          bizField({ fieldCode: 'next_visit', label: '下次拜访日期', fieldType: 'DATE', required: false, slotRole: 'KEY_DATE' }, 3),
          bizField({ fieldCode: 'budget', label: '预算金额（万元）', fieldType: 'DECIMAL', required: false, slotRole: 'AMOUNT' }, 4)
        ],
        dossier: {
          policy: { ...defaultPolicy(), confirmMode: 'ALL' },
          checklist: [
            { key: '决策人', when: { type: 'ALWAYS' }, hint: '记录拜访中出现的决策人姓名与角色' },
            { key: '竞争对手', when: { type: 'ALWAYS' }, hint: '客户提到的在谈竞品' }
          ],
          reduceRules: [
            { key: '决策人', desc: '决策人只增不减', strategy: 'LIST', params: { n: 5, staleAfterDays: null, normalize: true } },
            { key: '预算口径', desc: '预算变化保留冲突并列', strategy: 'CONFLICTS', params: { n: 5, staleAfterDays: 90, normalize: true } }
          ]
        }
      }
    ],
    403: [
      {
        id: 9003,
        tableCode: 'expense_audit',
        label: '报销审核底稿',
        description: '沉淀报销单核验结论与风险提示',
        status: 'active',
        recordCount: 0,
        refSkills: [],
        createdAt: '2026-08-21T14:00:00+08:00',
        updatedAt: '2026-08-21T14:00:00+08:00',
        fields: [
          uidField(),
          bizField({ fieldCode: 'expense_no', label: '报销单号', fieldType: 'TEXT', required: true, slotRole: 'IDENTITY', isPrimary: true }, 1),
          bizField({ fieldCode: 'risk_level', label: '风险等级', fieldType: 'ENUM', required: false, options: ['低', '中', '高'], slotRole: 'LABEL' }, 2)
        ],
        dossier: { policy: defaultPolicy(), checklist: [], reduceRules: [] }
      }
    ],
    404: []
  }
}

let tablesByPosition = buildSeed()

// 【持久化 2026-09-02】状态镜像到 localStorage；写点=下方各 persist() 调用处（只读与删表预检不落盘）。
// saveDataTableFields 里的 Map 是函数局部临时索引，不入快照。
const persist = attachPersist('dataTable', {
  version: 1,
  snapshot: () => ({ tableSeq, fieldSeq, tablesByPosition }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.tableSeq) || !Number.isFinite(d.fieldSeq) || typeof d.tablesByPosition !== 'object' || d.tablesByPosition === null) {
      throw new Error('dataTable 快照形状不合法')
    }
    tableSeq = d.tableSeq
    fieldSeq = d.fieldSeq
    tablesByPosition = d.tablesByPosition
  }
})

function listOf(positionId) {
  const key = String(positionId)
  if (!tablesByPosition[key]) tablesByPosition[key] = []
  return tablesByPosition[key]
}

function findTable(positionId, tableId) {
  return listOf(positionId).find((t) => String(t.id) === String(tableId))
}

function toRow(t) {
  return {
    id: t.id,
    tableCode: t.tableCode,
    label: t.label,
    description: t.description,
    status: t.status,
    fieldCount: t.fields.filter((f) => !f.isSystem).length,
    recordCount: t.recordCount,
    refSkillCount: (t.refSkills || []).length,
    updatedAt: t.updatedAt
  }
}

function cloneFields(fields) {
  return fields.map((f) => ({ ...f, options: [...(f.options || [])] }))
}

function cloneDossier(d) {
  return JSON.parse(JSON.stringify(d || { policy: defaultPolicy(), checklist: [], reduceRules: [] }))
}

/* ============================ 表（table） ============================ */

// 1.1 表列表
export async function listDataTables(positionId) {
  await delay()
  const list = listOf(positionId).map(toRow)
  return { list, total: list.length }
}

// 1.3 表详情（含 fields + dossier + refSkills）
export async function getDataTable(positionId, tableId) {
  await delay()
  const t = findTable(positionId, tableId)
  if (!t) throw err('工作档案不存在或已被删除', { code: 404 })
  return {
    id: t.id,
    positionId: Number(positionId),
    tableCode: t.tableCode,
    label: t.label,
    description: t.description,
    status: t.status,
    recordCount: t.recordCount,
    refSkills: (t.refSkills || []).map((s) => ({ ...s })),
    fields: cloneFields(t.fields),
    dossier: cloneDossier(t.dossier)
  }
}

// 1.2 建表（tableCode 可空 → 自动生成；重复 → TABLE_CODE_DUPLICATED）
export async function createDataTable(positionId, payload = {}) {
  await delay()
  const label = String(payload.label || '').trim()
  if (!label) throw err('对象类型名称必填', { field: 'label' })
  const list = listOf(positionId)
  let code = String(payload.tableCode || '').trim()
  if (!code) code = `table_${tableSeq}`
  if (list.some((t) => t.tableCode === code)) {
    throw err(`表编码已存在：${code}`, { field: 'tableCode', data: { errorCode: 'TABLE_CODE_DUPLICATED', field: 'tableCode' } })
  }
  const biz = Array.isArray(payload.fields) ? payload.fields : []
  if (biz.length > MAX_SLOTS) {
    throw err(`结构化卡位最多 ${MAX_SLOTS} 个`, { data: { errorCode: 'SLOT_LIMIT_EXCEEDED' } })
  }
  const now = nowIso()
  const t = {
    id: tableSeq++,
    tableCode: code,
    label,
    description: String(payload.description || '').trim(),
    status: 'active',
    recordCount: 0,
    refSkills: [],
    createdAt: now,
    updatedAt: now,
    fields: [
      uidField(),
      ...biz.map((f, i) => bizField({ ...f, fieldCode: f.fieldCode || `field_${fieldSeq}` }, i + 1))
    ],
    dossier: { policy: defaultPolicy(), checklist: [], reduceRules: [] }
  }
  list.push(t)
  persist()
  return { id: t.id, tableCode: t.tableCode, fields: cloneFields(t.fields) }
}

// 1.4 改表元信息（仅 label/description/status）
export async function updateDataTable(positionId, tableId, payload = {}) {
  await delay()
  const t = findTable(positionId, tableId)
  if (!t) throw err('工作档案不存在或已被删除', { code: 404 })
  if ('label' in payload) {
    const label = String(payload.label || '').trim()
    if (!label) throw err('对象类型名称必填', { field: 'label' })
    t.label = label
  }
  if ('description' in payload) t.description = String(payload.description || '').trim()
  if ('status' in payload && ['active', 'disabled'].includes(payload.status)) t.status = payload.status
  t.updatedAt = nowIso()
  persist()
  return toRow(t)
}

// 1.5 删表（api 层恒带 confirm=true；有数据 → 软删语义，demo 直接从列表移除）
export async function deleteDataTable(positionId, tableId) {
  await delay()
  const t = findTable(positionId, tableId)
  if (!t) throw err('工作档案不存在或已被删除', { code: 404 })
  tablesByPosition[String(positionId)] = listOf(positionId).filter((x) => x !== t)
  persist()
  return {}
}

// 1.9 删表影响预检
export async function getTableDeleteImpact(positionId, tableId) {
  await delay()
  const t = findTable(positionId, tableId)
  if (!t) throw err('工作档案不存在或已被删除', { code: 404 })
  return {
    affectedRows: t.recordCount,
    refSkills: (t.refSkills || []).map((s) => ({ ...s })),
    willSoftDelete: t.recordCount > 0
  }
}

/* ============================ 字段（field）原子批量保存 ============================ */

// 1.6 整表字段原子保存（diff 增/改/删；删有数据字段须 confirm，否则 FIELD_DELETE_NEED_CONFIRM）
export async function saveDataTableFields(positionId, tableId, fields, confirm = false) {
  await delay()
  const t = findTable(positionId, tableId)
  if (!t) throw err('工作档案不存在或已被删除', { code: 404 })
  const next = Array.isArray(fields) ? fields : []
  if (next.length > MAX_SLOTS) {
    throw err(`结构化卡位最多 ${MAX_SLOTS} 个`, { data: { errorCode: 'SLOT_LIMIT_EXCEEDED' } })
  }
  const oldCodes = t.fields.filter((f) => !f.isSystem).map((f) => f.fieldCode)
  const nextCodes = next.map((f) => f.fieldCode).filter(Boolean)
  const deleted = oldCodes.filter((c) => !nextCodes.includes(c))
  if (deleted.length && t.recordCount > 0 && !confirm) {
    throw err('删除的字段中含已有数据的字段，请确认后重试', {
      data: {
        errorCode: 'FIELD_DELETE_NEED_CONFIRM',
        affectedRows: t.recordCount,
        willSoftDelete: true,
        deleteFieldCodes: deleted
      }
    })
  }
  const oldByCode = new Map(t.fields.filter((f) => !f.isSystem).map((f) => [f.fieldCode, f]))
  const uid = t.fields.find((f) => f.isSystem) || uidField()
  t.fields = [
    uid,
    ...next.map((f, i) => {
      const code = f.fieldCode || `field_${fieldSeq}`
      const old = oldByCode.get(code)
      return {
        ...(old ? { id: old.id } : { id: fieldSeq++ }),
        fieldCode: code,
        label: f.label || '',
        fieldType: f.fieldType,
        required: !!f.required,
        defaultValue: f.defaultValue ?? null,
        options: Array.isArray(f.options) ? [...f.options] : [],
        fieldDesc: f.fieldDesc || '',
        slotRole: f.slotRole || '',
        isPrimary: !!f.isPrimary,
        isSystem: false,
        sortOrder: i + 1
      }
    })
  ]
  t.updatedAt = nowIso()
  persist()
  return {}
}

/* ============================ 工作档案配置（dossier） ============================ */

// 1.12 读配置（无行回默认）
export async function getDossierConfig(positionId, tableId) {
  await delay()
  const t = findTable(positionId, tableId)
  if (!t) throw err('工作档案不存在或已被删除', { code: 404 })
  return cloneDossier(t.dossier)
}

// 1.12 全量保存配置；响应回带归一化后的配置
export async function saveDossierConfig(positionId, tableId, payload = {}) {
  await delay()
  const t = findTable(positionId, tableId)
  if (!t) throw err('工作档案不存在或已被删除', { code: 404 })
  t.dossier = cloneDossier({
    policy: { ...defaultPolicy(), ...(payload.policy || {}) },
    checklist: payload.checklist || [],
    reduceRules: payload.reduceRules || []
  })
  t.updatedAt = nowIso()
  persist()
  return cloneDossier(t.dossier)
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetDataTableMock() {
  tableSeq = 9101
  fieldSeq = 95001
  tablesByPosition = buildSeed()
  persist()
}
