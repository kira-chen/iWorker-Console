/**
 * 岗位申请审批内存 mock（2026-09-04，PRD-20260903「岗位分配→岗位管理」双页签改造）。
 *
 * 【二选一注明】独立新建本文件（未并入 positionAssignmentMock）：申请审批是独立状态机
 * （PENDING → APPROVED / REJECTED / REBOUND），与「用户↔岗位」绑定关系分属两类数据；
 * 联动处（通过=改绑定、行内状态/现有绑定岗位=分配实时值）通过显式 import 表达依赖方向
 * （applications → assignments 单向），避免单文件双状态机互相纠缠。
 *
 * 种子照交互原型（PRD-20260903 数字员工管理端交互原型.html positionApplications 区，
 * L1522-1528）：3 条待审核申请（chenyu / li.na / sun.xin），用户与 positionAssignmentMock
 * 分配种子同源（userId 3 / 2 / 6 就近对齐）。
 *
 * 【Q10 同款拍板延续】原型申请区的岗位名（产品运营专员/经营分析师/合同审阅专员）与岗位模块
 * 种子不一致，属原型内部缺陷——申请岗位名不落库，按 requestedPositionId 从 positionMock
 * 实时解析（404→市场研究岗、401→经营分析岗、403→财务审核岗）。
 *
 * 【业务规则落点】（新 md §五，2026-09-04）：
 *  - 每个用户同一时间最多绑定 1 个岗位；换绑为覆盖关系 —— 由 setUserPosition 的单
 *    positionId 字段模型天然保证（approve 复用之，不另写绑定逻辑）。
 *  - 「通过」直接将用户绑定到申请岗位，等效于管理员手动修改绑定 —— approve 即调用
 *    positionAssignmentMock.setUserPosition（现有岗位绑定接口）。
 *  - 「驳回」不改变用户现有岗位绑定关系 —— reject 只改申请状态与驳回原因，不触碰 assignments。
 *  - 「重新绑定」允许选与申请岗位不同的岗位；绑定本身由修改绑定弹窗（同一 setUserPosition
 *    链路）完成，本 mock 仅在完成后把申请标记为 REBOUND（markApplicationRebound）。
 *
 * 【2026-09-09 PRD 复核·G2 / A8】md §4.1 改为**全部四态入列**（原「仅 PENDING 展示」口径退役）：
 * 列表按「待审核置顶 + 组内提交时间」排序、支持审核状态筛选，处理时落 processedAt / processedBy
 * 供 md §4.2 新增的「审核结果 / 处理时间 / 处理人」三列消费。
 */
import { ApiError } from './request'
import { getPositionNameById } from './positionMock'
import { setUserPosition, getAssignmentByUserId } from './positionAssignmentMock'
import { attachPersist } from './mockPersist'
// 2026-09-09 收编：处理时间戳（与种子同形「YYYY-MM-DD HH:mm」墙钟串，md §4.2「精确到分钟」）改引 utils/datetime 单一真相
import { nowMinuteText as nowMinute } from '@/utils/datetime'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

// 状态机：PENDING（待审核）→ APPROVED（已通过）/ REJECTED（已驳回）/ REBOUND（已重新绑定）。
// 2026-09-09 PRD 复核·G2（A8 / md §4.1）：四态**全部入列**，处理后不再离开列表；
// 处理结果与处理人、处理时间一并固化（md §五末条），种子补 processedAt / processedBy 三条已处理样本。
const PROCESSOR = 'admin' // demo 无登录态：处理人固定取管理员用户名（md §4.2「执行操作的管理员用户名」）
const seed = () => [
  { id: 701, userId: 3, username: 'chenyu', displayName: '陈宇', status: 'PENDING', requestedPositionId: 404, submittedAt: '2026-08-28 10:32', rejectReason: '', processedAt: '', processedBy: '' },
  { id: 702, userId: 2, username: 'li.na', displayName: '李娜', status: 'PENDING', requestedPositionId: 401, submittedAt: '2026-08-28 09:46', rejectReason: '', processedAt: '', processedBy: '' },
  { id: 703, userId: 6, username: 'sun.xin', displayName: '孙欣', status: 'PENDING', requestedPositionId: 403, submittedAt: '2026-08-27 17:18', rejectReason: '', processedAt: '', processedBy: '' },
  // 已处理样本（md §4.3.4「已处理记录长期保留」）：三态各一条，供列表分组排序与三列展示验收。
  // 同一用户可多次提交、历史申请各自独立成行（md §4.3.4）——704 与 701 同为 chenyu。
  { id: 704, userId: 3, username: 'chenyu', displayName: '陈宇', status: 'APPROVED', requestedPositionId: 401, submittedAt: '2026-08-20 14:05', rejectReason: '', processedAt: '2026-08-21 09:12', processedBy: PROCESSOR },
  { id: 705, userId: 5, username: 'zhouming', displayName: '周明', status: 'REJECTED', requestedPositionId: 403, submittedAt: '2026-08-19 11:40', rejectReason: '该岗位需先完成财务合规培训，请在培训通过后重新提交申请。', processedAt: '2026-08-19 16:28', processedBy: PROCESSOR },
  { id: 706, userId: 2, username: 'li.na', displayName: '李娜', status: 'REBOUND', requestedPositionId: 404, submittedAt: '2026-08-18 09:03', rejectReason: '', processedAt: '2026-08-18 15:47', processedBy: PROCESSOR }
]

let applications = seed()

