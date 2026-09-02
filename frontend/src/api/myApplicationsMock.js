/**
 * 我的申请内存 mock（2026-09-01 PRD 对齐新增模块，仅 DEV 生效，见 myApplications.js 头注释）。
 *
 * 种子数据照交互原型 v2 五模块脚本的 `var myApplications=[…]` 10 条逐字抄录
 * （覆盖 7 类业务 × 4 种审核结果，含一条 OTHER）。列表口径同原型 renderMyApplications：
 * - keyword 过滤域 [objectName, description]；
 * - businessType / applicationType / result 三个下拉筛选；
 * - submittedAt 排序（默认 desc）。
 * 写动作同原型：withdraw（撤回 → WITHDRAWN）/ resubmit（重新提交 → PENDING + 刷新申请时间
 * + 清空审核人/审核时间/驳回原因）。
 *
 * refId 为前端 demo 附加的「原生详情」接线字段（原型无此字段）：MCP/API 指向连接器
 * mock 里真实存在的实体；其余类型 demo 期无对应 mock，详情降级见 GovObjectDetail.vue。
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
    { id: 502, objectName: '财税顾问专家', description: '为企业财税问题提供政策解读、风险判断和材料建议', businessType: 'EXPERT', applicationType: 'VERSION_PUBLISH', version: 'v1.2.0', submittedAt: '2026-08-27 16:20', result: 'APPROVED', reviewedAt: '2026-08-27 17:05', submitter: 'config.admin', reviewer: 'audit.admin', versionNotes: '补充增值税风险识别和申报材料建议', rejectReason: '' },
    { id: 503, objectName: '经营分析岗', description: '负责经营数据汇总、异常识别与经营分析报告输出', businessType: 'POSITION', applicationType: 'VERSION_PUBLISH', version: 'v2.2.0', submittedAt: '2026-08-27 15:10', result: 'REJECTED', reviewedAt: '2026-08-27 16:02', submitter: 'config.admin', reviewer: 'audit.admin', versionNotes: '新增月度经营复盘和异常指标解释能力', rejectReason: '岗位说明未明确数据使用范围，请补充后重新提交。' },
    { id: 504, objectName: '行业研究助手', description: '汇总行业资料、竞品动态并生成结构化研究结论', businessType: 'SKILL', applicationType: 'FIRST_PUBLISH', version: 'v1.0.0', submittedAt: '2026-08-27 11:42', result: 'WITHDRAWN', reviewedAt: '2026-08-27 12:10', submitter: 'config.admin', reviewer: '—', versionNotes: '首次发布行业研究技能', rejectReason: '' },
    { id: 505, objectName: '企业知识库 MCP', description: '连接企业知识库并提供文档检索与内容读取能力', businessType: 'MCP', applicationType: 'DELIST', version: 'v3.4.0', submittedAt: '2026-08-28 09:55', result: 'PENDING', reviewedAt: '', submitter: 'config.admin', reviewer: '', versionNotes: '原服务即将迁移，申请停止旧 MCP 对外提供', rejectReason: '' },
    { id: 506, objectName: '人力资源系统', description: '员工、组织、请假和入转调离管理业务系统', businessType: 'BIZ_SYSTEM', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-26 18:20', result: 'APPROVED', reviewedAt: '2026-08-27 09:12', submitter: 'config.admin', reviewer: 'audit.admin', versionNotes: '首次接入用户端业务系统', rejectReason: '' },
    { id: 507, objectName: 'Kimi K2', description: '支持长上下文分析和文本生成的通用模型', businessType: 'MODEL', applicationType: 'VERSION_PUBLISH', version: 'v2.0.0', submittedAt: '2026-08-26 15:08', result: 'REJECTED', reviewedAt: '2026-08-26 16:30', submitter: 'config.admin', reviewer: 'model.audit', versionNotes: '更新模型标识和上下文窗口配置', rejectReason: '连通性验证未通过，请检查鉴权配置。' },
    { id: 508, objectName: '用户技能审核规则', description: '用户上传技能的安全检测与风险分级规则', businessType: 'OTHER', applicationType: 'VERSION_PUBLISH', version: 'v1.1.0', submittedAt: '2026-08-25 14:36', result: 'APPROVED', reviewedAt: '2026-08-25 16:08', submitter: 'config.admin', reviewer: 'audit.admin', versionNotes: '更新风险类型和风险等级字典', rejectReason: '' },
    { id: 509, objectName: '报销单查询', description: '按报销单号查询审批状态、金额与当前处理节点', businessType: 'API', applicationType: 'VERSION_PUBLISH', version: 'v1.3.0', submittedAt: '2026-08-28 08:50', result: 'PENDING', reviewedAt: '', submitter: 'config.admin', reviewer: '', versionNotes: '增加审批节点和付款状态返回字段', rejectReason: '' },
    { id: 510, objectName: '法务审阅专家', description: '辅助审阅合同条款并识别法律风险', businessType: 'EXPERT', applicationType: 'DELIST', version: 'v1.3.0', submittedAt: '2026-08-24 10:18', result: 'WITHDRAWN', reviewedAt: '2026-08-24 10:46', submitter: 'config.admin', reviewer: '—', versionNotes: '业务调整，申请停止专家对外提供', rejectReason: '' }
  ]
  // demo 附加接线：原生详情的目标实体 id，指向各业务模块 mock 里真实存在的实体
  // （API/MCP → 连接器 mock；EXPERT → domainExpertMock（502 无同名专家，借 201 经营分析专家示意，
  //  510 → 203 法务审阅专家）；MODEL → adminModelMock md_104 Kimi K2；BIZ_SYSTEM → bizSystemMock
  //  biz_2102 人力资源系统；SKILL → unifiedSkillMock sk_309 行业研究助手。
  //  POSITION 走本地简易只读抽屉、OTHER 走 toast，refId 不消费）
  const REF = {
    501: 'api_1103',
    502: 201,
    504: 'sk_309',
    505: 'spark_bridge_mcp',
    506: 'biz_2102',
    507: 'md_104',
    509: 'api_1101',
    510: 203
  }
  rows.forEach((r) => {
    r.refId = REF[r.id] ?? r.id
  })
  return rows
}

let applications = seedRows()

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=withdraw / resubmit / reset。
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子。
const persist = attachPersist('myApplications', {
  version: 1,
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
