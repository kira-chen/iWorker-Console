/**
 * 岗位申请内存 mock（新流程：用户举手申请，不指定具体岗位；管理端统一分配）。
 *
 * 原「通过 / 驳回」审批语义随 requestedPositionId 字段一并移除。
 * 状态机：PENDING（待分配）→ ASSIGNED（已分配）。
 *
 * 依赖方向调整（原 applications → assignments，现反向）：
 * 本文件不再 import positionAssignmentMock；改由 positionAssignmentMock 导入
 * getPendingApplicationByUserId 联查，消除循环依赖。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { nowMinuteText as nowMinute } from '@/utils/datetime'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

const PROCESSOR = 'admin'

// 种子：chenyu / sun.xin 为未绑定用户，已提交申请；li.na 历史已处理样本。
// userId 对应 adminUserMock 真实用户 id（2026-09-23 待办 yuepu#11③：positionAssignmentMock 改为
// 同源自 adminUserMock 后，本文件 userId 须与之一致，否则 getPendingApplicationByUserId 联查对不上）。
const seed = () => [
  { id: 701, userId: 203, username: 'chenyu',  displayName: '陈宇', status: 'PENDING',  submittedAt: '2026-08-28 10:32', assignedAt: '', assignedBy: '' },
  { id: 702, userId: 206, username: 'sun.xin', displayName: '孙欣', status: 'PENDING',  submittedAt: '2026-08-27 17:18', assignedAt: '', assignedBy: '' },
  { id: 703, userId: 202, username: 'li.na',   displayName: '李娜', status: 'ASSIGNED', submittedAt: '2026-08-18 09:03', assignedAt: '2026-08-18 15:47', assignedBy: PROCESSOR }
]

let applications = seed()

const persist = attachPersist('positionApplications', {
  version: 4, // v4（2026-09-23 待办 yuepu#11③）：种子 userId 改用 adminUserMock 真实 id，旧快照弃用回种子
  snapshot: () => ({ applications }),
  restore: (d) => {
    if (!d || !Array.isArray(d.applications)) throw new Error('positionApplications 快照形状不合法')
    applications = d.applications
  }
})

/**
 * 按 userId 查找待分配申请（同步）；无则返回 null。
 * 供 positionAssignmentMock.toRow 联查，给分配列表每行注入 hasPendingRequest 字段。
 */
export function getPendingApplicationByUserId(userId) {
  return applications.find((r) => String(r.userId) === String(userId) && r.status === 'PENDING') || null
}

/** 待分配数量（工具栏筛选按钮徽标）；返回 { count }。 */
export async function countPendingApplications() {
  await delay(50)
  return { count: applications.filter((r) => r.status === 'PENDING').length }
}

/**
 * 分配完成回执：绑定已由 setUserPosition 落库，此处仅把申请标记为 ASSIGNED 并留痕。
 */
export async function markApplicationAssigned(id) {
  await delay()
  const row = applications.find((r) => String(r.id) === String(id))
  if (!row) throw err('申请不存在', null, 404)
  if (row.status !== 'PENDING') throw err('该申请已处理')
  row.status = 'ASSIGNED'
  row.assignedAt = nowMinute()
  row.assignedBy = PROCESSOR
  persist()
  return {}
}

/** 测试辅助：重置种子。 */
export function __resetPositionApplicationsMock() {
  applications = seed()
  persist()
}
