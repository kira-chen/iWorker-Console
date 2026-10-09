/**
 * 实例管理开发期 mock。
 * 只维护实例对象及运行处置，不提供任务/会话数据；浏览器刷新后保留本地演示状态。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { nowMinuteText as now } from '@/utils/datetime'
import { getEffectiveRuntimeSpecForUser } from './runtimeSpecMock'

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))
const err = (message, code = 40000) => new ApiError({ code, message })

const seedInstances = () => [
  { id: 'ins-240901', userId: 201, name: '张伟', username: 'zhangwei', position: '经营分析岗', status: 'RUNNING', actualSpec: '重', effectiveSpec: '重', specSource: '岗位继承 · 经营分析岗', userStatus: 'active', cpu: '4 核 / 16 Gi', usage: '2.8 核 / 9.6 Gi', startedAt: '2026-09-06 09:12', active: '2026-09-06 15:28', updatedAt: '2026-09-06 15:30', error: '—', operable: false, operationHint: '实例当前繁忙，暂不可执行运行操作', records: [] },
  { id: 'ins-240902', userId: 202, name: '李娜', username: 'li.na', position: '客户成功岗', status: 'IDLE', actualSpec: '轻', effectiveSpec: '轻', specSource: '岗位继承 · 客户成功岗', userStatus: 'active', cpu: '1 核 / 2 Gi', usage: '0.1 核 / 0.4 Gi', startedAt: '2026-09-06 08:40', active: '2026-09-06 14:56', updatedAt: '2026-09-06 15:30', error: '—', operable: true, operationHint: '', records: [] },
  { id: 'ins-240903', userId: 205, name: '周明', username: 'zhouming', position: '经营分析岗', status: 'ERROR', actualSpec: '专属 · 生产计划员', effectiveSpec: '专属 · 生产计划员', specSource: '个人配置', userStatus: 'disabled', cpu: '8 核 / 32 Gi', usage: '—', startedAt: '2026-09-06 07:55', active: '2026-09-06 14:42', updatedAt: '2026-09-06 15:30', error: '实例反复重启，请检查内存使用', operable: true, operationHint: '', records: [] },
  { id: 'ins-240904', userId: 208, name: '赵敏', username: 'zhaomin', position: '未绑定', status: 'IDLE', actualSpec: '标准', effectiveSpec: '重', specSource: '个人配置', userStatus: 'active', cpu: '2 核 / 4 Gi', usage: '0.2 核 / 0.8 Gi', startedAt: '2026-09-05 16:20', active: '2026-09-06 13:30', updatedAt: '2026-09-06 15:30', error: '—', operable: true, operationHint: '', records: [] },
  { id: 'ins-240905', userId: 203, name: '陈宇', username: 'chenyu', position: '未绑定', status: 'STARTING', actualSpec: '标准', effectiveSpec: '标准', specSource: '平台默认', userStatus: 'active', cpu: '2 核 / 4 Gi', usage: '—', startedAt: '2026-09-06 15:29', active: '2026-09-06 15:30', updatedAt: '2026-09-06 15:30', error: '—', operable: false, operationHint: '实例正在启动，请稍后刷新状态', pendingOperation: 'startup', transitionPollsRemaining: 1, records: [] }
]

let instances = seedInstances()
const persist = attachPersist('instanceManagement', {
  version: 2,
  snapshot: () => ({ instances }),
  restore: (data) => {
    if (!data || !Array.isArray(data.instances)) throw new Error('instanceManagement 快照形状不合法')
    instances = data.instances
  }
})

const clone = (value) => structuredClone(value)
const statusOrder = { ERROR: 0, STARTING: 1, RUNNING: 2, IDLE: 3, RECYCLING: 4 }

function advanceTransitions() {
  let changed = false
  instances = instances.filter((item) => {
    if (!item.pendingOperation) return true
    if (Number(item.transitionPollsRemaining) > 0) {
      item.transitionPollsRemaining -= 1
      changed = true
      return true
    }
    const record = item.records.find((row) => row.result === '已受理')
    if (record) {
      record.result = '成功'
      record.completedAt = now()
    }
    if (item.pendingOperation === 'recycle') {
      changed = true
      return false
    }
    if (item.pendingOperation === 'rebuild' && item.pendingActualSpec) item.actualSpec = item.pendingActualSpec
    item.status = 'IDLE'
    item.operable = true
    item.operationHint = ''
    item.updatedAt = now()
    delete item.pendingOperation
    delete item.pendingActualSpec
    delete item.transitionPollsRemaining
    changed = true
    return true
  })
  if (changed) persist()
}

export async function listInstances(params = {}) {
  await delay()
  advanceTransitions()
  await Promise.all(instances.map(async (item) => {
    const effective = await getEffectiveRuntimeSpecForUser(item.userId)
    if (effective) Object.assign(item, effective)
  }))
  const keyword = String(params.keyword || '').trim().toLowerCase()
  const rows = instances
    .filter((item) => !keyword || [item.name, item.username, item.id, item.position, item.actualSpec, item.effectiveSpec].some((value) => String(value).toLowerCase().includes(keyword)))
    .filter((item) => !params.status || item.status === params.status)
    .filter((item) => !params.position || item.position === params.position)
    .filter((item) => !params.spec || item.effectiveSpec === params.spec)
    .filter((item) => !params.pending || item.actualSpec !== item.effectiveSpec)
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || String(b.active).localeCompare(String(a.active)))
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : rows.length || 20
  return {
    list: clone(rows.slice((page - 1) * size, page * size)),
    total: rows.length,
    updatedAt: rows.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, '')
  }
}

export async function getInstance(id) {
  await delay(60)
  const item = instances.find((row) => row.id === String(id))
  if (!item) throw err('实例不存在', 40400)
  return clone(item)
}

export async function operateInstance(id, operation) {
  await delay()
  const item = instances.find((row) => row.id === String(id))
  if (!item) throw err('实例不存在', 40400)
  if (!['restart', 'rebuild', 'recycle'].includes(operation)) throw err('不支持的实例操作', 40001)
  if (!item.operable || ['STARTING', 'RECYCLING'].includes(item.status)) {
    throw err(item.operationHint || '当前实例不可操作', 40900)
  }
  if (operation === 'rebuild' && item.actualSpec === item.effectiveSpec) {
    throw err('当前实际规格已是最新生效规格', 40900)
  }
  const labels = { restart: '重启', rebuild: '按最新规格重建', recycle: '回收' }
  item.status = operation === 'recycle' ? 'RECYCLING' : 'STARTING'
  item.operable = false
  item.operationHint = operation === 'recycle' ? '实例正在回收，请稍后刷新状态' : '实例正在启动，请稍后刷新状态'
  item.updatedAt = now()
  item.pendingOperation = operation
  item.transitionPollsRemaining = 1
  if (operation === 'rebuild') item.pendingActualSpec = item.effectiveSpec
  item.records.unshift({ type: labels[operation], operator: '当前管理员', time: item.updatedAt, result: '已受理' })
  persist()
  return clone(item)
}

export function __resetInstanceMock() {
  instances = seedInstances()
  persist()
}
