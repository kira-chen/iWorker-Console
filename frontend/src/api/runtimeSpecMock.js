/**
 * 运行规格开发期内存 mock（仅 DEV 生效）。
 * 生效优先级：个人配置（审批通过） > 岗位规格 > 平台默认规格。
 * 待审批的个人申请不替换当前规格；岗位是批量配置入口，一个岗位最多绑定一个规格。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { listUsers } from './adminUserMock'
import { listPositions } from './positionMock'
import { listPositionAssignments } from './positionAssignmentMock'
import { appendOpsRecord } from './accessAuditMock'
import { currentDemoUsername } from '@/utils/demoIdentity'
import { nowMinuteText as now } from '@/utils/datetime'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
let seq = 10
const relation = (username, name, approval = null) => ({ username, name, approval })

// 演示环境上限；正式环境由后端根据可调度单节点能力和平台安全策略返回。
const resourceLimits = { cpu: 32, memoryGi: 128, diskGi: 500 }

const seedSpecs = () => [
  { id: 1, name: '轻', boundaryDesc: '轻量问答与日常处理，可处理 20MB 以内文件', cpu: 1, memoryGi: 2, diskGi: 5, readinessTimeoutMin: 5, idleRecycleMin: 10, maxLifetimeHours: 0, isDefault: false, positionIds: [402], allowUserApply: true, requireApproval: true, directUsers: [], createdAt: '2026-08-15 10:20', updatedAt: '2026-08-28 09:40' },
  { id: 2, name: '标准', boundaryDesc: '大多数用户的常用配置，可处理 100MB 以内文件', cpu: 2, memoryGi: 4, diskGi: 20, readinessTimeoutMin: 10, idleRecycleMin: 20, maxLifetimeHours: 0, isDefault: true, positionIds: [], allowUserApply: false, requireApproval: false, directUsers: [], createdAt: '2026-08-15 10:22', updatedAt: '2026-08-30 14:12' },
  { id: 3, name: '重', boundaryDesc: '文档处理、数据分析、报告生成，可处理 500MB 以内文件', cpu: 4, memoryGi: 16, diskGi: 100, readinessTimeoutMin: 15, idleRecycleMin: 30, maxLifetimeHours: 24, isDefault: false, positionIds: [401], allowUserApply: true, requireApproval: true, directUsers: [relation('zhaomin', '赵敏', 'APPROVED'), relation('hejing', '何静', 'PENDING')], createdAt: '2026-08-16 09:05', updatedAt: '2026-08-29 16:55' },
  { id: 4, name: '高敏', boundaryDesc: '处理敏感数据的隔离运行环境', cpu: 2, memoryGi: 8, diskGi: 50, readinessTimeoutMin: 10, idleRecycleMin: 15, maxLifetimeHours: 8, isDefault: false, positionIds: [], allowUserApply: true, requireApproval: true, directUsers: [], createdAt: '2026-08-18 11:30', updatedAt: '2026-08-18 11:30' },
  { id: 5, name: '专属 · 生产计划员', boundaryDesc: '排产表体积大，可处理 800MB 以内文件', cpu: 8, memoryGi: 32, diskGi: 200, readinessTimeoutMin: 20, idleRecycleMin: 30, maxLifetimeHours: 12, isDefault: false, positionIds: [], allowUserApply: true, requireApproval: true, directUsers: [relation('zhouming', '周明', 'APPROVED')], createdAt: '2026-08-20 15:48', updatedAt: '2026-08-26 10:08' }
]

let specs = seedSpecs()

// v2 对应默认规格、岗位继承、个人例外及9字段契约；旧版运行规格缓存自动失效。
const persist = attachPersist('runtimeSpec', {
  version: 2,
  snapshot: () => ({ seq, specs }),
  restore: (data) => {
    if (!data || !Number.isFinite(data.seq) || !Array.isArray(data.specs)) {
      throw new Error('runtimeSpec 快照形状不合法')
    }
    seq = data.seq
    specs = data.specs
  }
})

const err = (message, code = 40000, field = null) => new ApiError({ code, message, field })
function findOr404(id) {
  const s = specs.find((x) => x.id === Number(id))
  if (!s) throw err('规格不存在', 40400)
  return s
}
/**
 * 校验文案 2026-09-12 逐字对齐 md 运行规格 §四.10（审计 K28）；顺序照 §四.7 L344「必填 → 格式 → 数值范围 → 名称唯一」。
 * 与 RuntimeSpecEditor.validate() 同一套文案：编辑器先拦一次，保存接口再拦一次（md §四.4 L303「保存接口必须再次校验上限」）。
 */
