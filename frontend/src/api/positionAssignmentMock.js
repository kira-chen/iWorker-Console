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
 *
 * 2026-09-23（待办 yuepu#11③）：原先本文件自己维护一份独立的 6 人名单（userId 1-6），与
 * adminUserMock 的 13 个真实用户各自为政、id 体系互不相通——用户页删 li.na，岗位管理页仍在，
 * 改名/停用也不同步。md「岗位管理以用户为核心维护用户—岗位绑定关系」（岗位管理 §一）意味着列表本就应
 * 覆盖全部组织用户；改为绑定关系只存 userId→positionId 映射（bindings），用户列表实时取自
 * adminUserMock.listUsersSync（同源），displayName/status 随之联动，用户被删即从列表消失。
 */
import { ApiError } from './request'
import { getPositionNameById, isPositionBindable } from './positionMock'
import { getPendingApplicationByUserId } from './positionApplicationsMock'
import { listUsersSync } from './adminUserMock'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

// userId(adminUserMock 真实 id) -> positionId；只存有绑定的用户，未出现的即「未绑定」。
// 种子对应 201 zhangwei / 202 li.na / 204 wangfang / 205 zhouming（203 chenyu、206 sun.xin 未绑定）。
let bindings = { 201: 401, 202: 402, 204: 403, 205: 401 }

const persist = attachPersist('positionAssignment', {
  version: 2,
  snapshot: () => ({ bindings }),
  restore: (d) => {
    if (!d || typeof d.bindings !== 'object' || d.bindings === null || Array.isArray(d.bindings)) {
      throw new Error('positionAssignment 快照形状不合法')
    }
    bindings = d.bindings
  }
})

function toRow(user) {
  const positionId = bindings[String(user.id)] ?? null
  const app = getPendingApplicationByUserId(user.id)
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    positionId,
    positionName: positionId != null ? getPositionNameById(positionId) || null : null,
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

  let list = listUsersSync()
    .map(toRow)
    .filter(
      (r) =>
        (!kw || [r.username, r.displayName].some((v) => String(v || '').toLowerCase().includes(kw))) &&
        (!status || r.status === status)
    )

  if (pendingOnly) {
    list = list.filter((r) => r.hasPendingRequest)
  }

  if (params.focusUserId != null) {
    const fid = String(params.focusUserId)
    list = [...list.filter((r) => String(r.userId) === fid), ...list.filter((r) => String(r.userId) !== fid)]
  }

  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 20
  return { list: list.slice((page - 1) * size, page * size), total }
}

// 设置某用户绑定岗位（保存即时生效）。positionId 非空=首绑/换绑；null/空=解绑。
export async function setUserPosition(userId, positionId) {
  await delay()
  const exists = listUsersSync().some((u) => String(u.id) === String(userId))
  if (!exists) throw err('用户不存在', null, 404)
  if (positionId != null && positionId !== '') {
    if (!getPositionNameById(positionId)) throw err('岗位不存在或已删除')
    // md 岗位管理 §六 L89「未发布岗位（含首次发布审核中）不进入下拉选项」——此前只在 UI 按
    // status==='published' 过滤候选，mock 数据层不拦，绕过 UI 直调可把用户绑到未发布岗位
    // （2026-09-23 待办 yuepu#9③）
    if (!isPositionBindable(positionId)) throw err('岗位未发布，暂不可绑定')
    bindings[String(userId)] = Number(positionId)
  } else {
    delete bindings[String(userId)]
  }
  persist()
  return {}
}

/**
 * 按 userId 取单条分配行（岗位名已实时解析）；用户不存在（含已删除）返回 null。
 * （2026-09-15 注：原供 positionApplicationsMock 联查，依赖方向已反转，此函数保留供其它消费方使用）
 */
export function getAssignmentByUserId(userId) {
  const user = listUsersSync().find((u) => String(u.id) === String(userId))
  return user ? toRow(user) : null
}

/**
 * 按岗位 id 统计当前绑定的用户数（岗位侧「领用数」claimedUserCount 派生用，2026-09-23 待办
 * yuepu#9①：此前岗位侧是静态种子，分配表增减用户不回写，停用/删除的「已被 N 个用户领用」
 * 拦截永远读的是种子里的老数字）。账号启停是另一回事，此处不按 status 过滤——解绑
 * （setUserPosition 传 null）才代表解除领用，停用账号不等于解除领用。
 * 只计对应真实用户仍存在的绑定（用户被删后其绑定视为已随之清除，见头注释 yuepu#11③）。
 */
export function countAssignedUsers(positionId) {
  const validIds = new Set(listUsersSync().map((u) => String(u.id)))
  return Object.entries(bindings).filter(
    ([uid, pid]) => validIds.has(uid) && String(pid) === String(positionId)
  ).length
}

/** 测试辅助：重置种子。 */
export function __resetPositionAssignmentMock() {
  bindings = { 201: 401, 202: 402, 204: 403, 205: 401 }
  persist()
}
