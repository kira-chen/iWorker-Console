/**
 * 业务系统（连接器 › 业务系统 tab）内存 mock（demo 数据层，模式同 apiConnectorMock.js；
 * 开关见 admin.js biz-systems 段头注释）。
 *
 * 模型与状态机对齐 PRD-20260828 交互原型 v2（renderBiz 终版 L803 / renderBizEditor L750+覆写）：
 * - 三态：未发布 NOT_PUBLISHED / 审核中 PENDING_REVIEW / 已发布 PUBLISHED；
 *   pendingAction 区分待审类型（PUBLISH 发布审核 / DEACTIVATE 停用审核），撤回按其恢复：
 *   待审发布撤回 → 未发布；待审停用撤回 → 已发布。停用审核通过 → 未发布。
 * - 搜索：name/description 模糊；状态筛选；按 updatedAt 排序（默认由近到远）。
 * - 删除：软引用——无论是否被技能引用均可删（确认影响后继续删）。
 * - 列表行内直接带 display 字段（status/pendingAction/refs/时间），
 *   免去旧版每行再拉 publication 的双请求编排。
 * - 字段：icon（必填）/ description（必填 ≤2000）/ loginUrl（必填 http(s)）/
 *   bizPages ≤20 / exampleQuestions 固定 3 条（每条 ≤60，保存须均非空）。
 *
 * 种子照原型 bizRows（L733-737，3 行覆盖三态）；示例问题种子照 L832、图标照 L842-844。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
// 2026-09-18 R1：发布 / 停用 → 审核中心 + 我的申请落行；撤回 → 摘行；审核落地前核对申请类型
import { enrollReview, unenrollReview, reviewActionMatches } from './reviewEnroll'
import { isBlankBizPage } from '@/utils/defValidate'

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let bizSeq = 2104
let skillSeq = 3

// 与 utils/defValidate.js 的同名 BIZ_QUESTION_MAX 同口径（mock 不 import utils，数值对齐即可；
// 2026-09-18 待办 yuepu#5⑥ 改口径时两处曾一度失配：这里卡在 60、defValidate 已经是 300，
// 导致输入框能填 300 字、保存却被这里拒——改这个值时务必同步另一处）
export const BIZ_QUESTION_MAX = 300

const mkBiz = (over) => ({
  id: over.id,
  name: '',
  icon: '',
  // 连接器类型（PRD §三.3：POSITION 岗位私有 / PLATFORM 市场连接器 / SYSTEM_DEFAULT 通用连接器）+
  // 所属岗位（仅 POSITION 时有意义）。两者创建后不可改，applyBizPayload 不碰这两个字段，只在
  // createBizSystem 里从 payload 落一次（2026-09-18 待办 yuepu#1）。
  type: 'PLATFORM',
  positionId: null,
  description: '',
  loginUrl: '',
  connType: 'login_session',
  bizPages: [], // [{ url, name, description }]
  exampleQuestions: ['', '', ''],
  referencedBySkills: [], // [{ skillId, skillName }]
  ownedSkills: [], // 业务系统专属技能 [{ skillId, name }]（BQ1 保留区块）
  status: 'NOT_PUBLISHED', // NOT_PUBLISHED / PENDING_REVIEW / PUBLISHED
  pendingAction: null, // null / 'PUBLISH' / 'DEACTIVATE'
  createdAt: null,
  updatedAt: null,
  publishedAt: null,
  ...over
})

// 原型 L832 示例问题种子（三行共用）
const SEED_QUESTIONS = ['帮我发起一个明天下午的请假审批', '帮我打开客户管理工作台', '帮我查询一份员工档案']

let bizRows = [
  // 原型 L734：已发布
  mkBiz({
    id: 'biz_2101',
    type: 'POSITION',
    positionId: 402,
    name: '客户管理系统 CRM',
    icon: '◎',
    description: '管理客户资料、商机与销售跟进',
    loginUrl: 'https://crm.example.com/login',
    bizPages: [
      { url: 'https://crm.example.com/workspace', name: '工作台', description: '客户与商机工作台' },
      { url: 'https://crm.example.com/customer', name: '客户详情', description: '查看客户完整资料' }
    ],
    exampleQuestions: [...SEED_QUESTIONS],
    referencedBySkills: [
      { skillId: 'sk_b1', skillName: '客户拜访准备' },
      { skillId: 'sk_b2', skillName: '销售方案生成' }
    ],
    ownedSkills: [{ skillId: 'sk_own_1', name: '客户跟进记录' }],
    status: 'PUBLISHED',
    createdAt: '2026-08-18T10:20:00+08:00',
    updatedAt: '2026-08-24T15:40:00+08:00',
    publishedAt: '2026-08-24T15:40:00+08:00'
  }),
  // 原型 L735：审核中（待审发布）
  mkBiz({
    id: 'biz_2102',
    name: '人力资源系统',
    icon: '▦',
    description: '员工、组织、请假和入转调离管理',
    loginUrl: 'https://hr.example.com/login',
    bizPages: [{ url: 'https://hr.example.com/employee', name: '员工档案', description: '员工信息页' }],
    exampleQuestions: [...SEED_QUESTIONS],
    referencedBySkills: [{ skillId: 'sk_b3', skillName: '员工信息查询' }],
    status: 'PENDING_REVIEW',
    pendingAction: 'PUBLISH',
    createdAt: '2026-08-20T09:05:00+08:00',
    updatedAt: '2026-08-24T11:32:00+08:00'
  }),
  // 原型 L736：未发布
  mkBiz({
    id: 'biz_2103',
    type: 'SYSTEM_DEFAULT',
    name: '合同管理系统',
    icon: '↗',
    description: '合同起草、审批、归档与风险跟踪',
    loginUrl: 'https://contract.example.com/login',
    bizPages: [],
    exampleQuestions: [...SEED_QUESTIONS],
    referencedBySkills: [],
    status: 'NOT_PUBLISHED',
    createdAt: '2026-08-22T16:18:00+08:00',
    updatedAt: '2026-08-22T16:18:00+08:00'
  })
]

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=新建/编辑/删除、
// 发布/撤回/停用/审核通过/驳回、专属技能增删。restore 做最小形状校验，快照不合法即抛错 → 兜底回种子。
// version 2（2026-09-18 待办 yuepu#1）：行新增 `type` / `positionId`（连接器类型/所属岗位），
//   旧快照没有这两个字段会让列表「连接器类型」列与筛选恒空 → 丢弃重播种。
const persist = attachPersist('bizSystem', {
  version: 2,
  snapshot: () => ({ bizSeq, skillSeq, bizRows }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.bizSeq) || !Number.isFinite(d.skillSeq) || !Array.isArray(d.bizRows)) {
      throw new Error('bizSystem 快照形状不合法')
    }
    bizSeq = d.bizSeq
    skillSeq = d.skillSeq
    bizRows = d.bizRows
  }
})

const findBiz = (id) => bizRows.find((b) => b.id === id)

// 出参行视图：带引用数与引用技能名清单（列表引用弹窗免二次请求）
function toRow(b) {
  const { ownedSkills, ...rest } = b
  return {
    ...rest,
    bizPages: (b.bizPages || []).map((p) => ({ ...p })),
    exampleQuestions: [0, 1, 2].map((i) => b.exampleQuestions?.[i] || ''),
    referencedBySkills: (b.referencedBySkills || []).map((s) => ({ ...s })),
    referencedBySkillCount: (b.referencedBySkills || []).length,
    refs: (b.referencedBySkills || []).map((s) => s.skillName),
    bizPagesCount: (b.bizPages || []).length,
    // 岗位私有类型的引用数：单 positionId 绑定 → 已绑定即 1（列表「N 个岗位引用」按钮态用）
    positionCount: b.positionId ? 1 : 0
  }
}

/* ================= 列表 / 详情 ================= */
export async function listBizSystems(params = {}) {
  await delay(200)
  const kw = (params.keyword || '').trim().toLowerCase()
  let list = bizRows
  if (kw) {
    // 原型 L805：按名称或描述模糊搜索
    list = list.filter(
      (b) => b.name.toLowerCase().includes(kw) || (b.description || '').toLowerCase().includes(kw)
    )
  }
  const state = params.state || params.status
  if (state) list = list.filter((b) => b.status === state)
  if (params.type) list = list.filter((b) => b.type === params.type)
  // 原型 L806：按最近更新时间排序（默认由近到远）
  const dir = params.sort === 'asc' ? 1 : -1
  list = [...list].sort((a, b) => dir * String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
  return { list: list.map(toRow), total: list.length }
}

export async function getBizSystem(id) {
  await delay(150)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  return toRow(b)
}

/* ================= 新建 / 编辑 / 删除 ================= */
function validateBizPayload(payload, selfId = null) {
  const name = (payload.name || '').trim()
  if (!name) throw err('系统名称必填', 'name')
  if (name.length > 64) throw err('系统名称最多 64 个字符', 'name')
  if (bizRows.some((b) => b.name === name && b.id !== selfId)) {
    throw err('系统名称平台内不可重复', 'name')
  }
  if (!payload.icon) throw err('请选择图标', 'icon')
  const description = (payload.description || '').trim()
  if (!description) throw err('系统描述必填', 'description')
  if (description.length > 2000) throw err('系统描述最多 2000 个字符', 'description')
  if (!/^https?:\/\//i.test((payload.loginUrl || '').trim())) {
    throw err('登录地址必须以 http:// 或 https:// 开头', 'loginUrl')
  }
  const pages = Array.isArray(payload.bizPages) ? payload.bizPages : []
  if (pages.length > 20) throw err('业务页最多 20 条', 'bizPages')
  const qs = [0, 1, 2].map((i) => (payload.exampleQuestions?.[i] || '').trim())
  if (qs.some((q) => !q)) throw err('示例问题固定 3 条，须全部填写', 'exampleQuestions')
  if (qs.some((q) => q.length > BIZ_QUESTION_MAX)) {
    throw err(`示例问题每条最多 ${BIZ_QUESTION_MAX} 个字符`, 'exampleQuestions')
  }
}

function applyBizPayload(b, payload) {
  b.name = payload.name.trim()
  b.icon = payload.icon || ''
  b.description = (payload.description || '').trim()
  b.loginUrl = (payload.loginUrl || '').trim()
  b.connType = 'login_session' // 连接方式只读（本期仅登录态托管一种）
  // 整行空白的业务页丢弃（2026-09-12 对齐 md 业务系统 §三.3 L108「自动丢弃空行」· 审计 K41）：
  // 与编辑器 buildPayload / validateBizSystemForm 共用 defValidate.isBlankBizPage，编辑器丢、mock 也丢，
  // 绕过 UI 直调 mock 时不会落进一条空行。
  b.bizPages = (Array.isArray(payload.bizPages) ? payload.bizPages : [])
    .filter((p) => !isBlankBizPage(p))
    .map((p) => ({
      url: (p?.url || '').trim(),
      name: (p?.name || '').trim(),
      description: (p?.description || '').trim()
    }))
  b.exampleQuestions = [0, 1, 2].map((i) => (payload.exampleQuestions?.[i] || '').trim())
}

export async function createBizSystem(payload) {
  await delay(250)
  validateBizPayload(payload)
  // 类型 + 所属岗位创建后不可更改（PRD），只在这里从 payload 落一次；applyBizPayload 不碰这两个字段
  const b = mkBiz({
    id: `biz_${bizSeq++}`,
    type: payload.type || 'PLATFORM',
    positionId: payload.type === 'POSITION' ? (payload.positionId ?? null) : null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  })
  applyBizPayload(b, payload)
  bizRows.push(b)
  persist()
  return toRow(b)
}

export async function updateBizSystem(id, payload) {
  await delay(250)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  validateBizPayload(payload, b.id)
  applyBizPayload(b, payload)
  b.updatedAt = nowIso()
  persist()
  return toRow(b)
}

export async function deleteBizSystem(id) {
  await delay(250)
  // 软引用（PRD 口径同 API 连接器）：被技能引用亦可删——列表侧已做「确认影响后继续删除」二次确认
  bizRows = bizRows.filter((b) => b.id !== id)
  persist()
  return {}
}

/* ================= 发布 / 撤回 / 停用（三态 + pendingAction 状态机） ================= */
export async function publishBizSystem(id) {
  await delay(250)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  if (b.status !== 'NOT_PUBLISHED') throw err('仅未发布状态可提交发布')
  b.status = 'PENDING_REVIEW'
  b.pendingAction = 'PUBLISH'
  enrollReview({ businessType: 'BIZ_SYSTEM', refId: b.id, name: b.name, description: b.description || '', requestAction: b.publishedAt ? 'VERSION_PUBLISH' : 'FIRST_PUBLISH', version: '—', versionNotes: '申请发布该业务系统' })
  persist()
  return toRow(b)
}

export async function withdrawBizSystem(id) {
  await delay(250)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  if (b.status !== 'PENDING_REVIEW') throw err('仅审核中状态可撤回')
  // 按待审类型恢复：待审发布 → 未发布；待审停用 → 已发布
  b.status = b.pendingAction === 'DEACTIVATE' ? 'PUBLISHED' : 'NOT_PUBLISHED'
  b.pendingAction = null
  unenrollReview('BIZ_SYSTEM', b.id)
  persist()
  return toRow(b)
}

export async function deactivateBizSystem(id) {
  await delay(250)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  if (b.status !== 'PUBLISHED') throw err('仅已发布状态可停用')
  // 停用走停用审核：状态转审核中，审核通过后变未发布（demo 停在审核中，可撤回恢复已发布）
  b.status = 'PENDING_REVIEW'
  b.pendingAction = 'DEACTIVATE'
  enrollReview({ businessType: 'BIZ_SYSTEM', refId: b.id, name: b.name, description: b.description || '', requestAction: 'DELIST', version: '—', versionNotes: '申请停止该业务系统对外提供' })
  persist()
  return toRow(b)
}

export async function approveBizSystem(id) {
  await delay(250)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  if (b.status !== 'PENDING_REVIEW') throw err('该业务系统没有待审事项')
  if (b.pendingAction === 'DEACTIVATE') {
    b.status = 'NOT_PUBLISHED'
  } else {
    b.status = 'PUBLISHED'
    b.publishedAt = nowIso()
  }
  b.pendingAction = null
  persist()
  return toRow(b)
}

export async function rejectBizSystem(id) {
  await delay(250)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  if (b.status !== 'PENDING_REVIEW') throw err('该业务系统没有待审事项')
  // 驳回与撤回同向：退回操作前原状（待审停用被拒 → 保持已发布）
  b.status = b.pendingAction === 'DEACTIVATE' ? 'PUBLISHED' : 'NOT_PUBLISHED'
  b.pendingAction = null
  persist()
  return toRow(b)
}

/**
 * 审核结果落地（2026-09-12 负责人决策 5（审计 J12））：由 reviewsMock.applyReviewResult 分发到此。
 * 复用上方既有的 approve/rejectBizSystem 状态机（不重复造），只抹掉 delay 与「无待审事项」抛错
 * ——审核中心分发到没有待审事项的对象时应静默跳过（返回 false），不该把审核动作整体打断。
 * md `prd-业务系统.md` §L46 / §L50。
 */
export function applyBizSystemReviewResult(refId, requestAction, approved) {
  const b = findBiz(refId)
  if (!b || b.status !== 'PENDING_REVIEW') return false
  if (requestAction && !reviewActionMatches(requestAction, b.pendingAction)) return false // 2026-09-18 R1
  const isDelist = b.pendingAction === 'DEACTIVATE'
  if (approved) {
    if (isDelist) {
      b.status = 'NOT_PUBLISHED'
    } else {
      b.status = 'PUBLISHED'
      b.publishedAt = nowIso()
    }
  } else {
    b.status = isDelist ? 'PUBLISHED' : 'NOT_PUBLISHED'
  }
  b.pendingAction = null
  persist()
  return true
}

/* ================= 业务系统专属技能（BQ1 保留区块，N8 第三类） ================= */
export async function listBizSystemSkills(id) {
  await delay(150)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  return b.ownedSkills.map((s) => ({ ...s }))
}

export async function createBizSystemOwnedSkill(id, payload = {}) {
  await delay(200)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  const name = (payload.name || '').trim()
  if (!name) throw err('技能名必填', 'name')
  // 名称类字段统一上限 64（2026-09-18 待办 yuepu#5④，与技能模块技能名同口径；此前无长度校验）
  if (name.length > 64) throw err('技能名最多 64 个字符', 'name')
  const skill = { skillId: `sk_own_${skillSeq++}`, name }
  b.ownedSkills.push(skill)
  persist()
  return { skillId: skill.skillId, name: skill.name }
}

export async function deleteBizSystemOwnedSkill(id, skillId) {
  await delay(200)
  const b = findBiz(id)
  if (!b) throw err('业务系统不存在')
  b.ownedSkills = b.ownedSkills.filter((s) => s.skillId !== skillId)
  persist()
  return {}
}

