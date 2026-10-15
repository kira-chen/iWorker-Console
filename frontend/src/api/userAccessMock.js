/**
 * 用户访问权限开发期 mock（06组织 › 用户访问权限，对齐 docs/PRD/数字员工管理端PRD/06组织/用户访问权限/prd.用户访问权限.md）。
 *
 * 两块数据：
 *  - grants    已被授予「完全访问」资格的（员工 × 运行环境）：本机、云端各授权各的（授权来源：管理员授权 / 申请通过）；
 *  - requests  员工端提交的权限申请，申请的是某一个运行环境的资格（待处理 / 已通过 / 已驳回）。
 * 授权名单一位员工一行，本机、云端两个环境的状态在行内各一份；（员工 × 环境）的状态是派生的：有授权 = 已授权；其余 = 未授权（有该环境的待处理申请只是 pendingRequestId 标记，不是状态）（默认，新建账号也是）。
 * 员工清单与用户模块、岗位分配**真联动**：每次读写前 reconcile()——用户被删除则其授权与申请一并移除，
 * 显示名 / 岗位取当前值，停用账号不进清单（其申请同样不展示、不计角标，重新启用后恢复）。
 * 员工端的「开关开 / 关」只存员工本机、不上传，所以这里没有「是否已开启」，管理端只管「有没有资格」。
 * 授权只分有 / 没有，不按权限类型拆开授权（操作记录里的权限类型只用来给留痕分类）。
 *
 * 第三块：操作记录——员工开启完全访问后，数字员工对运行环境的每一步操作由员工端上传留痕，管理端只读查看（PRD §四之二）。
 * 本页没有任何写入口，记录不可改删，所以是代码里的常量种子，不进持久化；员工显示名随用户模块，员工被删除后记录保留（审计留存）。
 *
 * 管理端操作写进访问审计（模块「用户访问权限」，动作：授权 / 收回 / 通过申请 / 驳回申请，meta 带运行环境），也是客户端状态同步与通知的来源。
 * 某环境有待处理申请的员工不能被直接授权或收回该环境，只能经申请的通过 / 驳回改变——页面上该行的操作是「待处理」，批量授权只作用于未授权的（员工 × 环境），其余自动跳过；
 * mock 同样拦截，防绕过页面。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { appendOpsRecord } from './accessAuditMock'
import { currentDemoUsername } from '@/utils/demoIdentity'
import { nowMinuteText as now } from '@/utils/datetime'
import { listUsersSync } from './adminUserMock'
import { getAssignmentByUserId } from './positionAssignmentMock'
import { REJECT_REASON_MAX, ENV_LABEL } from '@/utils/userAccess'

const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))
const err = (message, code = 40000, field = null) => new ApiError({ code, message, field })
const clone = (value) => structuredClone(value)
const ENVS = Object.keys(ENV_LABEL) // ['LOCAL', 'CLOUD']

// 授权种子，按用户模块的 userId 对应：张伟、赵敏由管理员授权（本机 + 云端），李娜只在本机、是申请通过（对应 UA-1002）。其余员工默认未授权。
const seedGrants = () => [
  { userId: 201, env: 'LOCAL', source: 'ADMIN', requestId: null, grantedAt: '2026-10-10 09:20', grantedBy: 'demo' },
  { userId: 201, env: 'CLOUD', source: 'ADMIN', requestId: null, grantedAt: '2026-10-10 09:21', grantedBy: 'demo' },
  { userId: 202, env: 'LOCAL', source: 'REQUEST', requestId: 'UA-1002', grantedAt: '2026-10-11 15:30', grantedBy: 'demo' },
  { userId: 208, env: 'LOCAL', source: 'ADMIN', requestId: null, grantedAt: '2026-10-09 17:05', grantedBy: 'zhangwei' },
  { userId: 208, env: 'CLOUD', source: 'ADMIN', requestId: null, grantedAt: '2026-10-09 17:06', grantedBy: 'zhangwei' }
]

// 权限申请：待处理 2 条（陈宇申请本机、带理由；王芳申请云端、没填理由，演示选填）；已处理 2 条：李娜（本机）已通过、刘强（本机）被驳回
// （处理人对应访问审计种子）。position 是提交时的岗位快照，不随岗位分配变化。
const seedRequests = () => [
  {
    id: 'UA-1004', userId: 203, username: 'chenyu', name: '陈宇', position: '', env: 'LOCAL',
    reason: '每周要批量整理本机的报销票据并生成汇总表，每一步都确认太打断，申请开启完全访问。',
    submittedAt: '2026-10-13 09:40', status: 'PENDING',
    rejectReason: '', handler: '', handledAt: ''
  },
  {
    id: 'UA-1003', userId: 204, username: 'wangfang', name: '王芳', position: '财务审核岗', env: 'CLOUD',
    reason: '',
    submittedAt: '2026-10-12 17:25', status: 'PENDING',
    rejectReason: '', handler: '', handledAt: ''
  },
  {
    id: 'UA-1002', userId: 202, username: 'li.na', name: '李娜', position: '客户成功岗', env: 'LOCAL',
    reason: '客户回访资料散在本机多个目录，需要数字员工直接读取整理。',
    submittedAt: '2026-10-11 11:02', status: 'APPROVED',
    rejectReason: '', handler: 'demo', handledAt: '2026-10-11 15:30'
  },
  {
    id: 'UA-1001', userId: 207, username: 'liuqiang', name: '刘强', position: '', env: 'LOCAL',
    reason: '想试试完全访问。',
    submittedAt: '2026-10-11 09:15', status: 'REJECTED',
    rejectReason: '当前任务无需完全访问，如确有需要请说明用途后重新申请。',
    handler: 'zhangwei', handledAt: '2026-10-11 10:12'
  }
]

let grants = seedGrants()
let requests = seedRequests()
let reqSeq = 1005 // 员工端提交申请的编号从这里续（演示用：本页不提供提交入口，只供测试模拟员工提交）

/**
 * 与用户模块、岗位分配对齐（每次读写前调用）：
 * - 用户被删除 → 其授权与权限申请一并移除；
 * - 显示名、用户名、岗位取当前值；停用账号保留记录但不进清单（active=false），其申请同样不展示、不计入角标，重新启用后恢复。
 * 申请上的岗位是提交时的快照，不随岗位分配变化；用户名 / 显示名随用户模块。
 */