const isIntAtLeast1 = (v) => Number.isInteger(Number(v)) && Number(v) >= 1
function validatePayload(p) {
  const name = String(p.name || '').trim()
  if (!name) throw err('规格名称不能为空', 40001, 'name')
  if (name.length > 64) throw err('规格名称最多 64 个字符', 40001, 'name')
  const boundaryDesc = String(p.boundaryDesc || '').trim()
  if (!boundaryDesc) throw err('请填写能力边界说明', 40001, 'boundaryDesc')
  if (boundaryDesc.length > 200) throw err('能力边界说明最多 200 个字符', 40001, 'boundaryDesc')
  // CPU：≥0.5 且按 0.5 递增（乘 2 后须为整数，避免浮点比较）
  const cpu = Number(p.cpu)
  if (!(cpu >= 0.5) || !Number.isInteger(cpu * 2)) throw err('CPU须不小于 0.5 核，并按照 0.5 递增', 40001, 'cpu')
  if (!isIntAtLeast1(p.memoryGi)) throw err('内存须为不小于 1 的整数', 40001, 'memoryGi')
  if (!isIntAtLeast1(p.diskGi)) throw err('临时存储须为不小于 1 的整数', 40001, 'diskGi')
  if (!isIntAtLeast1(p.readinessTimeoutMin)) throw err('就绪等待超时须为不小于 1 的整数分钟', 40001, 'readinessTimeoutMin')
  if (!isIntAtLeast1(p.idleRecycleMin)) throw err('空闲回收须为不小于 1 的整数分钟', 40001, 'idleRecycleMin')
  if (!(Number(p.maxLifetimeHours) >= 0) || !Number.isInteger(Number(p.maxLifetimeHours))) throw err('最大存活时长须为非负整数小时，0 表示不限', 40001, 'maxLifetimeHours')
  // 超过平台单实例上限（md §四.4 L302 模板「不能超过平台单实例上限 {最大值}{单位}」）
  for (const [key, unit] of [['cpu', '核'], ['memoryGi', 'Gi'], ['diskGi', 'Gi']]) {
    if (Number(p[key]) > resourceLimits[key]) {
      throw err(`不能超过平台单实例上限 ${resourceLimits[key]}${unit}`, 40001, key)
    }
  }
  if (specs.some((s) => s.name === name && s.id !== p.id)) throw err('规格名称已存在，请换一个', 40001, 'name')
}
async function getContext() {
  const [userData, positionData, assignmentData] = await Promise.all([
    listUsers({ size: 200 }), listPositions({ size: 200, status: 'published' }), listPositionAssignments({ size: 200 })
  ])
  return {
    users: userData.list || [], positions: positionData.list || [],
    assignments: new Map((assignmentData.list || []).map((a) => [a.username, a]))
  }
}
function resolveUser(user, ctx) {
  let activeDirect = null
  let pending = null
  for (const spec of specs) {
    const rel = spec.directUsers.find((x) => x.username === user.username)
    if (!rel) continue
    if (rel.approval === 'PENDING') pending = { spec, relation: rel }
    else activeDirect = { spec, relation: rel }
  }
  if (activeDirect) return { effective: activeDirect.spec, source: 'USER', pending }
  const assignment = ctx.assignments.get(user.username)
  const inherited = assignment?.positionId != null ? specs.find((s) => s.positionIds.includes(Number(assignment.positionId))) : null
  if (inherited) return { effective: inherited, source: 'POSITION', positionName: assignment.positionName, pending }
  return { effective: specs.find((s) => s.isDefault), source: 'DEFAULT', pending }
}
async function enrichedRows() {
  const ctx = await getContext()
  const positionMap = new Map(ctx.positions.map((p) => [Number(p.positionId), p.name]))
  const states = ctx.users.map((user) => ({ user, ...resolveUser(user, ctx) }))
  return specs.map((s) => {
    const effectiveUsers = states.filter((x) => x.effective?.id === s.id).map((x) => ({ username: x.user.username, name: x.user.displayName, source: x.source, positionName: x.positionName || '' }))
    const pendingUsers = states.filter((x) => x.pending?.spec.id === s.id).map((x) => ({ username: x.user.username, name: x.user.displayName, approval: 'PENDING' }))
    const positionNames = s.positionIds.map((id) => positionMap.get(Number(id))).filter(Boolean)
    return { ...s, positionIds: [...s.positionIds], positionNames, positionCount: positionNames.length, directUsers: s.directUsers.map((u) => ({ ...u })), effectiveUsers, pendingUsers, usedUsers: [...effectiveUsers, ...pendingUsers], usedCount: effectiveUsers.length, pendingCount: pendingUsers.length, approvalSummary: pendingUsers.length ? 'PENDING' : null }
  })
}
function payloadOf(s, p) {
  const data = { ...p, id: s?.id }
  validatePayload(data)
  const allowUserApply = !!p.allowUserApply
  return {
    name: String(p.name).trim(), boundaryDesc: String(p.boundaryDesc).trim(),
    cpu: Number(p.cpu), memoryGi: Number(p.memoryGi), diskGi: Number(p.diskGi), readinessTimeoutMin: Number(p.readinessTimeoutMin), idleRecycleMin: Number(p.idleRecycleMin), maxLifetimeHours: Number(p.maxLifetimeHours),
    positionIds: [...new Set((p.positionIds || []).map(Number))], allowUserApply, requireApproval: allowUserApply
  }
}
function occupyPositions(targetId, positionIds) {
  positionIds.forEach((positionId) => specs.forEach((s) => {
    if (s.id !== targetId) s.positionIds = s.positionIds.filter((id) => id !== positionId)
  }))
}

