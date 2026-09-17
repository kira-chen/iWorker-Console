/**
 * 岗位申请审批内存 mock（A8 全量展示口径；2026-09-09 PRD 复核·G2）。
 *
 * 流程：用户举手申请任一岗位 → 管理端审批（通过/驳回）或标记重新绑定。
 * 状态机：PENDING → APPROVED / REJECTED / REBOUND（已处理行保留在列表）。
 *
 * 依赖方向：双向静态循环（positionAssignmentMock ↔ positionApplicationsMock）；ESM live-bindings 安全，
 * 两端均无顶层跨模块调用，vitest 随机顺序下也不会抖。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { nowMinuteText as nowMinute } from '@/utils/datetime'
import { getPositionNameById } from './positionMock'
import { getAssignmentByUserId, setUserPosition } from './positionAssignmentMock'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

const PROCESSOR = 'admin'

// 种子：3 待审核(PENDING) + 3 已处理(APPROVED/REJECTED/REBOUND)
// 内部字段 status = 申请的审批状态（输出时映射为 reviewStatus 避免与用户启用/停用态 status 冲突）
const seed = () => [
  { id: 701, userId: 3, username: 'chenyu',   displayName: '陈宇', requestedPositionId: 404, status: 'PENDING',  submittedAt: '2026-08-28 10:32', processedAt: '', processedBy: '', rejectReason: '' },
  { id: 702, userId: 2, username: 'li.na',    displayName: '李娜', requestedPositionId: 401, status: 'PENDING',  submittedAt: '2026-08-28 09:46', processedAt: '', processedBy: '', rejectReason: '' },
  { id: 703, userId: 6, username: 'sun.xin',  displayName: '孙欣', requestedPositionId: 403, status: 'PENDING',  submittedAt: '2026-08-27 17:18', processedAt: '', processedBy: '', rejectReason: '' },
  { id: 704, userId: 4, username: 'wangfang', displayName: '王芳', requestedPositionId: 401, status: 'APPROVED', submittedAt: '2026-08-20 09:11', processedAt: '2026-08-20 14:05', processedBy: PROCESSOR, rejectReason: '' },
  { id: 705, userId: 5, username: 'zhouming', displayName: '周明', requestedPositionId: 402, status: 'REJECTED', submittedAt: '2026-08-19 11:40', processedAt: '2026-08-19 16:28', processedBy: PROCESSOR, rejectReason: '尚未完成财务合规培训，暂不符合岗位要求' },
  { id: 706, userId: 1, username: 'zhangwei', displayName: '张伟', requestedPositionId: 403, status: 'REBOUND',  submittedAt: '2026-08-18 09:03', processedAt: '2026-08-18 15:47', processedBy: PROCESSOR, rejectReason: '' }
]

let applications = seed()

const persist = attachPersist('positionApplications', {
  version: 2,
  snapshot: () => ({ applications }),
  restore: (d) => {
    if (!d || !Array.isArray(d.applications)) throw new Error('positionApplications 快照形状不合法')
    applications = d.applications
  }
})

// ===========================================================================

/**
 * 按 userId 查找待审核申请（同步）；供 positionAssignmentMock 联查。
 */
export function getPendingApplicationByUserId(userId) {
  return applications.find((r) => String(r.userId) === String(userId) && r.status === 'PENDING') || null
}

/**
 * 列表查询（A8 全量展示口径）。
 * params: { sortDir?: 'desc'|'asc', reviewStatus?: string }
 * 待审核组恒置顶，组内按 submittedAt 排序；已处理组在后，同序。
 * 每行联查分配表（status、currentPositionName）与岗位表（requestedPositionName）。
 */
export async function listPositionApplications(params = {}) {
  await delay(50)
  const { sortDir = 'desc', reviewStatus } = params

  const VALID_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'REBOUND']
  const filter = VALID_STATUSES.includes(reviewStatus) ? reviewStatus : null

  let list = filter ? applications.filter((r) => r.status === filter) : applications.slice()

  // PENDING 置顶；组内按 submittedAt 排
  const order = sortDir === 'asc' ? 1 : -1
  list.sort((a, b) => {
    const aPend = a.status === 'PENDING' ? 0 : 1
    const bPend = b.status === 'PENDING' ? 0 : 1
    if (aPend !== bPend) return aPend - bPend
    return order * (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0)
  })

  const rows = list.map((r) => {
    const assignment = getAssignmentByUserId(r.userId)
    return {
      id: r.id,
      userId: r.userId,
      username: r.username,
      displayName: r.displayName,
      reviewStatus: r.status,
      submittedAt: r.submittedAt,
      processedAt: r.processedAt,
      processedBy: r.processedBy,
      rejectReason: r.rejectReason,
      requestedPositionId: r.requestedPositionId,
      requestedPositionName: getPositionNameById(r.requestedPositionId) || null,
      status: assignment ? assignment.status : 'active',
      currentPositionName: assignment ? (assignment.positionName || null) : null
    }
  })

  return { list: rows, total: rows.length }
}

/** 待审核数量（工具栏徽标）；返回 { count }。 */
export async function countPendingApplications() {
  await delay(50)
  return { count: applications.filter((r) => r.status === 'PENDING').length }
}

/**
 * 通过：绑定用户到申请岗位 + 标记 APPROVED 并留痕。
 */
export async function approvePositionApplication(id) {
  await delay()
  const row = applications.find((r) => String(r.id) === String(id))
  if (!row) throw err('申请不存在', null, 404)
  if (row.status !== 'PENDING') throw err('该申请已处理')
  await setUserPosition(row.userId, row.requestedPositionId)
  row.status = 'APPROVED'
  row.processedAt = nowMinute()
  row.processedBy = PROCESSOR
  persist()
  return {}
}

/**
 * 驳回：原因必填且 ≤500 字；不改变用户现有岗位绑定。
 */
export async function rejectPositionApplication(id, reason) {
  await delay()
  const row = applications.find((r) => String(r.id) === String(id))
  if (!row) throw err('申请不存在', null, 404)
  if (row.status !== 'PENDING') throw err('该申请已处理')
  const trimmed = String(reason || '').trim()
  if (!trimmed) throw err('请输入驳回原因')
  if (trimmed.length > 500) throw err('最多 500 字')
  row.status = 'REJECTED'
  row.rejectReason = trimmed
  row.processedAt = nowMinute()
  row.processedBy = PROCESSOR
  persist()
  return {}
}

/**
 * 重新绑定回执：仅标记 REBOUND（行保留），绑定由修改绑定弹窗链路另行落库。
 */
export async function markApplicationRebound(id) {
  await delay()
  const row = applications.find((r) => String(r.id) === String(id))
  if (!row) throw err('申请不存在', null, 404)
  if (row.status !== 'PENDING') throw err('该申请已处理')
  row.status = 'REBOUND'
  row.processedAt = nowMinute()
  row.processedBy = PROCESSOR
  persist()
  return {}
}

/**
 * 分配完成回执：供 AdminPositionAssignments.vue 分配后留痕。
 */
export async function markApplicationAssigned(id) {
  await delay()
  const row = applications.find((r) => String(r.id) === String(id))
  if (!row) throw err('申请不存在', null, 404)
  if (row.status !== 'PENDING') throw err('该申请已处理')
  row.status = 'APPROVED'
  row.processedAt = nowMinute()
  row.processedBy = PROCESSOR
  persist()
  return {}
}

/** 测试辅助：重置种子。 */
export function __resetPositionApplicationsMock() {
  applications = seed()
  persist()
}
