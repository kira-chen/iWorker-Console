/**
 * 存储空间开发期 mock（04运行 › 存储空间，对齐 docs/PRD/数字员工管理端PRD/04运行/存储空间/prd.存储空间.md）。
 *
 * 两块数据：
 *  - members   员工的存储用量与容量（容量 = 个人设置值，没有则取固定的默认容量 DEFAULT_QUOTA_GB）；
 *  - requests  员工端提交的扩容申请（待处理 / 已同意 / 已拒绝）。
 * 员工清单与用户模块、岗位分配**真联动**：每次读写前 reconcile()——在职用户都在清单里（新增用户 = 未统计），
 * 显示名 / 岗位取用户模块与岗位分配的当前值，用户被删除则其容量记录与申请一并移除，停用账号不进清单。
 * 用量（最终产物 + 缓存）由员工端在登录等四个时点统计后上报，管理端只读展示最近一次结果，所以这里只维护快照，
 * 不模拟统计过程；管理端能写的只有「容量」和「申请处理结果」。
 *
 * 管理端操作写进访问审计（模块「存储空间」，PRD 访问审计 §6.2 / §6.5.4）：
 *  同意扩容 / 拒绝扩容 / 调整容量，访问审计页都展示，也都是客户端通知的来源。
 *
 * 有待处理扩容申请的员工，容量只能经申请处理（同意 / 拒绝）改变，不能在容量分配页直接调整——
 * 页面上该行的操作是「待处理」而不是「调整容量」，批量设置也只作用于没有待处理申请的员工；mock 同样拦截，防绕过页面。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { appendOpsRecord } from './accessAuditMock'
import { currentDemoUsername } from '@/utils/demoIdentity'
import { nowMinuteText as now } from '@/utils/datetime'
import { listUsersSync } from './adminUserMock'
import { getAssignmentByUserId } from './positionAssignmentMock'
import { QUOTA_MIN_GB, DEFAULT_QUOTA_GB, REJECT_REASON_MAX, quotaInputError } from '@/utils/storageSpace'

const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))
const err = (message, code = 40000, field = null) => new ApiError({ code, message, field })
const clone = (value) => structuredClone(value)
/** 容量、用量统一保留 1 位小数，避免 0.1 + 0.2 之类的浮点尾巴进到页面。 */
const round1 = (n) => Math.round(n * 10) / 10

/** 已用 ≥ 总量的 90% 且未满为预警（PRD 一·4）。 */
// 比较时放大成「十分位整数」：used*10 >= total*9，避免 13*0.9=11.700000000000001 这类浮点误判。
const tenths = (n) => Math.round(n * 10)

// 用量与容量种子，按用户模块的 userId 对应（id / 用户名 / 显示名 / 岗位不存这里，reconcile() 每次从用户模块与岗位分配取当前值）。
// 杨帆、马超从未登录过，员工端没统计过用量 → 「未统计」；停用账号（周明、吴杰）不进清单。
// 覆盖演示各种状态：正常 / 预警 / 已满、默认与个人设置、个人设置且已满（徐琳）、预警但仍有待处理申请（孙欣，申请后自行清了空间）。
const seedMembers = () => [
  { userId: 201, finalGb: 2.1, cacheGb: 0.6, quotaGb: null, statAt: '2026-10-09 09:12' },
  { userId: 202, finalGb: 4.1, cacheGb: 0.6, quotaGb: null, statAt: '2026-10-09 08:46' },
  { userId: 203, finalGb: 5.0, cacheGb: 0, quotaGb: null, statAt: '2026-10-09 10:02' },
  { userId: 204, finalGb: 5.0, cacheGb: 0, quotaGb: null, statAt: '2026-10-09 09:38' },
  { userId: 206, finalGb: 4.6, cacheGb: 0, quotaGb: null, statAt: '2026-10-09 09:20' },
  { userId: 207, finalGb: 5.0, cacheGb: 0, quotaGb: null, statAt: '2026-10-08 16:36' },
  { userId: 208, finalGb: 9.2, cacheGb: 0.5, quotaGb: 10, statAt: '2026-10-09 09:30' },
  { userId: 210, finalGb: 5.0, cacheGb: 0, quotaGb: null, statAt: '2026-10-05 15:02' },
  { userId: 212, finalGb: 7.6, cacheGb: 0.4, quotaGb: 8, statAt: '2026-10-09 08:30' },
  { userId: 209, finalGb: null, cacheGb: null, quotaGb: null, statAt: null },
  { userId: 213, finalGb: null, cacheGb: null, quotaGb: null, statAt: null }
]

