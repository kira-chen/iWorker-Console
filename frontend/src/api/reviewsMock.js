/**
 * 审核中心内存 mock（2026-09-01 PRD 对齐改造，仅 DEV 生效，见 reviews.js 头注释）。
 *
 * 种子 12 行与各业务模块 mock 里「在审」的对象逐条对齐（2026-09-18 R1 重写，见 seedRows 注释）。列表口径：
 * - 只出待审核（status === 'PENDING_REVIEW'），无四态历史；
 * - keyword 过滤域 [name, description, submitterName]；
 * - 业务类型七项筛选（CONNECTOR_MCP/CONNECTOR_API 由 TOOL+subType 拆分）；
 * - requestAction（申请类型）筛选；submittedAt 排序（默认 desc）。
 *
 * refId 为前端 demo 附加的「原生详情」接线字段（原型无此字段）：每行指向对应业务模块 mock
 * 里真实存在的实体（打开即有内容），分发见 GovObjectDetail.vue 头注释。
 */
import { reviewTypeMatch } from '@/utils/reviewMeta'
import { attachPersist } from './mockPersist'
// 2026-09-09 收编：本地「现在→分钟文本」复制品改引 utils/datetime 单一真相
import { nowMinuteText as now } from '@/utils/datetime'
// 2026-09-12 负责人决策 5（审计 J12）：审核人取 demo 当前身份，不硬编码人名
import { currentDemoUserName } from '@/utils/demoIdentity'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const clone = (v) => JSON.parse(JSON.stringify(v))

/* ---------------- 种子 ----------------
 * 2026-09-18 R1 修复重写：每一行必须与其 refId 所指业务对象的**当前在途事项**逐字段一致
 * （申请类型同向、申请版本同号），否则审核落地会把停用当发布、或造出重复版本历史——09-18 逻辑审查
 * 发现原 9 行里 6 行对不上（行 1/8 指向已发布对象、行 3 把待审发布记成停用、行 5/7 版本号或类型错）。
 * 对齐来源（各 mock 种子里 pendingAction 非空的对象）：
 *   positionMock       403 财务审核岗        draft + PUBLISH v1.0.0（首发）
 *   domainExpertMock   204 研究报告专家      published v1.1.0 + PUBLISH v1.2.0
 *   unifiedSkillMock   sk_302 经营数据分析   published v1.4.0 + publish v1.5.0
 *                      sk_304 合同风险检查   published v1.1.0 + publish v1.1.1
 *                      sk_308 报销单智能填报 draft + publish v1.0.0（首发）
 *                      sk_309 行业研究助手   published v1.0.0 + stop（停用）
 *   apiConnectorMock   api_1102 提交付款申请 PENDING_REVIEW + PUBLISH（首发）
 *   bizSystemMock      biz_2102 人力资源系统 PENDING_REVIEW + PUBLISH（首发）
 *   adminModelMock     md_103 企业视觉理解模型 PENDING_REVIEW + PUBLISH（首发）
 *   mcpConnectorMock   local_files 本地文件 MCP / crm CRM MCP  PENDING_REVIEW + PUBLISH（首发）
 *   knowledgeBaseMock  kb_3 法规与标准库     DRAFT + PUBLISH（首发）
 * 名称 / 描述照对象本体（Q10 拍板：以业务模块种子为准）。id 保持 1..9 区间之外新增用 10+。
 */