let users = []
function reconcile() {
  users = listUsersSync().map((u) => ({
    userId: u.id,
    username: u.username,
    name: u.displayName,
    active: u.status === 'active',
    position: getAssignmentByUserId(u.id)?.positionName || ''
  }))
  const alive = new Set(users.map((u) => u.userId))
  grants = grants.filter((g) => alive.has(g.userId))
  requests = requests.filter((r) => alive.has(r.userId))
  for (const r of requests) {
    const u = users.find((x) => x.userId === r.userId)
    r.username = u.username
    r.name = u.name
    r.active = u.active
  }
}

/** 清单里的员工（在职账号） */
const roster = () => users.filter((u) => u.active)

/** 页面可见的申请：停用账号的申请（含待处理）不展示、不计数、不能处理，重新启用后恢复 */
const visibleRequests = () => requests.filter((r) => r.active)

// v1（2026-10-13）：用户访问权限首版，授权名单 + 权限申请。
// v2（2026-10-14）：授权与申请按运行环境（本机 / 云端）区分，授权、申请记录新增 env，种子随之变，旧快照弃用回种子。
const persist = attachPersist('userAccess', {
  version: 2,
  // 只存业务数据；用户名 / 显示名 / 在职标记是派生值，每次读写前由 reconcile() 从用户模块取，不落存档
  snapshot: () => ({
    grants,
    requests: requests.map(({ username, name, active, ...rest }) => rest),
    reqSeq
  }),
  restore: (data) => {
    if (!data || !Array.isArray(data.grants) || !Array.isArray(data.requests) || !Number.isFinite(data.reqSeq)) {
      throw new Error('userAccess 快照形状不合法')
    }
    grants = data.grants
    requests = data.requests
    reqSeq = data.reqSeq
  }
})