// 扩容申请：员工端只在「清理缓存后仍满」或「缓存本来就是零」时才给申请入口，所以申请时缓存都已为零（cacheCleared 恒为 true）。
// 管理端只展示员工「当前用量」（列表行的 current 由 listExpansionRequests 现算），不存、不展示申请时的用量。
// position 是提交时的岗位快照，与岗位分配种子对齐（只有 202 李娜 / 204 王芳 / 201 张伟有绑定，其余提交时未绑定岗位）。
// 待处理 4 条（陈宇最新）；已处理 4 条：赵敏已同意（5→10 GB），何静、刘强、孙欣曾被拒绝（处理人有 demo / zhangwei 两位，对应访问审计种子）。
const seedRequests = () => [
  {
    id: 'ER-1006', userId: 203, username: 'chenyu', name: '陈宇', position: '',
    cacheCleared: true, skippedAutomations: 2,
    reason: '季度经营分析报告产物较多，缓存已清理，最终产物都需要保留，申请扩容到 10 GB。',
    submittedAt: '2026-10-09 10:05', status: 'PENDING',
    newTotalGb: null, rejectReason: '', handler: '', handledAt: ''
  },
  {
    id: 'ER-1005', userId: 204, username: 'wangfang', name: '王芳', position: '财务审核岗',
    cacheCleared: true, skippedAutomations: 0,
    reason: '客户方案和调研附件越来越多，申请扩容 5 GB。',
    submittedAt: '2026-10-09 09:40', status: 'PENDING',
    newTotalGb: null, rejectReason: '', handler: '', handledAt: ''
  },
  {
    id: 'ER-1004', userId: 206, username: 'sun.xin', name: '孙欣', position: '',
    cacheCleared: true, skippedAutomations: 3,
    reason: '每日数据日报自动化已经因空间不足跳过 3 次，影响晨会材料，麻烦尽快扩容。申请后我又清理了部分历史产物，目前略有余量，但日报和周报产物每天都在增加，预计很快会再次写满，希望能一并扩容，避免自动化反复被跳过。如果无法一次扩到位，也请先临时增加一部分额度，我会同步清理历史文件。',
    submittedAt: '2026-10-09 08:55', status: 'PENDING',
    newTotalGb: null, rejectReason: '', handler: '', handledAt: ''
  },
  {
    id: 'ER-1003', userId: 207, username: 'liuqiang', name: '刘强', position: '',
    cacheCleared: true, skippedAutomations: 1,
    reason: '排产表和设备点检图片按周归档，5 GB 已不够，申请扩容到 15 GB。',
    submittedAt: '2026-10-08 16:40', status: 'PENDING',
    newTotalGb: null, rejectReason: '', handler: '', handledAt: ''
  },
  {
    id: 'ER-1002', userId: 208, username: 'zhaomin', name: '赵敏', position: '',
    cacheCleared: true, skippedAutomations: 0,
    reason: '月度对账产物每日产出表格与图片，5 GB 已不够用。',
    submittedAt: '2026-10-07 14:20', status: 'APPROVED',
    newTotalGb: 10, rejectReason: '', handler: 'demo', handledAt: '2026-10-07 16:02'
  },
  {
    id: 'ER-1001', userId: 210, username: 'hejing', name: '何静', position: '',
    cacheCleared: true, skippedAutomations: 1,
    reason: '客户资料归档需要更多空间。',
    submittedAt: '2026-10-05 11:30', status: 'REJECTED',
    newTotalGb: null,
    rejectReason: '客户资料归档建议放进「我的资料」，该库独立计量、不占存储空间，也不受这里的容量限制，不需要为此扩容。同时请先清理历史产物里已经不再使用的中间文件和重复版本，确认清理后仍然不够再重新提交申请，并在说明里写清楚预计新增的数据量和用途，方便评估合理的扩容幅度。',
    handler: 'zhangwei', handledAt: '2026-10-05 15:18'
  },
  {
    id: 'ER-0999', userId: 207, username: 'liuqiang', name: '刘强', position: '',
    cacheCleared: true, skippedAutomations: 0,
    reason: '希望扩容。',
    submittedAt: '2026-09-28 10:10', status: 'REJECTED',
    newTotalGb: null, rejectReason: '申请说明过于简单，请补充使用场景和预计增量后重新提交。', handler: 'demo', handledAt: '2026-09-28 11:40'
  },
  {
    id: 'ER-0998', userId: 206, username: 'sun.xin', name: '孙欣', position: '',
    cacheCleared: true, skippedAutomations: 0,
    reason: '周报产物增多，申请扩容。',
    submittedAt: '2026-09-20 09:30', status: 'REJECTED',
    newTotalGb: null, rejectReason: '近期有大量重复产物，请先清理后再申请。', handler: 'zhangwei', handledAt: '2026-09-20 14:05'
  }
]

