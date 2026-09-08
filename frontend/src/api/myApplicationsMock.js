/**
 * 我的申请内存 mock（2026-09-01 PRD 对齐新增模块，仅 DEV 生效，见 myApplications.js 头注释）。
 *
 * 种子数据照交互原型 v2 五模块脚本的 `var myApplications=[…]` 10 条逐字抄录
 * （覆盖 7 类业务 × 4 种审核结果；原型样例第 8 条为 OTHER「用户技能审核规则」，2026-09-08 决议第 8 项
 * 「业务类型不含其他」——改为 SKILL「合同风险检查」新版本发布样例，refId 指向 unifiedSkillMock sk_304）。
 * 列表口径同原型 renderMyApplications：
 * - keyword 过滤域 [objectName, description]；
 * - businessType / applicationType / result 三个下拉筛选；
 * - submittedAt 排序（默认 desc）。
 * 写动作同原型：withdraw（撤回 → WITHDRAWN）/ resubmit（重新提交 → PENDING + 刷新申请时间
 * + 清空审核人/审核时间/驳回原因）。
 *
 * refId 为前端 demo 附加的「原生详情」接线字段（原型无此字段）：每行指向对应业务模块 mock
 * 里真实存在的实体，分发见 GovObjectDetail.vue。
 */
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const clone = (v) => JSON.parse(JSON.stringify(v))
const now = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------------- 种子（原型 var myApplications 逐字抄录） ---------------- */
function seedRows() {
  const rows = [
    { id: 501, objectName: '客户资料查询', description: '按客户编号读取客户基础信息和当前商机状态', businessType: 'API', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-28 10:30', result: 'PENDING', reviewedAt: '', submitter: 'config.admin', reviewer: '', versionNotes: '首次开放客户资料查询能力', rejectReason: '' },
    { id: 502, objectName: '经营分析专家', description: '汇总经营数据，识别异常并形成管理建议', businessType: 'EXPERT', applicationType: 'VERSION_PUBLISH', version: 'v1.2.0', submittedAt: '2026-08-27 16:20', result: 'APPROVED', reviewedAt: '2026-08-27 17:05', submitter: 'config.admin', reviewer: 'audit.admin', versionNotes: '补充经营异常识别与管理建议规则', rejectReason: '' },
    { id: 503, objectName: '经营分析岗', description: '负责经营数据汇总、异常识别与经营分析报告输出', businessType: 'POSITION', applicationType: 'VERSION_PUBLISH', version: 'v2.2.0', submittedAt: '2026-08-27 15:10', result: 'REJECTED', reviewedAt: '2026-08-27 16:02', submitter: 'config.admin', reviewer: 'audit.admin', versionNotes: '新增月度经营复盘和异常指标解释能力', rejectReason: '岗位说明未明确数据使用范围，请补充后重新提交。' },
    { id: 504, objectName: '行业研究助手', description: '汇总行业资料、竞品动态并生成结构化研究结论', businessType: 'SKILL', applicationType: 'FIRST_PUBLISH', version: 'v1.0.0', submittedAt: '2026-08-27 11:42', result: 'WITHDRAWN', reviewedAt: '2026-08-27 12:10', submitter: 'config.admin', reviewer: '—', versionNotes: '首次发布行业研究技能', rejectReason: '' },
    { id: 505, objectName: '企业知识库 MCP', description: '连接企业知识库并提供文档检索与内容读取能力', businessType: 'MCP', applicationType: 'DELIST', version: 'v3.4.0', submittedAt: '2026-08-28 09:55', result: 'PENDING', reviewedAt: '', submitter: 'config.admin', reviewer: '', versionNotes: '原服务即将迁移，申请停止旧 MCP 对外提供', rejectReason: '' },
    { id: 506, objectName: '人力资源系统', description: '员工、组织、请假和入转调离管理业务系统', businessType: 'BIZ_SYSTEM', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-26 18:20', result: 'APPROVED', reviewedAt: '2026-08-27 09:12', submitter: 'config.admin', reviewer: 'audit.admin', versionNotes: '首次接入用户端业务系统', rejectReason: '' },
    { id: 507, objectName: 'Kimi K2', description: '支持长上下文分析和文本生成的通用模型', businessType: 'MODEL', applicationType: 'VERSION_PUBLISH', version: 'v2.0.0', submittedAt: '2026-08-26 15:08', result: 'REJECTED', reviewedAt: '2026-08-26 16:30', submitter: 'config.admin', reviewer: 'model.audit', versionNotes: '更新模型标识和上下文窗口配置', rejectReason: '连通性验证未通过，请检查鉴权配置。' },
    { id: 508, objectName: '合同风险检查', description: '识别合同条款中的风险点并给出说明', businessType: 'SKILL', applicationType: 'VERSION_PUBLISH', version: 'v1.1.0', submittedAt: '2026-08-25 14:36', result: 'APPROVED', reviewedAt: '2026-08-25 16:08', submitter: 'config.admin', reviewer: 'audit.admin', versionNotes: '补充违约条款识别规则', rejectReason: '' },
    { id: 509, objectName: '报销单查询', description: '按报销单号查询审批状态、金额与当前处理节点', businessType: 'API', applicationType: 'VERSION_PUBLISH', version: 'v1.3.0', submittedAt: '2026-08-28 08:50', result: 'PENDING', reviewedAt: '', submitter: 'config.admin', reviewer: '', versionNotes: '增加审批节点和付款状态返回字段', rejectReason: '' },
    { id: 510, objectName: '法务审阅专家', description: '辅助审阅合同条款并识别法律风险', businessType: 'EXPERT', applicationType: 'DELIST', version: 'v1.3.0', submittedAt: '2026-08-24 10:18', result: 'WITHDRAWN', reviewedAt: '2026-08-24 10:46', submitter: 'config.admin', reviewer: '—', versionNotes: '业务调整，申请停止专家对外提供', rejectReason: '' }
  ]
  // demo 附加接线：原生详情的目标实体 id，指向各业务模块 mock 里真实存在的实体：
  //   501 → apiConnectorMock  api_1103      客户资料查询   502 → domainExpertMock 201 经营分析专家
  //   503 → positionMock      401           经营分析岗     504 → unifiedSkillMock sk_309 行业研究助手
  //   505 → mcpConnectorMock  knowledge_hub 企业知识库 MCP 506 → bizSystemMock   biz_2102 人力资源系统
  //   507 → adminModelMock    md_104        Kimi K2        508 → unifiedSkillMock sk_304 合同风险检查
  //   509 → apiConnectorMock  api_1101      报销单查询     510 → domainExpertMock 203 法务审阅专家
  //
  // 【2026-09-09 PRD 复核·G2 顺修：refId 借名缺陷已修正】原 502 名为「财税顾问专家」而 refId 指
  // 201「经营分析专家」、505「企业知识库 MCP」refId 却指 spark_bridge_mcp「星火智能体桥接 MCP」，
  // 点【查看】打开的详情与列表行名对不上。两名只出自已退役的交互原型 html（L1530），md 无依据 ——
  // 按 Q10 既定拍板以业务模块种子为准：502 改名/描述对齐 201 本体，505 改 refId 指向同名的 knowledge_hub。
  // 与 reviewsMock 同批修正，三方（我的申请 ↔ 各业务模块 ↔ 审核中心）现已同名。
  const REF = {
    501: 'api_1103',
    502: 201,
    503: 401,
    504: 'sk_309',
    505: 'knowledge_hub',
    506: 'biz_2102',
    507: 'md_104',
    508: 'sk_304',
    509: 'api_1101',
    510: 203
  }
  rows.forEach((r) => {
    r.refId = REF[r.id] ?? r.id
    // md §四 L47「对应业务对象已被删除时，不提供详情查看：【查看】按钮置灰，列表行保留该条申请记录
    // 及其对象名称、业务类型、申请类型、申请版本、申请时间与审核结果」。
    // demo 无真实删除链路，用显式标记表达该态（默认 false = 对象仍在）。
    r.objectDeleted = false
  })
  // 「对象已删除」样例（md §四 L47）：510 法务审阅专家的停用申请已处理完（WITHDRAWN），
  // 设为对象已删除 —— 行保留在列表、六个信息字段照常展示，仅【查看】置灰。
  // 选已终态行而非 PENDING 行：待审对象被删属异常数据，不作为常态样例。
  const deletedRow = rows.find((r) => r.id === 510)
  if (deletedRow) deletedRow.objectDeleted = true
  // 2026-09-09 PRD 复核 A6（Q265③）：知识库纳入发布审核 → 补一条知识库申请样例，
  // refId 指向 knowledgeBaseMock kb_3「法规与标准库」（该库种子即 pendingAction:'PUBLISH'，与审核中心 id 9 同一笔）
  rows.push({
    id: 511,
    objectName: '法规与标准库',
    description: '行业法规、国标与行标条文检索，供合规与方案设计参考。',
    businessType: 'KNOWLEDGE_BASE',
    applicationType: 'FIRST_PUBLISH',
    version: '—',
    submittedAt: '2026-08-28 11:02',
    result: 'PENDING',
    reviewedAt: '',
    submitter: 'config.admin',
    reviewer: '',
    versionNotes: '首次发布法规与标准知识库',
    rejectReason: '',
    refId: 'kb_3',
    objectDeleted: false
  })
  return rows
}

let applications = seedRows()

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=withdraw / resubmit / reset。
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子。
// version 2（2026-09-08 决议第 8 项）：种子 508 由 OTHER 改为 SKILL，旧快照丢弃回种子。
// version 3（2026-09-08 原型复刻批次 2B · G-4）：POSITION 行 503 refId 改指岗位 mock 401。
// version 4（2026-09-09 PRD 复核 G3G6 · A6/A5）：种子补知识库申请行 511（→ kb_3），
// 行结构增 snapshot 字段（岗位/专家/技能提交时由业务模块写入），旧快照丢弃回种子。
// version 5（2026-09-09 PRD 复核 G2）：行结构增 objectDeleted（md §四 L47【查看】置灰）；
// 502 改名「经营分析专家」、505 refId 改指 knowledge_hub（refId 借名缺陷修正），旧快照丢弃回种子。
const persist = attachPersist('myApplications', {
  version: 5,
  snapshot: () => ({ applications }),
  restore: (d) => {
    if (!d || !Array.isArray(d.applications)) {
      throw new Error('myApplications 快照形状不合法')
    }
    applications = d.applications
  }
})

/** 测试专用：重置内存态。 */
export function resetMyApplicationsMock() {
  applications = seedRows()
  persist()
}

/* ---------------- 提交端接线（2026-09-09 PRD 复核 A6） ----------------
 * 业务模块 mock 在「提交发布 / 提交停用」时调用 submitApplicationRow 记一条申请，
 * 「撤回」时调用 withdrawApplicationRow 把该行置为已撤回（md §3.1 审核结果四态含「已撤回」，
 * 行不删除——「列表行保留该条申请记录」）。本页只读展示，不写业务数据。
 */
function nextApplicationId() {
  return applications.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1
}

/**
 * 提交端写入（同一 businessType+refId 仍待审时覆盖，不重复建行）。
 * @param {Object} row { businessType, refId, objectName, description?, applicationType, version?, versionNotes? }
 */
export function submitApplicationRow(row = {}) {
  const same = (r) =>
    r.businessType === row.businessType && String(r.refId) === String(row.refId) && r.result === 'PENDING'
  const exist = applications.find(same)
  const next = {
    id: exist?.id ?? nextApplicationId(),
    version: '—',
    versionNotes: '',
    submitter: 'config.admin',
    objectDeleted: false, // 新提交的申请其对象必然存在（md §四 L47 的置灰态只对已删对象）
    ...row,
    submittedAt: row.submittedAt || now(),
    result: 'PENDING',
    reviewedAt: '',
    reviewer: '',
    rejectReason: ''
  }
  if (exist) Object.assign(exist, next)
  else applications = [next, ...applications]
  persist()
  return clone(next)
}

/** 撤回：把该对象仍待审的申请行置为已撤回（行保留，md §3.1）。 */
export function withdrawApplicationRow(businessType, refId) {
  const row = applications.find(
    (r) => r.businessType === businessType && String(r.refId) === String(refId) && r.result === 'PENDING'
  )
  if (!row) return
  row.result = 'WITHDRAWN'
  row.reviewedAt = now()
  row.reviewer = '—'
  persist()
}

/**
 * 列表。params: { keyword?, businessType?, applicationType?, result?, sortDir?('asc'|'desc'), page?, size? }
 * → { list, total }
 */
export async function listMyApplications(params = {}) {
  await delay()
  const q = String(params.keyword || '').toLowerCase()
  let list = applications.filter(
    (r) =>
      (!q || [r.objectName, r.description].some((v) => String(v || '').toLowerCase().includes(q))) &&
      (!params.businessType || r.businessType === params.businessType) &&
      (!params.applicationType || r.applicationType === params.applicationType) &&
      (!params.result || r.result === params.result)
  )
  const dir = params.sortDir === 'asc' ? 1 : -1
  list = list.slice().sort((a, b) => dir * String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')))
  const total = list.length
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: clone(list.slice((page - 1) * size, page * size)), total }
}

function findOr404(id) {
  const row = applications.find((r) => String(r.id) === String(id))
  if (!row) {
    const err = new Error('申请记录不存在')
    err.code = 404
    throw err
  }
  return row
}

/** 详情。 */
export async function getMyApplication(id) {
  await delay(80)
  return clone(findOr404(id))
}

/** 撤回（原型 withdraw 口径）：result → WITHDRAWN，审核人置「—」。 */
export async function withdrawMyApplication(id) {
  await delay()
  const row = findOr404(id)
  row.result = 'WITHDRAWN'
  row.reviewedAt = now()
  row.reviewer = '—'
  persist()
  return clone(row)
}

/** 重新提交（原型 submitAudit 口径）：result → PENDING，刷新申请时间，清空审核人/审核时间/驳回原因。 */
export async function resubmitMyApplication(id) {
  await delay()
  const row = findOr404(id)
  row.result = 'PENDING'
  row.submittedAt = now()
  row.reviewedAt = ''
  row.reviewer = ''
  row.rejectReason = ''
  persist()
  return clone(row)
}