/* ---------------- 派生 ---------------- */
const grantOf = (userId, env) => grants.find((g) => g.userId === userId && g.env === env) || null
const pendingOf = (userId, env) => requests.find((r) => r.userId === userId && r.env === env && r.status === 'PENDING') || null

// 授权状态只有已授权 / 未授权两态；有待处理申请由 pendingRequestId 表示，不是状态
function stateOf(userId, env) {
  return grantOf(userId, env) ? 'GRANTED' : 'NONE'
}
/** 授权名单的一行 = 一位员工；两个运行环境（本机 / 云端）的授权状态在 envs 里各一份 */
function toMemberRow(u) {
  const envs = {}
  for (const env of ENVS) {
    const g = grantOf(u.userId, env)
    envs[env] = {
      state: stateOf(u.userId, env),
      source: g?.source || null,
      grantedAt: g?.grantedAt || '',
      grantedBy: g?.grantedBy || '',
      pendingRequestId: pendingOf(u.userId, env)?.id || null
    }
  }
  return { userId: u.userId, username: u.username, name: u.name, position: u.position, envs }
}

const paginate = (rows, params) => {
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : rows.length || 10
  return { list: clone(rows.slice((page - 1) * size, page * size)), total: rows.length }
}

const matchKeyword = (item, keyword) =>
  !keyword || [item.name, item.username].some((v) => String(v).toLowerCase().includes(keyword))

function findMember(userId) {
  const u = users.find((row) => row.userId === Number(userId))
  if (!u) throw err('员工不存在', 40400)
  return u
}

function checkEnv(env) {
  if (!ENVS.includes(env)) throw err('请选择运行环境', 40001, 'env')
  return env
}

/* ---------------- 操作记录（只读） ---------------- */
// 操作对象一律是脱敏后的内容（路径只留前两级目录、接口入参只留参数名不留值、页面只留域名与按钮文字，规则见 PRD 第八节 10），
// 员工端上传的留痕（id 只是管理端自己生成的行标识，不展示、不依赖客户端的会话 ID；一个会话的操作由客户端打包成一条上传；全部留存，管理端只展示近 90 天），记录单元是「一次开启了完全访问的会话任务」（同工具调用审计「会话调用」）：
// 会话里数字员工做了哪些操作——只记原本需要用户二次确认的操作（PRD 附录 5 类场景，归为 4 项权限），读文件等本来就不弹窗的不记。
// 只有在某环境拥有完全访问资格的员工才会在该环境产生记录：张伟 201（本机 + 云端）、李娜 202（本机）、赵敏 208（本机 + 云端）。
// date / time 是会话开启时间，分开存，供 useAuditList 按时间范围与排序使用；ops 按发生顺序排列，不记单次操作的时刻。
const ok = (type, target) => ({ type, target, result: 'SUCCESS', reason: '' })
export const accessOperationRecords = [
  { id: 'SS-3006', userId: 202, username: 'li.na', name: '李娜', env: 'LOCAL', date: '2026-10-13', time: '16:41:18',
    ops: [ok('FILE', 'Remove-Item D:/客户回访/* -Recurse'), ok('BIZ_SYSTEM', 'crm.example.com · 点击「保存」')] },
  { id: 'SS-3005', userId: 201, username: 'zhangwei', name: '张伟', env: 'CLOUD', date: '2026-10-13', time: '10:25:12',
    ops: [ok('COMMAND', 'chmod 777 /workspace/output'),
      { type: 'NETWORK', target: '经营数据接口 · POST /v1/reports/daily 入参：date', result: 'FAILED', reason: '接口返回 503，日报未写入' },
      ok('NETWORK', '经营数据接口 · POST /v1/reports/daily 入参：date（重试）')] },
  { id: 'SS-3004', userId: 208, username: 'zhaomin', name: '赵敏', env: 'LOCAL', date: '2026-10-12', time: '15:02:09',
    ops: [ok('FILE', "shutil.rmtree('D:/对账/*')"), ok('BIZ_SYSTEM', 'bank.example.com · 点击「提交」'),
      { type: 'HARDLINE', target: 'sudo -S ***', result: 'BLOCKED', reason: '疑似猜密码（sudo -S），客户端直接拦截，未执行' }] },
  { id: 'SS-3003', userId: 201, username: 'zhangwei', name: '张伟', env: 'LOCAL', date: '2026-10-11', time: '09:12:33',
    ops: [ok('FILE', 'rm D:/经营/周报/*'), ok('BIZ_SYSTEM', '技能回放「报销单录入」· oa.example.com 点击「提交」')] },
  { id: 'SS-3002', userId: 208, username: 'zhaomin', name: '赵敏', env: 'CLOUD', date: '2026-10-10', time: '11:20:14',
    ops: [{ type: 'BIZ_SYSTEM', target: 'bank.example.com · 点击「发送」', result: 'FAILED', reason: '页面响应超时，提交未生效' }] },
  { id: 'SS-3001', userId: 201, username: 'zhangwei', name: '张伟', env: 'CLOUD', date: '2026-10-09', time: '17:31:02',
    ops: [ok('COMMAND', 'curl -s https://tools.example.com/* | sh'), { type: 'HARDLINE', target: 'rm -rf /', result: 'BLOCKED', reason: '毁灭级命令，客户端直接拦截，未执行' }, ok('NETWORK', '经营数据接口 · POST /v1/reports/weekly 入参：week'),
      { type: 'HARDLINE', target: 'format D:', result: 'BLOCKED', reason: '命中管理规则（approvals.deny），客户端直接拦截，未执行' }] }
]