let members = seedMembers()
let requests = seedRequests()

/**
 * 与用户模块、岗位分配对齐（每次读写前调用）：
 * - 用户被删除 → 其容量记录与扩容申请一并移除；
 * - 在职 / 新增用户都有一条记录（新用户没统计过 → 未统计）；显示名、用户名、岗位取当前值；
 * - 停用账号保留记录但不进清单（active=false），其扩容申请同样不展示、不计入角标，重新启用后用量和申请都回来。
 * 申请上的岗位是提交时的快照，不随岗位分配变化；用户名 / 显示名随用户模块。
 */
function reconcile() {
  const users = listUsersSync()
  const alive = new Set(users.map((u) => u.id))
  members = members.filter((m) => alive.has(m.userId))
  requests = requests.filter((r) => alive.has(r.userId))
  for (const u of users) {
    let m = members.find((x) => x.userId === u.id)
    if (!m) {
      m = { userId: u.id, finalGb: null, cacheGb: null, quotaGb: null, statAt: null }
      members.push(m)
    }
    m.username = u.username
    m.name = u.displayName
    m.active = u.status === 'active'
    m.position = getAssignmentByUserId(u.id)?.positionName || ''
  }
  for (const r of requests) {
    const u = users.find((x) => x.id === r.userId)
    r.username = u.username
    r.name = u.displayName
    r.active = u.status === 'active'
  }
}

/** 清单里的员工（在职账号） */
const roster = () => members.filter((m) => m.active)

/** 页面可见的申请：停用账号的申请（含待处理）不展示、不计数、不能处理，重新启用后恢复 */
const visibleRequests = () => requests.filter((r) => r.active)

// v1（2026-10-09）：存储空间首版，容量分配 + 扩容申请。
// v2（2026-10-09）：员工改取用户模块真实在职账号；待处理扩容申请由 1 条增至 4 条，旧快照弃用回种子。
// v3（2026-10-09）：去掉「修改默认容量」，默认容量固定 5 GB，快照不再含 defaultQuotaGb，旧快照弃用回种子。
// v4（2026-10-09）：员工清单与用户模块 / 岗位分配真联动（种子只存用量，身份取当前值）；种子补徐琳与更多申请历史，旧快照弃用回种子。
// v5（2026-10-09）：扩容申请只展示当前用量，申请记录不再带申请时的 usedGb / totalGb，种子随之变，旧快照弃用回种子。
// v6（2026-10-10）：快照里 requests 也只存业务字段（去掉派生的 username / name / active，读时 reconcile 补回），旧快照弃用回种子。
const persist = attachPersist('storageSpace', {
  version: 6,
  // 只存业务数据；用户名 / 显示名 / 岗位 / 在职标记是派生值，每次读写前由 reconcile() 从用户模块取，不落存档
  snapshot: () => ({
    members: members.map(({ userId, finalGb, cacheGb, quotaGb, statAt }) => ({ userId, finalGb, cacheGb, quotaGb, statAt })),
    requests: requests.map(({ username, name, active, ...business }) => business)
  }),
  restore: (data) => {
    if (!data || !Array.isArray(data.members) || !Array.isArray(data.requests)) {
      throw new Error('storageSpace 快照形状不合法')
    }
    members = data.members
    requests = data.requests
  }
})

/* ---------------- 派生 ---------------- */
const totalOf = (m) => m.quotaGb ?? DEFAULT_QUOTA_GB
const usedOf = (m) => (m.finalGb == null ? null : round1(m.finalGb + (m.cacheGb || 0)))

