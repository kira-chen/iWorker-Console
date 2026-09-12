/**
 * 审核中心内存 mock（2026-09-01 PRD 对齐改造，仅 DEV 生效，见 reviews.js 头注释）。
 *
 * 种子数据照交互原型 v2 五模块脚本的 `var reviews=[…]` 8 条逐字抄录（含其后的
 * requestAction / version 补丁逻辑：id 3/6 → DELIST v2.0.0；id 1/4/8 → FIRST_PUBLISH —；
 * 其余 → VERSION_PUBLISH v1.2.0）。列表口径同原型 renderReviews：
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

/* ---------------- 种子（原型 var reviews 逐字抄录） ---------------- */
function seedRows() {
  const rows = [
    { id: 1, name: '客户资料查询', description: '按客户编号读取客户基础信息', type: 'TOOL', subType: 'API', target: 'USER_END', submitterName: 'config.admin', submitterId: 12, submittedAt: '2026-08-28 09:42', status: 'PENDING_REVIEW', code: 'customer.query', writeClass: 'READ', requiresConfirmation: false },
    { id: 2, name: '经营数据分析', description: '读取经营数据并生成趋势分析和异常说明', type: 'SKILL', platformSource: 'PLATFORM_CREATED', target: 'FDE_WORKBENCH', submitterName: 'li.na', submitterId: 2, submittedAt: '2026-08-28 09:18', status: 'PENDING_REVIEW' },
    { id: 3, name: '人力资源系统', description: '员工、组织、请假和入转调离管理', type: 'BIZ_SYSTEM', target: 'USER_END', submitterName: 'config.admin', submitterId: 12, submittedAt: '2026-08-27 18:34', status: 'PENDING_REVIEW' },
    { id: 4, name: 'Kimi K2', description: '长上下文文本生成模型', type: 'MODEL', subType: 'PUBLISH', target: 'USER_END', submitterName: 'platform.admin', submitterId: 1, submittedAt: '2026-08-27 16:20', status: 'PENDING_REVIEW' },
    { id: 5, name: '财务审核岗', description: '负责报销材料核验、财务单据检查与风险提示', type: 'POSITION', target: 'FDE_WORKBENCH', submitterName: 'wangfang', submitterId: 4, submittedAt: '2026-08-27 14:05', status: 'PENDING_REVIEW' },
    { id: 6, name: '研究报告专家', description: '从公开资料生成行业研究与竞品报告', type: 'EXPERT', target: 'USER_END', submitterName: 'config.admin', submitterId: 12, submittedAt: '2026-08-28 10:18', status: 'PENDING_REVIEW' },
    { id: 7, name: '行业研究助手', description: '由客户端用户上传的研究技能', type: 'SKILL', platformSource: 'USER_UPLOADED', target: 'USER_END', submitterName: 'zhangwei', submitterId: 1, submittedAt: '2026-08-28 08:55', status: 'PENDING_REVIEW' },
    { id: 8, name: '企业知识库 MCP', description: '连接企业知识库，提供文档检索与内容读取能力', type: 'TOOL', subType: 'MCP', target: 'FDE_WORKBENCH', submitterName: 'config.admin', submitterId: 12, submittedAt: '2026-08-28 10:05', status: 'PENDING_REVIEW', code: 'knowledge.search', writeClass: 'READ', requiresConfirmation: false }
  ]
  // 原型补丁逻辑逐字对应：申请类型与申请版本
  // 【2026-09-09 发布前收口】id 6（专家）原为 DELIST，但专家 mock 里没有任何「已发布 + 停用在审」
  // 的实体可指：203 是全套种子唯一的草稿样本（多处用例依赖，不能动），204 才是真正在审的那条，
  // 且它是 PUBLISH 方向。改指 204 并同步申请类型为 VERSION_PUBLISH，使审核中心与业务模块自洽
  // （原口径下审核快照永不补播，审核人点【查看】必撞「无法查看」）。
  rows.forEach((r) => {
    if (r.id === 3) {
      r.requestAction = 'DELIST'
      r.version = 'v2.0.0'
    } else if ([1, 4, 8].includes(r.id)) {
      r.requestAction = 'FIRST_PUBLISH'
      r.version = '—'
    } else {
      r.requestAction = 'VERSION_PUBLISH'
      // 2026-09-12 审计 K19：行 2 指向 sk_302，其在审版本已按「在审号必须由线上 v1.4.0 递增得出」
      // 改为 v1.5.0（unifiedSkillMock persist v4）；这里跟着取同一个号，否则列表显 v1.2.0、
      // 详情与审核快照显 v1.5.0，三方不自洽。其余行仍是 v1.2.0。
      r.version = r.id === 2 ? 'v1.5.0' : 'v1.2.0'
    }
  })
  // demo 附加接线：原生只读详情的目标实体 id，指向各业务模块 mock 里真实存在的实体：
  //   1 → apiConnectorMock api_1103 客户资料查询    2 → unifiedSkillMock sk_302 经营数据分析
  //   3 → bizSystemMock  biz_2102  人力资源系统     4 → adminModelMock   md_104 Kimi K2
  //   5 → positionMock   403       财务审核岗       6 → domainExpertMock 203    法务审阅专家
  //   7 → unifiedSkillMock sk_309  行业研究助手     8 → mcpConnectorMock knowledge_hub 企业知识库 MCP
  //
  // 【2026-09-09 PRD 复核·G2 顺修：refId 借名缺陷已修正】原种子 4 行的 name 与其 refId 所指实体不同名
  // （5「合同审阅专员」借 403 财务审核岗、1「客户数据查询 API」借 api_1103、3「企业人事系统」借 biz_2102、
  // 8「知识库检索 MCP」借 spark_bridge_mcp），点【查看】打开的只读抽屉与列表行名对不上。这些名只出自
  // 已退役的交互原型 html（L1539），md 无依据 —— 按 Q10 既定拍板（原型名与业务模块种子冲突时以业务模块
  // 为准，见 positionAssignmentMock / positionApplicationsMock 头注释）：name/description 对齐实体本体，
  // 8 另把 refId 改指同名的 knowledge_hub。三方（审核中心 ↔ 各业务模块 ↔ 我的申请）现已同名。
  const REF = {
    1: 'api_1103',
    2: 'sk_302',
    3: 'biz_2102',
    4: 'md_104',
    5: 403,
    6: 204, // 研究报告专家（唯一在审专家；原指 203 草稿态 → 无审核快照）
    7: 'sk_309',
    8: 'knowledge_hub'
  }
  rows.forEach((r) => {
    r.refId = REF[r.id] ?? r.id
  })
  // 2026-09-09 PRD 复核 A6（Q265③「知识库也需要发布审核，逻辑同 MCP/API/模型」；md §二.2/§3.1 业务类型含知识库）：
  // 补一条知识库在审种子，refId 指向 knowledgeBaseMock 的 kb_3「法规与标准库」（种子本就是 pendingAction:'PUBLISH'）。
  rows.push({
    id: 9,
    name: '法规与标准库',
    description: '行业法规、国标与行标条文检索，供合规与方案设计参考。',
    type: 'KNOWLEDGE_BASE',
    target: 'USER_END',
    submitterName: 'config.admin',
    submitterId: 12,
    submittedAt: '2026-08-28 11:02',
    status: 'PENDING_REVIEW',
    requestAction: 'FIRST_PUBLISH',
    version: '—',
    refId: 'kb_3'
  })
  return rows
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
  version: 6,
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
  'TOOL:API': () => import('./apiConnectorMock').then((m) => m.applyApiReviewResult)
}

