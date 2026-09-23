/**
 * 岗位分配页内存 mock（demo 数据层，模式同 positionMock.js；开关见 positionAssignment.js 头注释）。
 *
 * 种子照交互原型 v2（renderAssignments 区，约 L1500）：6 名用户
 * zhangwei / li.na / chenyu / wangfang / zhouming(停用) / sun.xin，其中 2 人（chenyu、sun.xin）未绑定。
 *
 * 2026-09-15 新流程：引入 getPendingApplicationByUserId 联查，每行增加
 * hasPendingRequest / pendingRequestId / pendingRequestAt 字段；
 * listPositionAssignments 支持 hasPendingRequest 过滤参数（待分配申请筛选）。
 * 依赖方向：本文件 → positionApplicationsMock（单向，原方向已反转）。
 */
import { ApiError } from './request'
import { getPositionNameById, isPositionBindable } from './positionMock'
import { getPendingApplicationByUserId } from './positionApplicationsMock'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let assignments = [
  { userId: 1, username: 'zhangwei', displayName: '张伟', status: 'active',    positionId: 401 },
  { userId: 2, username: 'li.na',    displayName: '李娜', status: 'active',    positionId: 402 },
  { userId: 3, username: 'chenyu',   displayName: '陈宇', status: 'active',    positionId: null },
  { userId: 4, username: 'wangfang', displayName: '王芳', status: 'active',    positionId: 403 },
  { userId: 5, username: 'zhouming', displayName: '周明', status: 'disabled',  positionId: 401 },
  { userId: 6, username: 'sun.xin',  displayName: '孙欣', status: 'active',    positionId: null }
]

const persist = attachPersist('positionAssignment', {
  version: 1,
  snapshot: () => ({ assignments }),
  restore: (d) => {
    if (!d || !Array.isArray(d.assignments)) throw new Error('positionAssignment 快照形状不合法')
    assignments = d.assignments
  }
})

function toRow(r) {
  const app = getPendingApplicationByUserId(r.userId)
  return {
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    status: r.status,
    positionId: r.positionId,
    positionName: r.positionId != null ? getPositionNameById(r.positionId) || null : null,
    // 待分配申请联查字段（2026-09-15）
    hasPendingRequest: !!app,
    pendingRequestId: app ? app.id : null,
    pendingRequestAt: app ? app.submittedAt : null
  }
}

/**
 * params: { page, size, keyword, status, hasPendingRequest, focusUserId }
 * hasPendingRequest=true 时只返回有待分配申请的用户（「待分配申请」筛选按钮）。
 * focusUserId：将该用户置顶（stable sort），供分配后置顶高亮一次性使用。
 */
export async function listPositionAssignments(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const status = params.status || ''
  const pendingOnly = params.hasPendingRequest === true || params.hasPendingRequest === 'true'

  let list = assignments.filter(
    (r) =>
      (!kw || [r.username, r.displayName].some((v) => String(v || '').toLowerCase().includes(kw))) &&
      (!status || r.status === status)
  )

  if (pendingOnly) {
    list = list.filter((r) => !!getPendingApplicationByUserId(r.userId))
  }

  if (params.focusUserId != null) {
    const fid = String(params.focusUserId)
    list = [...list.filter((r) => String(r.userId) === fid), ...list.filter((r) => String(r.userId) !== fid)]
  }

  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 20
  return { list: list.slice((page - 1) * size, page * size).map(toRow), total }
}

// 设置某用户绑定岗位（保存即时生效）。positionId 非空=首绑/换绑；null/空=解绑。
export async function setUserPosition(userId, positionId) {
  await delay()
  const row = assignments.find((r) => String(r.userId) === String(userId))
  if (!row) throw err('用户不存在', null, 404)
  if (positionId != null && positionId !== '') {
    if (!getPositionNameById(positionId)) throw err('岗位不存在或已删除')
    // md 岗位管理 §六 L89「未发布岗位（含首次发布审核中）不进入下拉选项」——此前只在 UI 按
    // status==='published' 过滤候选，mock 数据层不拦，绕过 UI 直调可把用户绑到未发布岗位
    // （2026-09-23 待办 yuepu#9③）
    if (!isPositionBindable(positionId)) throw err('岗位未发布，暂不可绑定')
    row.positionId = Number(positionId)
  } else {
    row.positionId = null
  }
  persist()
  return {}
}

/**
 * 按 userId 取单条分配行（岗位名已实时解析）；不存在返回 null。
 * （2026-09-15 注：原供 positionApplicationsMock 联查，依赖方向已反转，此函数保留供其它消费方使用）
 */
export function getAssignmentByUserId(userId) {
  const row = assignments.find((r) => String(r.userId) === String(userId))
  return row ? toRow(row) : null
}

/**
 * 按岗位 id 统计当前绑定的用户数（岗位侧「领用数」claimedUserCount 派生用，2026-09-23 待办
 * yuepu#9①：此前岗位侧是静态种子，分配表增减用户不回写，停用/删除的「已被 N 个用户领用」
 * 拦截永远读的是种子里的老数字）。账号启停是另一回事，此处不按 status 过滤——解绑
 * （setUserPosition 传 null）才代表解除领用，停用账号不等于解除领用。
 */
export function countAssignedUsers(positionId) {
  return assignments.filter((r) => String(r.positionId) === String(positionId)).length
}

/** 测试辅助：重置种子。 */
export function __resetPositionAssignmentMock() {
  assignments = [
    { userId: 1, username: 'zhangwei', displayName: '张伟', status: 'active',   positionId: 401 },
    { userId: 2, username: 'li.na',    displayName: '李娜', status: 'active',   positionId: 402 },
    { userId: 3, username: 'chenyu',   displayName: '陈宇', status: 'active',   positionId: null },
    { userId: 4, username: 'wangfang', displayName: '王芳', status: 'active',   positionId: 403 },
    { userId: 5, username: 'zhouming', displayName: '周明', status: 'disabled', positionId: 401 },
    { userId: 6, username: 'sun.xin',  displayName: '孙欣', status: 'active',   positionId: null }
  ]
  persist()
}