/** 状态：未统计 / 已满 / 预警 / 正常（PRD 一·4）。 */
function stateOf(m) {
  const used = usedOf(m)
  if (used == null) return 'UNKNOWN'
  const total = totalOf(m)
  if (used >= total) return 'FULL'
  if (tenths(used) * 10 >= tenths(total) * 9) return 'WARN'
  return 'NORMAL'
}
const STATE_ORDER = { FULL: 0, WARN: 1, NORMAL: 2, UNKNOWN: 3 }

function pendingOf(userId) {
  return requests.find((r) => r.userId === userId && r.status === 'PENDING') || null
}

function toMemberRow(m) {
  const used = usedOf(m)
  const total = totalOf(m)
  const pending = pendingOf(m.userId)
  return {
    userId: m.userId,
    username: m.username,
    name: m.name,
    position: m.position,
    usedGb: used,
    finalGb: m.finalGb,
    cacheGb: m.cacheGb,
    totalGb: total,
    ratio: used == null ? null : used / total,
    state: stateOf(m),
    quotaSource: m.quotaGb == null ? 'DEFAULT' : 'PERSONAL',
    statAt: m.statAt,
    pendingRequestId: pending?.id || null
  }
}

const paginate = (rows, params) => {
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : rows.length || 10
  return { list: clone(rows.slice((page - 1) * size, page * size)), total: rows.length }
}

const matchKeyword = (item, keyword) =>
  !keyword || [item.name, item.username].some((v) => String(v).toLowerCase().includes(keyword))

/* ---------------- 校验 ---------------- */
function checkQuota(value, min = QUOTA_MIN_GB) {
  // 正整数、不小于 min（1 GB），不设上限：真实可分配上限取决于部署侧存储，不是产品规则；文案与页面共用 quotaInputError
  const message = quotaInputError(value, min)
  if (message) throw err(message, 40001, 'quotaGb')
  return Number(value)
}

function findMember(userId) {
  const m = members.find((row) => row.userId === Number(userId))
  if (!m) throw err('员工不存在', 40400)
  return m
}

/* ---------------- 访问审计 ---------------- */
function audit(action, m, detail, extra = {}) {
  appendOpsRecord({
    operator: currentDemoUsername(),
    module: '存储空间',
    action,
    target: m.username,
    detail,
    objectId: m.userId,
    meta: { userId: m.userId, username: m.username, ...extra }
  })
}

/* ---------------- 容量分配 ---------------- */
export async function getStorageOverview() {
  await delay(60)
  reconcile()
  return {
    defaultQuotaGb: DEFAULT_QUOTA_GB,
    defaultMemberCount: roster().filter((m) => m.quotaGb == null).length,
    pendingCount: visibleRequests().filter((r) => r.status === 'PENDING').length
  }
}

export async function listStorageMembers(params = {}) {
  await delay()
  reconcile()
  const keyword = String(params.keyword || '').trim().toLowerCase()
  const rows = roster()
    .map(toMemberRow)
    .filter((row) => matchKeyword(row, keyword))
    .filter((row) => !params.state || row.state === params.state)
    .filter((row) => !params.pending || row.pendingRequestId)
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (b.ratio ?? -1) - (a.ratio ?? -1))
  return paginate(rows, params)
}

/** 应用一次容量变更；总量没变不记审计。 */
function applyQuota(m, nextTotal, { restoreDefault = false } = {}) {
  const prevTotal = totalOf(m)
  // 填的值恰好等于当前总量：什么都不改（否则默认员工会悄悄变成「个人设置」，容量来源与人数都变了却没有记录）
  if (!restoreDefault && nextTotal === prevTotal) return false
  m.quotaGb = restoreDefault ? null : nextTotal
  const total = totalOf(m)
  if (total === prevTotal) return false
  audit('调整容量', m, `${prevTotal} GB → ${total} GB`, { fromGb: prevTotal, newTotalGb: total })
  return true
}

/** 同意扩容：申请结案为已同意，审计记「同意扩容」。prevTotal = 同意那一刻员工的当前总量（不是申请快照）。 */
function closePending(request, newTotalGb, prevTotal) {
  const member = findMember(request.userId)
  request.status = 'APPROVED'
  request.newTotalGb = newTotalGb
  request.handler = currentDemoUsername()
  request.handledAt = now()
  audit('同意扩容', member, `${prevTotal} GB → ${newTotalGb} GB`, { requestId: request.id, fromGb: prevTotal, newTotalGb })
}

