/**
 * 运行规格开发期内存 mock（仅 DEV 生效，见 runtimeSpec.js 头注释）。
 *
 * 领域模型（2026-09-02 启动轮，基准=负责人交互截图 + 当日两点修正：①规格绑定对象为**用户**
 * 而非岗位——短期版本为每个用户分配 Pod；②不设「默认规格」概念）：
 * 运行规格 = 一档 k8s Pod 资源模板（demo 语义：requests=limits，QoS Guaranteed）+ 运行策略。
 * 管理员在此定义；FDE 只见「规格名 + 能力边界说明」，看不到任何技术参数（D17）。
 *
 * 字段 ↔ 落地映射（供抽屉提示，demo 不真连集群；2026-09-03 负责人拍板修订）：
 *   cpu → resources.requests/limits.cpu（核）
 *   memoryGi → resources.requests/limits.memory（Gi）
 *   diskGi → resources.requests/limits.ephemeral-storage（Gi）
 *   timeoutMin / idleRecycleMin / concurrency → 全部为平台侧业务策略，不映射 k8s 字段：
 *     任务超时=调用方发起任务后计时、N 分钟无结果主动结束该任务（非 activeDeadlineSeconds，
 *     运行模型为用户级常驻 Pod，做不到任务级 Pod）；空闲回收=平台回收器；并发=平台限流。
 *   （出网 egress 配置项已于 2026-09-03 取消，见 docs/调研讨论/2026-09-03-K8s-Node与Pod管理调研.md）
 *
 * 护栏：规格名平台内唯一；被用户使用（usedUsers 非空）不可删除。
 *
 * 【数据同源】usedUsers 以 adminUserMock 的 13 个用户种子做全量分配（每用户一档，短期口径）；
 * 用户管理侧尚无「运行规格」分配字段，暂为本文件静态绑定——待用户侧字段落地后双向联动。
 */
import { ApiError } from './request'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
let seq = 10

const now = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// approval: 'APPROVED' | 'PENDING'（仅 requireApproval 规格的绑定携带；无审批规格为 null）
const uu = (username, name, approval = null) => ({ username, name, approval })

const specs = [
  {
    id: 1,
    name: '轻',
    boundaryDesc: '可处理 20MB 以内文件，单次任务最长 3 分钟',
    cpu: 1, memoryGi: 2, diskGi: 5,
    timeoutMin: 3, idleRecycleMin: 10, concurrency: 200,
    requireApproval: false,
    usedUsers: [uu('chenyu', '陈宇'), uu('yangfan', '杨帆'), uu('wujie', '吴杰'), uu('ma.chao', '马超')],
    createdAt: '2026-08-15 10:20', updatedAt: '2026-08-28 09:40'
  },
  {
    id: 2,
    name: '标准',
    boundaryDesc: '大多数用户的常用配置。可处理 100MB 以内文件，单次任务最长 10 分钟',
    cpu: 2, memoryGi: 4, diskGi: 20,
    timeoutMin: 10, idleRecycleMin: 20, concurrency: 80,
    requireApproval: false,
    usedUsers: [
      uu('zhangwei', '张伟'), uu('li.na', '李娜'), uu('wangfang', '王芳'),
      uu('sun.xin', '孙欣'), uu('liuqiang', '刘强'), uu('xulin', '徐琳')
    ],
    createdAt: '2026-08-15 10:22', updatedAt: '2026-08-30 14:12'
  },
  {
    id: 3,
    name: '重',
    boundaryDesc: '文档处理、数据分析、报告生成。可处理 500MB 以内文件，单次任务最长 30 分钟',
    cpu: 4, memoryGi: 16, diskGi: 100,
    timeoutMin: 30, idleRecycleMin: 30, concurrency: 20,
    requireApproval: true,
    usedUsers: [uu('zhaomin', '赵敏', 'APPROVED'), uu('hejing', '何静', 'PENDING')],
    createdAt: '2026-08-16 09:05', updatedAt: '2026-08-29 16:55'
  },
  {
    id: 4,
    name: '高敏',
    boundaryDesc: '处理敏感数据的用户',
    cpu: 2, memoryGi: 8, diskGi: 50,
    timeoutMin: 15, idleRecycleMin: 15, concurrency: 10,
    requireApproval: false,
    usedUsers: [],
    createdAt: '2026-08-18 11:30', updatedAt: '2026-08-18 11:30'
  },
  {
    id: 5,
    name: '专属 · 生产计划员',
    boundaryDesc: '排产表体积大，需处理 800MB 以内文件',
    cpu: 8, memoryGi: 32, diskGi: 200,
    timeoutMin: 60, idleRecycleMin: 30, concurrency: 6,
    requireApproval: true,
    usedUsers: [uu('zhouming', '周明', 'APPROVED')],
    createdAt: '2026-08-20 15:48', updatedAt: '2026-08-26 10:08'
  }
]