/** demo：全量返回（员工显示名取用户模块当前值，用户已删除的保留记录里的快照），由 useAuditList 的客户端模式筛选、排序、分页。 */
export async function listAccessOperations() {
  await delay(60)
  const current = new Map(listUsersSync().map((u) => [u.id, u]))
  for (const r of accessOperationRecords) {
    const u = current.get(r.userId)
    if (u) { r.username = u.username; r.name = u.displayName }
  }
  return accessOperationRecords
}

/* ---------------- 访问审计 ---------------- */
function audit(action, u, detail, env, extra = {}) {
  appendOpsRecord({
    operator: currentDemoUsername(),
    module: '用户访问权限',
    action,
    target: u.username,
    detail,
    objectId: u.userId,
    meta: { userId: u.userId, username: u.username, env, ...extra }
  })
}

/** 某环境有待处理申请的员工不能直接授权 / 收回该环境，先在授权名单的【处理申请】里通过或驳回。 */
function assertNoPending(u, env) {
  if (pendingOf(u.userId, env)) throw err(`${u.name} 有待处理的${ENV_LABEL[env]}权限申请，请先处理该申请`, 40900)
}

/* ---------------- 授权名单 ---------------- */
export async function getUserAccessOverview() {
  await delay(60)
  reconcile()
  return {
    pendingCount: visibleRequests().filter((r) => r.status === 'PENDING').length
  }
}

