/**
 * 岗位分配页内存 mock（demo 数据层，模式同 positionMock.js；开关见 positionAssignment.js 头注释）。
 *
 * 种子照交互原型 v2（renderAssignments 区，约 L1500）：6 名用户
 * zhangwei / li.na / chenyu / wangfang / zhouming(停用) / sun.xin，其中 2 人（chenyu、sun.xin）未绑定。
 *
 * 【Q10 拍板】原型分配区种子的岗位名（经营分析师/客户运营专员/合同审阅专员）与岗位模块种子
 * 岗位名不一致，属原型内部缺陷 —— mock 统一采用岗位模块种子的岗位名：positionName 不落库、
 * 每次出参时按 positionId 从 positionMock 实时解析（岗位改名/删除自动联动）。
 */
import { ApiError } from './request'
import { getPositionNameById } from './positionMock'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let assignments = [
  { userId: 1, username: 'zhangwei', displayName: '张伟', status: 'active', positionId: 401 },
  { userId: 2, username: 'li.na', displayName: '李娜', status: 'active', positionId: 402 },
  { userId: 3, username: 'chenyu', displayName: '陈宇', status: 'active', positionId: null },
  { userId: 4, username: 'wangfang', displayName: '王芳', status: 'active', positionId: 403 },
  { userId: 5, username: 'zhouming', displayName: '周明', status: 'disabled', positionId: 401 },
  { userId: 6, username: 'sun.xin', displayName: '孙欣', status: 'active', positionId: null }
]

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=setUserPosition / __reset。
// positionName 不落库（Q10：出参时从 positionMock 实时解析），快照只存绑定关系本身。
const persist = attachPersist('positionAssignment', {
  version: 1,
  snapshot: () => ({ assignments }),
  restore: (d) => {
    if (!d || !Array.isArray(d.assignments)) {
      throw new Error('positionAssignment 快照形状不合法')
    }
    assignments = d.assignments
  }
})

function toRow(r) {
  return {
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    status: r.status,
    positionId: r.positionId,
    // 岗位名实时解析（Q10：岗位模块种子为单一真相源）；解绑/岗位已删 → null
    positionName: r.positionId != null ? getPositionNameById(r.positionId) || null : null
  }
}

// params: { page, size, keyword(用户名/显示名), status(active|disabled), focusUserId }
// focusUserId（2026-09-04 PRD-20260903 岗位申请审批「重新绑定」回跳）：照原型 paFocusUserId——
// 将该用户置顶（stable sort，其余行相对顺序不变），供分配页签「置顶高亮聚焦」一次性使用。
export async function listPositionAssignments(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const status = params.status || ''
  let list = assignments.filter(
    (r) =>
      (!kw || [r.username, r.displayName].some((v) => String(v || '').toLowerCase().includes(kw))) &&
      (!status || r.status === status)
  )
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
    row.positionId = Number(positionId)
  } else {
    row.positionId = null
  }
  persist()
  return {}
}

/**
 * 按 userId 取单条分配行（岗位名已实时解析）；不存在返回 null。
 * 供 positionApplicationsMock 联表使用（2026-09-04 岗位申请审批：状态 / 现有绑定岗位
 * 取分配列表实时值，照原型 renderPositionApplications 的 assignments.find 联查）。
 */
export function getAssignmentByUserId(userId) {
  const row = assignments.find((r) => String(r.userId) === String(userId))
  return row ? toRow(row) : null
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetPositionAssignmentMock() {
  assignments = [
    { userId: 1, username: 'zhangwei', displayName: '张伟', status: 'active', positionId: 401 },
    { userId: 2, username: 'li.na', displayName: '李娜', status: 'active', positionId: 402 },
    { userId: 3, username: 'chenyu', displayName: '陈宇', status: 'active', positionId: null },
    { userId: 4, username: 'wangfang', displayName: '王芳', status: 'active', positionId: 403 },
    { userId: 5, username: 'zhouming', displayName: '周明', status: 'disabled', positionId: 401 },
    { userId: 6, username: 'sun.xin', displayName: '孙欣', status: 'active', positionId: null }
  ]
  persist()
}
