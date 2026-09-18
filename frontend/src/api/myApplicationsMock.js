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
// 2026-09-09 收编：本地「现在→分钟文本」复制品改引 utils/datetime 单一真相
import { nowMinuteText as now } from '@/utils/datetime'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const clone = (v) => JSON.parse(JSON.stringify(v))

/* ---------------- 种子 ----------------
 * 2026-09-18 R1 修复重写。规则：**每条「待审核」行必须与审核中心（reviewsMock 种子）同一笔、且与业务对象
 * 当前在途事项一致**；已通过 / 已驳回 / 已撤回的是历史记录，只需对象存在、版本号不与对象现状矛盾。
 * 原种子 501（api_1103 已发布却「首发待审」）、505（knowledge_hub「停用待审」而对象已发布且审核中心记的是首发）、
 * 506（biz_2102 实为待审却记「已通过」）、509（api_1101 无在途）四处不自洽，09-18 审查实测「通过审核后
 * 我的申请标错行」即由此而来。
 */
function seedRows() {
  const row = (r) => ({ submitter: 'config.admin', reviewedAt: '', reviewer: '', rejectReason: '', objectDeleted: false, ...r })
  return [
    // —— 待审核（与审核中心 id 1..12 逐笔对应）——
    row({ id: 501, refId: 'api_1102', objectName: '提交付款申请', description: '发起一笔付款申请并进入审批流', businessType: 'API', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-28 09:42', result: 'PENDING', versionNotes: '首次开放付款申请能力' }),
    row({ id: 505, refId: 'local_files', objectName: '本地文件 MCP', description: '读取工作区文件并执行受限文件操作', businessType: 'MCP', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-28 10:05', result: 'PENDING', versionNotes: '首次登记本地文件操作工具' }),
    row({ id: 506, refId: 'biz_2102', objectName: '人力资源系统', description: '员工、组织、请假和入转调离管理', businessType: 'BIZ_SYSTEM', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-27 18:34', result: 'PENDING', versionNotes: '首次接入用户端业务系统' }),
    row({ id: 509, refId: 'md_103', objectName: '企业视觉理解模型', description: '图片理解与多模态问答模型', businessType: 'MODEL', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-27 16:20', result: 'PENDING', versionNotes: '首次接入视觉理解模型' }),
    row({ id: 511, refId: 'kb_3', objectName: '法规与标准库', description: '行业法规、国标与行标条文检索，供合规与方案设计参考。', businessType: 'KNOWLEDGE_BASE', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-28 11:02', result: 'PENDING', versionNotes: '首次发布法规与标准知识库' }),
    row({ id: 512, refId: 403, objectName: '财务审核岗', description: '负责报销材料核验、财务单据检查与风险提示', businessType: 'POSITION', applicationType: 'FIRST_PUBLISH', version: 'v1.0.0', submittedAt: '2026-08-27 14:05', result: 'PENDING', versionNotes: '首个版本' }),
    row({ id: 513, refId: 204, objectName: '研究报告专家', description: '从公开资料生成行业研究与竞品报告', businessType: 'EXPERT', applicationType: 'VERSION_PUBLISH', version: 'v1.2.0', submittedAt: '2026-08-28 10:18', result: 'PENDING', versionNotes: '补充竞品对比维度' }),
    row({ id: 514, refId: 'sk_302', objectName: '经营数据分析', description: '读取经营数据并生成趋势分析和异常说明', businessType: 'SKILL', applicationType: 'VERSION_PUBLISH', version: 'v1.5.0', submittedAt: '2026-08-28 09:18', result: 'PENDING', versionNotes: '补充经营异常归因说明' }),
    row({ id: 515, refId: 'sk_309', objectName: '行业研究助手', description: '汇总行业资料、竞品动态并生成结构化研究结论', businessType: 'SKILL', applicationType: 'DELIST', version: 'v1.0.0', submittedAt: '2026-08-28 08:55', result: 'PENDING', versionNotes: '业务调整，申请停止该技能对外提供' }),
    // —— 历史记录（已通过 / 已驳回 / 已撤回）——
    row({ id: 502, refId: 201, objectName: '经营分析专家', description: '汇总经营数据，识别异常并形成管理建议', businessType: 'EXPERT', applicationType: 'VERSION_PUBLISH', version: 'v2.3.0', submittedAt: '2026-08-27 16:20', result: 'APPROVED', reviewedAt: '2026-08-27 17:05', reviewer: 'audit.admin', versionNotes: '补充经营异常识别与管理建议规则' }),
    row({ id: 503, refId: 401, objectName: '经营分析岗', description: '负责经营数据汇总、异常识别与经营分析报告输出', businessType: 'POSITION', applicationType: 'VERSION_PUBLISH', version: 'v2.2.0', submittedAt: '2026-08-27 15:10', result: 'REJECTED', reviewedAt: '2026-08-27 16:02', reviewer: 'audit.admin', versionNotes: '新增月度经营复盘和异常指标解释能力', rejectReason: '岗位说明未明确数据使用范围，请补充后重新提交。' }),
    row({ id: 504, refId: 'sk_309', objectName: '行业研究助手', description: '汇总行业资料、竞品动态并生成结构化研究结论', businessType: 'SKILL', applicationType: 'FIRST_PUBLISH', version: 'v1.0.0', submittedAt: '2026-08-17 11:42', result: 'APPROVED', reviewedAt: '2026-08-18 10:00', reviewer: 'audit.admin', versionNotes: '首次发布行业研究技能' }),
    row({ id: 507, refId: 'md_104', objectName: 'Kimi K2', description: '支持长上下文分析和文本生成的通用模型', businessType: 'MODEL', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-26 15:08', result: 'REJECTED', reviewedAt: '2026-08-26 16:30', reviewer: 'model.audit', versionNotes: '接入长上下文模型', rejectReason: '连通性验证未通过，请检查鉴权配置。' }),
    row({ id: 508, refId: 'sk_304', objectName: '合同风险检查', description: '识别合同条款中的风险点并给出说明', businessType: 'SKILL', applicationType: 'VERSION_PUBLISH', version: 'v1.1.1', submittedAt: '2026-08-25 10:12', result: 'PENDING', versionNotes: '补充违约条款识别规则' }),
    row({ id: 516, refId: 'sk_308', objectName: '报销单智能填报', description: '按发票信息自动填写并提交报销单', businessType: 'SKILL', applicationType: 'FIRST_PUBLISH', version: 'v1.0.0', submittedAt: '2026-08-25 09:30', result: 'PENDING', versionNotes: '首次发布' }),
    row({ id: 517, refId: 'crm', objectName: 'CRM MCP', description: '查询客户资料及商机状态', businessType: 'MCP', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-15 14:26', result: 'PENDING', versionNotes: '首次登记 CRM 查询工具' }),
    // md §四 L47「对应业务对象已被删除」样例：行保留、【查看】置灰。选终态行而非待审行（待审对象被删属异常数据）。
    row({ id: 510, refId: 'ex_gone_1', objectName: '合同审阅专员', description: '辅助审阅合同条款并识别法律风险', businessType: 'EXPERT', applicationType: 'DELIST', version: 'v1.3.0', submittedAt: '2026-08-24 10:18', result: 'WITHDRAWN', reviewedAt: '2026-08-24 10:46', reviewer: '—', versionNotes: '业务调整，申请停止专家对外提供', objectDeleted: true })
  ]
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
// version 6（2026-09-18 R1）：种子重写为与审核中心 / 业务对象逐笔一致，旧快照丢弃回种子。
const persist = attachPersist('myApplications', {
  version: 6,
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
 * 审核结论回写（2026-09-12 负责人决策 5（审计 J12））：审核中心通过 / 驳回后，把同一对象
 * （businessType + refId）仍待审的申请行置为已通过 / 已驳回，并记审核人、审核时间、驳回原因。
 *
 * md `prd.我的申请.md` §六 L87「每条申请保存：……审核结果、审核人、审核时间和驳回原因」、
 * §五 状态流转表（待审核 → 审核后为已通过 / 已驳回）。
 * 无匹配待审行（如种子里只有审核中心行、没有对应申请行）时静默跳过，不建新行
 * ——申请行只应由提交端 submitApplicationRow 创建。
 * @param {Object} p { businessType, refId, approved, reviewer, reviewedAt?, rejectReason? }
 * @returns {boolean} 是否命中并回写
 */
export function applyApplicationReviewResult(p = {}) {
  // 2026-09-18 R1：加申请类型匹配——同一对象若同时存在旧的停用申请与新的发布申请，不能张冠李戴
  const row = applications.find(
    (r) =>
      r.businessType === p.businessType &&
      String(r.refId) === String(p.refId) &&
      r.result === 'PENDING' &&
      (!p.applicationType || r.applicationType === p.applicationType)
  )
  if (!row) return false
  row.result = p.approved ? 'APPROVED' : 'REJECTED'
  row.reviewer = p.reviewer || ''
  row.reviewedAt = p.reviewedAt || now()
  row.rejectReason = p.approved ? '' : String(p.rejectReason || '').trim()
  persist()
  return true
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

/* ---------------- 撤回 / 重新提交：一律经业务模块（2026-09-18 R1） ----------------
 * 原实现只翻本表的 result，审核中心行与业务对象的 pendingAction 都不动：撤回后审核中心仍能通过并真的发布，
 * 重新提交后审核中心根本没这条。改为分发到各业务模块自己的撤回 / 提交入口——它们会经 reviewEnroll
 * 同时处理审核中心行与本表行，本表不再直接写状态。动态 import 原因同 reviewsMock LOADERS。
 */
const MODULES = {
  POSITION: () => import('./positionMock').then((m) => ({ withdraw: m.withdrawPosition, publish: (id, notes) => m.publishPosition(id, { releaseNotes: notes }), delist: m.unpublishPosition })),
  EXPERT: () => import('./domainExpertMock').then((m) => ({ withdraw: m.withdrawExpert, publish: (id, notes) => m.publishExpert(id, { releaseNotes: notes }), delist: m.unpublishExpert })),
  SKILL: () => import('./unifiedSkillMock').then((m) => ({ withdraw: m.withdrawPublish, publish: (id, notes) => m.publishSkill(id, { releaseNotes: notes }), delist: m.delistSkill })),
  KNOWLEDGE_BASE: () => import('./knowledgeBaseMock').then((m) => ({ withdraw: (id) => m.transition(id, "withdraw"), publish: (id) => m.transition(id, "publish"), delist: (id) => m.transition(id, "delist") })),
  MCP: () => import('./mcpConnectorMock').then((m) => ({ withdraw: m.withdrawMcpService, publish: m.publishMcpService, delist: m.delistMcpService })),
  API: () => import('./apiConnectorMock').then((m) => ({ withdraw: m.withdrawApi, publish: m.publishApi, delist: m.deactivateApi })),
  BIZ_SYSTEM: () => import('./bizSystemMock').then((m) => ({ withdraw: m.withdrawBizSystem, publish: m.publishBizSystem, delist: m.deactivateBizSystem })),
  MODEL: () => import('./adminModelMock').then((m) => ({ withdraw: m.withdrawModel, publish: m.publishModel, delist: m.delistModel }))
}

function conflict(message) {
  const err = new Error(message)
  err.code = 409
  return err
}

/**
 * 撤回：仅「待审核」可撤（md §五 状态流转表）。经业务模块撤回 → 模块摘审核中心行并把本行置「已撤回」。
 * md §七「撤回时申请已被审核 → 阻止撤回并刷新最新审核结果」：本行已非 PENDING、或对象已无在途事项
 * （另一端已审完）都按 409 拦下，页面 catch 后弹 toast + 重取列表。
 */
export async function withdrawMyApplication(id) {
  await delay()
  const row = findOr404(id)
  if (row.result !== 'PENDING') throw conflict('该申请已被审核，无法撤回，请查看最新审核结果')
  const mod = await MODULES[row.businessType]?.()
  if (!mod) throw conflict('该业务类型暂不支持撤回')
  try {
    await mod.withdraw(row.refId)
  } catch (e) {
    throw conflict('该申请已被审核，无法撤回，请查看最新审核结果')
  }
  // 模块撤回内部已调 withdrawApplicationRow；防御：模块侧没命中本行时补一刀
  if (row.result === 'PENDING') {
    row.result = 'WITHDRAWN'
    row.reviewedAt = now()
    row.reviewer = '—'
    persist()
  }
  return clone(row)
}

/**
 * 重新提交（md §4.3「重新生成待审核申请」）：仅「已驳回 / 已撤回」可重提；对象已删除不可重提；
 * 经业务模块重新走一遍提交发布 / 提交停用 → 模块经 reviewEnroll 生成**新的**待审申请行与审核中心行，
 * 原行保留为历史。同一对象已有在途申请时模块会拒绝（md §六 L89）。
 * @returns 新生成的申请行
 */
export async function resubmitMyApplication(id) {
  await delay()
  const row = findOr404(id)
  if (row.result !== 'REJECTED' && row.result !== 'WITHDRAWN') throw conflict('仅已驳回或已撤回的申请可重新提交')
  if (row.objectDeleted) throw conflict('该申请对应的业务对象已删除，无法重新提交')
  const mod = await MODULES[row.businessType]?.()
  if (!mod) throw conflict('该业务类型暂不支持重新提交')
  try {
    if (row.applicationType === 'DELIST') await mod.delist(row.refId)
    else await mod.publish(row.refId, row.versionNotes || '重新提交审核')
  } catch (e) {
    throw conflict(e?.message || '重新提交失败，请检查该对象当前状态')
  }
  const fresh = applications.find(
    (r) => r.businessType === row.businessType && String(r.refId) === String(row.refId) && r.result === 'PENDING'
  )
  return clone(fresh || row)
}