export async function listAccessMembers(params = {}) {
  await delay()
  reconcile()
  const keyword = String(params.keyword || '').trim().toLowerCase()
  // 状态筛选：选了运行环境就看该环境的状态，没选就看「任一环境」是否是该状态
  const matchState = (row) => {
    if (!params.state) return true
    const envs = params.env ? [params.env] : ENVS
    return envs.some((env) => row.envs[env].state === params.state)
  }
  // 「待处理申请」按钮：只看任一环境有待处理申请的员工
  const hasPending = (row) => ENVS.some((env) => !!row.envs[env].pendingRequestId)
  const matchPending = (row) => !params.hasPendingRequest || hasPending(row)
  // 排序：任一环境有待处理申请的在最前，其次有授权的（最近授权时间倒序），最后两个环境都未授权的（用户名升序）
  const rank = (row) => (hasPending(row) ? 0 : ENVS.some((e) => row.envs[e].state === 'GRANTED') ? 1 : 2)
  const latest = (row) => ENVS.map((e) => row.envs[e].grantedAt).sort().at(-1)
  const rows = roster()
    .filter((u) => matchKeyword(u, keyword))
    .map(toMemberRow)
    .filter(matchState)
    .filter(matchPending)
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      if (rank(a) === 1) return latest(b).localeCompare(latest(a)) || a.username.localeCompare(b.username)
      return a.username.localeCompare(b.username)
    })
  // 处理申请后置顶该员工（stable），供前端一次性高亮；同岗位管理的 focusUserId
  if (params.focusUserId != null) {
    const fid = String(params.focusUserId)
    rows.splice(0, rows.length, ...rows.filter((r) => String(r.userId) === fid), ...rows.filter((r) => String(r.userId) !== fid))
  }
  return paginate(rows, params)
}

/** 授权一位员工在某环境的资格；已授权的返回 false（批量时据此计入跳过），不重复写审计。 */
function applyGrant(u, env) {
  if (grantOf(u.userId, env)) return false
  grants.push({ userId: u.userId, env, source: 'ADMIN', requestId: null, grantedAt: now(), grantedBy: currentDemoUsername() })
  audit('授权', u, `未授权 → 已授权（${ENV_LABEL[env]}）`, env)
  return true
}

function applyRevoke(u, env) {
  grants = grants.filter((g) => !(g.userId === u.userId && g.env === env))
  audit('收回', u, `已授权 → 未授权（${ENV_LABEL[env]}）`, env)
}

/**
 * 设置一位员工的授权：在弹窗里勾选授权给本机、云端或两者，按差异提交。
 * @param {number} userId
 * @param {{grant?: string[], revoke?: string[]}} changes 要新授权的环境 / 要收回的环境
 * 每个被改动的环境各写一条审计；任一环境状态不符（该环境有待处理申请、已授权还要授权、未授权还要收回）整体拒绝、都不改，避免半成功。
 */
export async function updateAccess(userId, { grant = [], revoke = [] } = {}) {
  await delay()
  reconcile()
  const u = findMember(userId)
  const toGrant = [...new Set(grant)].map(checkEnv)
  const toRevoke = [...new Set(revoke)].map(checkEnv)
  if (!toGrant.length && !toRevoke.length) throw err('请先修改授权', 40001)
  for (const env of [...toGrant, ...toRevoke]) assertNoPending(u, env)
  for (const env of toGrant) if (grantOf(u.userId, env)) throw err(`${u.name} 在${ENV_LABEL[env]}已经是已授权状态`, 40900)
  for (const env of toRevoke) if (!grantOf(u.userId, env)) throw err(`${u.name} 在${ENV_LABEL[env]}当前没有完全访问权限`, 40900)
  for (const env of toGrant) applyGrant(u, env)
  for (const env of toRevoke) applyRevoke(u, env)
  persist()
  return toMemberRow(u)
}

/**
 * 批量授权：为所选员工授权所选的运行环境。已授权、有待处理申请的（员工 × 环境）自动跳过并计数。
 * @param {number[]} userIds
 * @param {string[]} envs 要授权的环境（本机 / 云端 / 两者）
 * @returns {{count: number, skipped: number}} count = 实际新授权的（员工 × 环境）数，skipped = 跳过数
 */
export async function batchGrantAccess(userIds, envs) {
  await delay()
  reconcile()
  const ids = [...new Set(userIds || [])]
  if (!ids.length) throw err('请先选择员工', 40001)
  const targetEnvs = [...new Set(envs || [])].map(checkEnv)
  if (!targetEnvs.length) throw err('请选择要授权的运行环境', 40001, 'env')
  const members = ids.map(findMember)
  let granted = 0
  let skipped = 0
  for (const u of members) {
    for (const env of targetEnvs) {
      if (pendingOf(u.userId, env) || grantOf(u.userId, env)) skipped += 1
      else if (applyGrant(u, env)) granted += 1
    }
  }
  persist()
  return { count: granted, skipped }
}