// 【持久化】同 positionAssignment 模式：镜像到 localStorage；写点=approve / reject / rebound / __reset。
// 岗位名不落库（Q10 同款：出参时实时解析），快照只存申请本身。
const persist = attachPersist('positionApplications', {
  // v2（2026-09-09 PRD 复核·G2 / A8）：种子补三条已处理样本 + processedAt / processedBy 字段
  version: 2,
  snapshot: () => ({ applications }),
  restore: (d) => {
    if (!d || !Array.isArray(d.applications)) {
      throw new Error('positionApplications 快照形状不合法')
    }
    applications = d.applications
  }
})

/**
 * 出参行：用户状态 / 现有绑定岗位取分配列表实时值（md §4.2「取该用户在分配列表中的启用/停用状态；
 * 用户记录不存在时默认展示为启用」）；申请岗位名实时解析。
 *
 * 【命名口径】`status` 是**用户启用/停用态**（历史占用，不改以免波及分配页签同名列）；
 * 申请自身的审核态另出 `reviewStatus`（PENDING/APPROVED/REJECTED/REBOUND），
 * 与 `processedAt` / `processedBy` / `rejectReason` 一同供 md §4.2 新增三列消费。
 */
function toRow(r) {
  const assignment = getAssignmentByUserId(r.userId)
  return {
    id: r.id,
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    status: assignment ? assignment.status : 'active',
    currentPositionId: assignment ? assignment.positionId : null,
    currentPositionName: assignment ? assignment.positionName : null,
    requestedPositionId: r.requestedPositionId,
    requestedPositionName: getPositionNameById(r.requestedPositionId) || null,
    submittedAt: r.submittedAt,
    // 申请审核态与处理留痕（md §4.2 / §五末条）
    reviewStatus: r.status,
    processedAt: r.processedAt || '',
    processedBy: r.processedBy || '',
    rejectReason: r.rejectReason || ''
  }
}

/** 处理落章：状态 + 处理时间 + 处理人一并固化（md §五「处理结果与处理人、处理时间一并记录」）。 */
function stamp(row, status) {
  row.status = status
  row.processedAt = nowMinute()
  row.processedBy = PROCESSOR
}

function findPending(id) {
  const row = applications.find((r) => String(r.id) === String(id))
  if (!row) throw err('申请不存在', null, 404)
  if (row.status !== 'PENDING') throw err('该申请已处理，请刷新列表')
  return row
}

/**
 * 列表（md §4.1，2026-09-09 PRD 复核·G2 / A8 重定口径）：
 * - **展示全部四态**（待审核 / 已通过 / 已驳回 / 已重新绑定），处理完成后仍保留在列表中；
 * - **排序**：待审核统一排在已处理之前；**两组内部各自**按提交时间由近到远。点列头切升降序时
 *   「待审核优先」的分组规则不变，**仅组内顺序反转**（故排序键先比分组、再比时间）；
 * - **审核状态筛选**：reviewStatus ∈ ''(全部) | PENDING | APPROVED | REJECTED | REBOUND。
 *
 * params: { page, size, sortDir(desc|asc), reviewStatus }
 */
const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'REBOUND']

export async function listPositionApplications(params = {}) {
  await delay()
  const dir = params.sortDir === 'asc' ? 'asc' : 'desc'
  const rs = REVIEW_STATUSES.includes(params.reviewStatus) ? params.reviewStatus : ''
  const list = applications
    .filter((r) => !rs || r.status === rs)
    .slice()
    .sort((a, b) => {
      // 1) 分组：待审核恒在前（不随升降序反转）
      const ga = a.status === 'PENDING' ? 0 : 1
      const gb = b.status === 'PENDING' ? 0 : 1
      if (ga !== gb) return ga - gb
      // 2) 组内：按提交时间，desc=由近到远（默认），asc=反转
      return dir === 'desc' ? b.submittedAt.localeCompare(a.submittedAt) : a.submittedAt.localeCompare(b.submittedAt)
    })
  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 20
  return { list: list.slice((page - 1) * size, page * size).map(toRow), total }
}

// 待审核数量（页签徽标）；0 时页面不展示徽标。
export async function countPendingApplications() {
  await delay(50)
  return { count: applications.filter((r) => r.status === 'PENDING').length }
}

/**
 * 通过：用现有岗位绑定接口（setUserPosition）把用户绑到申请岗位，再置 APPROVED。
 * 申请岗位已不存在时 setUserPosition 抛错，申请保持 PENDING（异常表「保存失败→展示失败原因」）。
 * A8 后已处理记录**仍留在列表**，只是不再展示操作按钮（md §4.3.4）。
 */
export async function approvePositionApplication(id) {
  await delay()
  const row = findPending(id)
  await setUserPosition(row.userId, row.requestedPositionId)
  stamp(row, 'APPROVED')
  persist()
  return {}
}

// 驳回：原因必填（≤500 字）；只改申请状态，不改变现有绑定（md §五）。
export async function rejectPositionApplication(id, reason) {
  await delay()
  const row = findPending(id)
  const trimmed = String(reason || '').trim()
  if (!trimmed) throw err('请输入驳回原因', 'reason')
  if (trimmed.length > 500) throw err('驳回原因最多 500 字', 'reason')
  stamp(row, 'REJECTED')
  row.rejectReason = trimmed
  persist()
  return {}
}

/**
 * 重新绑定完成回执：绑定已由修改绑定弹窗（setUserPosition）落库，此处仅把申请
 * 标记为 REBOUND（弹窗取消则不调用，申请保持 PENDING，md §4.3.3）。
 */
export async function markApplicationRebound(id) {
  await delay()
  const row = findPending(id)
  stamp(row, 'REBOUND')
  persist()
  return {}
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetPositionApplicationsMock() {
  applications = seed()
  persist()
}