function seedRows() {
  const row = (r) => ({ target: 'USER_END', submitterName: 'config.admin', submitterId: 12, status: 'PENDING_REVIEW', ...r })
  return [
    row({ id: 1, refId: 'api_1102', type: 'TOOL', subType: 'API', name: '提交付款申请', description: '创建付款申请并返回流程编号', requestAction: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-28 09:42', code: 'payment.apply', writeClass: 'WRITE', requiresConfirmation: true }),
    row({ id: 2, refId: 'sk_302', type: 'SKILL', platformSource: 'PLATFORM_CREATED', target: 'FDE_WORKBENCH', submitterName: 'li.na', submitterId: 2, name: '经营数据分析', description: '读取经营数据并生成趋势分析和异常说明', requestAction: 'VERSION_PUBLISH', version: 'v1.5.0', submittedAt: '2026-08-28 09:18' }),
    row({ id: 3, refId: 'biz_2102', type: 'BIZ_SYSTEM', name: '人力资源系统', description: '员工、组织、请假和入转调离管理', requestAction: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-27 18:34' }),
    row({ id: 4, refId: 'md_103', type: 'MODEL', subType: 'PUBLISH', submitterName: 'platform.admin', submitterId: 1, name: '企业视觉理解模型', description: '图片理解与多模态问答模型', requestAction: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-27 16:20' }),
    row({ id: 5, refId: 403, type: 'POSITION', target: 'FDE_WORKBENCH', submitterName: 'wangfang', submitterId: 4, name: '财务审核岗', description: '负责报销材料核验、财务单据检查与风险提示', requestAction: 'FIRST_PUBLISH', version: 'v1.0.0', submittedAt: '2026-08-27 14:05' }),
    row({ id: 6, refId: 204, type: 'EXPERT', name: '研究报告专家', description: '从公开资料生成行业研究与竞品报告', requestAction: 'VERSION_PUBLISH', version: 'v1.2.0', submittedAt: '2026-08-28 10:18' }),
    row({ id: 7, refId: 'sk_309', type: 'SKILL', platformSource: 'USER_UPLOADED', submitterName: 'zhangwei', submitterId: 1, name: '行业研究助手', description: '汇总行业资料、竞品动态并生成结构化研究结论', requestAction: 'DELIST', version: 'v1.0.0', submittedAt: '2026-08-28 08:55' }),
    row({ id: 8, refId: 'local_files', type: 'TOOL', subType: 'MCP', target: 'FDE_WORKBENCH', name: '本地文件 MCP', description: '读取工作区文件并执行受限文件操作', requestAction: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-28 10:05', code: 'local.files', writeClass: 'WRITE', requiresConfirmation: true }),
    row({ id: 9, refId: 'kb_3', type: 'KNOWLEDGE_BASE', name: '法规与标准库', description: '行业法规、国标与行标条文检索，供合规与方案设计参考。', requestAction: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-28 11:02' }),
    row({ id: 10, refId: 'sk_304', type: 'SKILL', platformSource: 'PLATFORM_CREATED', target: 'FDE_WORKBENCH', name: '合同风险检查', description: '识别合同条款中的风险点并给出说明', requestAction: 'VERSION_PUBLISH', version: 'v1.1.1', submittedAt: '2026-08-25 10:12' }),
    row({ id: 11, refId: 'sk_308', type: 'SKILL', platformSource: 'PLATFORM_CREATED', target: 'FDE_WORKBENCH', name: '报销单智能填报', description: '按发票信息自动填写并提交报销单', requestAction: 'FIRST_PUBLISH', version: 'v1.0.0', submittedAt: '2026-08-25 09:30' }),
    row({ id: 12, refId: 'crm', type: 'TOOL', subType: 'MCP', target: 'FDE_WORKBENCH', name: 'CRM MCP', description: '查询客户资料及商机状态', requestAction: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-15 14:26', code: 'crm.query', writeClass: 'READ', requiresConfirmation: false }),
    // 版本管理（客户端版本）：对应 versionMock 里 Mac v1.2.0（refId 7，审核中，提交前未发布，该终端已发布过 → 新版本发布）
    row({ id: 13, refId: 7, type: 'VERSION', submitterName: 'li.na', submitterId: 2, name: 'Mac v1.2.0', description: '新增记忆管理；修复深色模式下部分弹窗文字看不清的问题。', requestAction: 'VERSION_PUBLISH', version: 'v1.2.0', submittedAt: '2026-09-19 16:30' })
  ]
}

let reviews = seedRows()

/* ---------------- 提交端接线（2026-09-09 A6） ----------------
 * 各业务模块 mock 在「提交发布 / 提交停用」时调用 submitReviewRow 把自己挂进审核中心，
 * 「撤回」时调用 cancelReviewRow 摘掉。审核中心/我的申请只读不写业务数据，语义与 md
 * 「审核中心审核系统配置员提交的……知识库……发布、停用申请」一致。
 */

/** 生成新审核行 id（避开种子 1..9 与已有行）。 */
function nextReviewId() {
  return reviews.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1
}

/**
 * 提交端写入（同一 type+refId 已在审时覆盖，不重复建行）。
 * @param {Object} row { type, refId, name, description?, requestAction, version?, submitterName?, subType?, snapshot? }
 * @returns {Object} 写入后的审核行
 */
export function submitReviewRow(row = {}) {
  const key = (r) => `${r.type}:${r.refId}`
  const exist = reviews.find((r) => key(r) === key(row) && r.status === 'PENDING_REVIEW')
  const next = {
    id: exist?.id ?? nextReviewId(),
    target: 'USER_END',
    submitterName: 'config.admin',
    submitterId: 12,
    version: '—',
    ...row,
    status: 'PENDING_REVIEW',
    submittedAt: row.submittedAt || now()
  }
  if (exist) Object.assign(exist, next)
  else reviews = [next, ...reviews]
  persist()
  return clone(next)
}

/** 撤回：摘掉该对象仍在待审的行（无则静默）。 */
export function cancelReviewRow(type, refId) {
  const before = reviews.length
  reviews = reviews.filter(
    (r) => !(r.type === type && String(r.refId) === String(refId) && r.status === 'PENDING_REVIEW')
  )
  if (reviews.length !== before) persist()
}

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=approve / reject / reset。
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子。
// version 2（2026-09-08 原型复刻批次 2B · G-4）：POSITION 行 refId 改指岗位 mock 403，旧快照丢弃回种子。
// version 3（2026-09-09 PRD 复核 G3G6 · A6/A5）：种子补知识库在审行（id 9 → kb_3），
// 行结构增 snapshot 字段（岗位/专家/技能提交时由各业务模块写入），旧快照丢弃回种子。
// version 4（2026-09-09 PRD 复核 G2）：refId 借名缺陷修正 —— 种子 1/3/5 的 name/description 对齐
// 其 refId 所指实体本体，8 的 refId 由 spark_bridge_mcp 改指同名 knowledge_hub；旧快照丢弃回种子。
const persist = attachPersist('reviews', {
  // version 5（2026-09-09 发布前收口）：种子 6 由「法务审阅专家 203 · DELIST」改指
  // 「研究报告专家 204 · VERSION_PUBLISH」——203 是草稿态、永远补播不出审核快照。
  // version 6（2026-09-12 负责人决策 5 · 审计 J12）：行结构增 reviewer（审核人，md §5.1 L71 / §5.2 L82）；
  // 存量快照里已审的行没有该字段、且当时未联动业务对象与我的申请，三方会不自洽 → 丢弃回种子。
  // version 7（2026-09-18 R1）：种子重写为与各业务模块在审对象逐条一致（12 行），旧快照丢弃回种子。
  // version 8（2026-09-20）：新增业务类型「版本管理」（VERSION），种子补 id 13（Mac v1.2.0），旧快照丢弃回种子。
  version: 8,
  snapshot: () => ({ reviews }),
  restore: (d) => {
    if (!d || !Array.isArray(d.reviews)) {
      throw new Error('reviews 快照形状不合法')
    }
    reviews = d.reviews
  }
})

/** 测试专用：重置内存态。 */
export function resetReviewsMock() {
  reviews = seedRows()
  persist()
}

/**
 * 列表（只出待审核）。params: { keyword?, type?(七项), requestAction?, sortDir?('asc'|'desc')，page?, size? }
 * → { list, total }
 */
export async function listReviews(params = {}) {
  await delay()
  const q = String(params.keyword || '').toLowerCase()
  let list = reviews.filter(
    (r) =>
      r.status === 'PENDING_REVIEW' &&
      (!q || [r.name, r.description, r.submitterName].some((v) => String(v || '').toLowerCase().includes(q))) &&
      reviewTypeMatch(r, params.type) &&
      (!params.requestAction || r.requestAction === params.requestAction)
  )
  const dir = params.sortDir === 'asc' ? 1 : -1
  list = list.slice().sort((a, b) => dir * String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')))
  const total = list.length
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: clone(list.slice((page - 1) * size, page * size)), total }
}

function findOr404(id) {
  const row = reviews.find((r) => String(r.id) === String(id))
  if (!row) {
    const err = new Error('审核记录不存在')
    err.code = 404
    throw err
  }
  return row
}

/** 单条详情（技能整页只读吸底操作栏取行用）。 */
export async function getReview(id) {
  await delay(80)
  return clone(findOr404(id))
}

/* ---------------- 审核结论联动（2026-09-12 负责人决策 5（审计 J12）） ----------------
 * md `prd.审核中心.md` §5.1 L71「确认后记录审核人、审核时间和驳回原因，审核结果更新为已驳回」、
 * §5.2 L79-82「首次发布、新版本发布通过后，对象更新为已发布并启用相应版本；停用申请通过后，
 * 对象变为未发布 / 已下架……确认后记录审核人和审核时间」；`prd.我的申请.md` §六 L87
 * 「每条申请保存：……审核结果、审核人、审核时间和驳回原因」。
 *
 * 分发原则：审核中心只调各业务模块自己暴露的「应用审核结果」入口（applyXxxReviewResult），
 * 绝不直接改别的模块内部数组——各模块的落态规则写在各自 md 里，规则归属留在各自模块。
 *
 * 为什么是动态 import 而非顶层静态 import：knowledgeBaseMock / mcpConnectorMock 反向 import
 * 本模块（提交端接线），静态引会成环；且审核中心页不该把 8 个业务 mock 全部拉进首屏包。
 *
 * 【不要改成模块加载时预热】曾试过在本模块加载时就发起这些 import 以省掉首次点击的冷加载，
 * 结果 mcpConnectorMock.test.js（每例 vi.resetModules 取全新模块）成片翻红：该模块静态 import
 * 本模块，本模块加载期再反向 import 它，新旧实例互相穿插。保持「用到才引」这一条即无此问题。
 */
const LOADERS = {
  POSITION: () => import('./positionMock').then((m) => m.applyPositionReviewResult),
  EXPERT: () => import('./domainExpertMock').then((m) => m.applyExpertReviewResult),
  SKILL: () => import('./unifiedSkillMock').then((m) => m.applySkillReviewResult),
  KNOWLEDGE_BASE: () => import('./knowledgeBaseMock').then((m) => m.applyKnowledgeBaseReviewResult),
  MODEL: () => import('./adminModelMock').then((m) => m.applyModelReviewResult),
  BIZ_SYSTEM: () => import('./bizSystemMock').then((m) => m.applyBizSystemReviewResult),
  // 连接器两件套由 type=TOOL + subType 拆分（同列表筛选口径，见 utils/reviewMeta）
  'TOOL:MCP': () => import('./mcpConnectorMock').then((m) => m.applyMcpReviewResult),
  'TOOL:API': () => import('./apiConnectorMock').then((m) => m.applyApiReviewResult),
  // 版本管理（客户端版本，2026-09-20 新增）：发布必须走审核，通过 / 驳回经此落到版本自身
  VERSION: () => import('./versionMock').then((m) => m.applyVersionReviewResult)
}

/**
 * 把审核结论落到对应业务对象。
 * 2026-09-18 R1：不再「静默跳过」——各模块的 apply 会核对审核行的申请类型与对象自身在途事项是否同向
 * （见 reviewEnroll.reviewActionMatches），对不上 / 对象已无待审事项时返回 false，这里转成 409 抛出，
 * **审核行保持待审不动**。原实现先改审核行再落地，对象没落态也算「已审」，就是 09-18 审查里
 * 「通过后本体不动、我的申请却显示已通过」的根因。
 */
async function applyToBusinessObject(row, approved) {
  const load = LOADERS[row.type === 'TOOL' ? `TOOL:${row.subType}` : row.type]
  if (!load) throw conflict('该业务类型暂不支持审核落地')
  const apply = await load()
  const ok = typeof apply === 'function' && apply(row.refId, row.requestAction, approved)
  if (!ok) throw conflict('业务对象当前没有与本申请对应的待审事项（可能已被撤回或另行处理），请让提交人重新提交')
}

function conflict(message) {
  const err = new Error(message)
  err.code = 409
  return err
}

/** 已审结的行不能再审（md 审核中心 §七 L101「记录已被其他审核人处理 → 操作失败」）。 */
function assertPending(row) {
  if (row.status !== 'PENDING_REVIEW') throw conflict('该记录已被处理，请刷新列表')
}

/** 把审核结论同步到「我的申请」同 type+refId+申请类型 的待审行（含审核人 / 审核时间 / 驳回原因）。 */
async function applyToMyApplication(row, approved, reviewer, reviewedAt, rejectReason) {
  const { applyApplicationReviewResult } = await import('./myApplicationsMock')
  applyApplicationReviewResult({
    businessType: row.type === 'TOOL' ? row.subType : row.type,
    refId: row.refId,
    applicationType: row.requestAction,
    approved,
    reviewer,
    reviewedAt,
    rejectReason
  })
}

/**
 * 通过：审核行 DELIST → DELISTED / 其余 → PUBLISHED（原型 approveReview 口径，记录离开待审列表），
 * 同时记审核人与审核时间（md §5.2 L82），并联动业务对象与「我的申请」行（md §5.2 L79-80 / §六 L87）。
 */
export async function approveReview(id) {
  await delay()
  const row = findOr404(id)
  assertPending(row)
  await applyToBusinessObject(row, true) // 先落业务对象，落不上就整体失败，审核行不动
  row.status = row.requestAction === 'DELIST' ? 'DELISTED' : 'PUBLISHED'
  row.reviewer = currentDemoUserName()
  row.reviewedAt = now()
  persist()
  await applyToMyApplication(row, true, row.reviewer, row.reviewedAt, '')
  return clone(row)
}

/**
 * 驳回：必填驳回原因（空值由页面拦，mock 兜底再校验一次）；记审核人 / 审核时间 / 驳回原因，
 * 业务对象按申请类型回退、我的申请行转「已驳回」并带原因（md §5.1 L71 / §六 L87）。
 */
export async function rejectReview(id, reason) {
  await delay()
  const row = findOr404(id)
  const trimmed = String(reason || '').trim()
  if (!trimmed) {
    const err = new Error('请输入驳回原因')
    err.code = 400
    throw err
  }
  assertPending(row)
  await applyToBusinessObject(row, false) // 同 approve：先落业务对象
  row.status = 'REJECTED'
  row.rejectReason = trimmed
  row.reviewer = currentDemoUserName()
  row.reviewedAt = now()
  persist()
  await applyToMyApplication(row, false, row.reviewer, row.reviewedAt, trimmed)
  return clone(row)
}