/* ---------------- 权限申请 ---------------- */
export async function listAccessRequests(params = {}) {
  await delay()
  reconcile()
  const keyword = String(params.keyword || '').trim().toLowerCase()
  const rows = visibleRequests()
    .filter((r) => matchKeyword(r, keyword))
    .filter((r) => !params.status || r.status === params.status)
    .filter((r) => !params.env || r.env === params.env)
    // 待处理永远在前、先到先处理；已处理按处理时间排序，默认倒序，列头箭头可切正序（PRD 四·2）
    .sort((a, b) => {
      if ((a.status === 'PENDING') !== (b.status === 'PENDING')) return a.status === 'PENDING' ? -1 : 1
      if (a.status === 'PENDING') return a.submittedAt.localeCompare(b.submittedAt)
      const dir = params.sortOrder === 'ascending' ? 1 : -1
      return a.handledAt.localeCompare(b.handledAt) * dir
    })
  return paginate(rows, params)
}

function findPending(id) {
  const r = visibleRequests().find((row) => row.id === id)
  if (!r) throw err('申请不存在', 40400)
  if (r.status !== 'PENDING') throw err('该申请已被处理', 40900)
  return r
}

export async function approveAccessRequest(id) {
  await delay()
  reconcile()
  const r = findPending(id)
  const u = findMember(r.userId)
  r.status = 'APPROVED'
  r.handler = currentDemoUsername()
  r.handledAt = now()
  grants.push({ userId: u.userId, env: r.env, source: 'REQUEST', requestId: r.id, grantedAt: r.handledAt, grantedBy: r.handler })
  audit('通过申请', u, `未授权 → 已授权（申请通过·${ENV_LABEL[r.env]}）`, r.env, { requestId: r.id })
  persist()
  return clone(r)
}

export async function rejectAccessRequest(id, reason) {
  await delay()
  reconcile()
  const r = findPending(id)
  const text = String(reason || '').trim()
  if (!text) throw err('请输入驳回原因', 40001, 'reason')
  if (text.length > REJECT_REASON_MAX) throw err(`驳回原因最多 ${REJECT_REASON_MAX} 字`, 40001, 'reason')
  r.status = 'REJECTED'
  r.rejectReason = text
  r.handler = currentDemoUsername()
  r.handledAt = now()
  audit('驳回申请', findMember(r.userId), text, r.env, { requestId: r.id })
  persist()
  return clone(r)
}

/**
 * 模拟员工端提交一条权限申请（本页没有提交入口，申请来自员工端；演示与测试用）。
 * 申请的是员工当前运行环境的资格：该环境已授权或已有待处理申请时员工端会拦截，这里同样拒绝；另一个环境不受影响。
 */
export async function submitAccessRequestAsEmployee(userId, env, reason = '') {
  await delay(60)
  reconcile()
  checkEnv(env)
  const u = findMember(userId)
  if (grantOf(u.userId, env)) throw err(`${u.name} 在${ENV_LABEL[env]}已有完全访问权限`, 40900)
  if (pendingOf(u.userId, env)) throw err(`${u.name} 已有待处理的${ENV_LABEL[env]}权限申请`, 40900)
  const r = {
    id: `UA-${reqSeq++}`, userId: u.userId, username: u.username, name: u.name, position: u.position, env,
    reason: String(reason || '').trim(), submittedAt: now(), status: 'PENDING',
    rejectReason: '', handler: '', handledAt: '', active: u.active
  }
  requests.push(r)
  persist()
  return clone(r)
}

export function __resetUserAccessMock() {
  grants = seedGrants()
  requests = seedRequests()
  reqSeq = 1005
  persist()
}
