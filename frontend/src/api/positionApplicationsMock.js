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
 */
import { ApiError } from './request'
import { getPositionNameById } from './positionMock'
import { setUserPosition, getAssignmentByUserId } from './positionAssignmentMock'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

// 状态机：PENDING（待审核，唯一入列态）→ APPROVED（已通过）/ REJECTED（已驳回）/ REBOUND（已重新绑定）
const seed = () => [
  { id: 701, userId: 3, username: 'chenyu', displayName: '陈宇', status: 'PENDING', requestedPositionId: 404, submittedAt: '2026-08-28 10:32', rejectReason: '' },
  { id: 702, userId: 2, username: 'li.na', displayName: '李娜', status: 'PENDING', requestedPositionId: 401, submittedAt: '2026-08-28 09:46', rejectReason: '' },
  { id: 703, userId: 6, username: 'sun.xin', displayName: '孙欣', status: 'PENDING', requestedPositionId: 403, submittedAt: '2026-08-27 17:18', rejectReason: '' }
]

let applications = seed()

// 【持久化】同 positionAssignment 模式：镜像到 localStorage；写点=approve / reject / rebound / __reset。
// 岗位名不落库（Q10 同款：出参时实时解析），快照只存申请本身。
const persist = attachPersist('positionApplications', {
  version: 1,
  snapshot: () => ({ applications }),
  restore: (d) => {
    if (!d || !Array.isArray(d.applications)) {
      throw new Error('positionApplications 快照形状不合法')
    }
    applications = d.applications
  }
})

/**
 * 出参行：用户状态 / 现有绑定岗位取分配列表实时值（照原型 renderPositionApplications
 * 的 assignments.find 联查；用户不在分配表时状态回落 active）；申请岗位名实时解析。
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
    submittedAt: r.submittedAt
  }
}

function findPending(id) {
  const row = applications.find((r) => String(r.id) === String(id))
  if (!row) throw err('申请不存在', null, 404)
  if (row.status !== 'PENDING') throw err('该申请已处理，请刷新列表')
  return row
}

// 列表：仅展示 PENDING（已通过/已驳回/已重新绑定不展示，md §4.1）；
// 默认按提交时间由近到远（sortDir=desc），点列头可切换（sortDir=asc）。
// params: { page, size, sortDir(desc|asc) }
export async function listPositionApplications(params = {}) {
  await delay()
  const dir = params.sortDir === 'asc' ? 'asc' : 'desc'
  const list = applications
    .filter((r) => r.status === 'PENDING')
    .sort((a, b) => (dir === 'desc' ? b.submittedAt.localeCompare(a.submittedAt) : a.submittedAt.localeCompare(b.submittedAt)))
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
 * 通过：用现有岗位绑定接口（setUserPosition）把用户绑到申请岗位，再置 APPROVED 离开列表。
 * 申请岗位已不存在时 setUserPosition 抛错，申请保持 PENDING（异常表「保存失败→展示失败原因」）。
 */
export async function approvePositionApplication(id) {
  await delay()
  const row = findPending(id)
  await setUserPosition(row.userId, row.requestedPositionId)
  row.status = 'APPROVED'
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
  row.status = 'REJECTED'
  row.rejectReason = trimmed
  persist()
  return {}
}

/**
 * 重新绑定完成回执：绑定已由修改绑定弹窗（setUserPosition）落库，此处仅把申请
 * 标记为 REBOUND 离开列表（弹窗取消则不调用，申请保持 PENDING，md §4.3.3）。
 */
export async function markApplicationRebound(id) {
  await delay()
  const row = findPending(id)
  row.status = 'REBOUND'
  persist()
  return {}
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetPositionApplicationsMock() {
  applications = seed()
  persist()
}