/** 有待处理申请的员工不能在容量分配页调整，先去扩容申请页签同意或拒绝。 */
function assertNoPending(m) {
  if (pendingOf(m.userId)) throw err(`${m.name} 有待处理的扩容申请，请先在扩容申请页签处理`, 40900)
}

export async function adjustStorageQuota(userId, quotaGb, { restoreDefault = false } = {}) {
  await delay()
  reconcile()
  const m = findMember(userId)
  assertNoPending(m)
  const next = restoreDefault ? DEFAULT_QUOTA_GB : checkQuota(quotaGb)
  applyQuota(m, next, { restoreDefault })
  persist()
  return toMemberRow(m)
}

export async function batchAdjustStorageQuota(userIds, quotaGb) {
  await delay()
  reconcile()
  const ids = [...new Set(userIds || [])]
  if (!ids.length) throw err('请先选择员工', 40001)
  const next = checkQuota(quotaGb)
  const all = ids.map(findMember)
  // 只调整没有待处理申请的员工；有待处理申请的跳过并计数（页面上这些行的勾选框本来就是置灰的）
  const targets = all.filter((m) => !pendingOf(m.userId))
  let changed = 0
  for (const m of targets) {
    if (applyQuota(m, next)) changed += 1
  }
  persist()
  return { count: targets.length, changed, skipped: all.length - targets.length }
}

/* ---------------- 扩容申请 ---------------- */
export async function listExpansionRequests(params = {}) {
  await delay()
  reconcile()
  const keyword = String(params.keyword || '').trim().toLowerCase()
  const rows = visibleRequests()
    .filter((r) => matchKeyword(r, keyword))
    .filter((r) => !params.status || r.status === params.status)
    // 待处理永远在前、先到先处理；已处理按处理时间排序，默认倒序，列头箭头可切正序（PRD 四·2）
    .sort((a, b) => {
      if ((a.status === 'PENDING') !== (b.status === 'PENDING')) return a.status === 'PENDING' ? -1 : 1
      if (a.status === 'PENDING') return a.submittedAt.localeCompare(b.submittedAt)
      const dir = params.sortOrder === 'ascending' ? 1 : -1
      return a.handledAt.localeCompare(b.handledAt) * dir
    })
    // 列表展示的是员工「当前用量」（不是申请时的用量）：每行现算，员工清空间 / 管理员调整后刷新即变
    .map((r) => {
      const m = findMember(r.userId)
      return { ...r, current: { usedGb: usedOf(m), totalGb: totalOf(m) } }
    })
  return paginate(rows, params)
}

/** 取申请对应员工的当前用量，供同意弹窗展示（员工可能在申请后自行清出空间）。 */
export async function getExpansionRequest(id) {
  await delay(60)
  reconcile()
  const r = visibleRequests().find((row) => row.id === id)
  if (!r) throw err('申请不存在', 40400)
  const m = findMember(r.userId)
  return { ...clone(r), current: toMemberRow(m) }
}

function findPending(id) {
  const r = visibleRequests().find((row) => row.id === id)
  if (!r) throw err('申请不存在', 40400)
  if (r.status !== 'PENDING') throw err('该申请已被处理', 40900)
  return r
}

export async function approveExpansionRequest(id, newTotalGb) {
  await delay()
  reconcile()
  const r = findPending(id)
  const m = findMember(r.userId)
  const next = checkQuota(newTotalGb)
  if (next <= totalOf(m)) throw err(`新总量须大于当前总量 ${totalOf(m)} GB`, 40001, 'quotaGb')
  const prevTotal = totalOf(m) // 先取同意那一刻的当前总量，再写入新总量
  m.quotaGb = next
  closePending(r, next, prevTotal)
  persist()
  return clone(r)
}

export async function rejectExpansionRequest(id, reason) {
  await delay()
  reconcile()
  const r = findPending(id)
  const text = String(reason || '').trim()
  if (!text) throw err('请输入拒绝原因', 40001, 'reason')
  if (text.length > REJECT_REASON_MAX) throw err(`拒绝原因最多 ${REJECT_REASON_MAX} 字`, 40001, 'reason')
  r.status = 'REJECTED'
  r.rejectReason = text
  r.handler = currentDemoUsername()
  r.handledAt = now()
  audit('拒绝扩容', findMember(r.userId), text, { requestId: r.id })
  persist()
  return clone(r)
}

export function __resetStorageSpaceMock() {
  members = seedMembers()
  requests = seedRequests()
  persist()
}