export async function listRuntimeSpecs(params = {}) {
  await delay()
  const rows = await enrichedRows()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const approval = String(params.approval || '')
  const usage = String(params.usage || '')
  const sortDirection = params.sortOrder === 'ascending' ? 1 : -1
  const filtered = rows
    .filter((s) => !kw || [s.name, s.boundaryDesc, ...s.positionNames].some((v) => String(v).toLowerCase().includes(kw)))
    .filter((s) => !approval || (approval === 'required' ? s.allowUserApply && s.requireApproval : !s.requireApproval))
    .filter((s) => !usage || (usage === 'used' ? s.usedCount > 0 : s.usedCount === 0))
    .sort((a, b) => {
      const updated = String(a.updatedAt).localeCompare(String(b.updatedAt))
      if (updated) return updated * sortDirection
      return String(a.createdAt).localeCompare(String(b.createdAt)) * sortDirection
    })
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : filtered.length || 20
  return {
    list: params.page || params.size ? filtered.slice((page - 1) * size, page * size) : filtered,
    total: filtered.length,
    summary: { specCount: specs.length, userCount: rows.reduce((n, s) => n + s.usedCount, 0), positionCount: rows.reduce((n, s) => n + s.positionCount, 0) }
  }
}

export async function getRuntimeSpecLimits() {
  await delay(80)
  return { ...resourceLimits }
}

export async function listRuntimeSpecUsers(specId, params = {}) {
  await delay(80)
  const target = findOr404(specId)
  const ctx = await getContext()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const rows = ctx.users.map((u) => {
    const state = resolveUser(u, ctx)
    const isPending = state.pending?.spec.id === target.id
    const isEffective = state.effective?.id === target.id
    return { userId: u.id, username: u.username, displayName: u.displayName, status: u.status, roles: u.roles, currentSpecId: state.effective?.id || null, currentSpecName: state.effective?.name || '', source: state.source, positionName: state.positionName || '', approval: isPending ? 'PENDING' : null, pendingSpecName: state.pending?.spec.name || '', isCurrent: isEffective || isPending, isEffective, isPending }
  }).filter((u) => !kw || [u.username, u.displayName, u.currentSpecName, u.positionName].some((v) => String(v).toLowerCase().includes(kw)))
  return { list: rows, total: rows.length, spec: (await enrichedRows()).find((s) => s.id === target.id) }
}

export async function assignRuntimeSpecUsers(specId, usernames = []) {
  await delay()
  const target = findOr404(specId)
  const data = await listUsers({ size: 200 })
  const userMap = new Map((data.list || []).map((u) => [u.username, u]))
  const unique = [...new Set((Array.isArray(usernames) ? usernames : []).filter(Boolean))]
  if (!unique.length) throw err('请至少选择一个用户', 40001)
  unique.forEach((username) => {
    const user = userMap.get(username)
    if (!user) throw err(`用户 ${username} 不存在`, 40400)
    if (user.status === 'disabled') throw err(`用户 ${user.displayName || username} 已停用，不能配置规格`, 40004)
  })
  unique.forEach((username) => {
    const user = userMap.get(username)
    // 管理员配置是授权动作，保存后立即生效；只有用户自主申请才进入审批。
    specs.forEach((s) => { s.directUsers = s.directUsers.filter((u) => u.username !== username) })
    target.directUsers.push(relation(username, user.displayName || username))
  })
  persist()
  // md 访问审计 §6「运行规格记录」：个人例外确认配置后写入管理端操作
  appendOpsRecord({ operator: currentDemoUsername(), module: '运行规格', action: '个人配置', target: target.name, detail: `为 ${unique.length} 个用户配置规格「${target.name}」` })
  return { count: unique.length, pending: false }
}