/** 把审核结论落到对应业务对象；无对应模块 / 对象已无待审事项时静默跳过。 */
async function applyToBusinessObject(row, approved) {
  const load = LOADERS[row.type === 'TOOL' ? `TOOL:${row.subType}` : row.type]
  if (!load) return
  const apply = await load()
  if (typeof apply === 'function') apply(row.refId, row.requestAction, approved)
}

/** 把审核结论同步到「我的申请」同 type+refId 的待审行（含审核人 / 审核时间 / 驳回原因）。 */
async function applyToMyApplication(row, approved, reviewer, reviewedAt, rejectReason) {
  const { applyApplicationReviewResult } = await import('./myApplicationsMock')
  applyApplicationReviewResult({
    businessType: row.type === 'TOOL' ? row.subType : row.type,
    refId: row.refId,
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
  row.status = row.requestAction === 'DELIST' ? 'DELISTED' : 'PUBLISHED'
  row.reviewer = currentDemoUserName()
  row.reviewedAt = now()
  persist()
  await applyToBusinessObject(row, true)
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
  row.status = 'REJECTED'
  row.rejectReason = trimmed
  row.reviewer = currentDemoUserName()
  row.reviewedAt = now()
  persist()
  await applyToBusinessObject(row, false)
  await applyToMyApplication(row, false, row.reviewer, row.reviewedAt, trimmed)
  return clone(row)
}