const err = (message, code = 40000, field = null) => new ApiError({ code, message, field })

function findOr404(id) {
  const s = specs.find((x) => x.id === Number(id))
  if (!s) throw err('规格不存在', 40400)
  return s
}

function assertNameUnique(name, excludeId) {
  if (specs.some((s) => s.name === name && s.id !== excludeId)) {
    throw err('规格名称已存在，请换一个', 40001, 'name')
  }
}

// 校验（服务端兜底，与抽屉同口径）
function validatePayload(p) {
  const name = String(p.name || '').trim()
  if (!name) throw err('规格名称不能为空', 40001, 'name')
  if (name.length > 64) throw err('规格名称不超过 64 字符', 40001, 'name')
  if (!String(p.boundaryDesc || '').trim()) throw err('能力边界说明必填', 40001, 'boundaryDesc')
  for (const [k, label] of [
    ['cpu', 'CPU'], ['memoryGi', '内存'], ['diskGi', '临时磁盘'],
    ['timeoutMin', '任务超时'], ['idleRecycleMin', '空闲回收'], ['concurrency', '并发上限']
  ]) {
    if (!(Number(p[k]) > 0)) throw err(`${label}须为大于 0 的数值`, 40001, k)
  }
}

// 出参行（列表与详情同构；usedUsers 给拷贝）
function toRow(s) {
  return {
    ...s,
    usedUsers: s.usedUsers.map((u) => ({ ...u })),
    usedCount: s.usedUsers.length,
    // 在用审批汇总：需审批规格有待审绑定 → PENDING；有绑定且全过 → APPROVED；其余 null
    approvalSummary: !s.requireApproval || !s.usedUsers.length
      ? null
      : s.usedUsers.some((u) => u.approval === 'PENDING') ? 'PENDING' : 'APPROVED'
  }
}

function applyPayload(s, p) {
  validatePayload(p)
  const name = String(p.name).trim()
  assertNameUnique(name, s?.id)
  return {
    name,
    boundaryDesc: String(p.boundaryDesc).trim(),
    cpu: Number(p.cpu), memoryGi: Number(p.memoryGi), diskGi: Number(p.diskGi),
    timeoutMin: Number(p.timeoutMin), idleRecycleMin: Number(p.idleRecycleMin),
    concurrency: Number(p.concurrency),
    requireApproval: !!p.requireApproval
  }
}

/* ============================ 接口 ============================ */

// 列表（按创建序，照截图行序：轻→标准→重→高敏→专属）。summary 供底部「N 个规格 · M 个用户已配置」。
export async function listRuntimeSpecs(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const list = specs
    .filter((s) => !kw || s.name.toLowerCase().includes(kw) || s.boundaryDesc.toLowerCase().includes(kw))
    .sort((a, b) => a.id - b.id)
    .map(toRow)
  return {
    list,
    total: list.length,
    summary: {
      specCount: specs.length,
      userCount: specs.reduce((n, s) => n + s.usedUsers.length, 0)
    }
  }
}

export async function getRuntimeSpec(id) {
  await delay()
  return toRow(findOr404(id))
}

export async function createRuntimeSpec(payload) {
  await delay()
  const next = applyPayload(null, payload)
  const s = { id: ++seq, ...next, usedUsers: [], createdAt: now(), updatedAt: now() }
  specs.push(s)
  return toRow(s)
}

export async function updateRuntimeSpec(id, payload) {
  await delay()
  const s = findOr404(id)
  Object.assign(s, applyPayload(s, payload), { updatedAt: now() })
  return toRow(s)
}

/**
 * 删除护栏：被用户使用不可删（message 携用户名单，页面直接展示）。
 */
export async function deleteRuntimeSpec(id) {
  await delay()
  const s = findOr404(id)
  if (s.usedUsers.length) {
    throw err(
      `该规格正在被 ${s.usedUsers.length} 个用户使用（${s.usedUsers.map((u) => u.name).join('、')}），需先为这些用户改配其他规格后再删除`,
      40004
    )
  }
  specs.splice(specs.indexOf(s), 1)
  return true
}