export async function applyRuntimeSpecForUser(specId, username) {
  await delay()
  const target = findOr404(specId)
  if (!target.allowUserApply) throw err('该规格当前不开放用户申请', 40004)
  const data = await listUsers({ size: 200 })
  const user = (data.list || []).find((item) => item.username === username)
  if (!user) throw err(`用户 ${username} 不存在`, 40400)
  if (user.status === 'disabled') throw err(`用户 ${user.displayName || username} 已停用，不能申请规格`, 40004)
  specs.forEach((s) => { s.directUsers = s.directUsers.filter((u) => !(u.username === username && u.approval === 'PENDING')) })
  target.directUsers.push(relation(username, user.displayName || username, 'PENDING'))
  persist()
  return { pending: true }
}

export async function unassignRuntimeSpecUser(specId, username) {
  await delay()
  const target = findOr404(specId)
  const before = target.directUsers.length
  target.directUsers = target.directUsers.filter((u) => u.username !== username)
  if (before === target.directUsers.length) throw err('该用户没有此规格的个人配置或待审批申请', 40400)
  persist()
  return true
}

export async function getRuntimeSpec(id) {
  await delay()
  const row = (await enrichedRows()).find((x) => x.id === Number(id))
  if (!row) throw err('规格不存在', 40400)
  return row
}
export async function createRuntimeSpec(payload) {
  await delay()
  const next = payloadOf(null, payload)
  const id = ++seq
  occupyPositions(id, next.positionIds)
  specs.push({ id, ...next, isDefault: false, directUsers: [], createdAt: now(), updatedAt: now() })
  persist()
  return getRuntimeSpec(id)
}
export async function updateRuntimeSpec(id, payload) {
  await delay()
  const s = findOr404(id)
  const next = payloadOf(s, payload)
  // md §四.8.3 L372 / §四.10 L398（审计 K29）：存在待审批申请时关闭申请入口 → 阻止保存并提示先处理或撤回
  const pendingCount = s.directUsers.filter((u) => u.approval === 'PENDING').length
  if (s.allowUserApply && !next.allowUserApply && pendingCount > 0) {
    throw err(`存在 ${pendingCount} 个待审批申请，请先处理或撤回相关申请后再关闭申请入口`, 40004, 'allowUserApply')
  }
  occupyPositions(s.id, next.positionIds)
  Object.assign(s, next, { updatedAt: now() })
  persist()
  return getRuntimeSpec(s.id)
}
export async function deleteRuntimeSpec(id) {
  await delay()
  const s = findOr404(id)
  // 2026-09-12 对齐 md §三.3.6 L222（审计 K28）
  if (s.isDefault) throw err('默认运行规格用于平台兜底，不能删除', 40004)
  if (s.positionIds.length) throw err(`该规格已配置给 ${s.positionIds.length} 个岗位，请先解除岗位配置`, 40004)
  if (s.directUsers.length) throw err(`该规格存在 ${s.directUsers.length} 个个人配置或待审批申请，请先处理后再删除`, 40004)
  specs.splice(specs.indexOf(s), 1)
  persist()
  return true
}
export function __resetRuntimeSpecMock() {
  specs = seedSpecs()
  seq = 10
  persist()
}

/**
 * 删岗级联：把该岗位 id 从所有运行规格的 positionIds 里摘掉（positionMock.deletePosition 调用）。
 * 不摘会导致 posSeq 回种子后新建的第一个岗位复用同一个 id 时，直接「继承」上一轮同 id 岗位
 * 遗留的运行规格配置（2026-09-23 待办 yuepu#9⑥）。
 */
export function unassignPositionFromAllSpecs(positionId) {
  const pid = Number(positionId)
  specs.forEach((s) => { s.positionIds = s.positionIds.filter((id) => id !== pid) })
  persist()
}
