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
 * refId 为前端 demo 附加的「原生详情」接线字段（原型无此字段）：MCP/API 指向连接器
 * mock 里真实存在的实体（打开即有内容）；其余类型 demo 期无对应 mock，详情降级见
 * GovObjectDetail.vue 头注释。
 */
import { reviewTypeMatch } from '@/utils/reviewMeta'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const clone = (v) => JSON.parse(JSON.stringify(v))
const now = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------------- 种子（原型 var reviews 逐字抄录） ---------------- */
function seedRows() {
  const rows = [
    { id: 1, name: '客户数据查询 API', description: '查询客户基础资料与商机信息', type: 'TOOL', subType: 'API', target: 'USER_END', submitterName: 'config.admin', submitterId: 12, submittedAt: '2026-08-28 09:42', status: 'PENDING_REVIEW', code: 'customer.query', writeClass: 'READ', requiresConfirmation: false },
    { id: 2, name: '经营数据分析', description: '读取经营数据并生成趋势分析和异常说明', type: 'SKILL', platformSource: 'PLATFORM_CREATED', target: 'FDE_WORKBENCH', submitterName: 'li.na', submitterId: 2, submittedAt: '2026-08-28 09:18', status: 'PENDING_REVIEW' },
    { id: 3, name: '企业人事系统', description: '提供组织、员工和审批业务页', type: 'BIZ_SYSTEM', target: 'USER_END', submitterName: 'config.admin', submitterId: 12, submittedAt: '2026-08-27 18:34', status: 'PENDING_REVIEW' },
    { id: 4, name: 'Kimi K2', description: '长上下文文本生成模型', type: 'MODEL', subType: 'PUBLISH', target: 'USER_END', submitterName: 'platform.admin', submitterId: 1, submittedAt: '2026-08-27 16:20', status: 'PENDING_REVIEW' },
    { id: 5, name: '合同审阅专员', description: '识别合同风险并生成修改建议', type: 'POSITION', target: 'FDE_WORKBENCH', submitterName: 'wangfang', submitterId: 4, submittedAt: '2026-08-27 14:05', status: 'PENDING_REVIEW' },
    { id: 6, name: '法务审阅专家', description: '辅助审阅合同条款并提示风险', type: 'EXPERT', target: 'USER_END', submitterName: 'config.admin', submitterId: 12, submittedAt: '2026-08-28 10:18', status: 'PENDING_REVIEW' },
    { id: 7, name: '行业研究助手', description: '由客户端用户上传的研究技能', type: 'SKILL', platformSource: 'USER_UPLOADED', target: 'USER_END', submitterName: 'zhangwei', submitterId: 1, submittedAt: '2026-08-28 08:55', status: 'PENDING_REVIEW' },
    { id: 8, name: '知识库检索 MCP', description: '连接企业知识库并提供语义检索工具', type: 'TOOL', subType: 'MCP', target: 'FDE_WORKBENCH', submitterName: 'config.admin', submitterId: 12, submittedAt: '2026-08-28 10:05', status: 'PENDING_REVIEW', code: 'knowledge.search', writeClass: 'READ', requiresConfirmation: false }
  ]
  // 原型补丁逻辑逐字对应：申请类型与申请版本
  rows.forEach((r) => {
    if ([3, 6].includes(r.id)) {
      r.requestAction = 'DELIST'
      r.version = 'v2.0.0'
    } else if ([1, 4, 8].includes(r.id)) {
      r.requestAction = 'FIRST_PUBLISH'
      r.version = '—'
    } else {
      r.requestAction = 'VERSION_PUBLISH'
      r.version = 'v1.2.0'
    }
  })
  // demo 附加接线：原生只读详情的目标实体 id，指向各业务模块 mock 里真实存在的实体
  // （API/MCP → 连接器 mock；EXPERT → domainExpertMock 203 法务审阅专家；MODEL → adminModelMock
  //  md_104 Kimi K2；BIZ_SYSTEM → bizSystemMock biz_2102；SKILL → unifiedSkillMock sk_302/sk_309。
  //  POSITION 走本地简易只读抽屉，refId 不消费）
  const REF = {
    1: 'api_1103',
    2: 'sk_302',
    3: 'biz_2102',
    4: 'md_104',
    6: 203,
    7: 'sk_309',
    8: 'spark_bridge_mcp'
  }
  rows.forEach((r) => {
    r.refId = REF[r.id] ?? r.id
  })
  return rows
}

let reviews = seedRows()

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=approve / reject / reset。
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子。
const persist = attachPersist('reviews', {
  version: 1,
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

/** 通过：DELIST 申请 → DELISTED，其余 → PUBLISHED（原型 approveReview 口径）。 */
export async function approveReview(id) {
  await delay()
  const row = findOr404(id)
  row.status = row.requestAction === 'DELIST' ? 'DELISTED' : 'PUBLISHED'
  row.reviewedAt = now()
  persist()
  return clone(row)
}

/** 驳回：必填驳回原因（空值由页面拦，mock 兜底再校验一次）。 */
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
  row.reviewedAt = now()
  persist()
  return clone(row)
}
