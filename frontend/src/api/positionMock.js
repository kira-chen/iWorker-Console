/**
 * 岗位列表页 + 岗位工作台内存 mock（demo 数据层，模式同 apiConnectorMock.js；开关见 position.js 头注释）。
 *
 * 【覆盖范围】
 * - 2026-09-01 PRD 对齐改造：AdminPositions.vue 列表页与 AdminPositionAssignments.vue 所调用的
 *   接口（含版本管理侧栏 versionAdapter 所调接口）。
 * - 2026-09-02 工作台补 mock（负责人拍板沿用 PositionDetailTabs 完整独立页）：岗位详情树
 *   getPosition / updatePosition、Agent CRUD、技能引用 assign/detach、平台技能候选。
 *   与列表页 4 条岗位种子同源联动：agentCount / skillIds(技能数) 由工作台 agents 引用推导，
 *   技能本体从 unifiedSkillMock 同源取（不造第二份真相），引用变化回写技能 refNames。
 * - 工作档案（数据表）与样例任务的工作台数据在 dataTableMock.js / sampleTaskMock.js（同开关）。
 *
 * 种子数据照交互原型 v2（renderPositions 区，约 L1157）：
 * 岗位 4 条 —— 经营分析岗 v2.1.0 已发布 / 客户成功岗 v1.4.0 已发布 / 财务审核岗 审核中 /
 * 市场研究岗 未发布无版本；含 agentCount / claimCount / skillIds、创建与更新时间；
 * 版本历史含 大小 / 发布人 / 发布时间 / 禁用时间 / 升级说明。
 *
 * 状态口径（Q6：不改共享 publishState 语义，展示层三态映射在页面做）：
 * - 本体 status: draft | published；pendingAction: PUBLISH | DELIST | null。
 * - 列表 status 筛选参数：all | draft(未发布) | reviewing(审核中) | published(已发布)，
 *   按原型 positionView 的标签口径过滤（pendingAction 优先判审核中）。
 * - 版本历史「同一时间只能启用一个版本」（原型 togglePositionHistory 互斥逻辑）：
 *   relist 启用某版本时其余 ACTIVE 版本自动转 DELISTED；最后一个启用版本不可禁用。
 */
import { ApiError } from './request'
import * as skillMock from './unifiedSkillMock'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let posSeq = 405
let agentSeq = 520

// 北京时间「现在」→ ISO 串（mock 内时间统一带 +08:00，展示走 fmtTime 精确到分钟）
function nowIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`
  )
}

/* ---------------- 岗位种子（照原型 positionRows + positionCountSeeds） ---------------- */
let positions = [
  {
    positionId: 401,
    name: '经营分析岗',
    description: '负责经营数据汇总、异常识别与经营分析报告输出',
    icon: '▤',
    skillIds: [301],
    agentCount: 3,
    claimedUserCount: 26,
    status: 'published',
    pendingAction: null,
    latestVersion: 'v2.1.0',
    createdAt: '2026-08-12T09:30:00+08:00',
    updatedAt: '2026-08-25T16:20:00+08:00'
  },
  {
    positionId: 402,
    name: '客户成功岗',
    description: '负责客户资料准备、拜访跟进与服务过程记录',
    icon: '◎',
    skillIds: [305],
    agentCount: 2,
    claimedUserCount: 18,
    status: 'published',
    pendingAction: null,
    latestVersion: 'v1.4.0',
    createdAt: '2026-08-14T10:05:00+08:00',
    updatedAt: '2026-08-24T14:35:00+08:00'
  },
  {
    positionId: 403,
    name: '财务审核岗',
    description: '负责报销材料核验、财务单据检查与风险提示',
    icon: '¥',
    skillIds: [301],
    agentCount: 1,
    claimedUserCount: 6,
    status: 'draft',
    pendingAction: 'PUBLISH',
    pendingVersion: 'v1.0.0',
    pendingReleaseNotes: '首个版本',
    latestVersion: 'v1.0.0',
    createdAt: '2026-08-20T15:40:00+08:00',
    updatedAt: '2026-08-25T10:18:00+08:00'
  },
  {
    positionId: 404,
    name: '市场研究岗',
    description: '负责行业资料整理、竞品跟踪与研究结论沉淀',
    icon: '⌁',
    skillIds: [],
    agentCount: 0,
    claimedUserCount: 0,
    status: 'draft',
    pendingAction: null,
    latestVersion: '',
    createdAt: '2026-08-23T09:42:00+08:00',
    updatedAt: '2026-08-23T09:42:00+08:00'
  }
]

/* ---------------- 版本历史种子（照原型 seededPositionHistory：当前版 + 上一版） ---------------- */
// 行结构对齐 VersionHistoryList：version(内部序号)/versionLabel/status/sizeBytes/publishedBy/
// publishedAt/delistedAt/releaseNotes。7782B≈7.6KB、7475B≈7.3KB（原型固定示意值）。
let publications = {
  401: [
    { version: 2, versionLabel: 'v2.1.0', status: 'ACTIVE', sizeBytes: 7782, publishedBy: '管理员', publishedAt: '2026-08-25T16:20:00+08:00', delistedAt: null, releaseNotes: '当前线上版本' },
    { version: 1, versionLabel: 'v2.0.0', status: 'DELISTED', sizeBytes: 7475, publishedBy: '管理员', publishedAt: '2026-08-18T10:20:00+08:00', delistedAt: '2026-08-25T16:20:00+08:00', releaseNotes: '历史版本' }
  ],
  402: [
    { version: 2, versionLabel: 'v1.4.0', status: 'ACTIVE', sizeBytes: 7782, publishedBy: '管理员', publishedAt: '2026-08-24T14:35:00+08:00', delistedAt: null, releaseNotes: '当前线上版本' },
    { version: 1, versionLabel: 'v1.3.0', status: 'DELISTED', sizeBytes: 7475, publishedBy: '管理员', publishedAt: '2026-08-18T10:20:00+08:00', delistedAt: '2026-08-24T14:35:00+08:00', releaseNotes: '历史版本' }
  ],
  // 财务审核岗首发在审：尚无审核通过的快照（原型 version 字段 v1.0.0 为在审的 pendingVersion）
  403: [],
  404: []
}

/* ---------------- 工作台详情种子（岗位树：身份卡字段 + Agent → 技能引用） ----------------
 * 与列表种子同源联动口径：agents 数量 = 列表 agentCount；全部 Agent 引用的技能并集 = 列表 skillIds。
 * 技能只存引用 { skillId, sortOrder }，本体（名称/描述/工具）渲染时从 unifiedSkillMock 同源取。 */
function buildWorkbenchSeed() {
  return {
    401: {
      intro: '面向经营层的经营数据分析 AI 同事',
      iconSource: 'library',
      claimDesc: [
        { emoji: '📊', content: '每天自动汇总经营数据，异常主动提醒' },
        { emoji: '📝', content: '一句话生成经营分析周报' }
      ],
      // 岗位认领说明（2026-09-04 PRD-20260903 对齐：新原型 ensure() 种子口径，纯文本一行一条）
      claimDescriptions: ['自动汇总各业务线经营数据', '识别异常波动并分析原因', '生成周度经营分析报告'],
      // 示例问题（3 条）+ 岗位 SOP（编号步骤式）
      exampleQuestions: ['汇总昨天的经营数据', '本月营收有什么异常', '生成上周的经营周报'],
      positionSop:
        '1. 理解用户目标并确认所需信息。\n2. 根据任务选择合适的 Agent、技能、知识库与工具。\n3. 执行任务并核对关键结果与数据口径。\n4. 向用户输出结论、依据和后续建议。',
      // 引用的已发布业务系统（bizSystemMock 同源取行；仅 biz_2101 是已发布种子）
      businessSystemIds: ['biz_2101'],
      persona: '稳、细、主动。先给结论，再给数据依据；发现异常主动提示影响面与建议动作。',
      intakeSchema: [
        { label: '负责业务线', key: 'biz_line', type: 'text', required: true, options: [] },
        { label: '关注指标', key: 'focus_metric', type: 'single_select', required: false, options: ['营收', '毛利', '回款'] }
      ],
      recommendedQuestions: ['汇总昨天的经营数据', '本月营收有什么异常', '生成上周的经营周报', '对比近两个月的毛利趋势'],
      agents: [
        { agentId: 501, name: '数据汇总', description: '按日/周/月拉取经营数据并汇总成表', sortOrder: 0, skills: [{ skillId: 'sk_301', sortOrder: 0 }] },
        { agentId: 502, name: '异常识别', description: '识别经营指标异常并解释原因', sortOrder: 1, skills: [] },
        { agentId: 503, name: '报告输出', description: '组织分析结论，输出经营分析报告', sortOrder: 2, skills: [] }
      ]
    },
    402: {
      intro: '负责客户资料准备与拜访跟进的客户成功 AI 同事',
      iconSource: 'library',
      claimDesc: [{ emoji: '🤝', content: '拜访前自动准备客户资料与提纲' }],
      claimDescriptions: ['拜访前自动准备客户资料与提纲', '拜访后整理跟进记录并沉淀服务过程'],
      exampleQuestions: ['帮我准备明天拜访的客户资料', '整理本周的客户跟进记录', '生成客户拜访提纲'],
      positionSop:
        '1. 确认拜访对象与目标，收集客户基础资料。\n2. 调用客户洞察 Agent 生成拜访提纲。\n3. 拜访后整理跟进记录，沉淀到工作档案。',
      businessSystemIds: ['biz_2101'],
      persona: '热情、周到。拜访前主动准备资料，拜访后提醒记录跟进事项。',
      intakeSchema: [{ label: '负责客户区域', key: 'region', type: 'text', required: true, options: [] }],
      recommendedQuestions: ['帮我准备明天拜访的客户资料', '整理本周的客户跟进记录', '生成客户拜访提纲', '哪些客户超过两周没有跟进'],
      agents: [
        { agentId: 504, name: '拜访准备', description: '汇总客户资料并生成拜访提纲', sortOrder: 0, skills: [{ skillId: 'sk_305', sortOrder: 0 }] },
        { agentId: 505, name: '跟进记录', description: '整理拜访记录并沉淀服务过程', sortOrder: 1, skills: [] }
      ]
    },
    403: {
      intro: '负责报销材料核验与财务单据检查的审核 AI 同事',
      iconSource: 'library',
      claimDesc: [{ emoji: '🧾', content: '报销单据自动核验，风险提前提示' }],
      claimDescriptions: ['报销单据自动核验，风险提前提示'],
      exampleQuestions: ['核验这张报销单', '本月报销有哪些风险点', '检查这批发票的合规性'],
      positionSop: '1. 接收报销材料并逐项核验。\n2. 标记风险项并给出风险等级。\n3. 输出核验结论与整改建议。',
      businessSystemIds: [],
      persona: '严谨、克制。逐项核验，结论给出依据与风险等级。',
      intakeSchema: [],
      recommendedQuestions: ['核验这张报销单', '本月报销有哪些风险点', '检查这批发票的合规性', '汇总本周审核情况'],
      agents: [
        { agentId: 506, name: '单据核验', description: '核验报销材料与财务单据，输出风险提示', sortOrder: 0, skills: [{ skillId: 'sk_301', sortOrder: 0 }] }
      ]
    },
    404: {
      intro: '',
      iconSource: 'library',
      claimDesc: [],
      claimDescriptions: [],
      exampleQuestions: ['', '', ''],
      positionSop: '',
      businessSystemIds: [],
      persona: '',
      intakeSchema: [],
      recommendedQuestions: ['', '', '', ''],
      agents: []
    }
  }
}
let workbench = buildWorkbenchSeed()

/** 空白工作台条目（新建岗位 / 兜底）。 */
function emptyWorkbench(payload = {}) {
  return {
    intro: String(payload.intro || '').trim(),
    iconSource: payload.iconSource || 'library',
    claimDesc: Array.isArray(payload.claimDesc) ? payload.claimDesc.map((c) => ({ ...c })) : [],
    // 2026-09-04 PRD-20260903 对齐新增：岗位认领说明 / 示例问题（3 条）/ 岗位 SOP / 引用业务系统
    claimDescriptions: Array.isArray(payload.claimDescriptions) ? payload.claimDescriptions.map(String) : [],
    exampleQuestions: normEq(payload.exampleQuestions),
    positionSop: String(payload.positionSop || ''),
    businessSystemIds: Array.isArray(payload.businessSystemIds) ? [...payload.businessSystemIds] : [],
    persona: String(payload.persona || ''),
    intakeSchema: Array.isArray(payload.intakeSchema) ? payload.intakeSchema.map((r) => ({ ...r, options: [...(r.options || [])] })) : [],
    recommendedQuestions: Array.isArray(payload.recommendedQuestions) && payload.recommendedQuestions.length ? [...payload.recommendedQuestions] : ['', '', '', ''],
    agents: []
  }
}

/** 示例问题归一为固定 3 格（不足补空、超出截断）。 */
function normEq(list) {
  const arr = Array.isArray(list) ? list.map((q) => String(q ?? '')) : []
  return [0, 1, 2].map((i) => arr[i] ?? '')
}

function ensureWb(positionId) {
  const key = String(positionId)
  if (!workbench[key] && !workbench[positionId]) workbench[key] = emptyWorkbench()
  return workbench[key] || workbench[positionId]
}

function findPos(id) {
  // 路由参数可能是字符串，宽松相等匹配数字 id
  return positions.find((p) => String(p.positionId) === String(id))
}

/** 展示态标签（原型 positionView 同口径）：审核中 > 已发布 > 未发布 */
function viewLabelOf(p) {
  if (p.pendingAction) return 'reviewing'
  if (p.status === 'published') return 'published'
  return 'draft'
}

function parseVersion(label) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(label || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** 出参行（不带 mock 内部字段裸引用，浅拷贝防组件误改内存种子） */
function toRow(p) {
  return {
    positionId: p.positionId,
    name: p.name,
    description: p.description,
    icon: p.icon,
    skillIds: [...p.skillIds],
    skillCount: p.skillIds.length,
    agentCount: p.agentCount,
    claimedUserCount: p.claimedUserCount,
    status: p.status,
    pendingAction: p.pendingAction,
    pendingVersion: p.pendingVersion || null,
    latestVersion: p.latestVersion || '',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }
}

/* ============================ 列表 / 新建 / 删除 ============================ */

// params: { page, size, keyword, status(all|draft|reviewing|published), sort(asc|desc，按 updatedAt) }
export async function listPositions(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const status = params.status && params.status !== 'all' ? params.status : ''
  const sort = params.sort === 'asc' ? 'asc' : 'desc'
  let list = positions.filter(
    (p) =>
      (!kw || [p.name, p.description].some((v) => String(v || '').toLowerCase().includes(kw))) &&
      (!status || viewLabelOf(p) === status)
  )
  list = [...list].sort((a, b) =>
    sort === 'desc' ? String(b.updatedAt).localeCompare(String(a.updatedAt)) : String(a.updatedAt).localeCompare(String(b.updatedAt))
  )
  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 12
  return { list: list.slice((page - 1) * size, page * size).map(toRow), total }
}

export async function createPosition(payload = {}) {
  await delay()
  const name = String(payload.name || '').trim()
  if (!name) throw err('请填写岗位名称', 'name')
  if (positions.some((p) => p.name === name)) throw err('已存在同名岗位', 'name', 1005)
  // 岗位描述 500 字上限（2026-09-04 PRD-20260903 对齐，全链同口径：新建弹窗 / 人格页签 / mock 兜底）
  if (String(payload.description || '').trim().length > 500) throw err('岗位描述不超过 500 字', 'description')
  const now = nowIso()
  const p = {
    positionId: posSeq++,
    name,
    description: String(payload.description || '').trim(),
    intro: String(payload.intro || '').trim(),
    icon: payload.icon || '♟',
    skillIds: [],
    agentCount: 0,
    claimedUserCount: 0,
    status: 'draft',
    pendingAction: null,
    latestVersion: '',
    createdAt: now,
    updatedAt: now
  }
  positions.unshift(p)
  publications[p.positionId] = []
  // 工作台条目同步初始化（新建岗位小弹窗 → 跳工作台即可编辑；工作台新建态首存 hydrate 需完整详情树）
  workbench[String(p.positionId)] = emptyWorkbench(payload)
  persist()
  return detailVO(p)
}

export async function deletePosition(id) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在', null, 404)
  // 引用联动：删岗前把岗位名从所引用技能的 refNames 摘掉
  const wb = ensureWb(p.positionId)
  const ids = new Set()
  wb.agents.forEach((a) => a.skills.forEach((s) => ids.add(s.skillId)))
  wb.agents = []
  ids.forEach((skillId) => removeSkillRefNameIfUnused(p, skillId))
  positions = positions.filter((x) => x !== p)
  delete publications[p.positionId]
  delete workbench[String(p.positionId)]
  delete workbench[p.positionId]
  persist()
  return {}
}

export async function getDeleteImpact(id) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在', null, 404)
  return {
    positionName: p.name,
    agentCount: p.agentCount,
    skillCount: p.skillIds.length,
    claimedUserCount: p.claimedUserCount
  }
}

/* ============================ 发布 / 撤回 / 停用（状态流转） ============================ */

// 建议的下一个展示版本号：最新历史版 patch+1；无历史 → v1.0.0（首发固定，抽屉按发布态判首发）
export async function getNextVersionLabel(id) {
  await delay(120)
  const rows = publications[String(findPos(id)?.positionId)] || publications[id] || []
  const latest = parseVersion(rows[0]?.versionLabel)
  if (!latest) return 'v1.0.0'
  return `v${latest[0]}.${latest[1]}.${latest[2] + 1}`
}

// 提交发布 → 进入审核（pendingAction=PUBLISH）。bump 由抽屉算好展示号后仍上送类型，
// mock 按同一 bump 规则落 pendingVersion（与抽屉 previewLabel 一致）。
export async function publishPosition(id, payload = {}) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在', null, 404)
  if (p.pendingAction) throw err('该岗位已有在途审核，请先撤回')
  if (!p.skillIds.length && !publications[p.positionId]?.length) {
    // 前端已有前置校验（Q3），此处兜底同口径
    if (!p.skillIds.length) throw err('至少关联 1 个岗位私有技能才能发布')
  }
  const rows = publications[p.positionId] || []
  const latest = parseVersion(rows[0]?.versionLabel)
  let label = 'v1.0.0'
  if (latest) {
    const bump = payload.bump || 'NONE'
    if (bump === 'MAJOR') label = `v${latest[0] + 1}.0.0`
    else if (bump === 'MINOR') label = `v${latest[0]}.${latest[1] + 1}.0`
    else label = `v${latest[0]}.${latest[1]}.${latest[2] + 1}`
  }
  // 工作台发布链路（N5）：显式带 versionLabel 则以其为准（列表版本抽屉仍走 bump 口径）
  if (String(payload.versionLabel || '').trim()) label = String(payload.versionLabel).trim()
  p.pendingAction = 'PUBLISH'
  p.pendingVersion = label
  p.pendingReleaseNotes = String(payload.releaseNotes || '').trim()
  p.latestVersion = label
  p.updatedAt = nowIso()
  persist()
  return {}
}

// 撤回在途审核（发布/停用同口径）：清 pendingVersion / pendingReleaseNotes，回到修改前状态
export async function withdrawPosition(id) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在', null, 404)
  if (!p.pendingAction) throw err('该岗位没有在途审核')
  if (p.pendingAction === 'PUBLISH') {
    // 撤回发布申请：最新版本列回落到已通过的最新快照（无快照则回空）
    p.latestVersion = publications[p.positionId]?.[0]?.versionLabel || ''
  }
  p.pendingAction = null
  delete p.pendingVersion
  delete p.pendingReleaseNotes
  p.updatedAt = nowIso()
  persist()
  return {}
}

// 停用（整岗位下架）→ 提交停用审核（pendingAction=DELIST）。领用数>0 的拦截在页面提示层。
export async function unpublishPosition(id) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在', null, 404)
  if (p.status !== 'published') throw err('仅已发布岗位可停用')
  if (p.pendingAction) throw err('该岗位已有在途审核，请先撤回')
  p.pendingAction = 'DELIST'
  p.updatedAt = nowIso()
  persist()
  return {}
}

/* ============================ 版本历史 + 禁用/启用（互斥） ============================ */

export async function listPositionPublications(positionId) {
  await delay()
  const p = findPos(positionId)
  const rows = (p && publications[p.positionId]) || []
  return rows.map((r) => ({ ...r }))
}

// 禁用某版本。最后一个启用版本不可禁用（原型 togglePositionHistory 护栏，页面按钮同步置灰）。
export async function delistPositionPublication(positionId, version) {
  await delay()
  const p = findPos(positionId)
  const rows = (p && publications[p.positionId]) || []
  const row = rows.find((r) => r.version === version)
  if (!row) throw err('版本不存在', null, 404)
  if (row.status !== 'ACTIVE') throw err('该版本已是禁用状态', null, 409)
  if (rows.filter((r) => r.status === 'ACTIVE').length <= 1) {
    throw err('当前版本是该岗位最后一个启用版本。如需停止对外提供，请先整体下架岗位。', null, 409)
  }
  row.status = 'DELISTED'
  row.delistedAt = nowIso()
  persist()
  return { ...row }
}

// 启用某版本：同一时间只能启用一个版本 —— 其余 ACTIVE 自动转禁用（互斥）。
export async function relistPositionPublication(positionId, version) {
  await delay()
  const p = findPos(positionId)
  const rows = (p && publications[p.positionId]) || []
  const row = rows.find((r) => r.version === version)
  if (!row) throw err('版本不存在', null, 404)
  if (row.status !== 'DELISTED') throw err('该版本已是启用状态', null, 409)
  rows.forEach((r) => {
    if (r !== row && r.status === 'ACTIVE') {
      r.status = 'DELISTED'
      r.delistedAt = nowIso()
    }
  })
  row.status = 'ACTIVE'
  row.delistedAt = null
  if (p) {
    p.latestVersion = rows.find((r) => r.status === 'ACTIVE')?.versionLabel || p.latestVersion
  }
  persist()
  return { ...row }
}

/* ============================ 工作台：岗位详情树 + Agent/技能引用（2026-09-02 补 mock） ============================ */

const AGENT_MAX = 20 // 与 utils/positionModel LIMITS 同口径（mock 不 import utils，数值对齐即可）
const SKILL_PER_AGENT_MAX = 20

const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)

/** 'sk_301' → 301（列表 skillIds 沿用数字口径）；非常规 id 原样保留。 */
function numericSkillId(id) {
  const m = /(\d+)$/.exec(String(id))
  return m ? Number(m[1]) : id
}

/** Agent/技能引用变化后回写列表行计数（同源联动：agentCount、skillIds→skillCount）。 */
function syncCounts(p) {
  const wb = ensureWb(p.positionId)
  p.agentCount = wb.agents.length
  const ids = new Set()
  wb.agents.forEach((a) => a.skills.forEach((s) => ids.add(s.skillId)))
  p.skillIds = [...ids].map(numericSkillId)
}

/** 技能引用行 → 白板技能卡 summary VO（本体字段从 unifiedSkillMock 同源取）。 */
function skillRefVO(ref) {
  const raw = skillMock._getRaw(ref.skillId)
  if (!raw) {
    return { skillId: ref.skillId, name: '（技能已删除）', icon: '', description: '', category: 'QUERY', status: 'draft', versionLabel: '', sortOrder: ref.sortOrder ?? 0 }
  }
  // 类别派生口径与后端一致：引用业务系统/数据表 → 操作类，否则查询类
  const isOperation = (raw.toolRefs || []).some((c) => String(c).startsWith('biz__') || String(c).startsWith('table__'))
  return {
    skillId: raw.id,
    name: raw.name,
    icon: raw.icon || '',
    description: raw.description || '',
    category: isOperation ? 'OPERATION' : 'QUERY',
    status: raw.status,
    versionLabel: raw.version || '',
    sortOrder: ref.sortOrder ?? 0
  }
}

function agentVO(a, { withSkills = true } = {}) {
  const vo = { agentId: a.agentId, name: a.name, description: a.description || '', sortOrder: a.sortOrder ?? 0 }
  if (withSkills) vo.skills = a.skills.slice().sort(bySort).map(skillRefVO)
  return vo
}

/** 岗位详情树 VO（PositionDetailVO：身份卡字段 + agents[].skills[]）。 */
function detailVO(p) {
  const wb = ensureWb(p.positionId)
  return {
    positionId: p.positionId,
    name: p.name,
    description: p.description || '',
    intro: wb.intro || '',
    icon: p.icon || '',
    iconSource: wb.iconSource || 'library',
    claimDesc: (wb.claimDesc || []).map((c) => ({ ...c })),
    // 2026-09-04 PRD-20260903 对齐新增字段
    claimDescriptions: [...(wb.claimDescriptions || [])],
    exampleQuestions: normEq(wb.exampleQuestions),
    positionSop: wb.positionSop || '',
    businessSystemIds: [...(wb.businessSystemIds || [])],
    persona: wb.persona || '',
    intakeSchema: (wb.intakeSchema || []).map((r) => ({ ...r, options: [...(r.options || [])] })),
    recommendedQuestions: [...(wb.recommendedQuestions || ['', '', '', ''])],
    status: p.status,
    pendingAction: p.pendingAction,
    latestVersion: p.latestVersion || '',
    agents: wb.agents.slice().sort(bySort).map((a) => agentVO(a))
  }
}

function findAgent(agentId) {
  for (const p of positions) {
    const wb = ensureWb(p.positionId)
    const agent = wb.agents.find((a) => String(a.agentId) === String(agentId))
    if (agent) return { p, wb, agent }
  }
  return null
}

/** 引用联动：把本岗位名加进技能 refNames（unifiedSkillMock 单一真相，不复制本体）。 */
function addSkillRefName(skillId, posName) {
  const raw = skillMock._getRaw(skillId)
  if (raw && !(raw.refNames || []).includes(posName)) {
    skillMock._reset(skillId, { refNames: [...(raw.refNames || []), posName] })
  }
}
/** 本岗位内已无任何 Agent 引用该技能时，把岗位名从技能 refNames 摘掉。 */
function removeSkillRefNameIfUnused(p, skillId) {
  const wb = ensureWb(p.positionId)
  const stillUsed = wb.agents.some((a) => a.skills.some((s) => String(s.skillId) === String(skillId)))
  if (stillUsed) return
  const raw = skillMock._getRaw(skillId)
  if (raw && (raw.refNames || []).includes(p.name)) {
    skillMock._reset(skillId, { refNames: raw.refNames.filter((n) => n !== p.name) })
  }
}

// 1.2 岗位详情（树形，含 Agent→技能）
export async function getPosition(id) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  return detailVO(p)
}

// 1.4 编辑岗位基本信息 / 采集 schema（部分更新，回详情树 + warnings）
export async function updatePosition(id, payload = {}) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  const wb = ensureWb(p.positionId)
  if ('name' in payload) {
    const name = String(payload.name || '').trim()
    if (!name) throw err('请填写岗位名称', 'name')
    if (positions.some((x) => x !== p && x.name === name)) throw err('已存在同名岗位', 'name', 1005)
    // 岗位改名：同步维护已引用技能的 refNames（同源联动，避免留下旧名）
    if (name !== p.name) {
      const ids = new Set()
      wb.agents.forEach((a) => a.skills.forEach((s) => ids.add(s.skillId)))
      ids.forEach((skillId) => {
        const raw = skillMock._getRaw(skillId)
        if (raw && (raw.refNames || []).includes(p.name)) {
          skillMock._reset(skillId, { refNames: raw.refNames.map((n) => (n === p.name ? name : n)) })
        }
      })
      p.name = name
    }
  }
  if ('description' in payload) {
    const description = String(payload.description || '').trim()
    // 岗位描述 500 字上限（2026-09-04 PRD-20260903 对齐）
    if (description.length > 500) throw err('岗位描述不超过 500 字', 'description')
    p.description = description
  }
  if ('intro' in payload) wb.intro = String(payload.intro || '').trim()
  if ('icon' in payload) p.icon = payload.icon || p.icon
  if ('iconSource' in payload) wb.iconSource = payload.iconSource || 'library'
  if ('claimDesc' in payload) wb.claimDesc = Array.isArray(payload.claimDesc) ? payload.claimDesc.map((c) => ({ ...c })) : []
  // 2026-09-04 PRD-20260903 对齐新增字段（部分更新语义：payload 未含即不改）
  if ('claimDescriptions' in payload) {
    const notes = Array.isArray(payload.claimDescriptions) ? payload.claimDescriptions.map((s) => String(s ?? '').trim()).filter(Boolean) : []
    if (notes.length > 6) throw err('岗位认领说明最多 6 条', 'claimDescriptions')
    if (notes.some((s) => s.length > 100)) throw err('岗位认领说明每条不超过 100 字', 'claimDescriptions')
    wb.claimDescriptions = notes
  }
  if ('exampleQuestions' in payload) {
    const qs = normEq(payload.exampleQuestions)
    if (qs.some((q) => q.trim().length > 60)) throw err('示例问题每条不超过 60 字', 'exampleQuestions')
    wb.exampleQuestions = qs
  }
  if ('positionSop' in payload) {
    const sop = String(payload.positionSop || '')
    if (sop.length > 4000) throw err('岗位 SOP 不超过 4000 字', 'positionSop')
    wb.positionSop = sop
  }
  if ('businessSystemIds' in payload) {
    wb.businessSystemIds = Array.isArray(payload.businessSystemIds) ? [...payload.businessSystemIds] : []
  }
  if ('persona' in payload) wb.persona = String(payload.persona || '')
  if ('intakeSchema' in payload) {
    wb.intakeSchema = Array.isArray(payload.intakeSchema) ? payload.intakeSchema.map((r) => ({ ...r, options: [...(r.options || [])] })) : []
  }
  // 推荐问题部分更新语义：payload 未含该字段 = 不改（半填不上送，见工作台 buildBasicPayload）
  if ('recommendedQuestions' in payload && Array.isArray(payload.recommendedQuestions)) {
    wb.recommendedQuestions = [0, 1, 2, 3].map((i) => String(payload.recommendedQuestions[i] ?? ''))
  }
  p.updatedAt = nowIso()
  persist()
  return { ...detailVO(p), warnings: [] }
}

/* ---------------- Agent CRUD（契约 §2） ---------------- */

// 2.1 新建 Agent（岗位内 name 唯一 1005；≤20 上限 1002）
export async function createAgent(positionId, payload = {}) {
  await delay()
  const p = findPos(positionId)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  const wb = ensureWb(p.positionId)
  if (wb.agents.length >= AGENT_MAX) throw err(`单岗位最多 ${AGENT_MAX} 个 Agent`, null, 1002)
  let name = String(payload.name || '').trim() || '新 Agent'
  // 「新 Agent」快捷创建允许重名场景：自动追加序号，避免连点两次「＋ 新 Agent」直接报错
  if (wb.agents.some((a) => a.name === name)) {
    let n = 2
    while (wb.agents.some((a) => a.name === `${name} ${n}`)) n++
    name = `${name} ${n}`
  }
  const agent = {
    agentId: agentSeq++,
    name,
    description: String(payload.description || ''),
    sortOrder: payload.sortOrder ?? wb.agents.length,
    skills: []
  }
  wb.agents.push(agent)
  syncCounts(p)
  p.updatedAt = nowIso()
  persist()
  return agentVO(agent)
}

// 2.2 编辑 Agent（部分更新 name/description/sortOrder；岗位内重名 1005）
export async function updateAgent(agentId, payload = {}) {
  await delay()
  const hit = findAgent(agentId)
  if (!hit) throw err('Agent 不存在或已被删除', null, 404)
  const { p, wb, agent } = hit
  if ('name' in payload) {
    const name = String(payload.name || '').trim()
    if (!name) throw err('请填写 Agent 名称', 'name')
    if (wb.agents.some((a) => a !== agent && a.name === name)) throw err('Agent 名已存在', 'name', 1005)
    agent.name = name
  }
  if ('description' in payload) agent.description = String(payload.description || '')
  if ('sortOrder' in payload) agent.sortOrder = payload.sortOrder
  p.updatedAt = nowIso()
  persist()
  return agentVO(agent, { withSkills: false })
}

// 2.3 删除 Agent（其下技能脱离岗位变「未被引用」，回 orphanedSkillCount）
export async function deleteAgent(agentId) {
  await delay()
  const hit = findAgent(agentId)
  if (!hit) throw err('Agent 不存在或已被删除', null, 404)
  const { p, wb, agent } = hit
  const orphaned = agent.skills.map((s) => s.skillId)
  wb.agents = wb.agents.filter((a) => a !== agent)
  orphaned.forEach((skillId) => removeSkillRefNameIfUnused(p, skillId))
  syncCounts(p)
  p.updatedAt = nowIso()
  persist()
  return { orphanedSkillCount: orphaned.length }
}

/* ---------------- 技能引用（V84 引用模型：assign 拉入/跨泳道迁移，detach 可逆移除） ---------------- */

// 3.2.1 分配 / 改挂 Agent。1002=目标 Agent 技能数上限；已在本岗位其它 Agent → 迁移（拖拽跨泳道语义）。
export async function assignSkill(skillId, targetAgentId) {
  await delay()
  const hit = findAgent(targetAgentId)
  if (!hit) throw err('目标 Agent 不存在或已被删除', null, 404)
  const { p, wb, agent } = hit
  const raw = skillMock._getRaw(skillId)
  if (!raw) throw err('技能不存在或已被删除', null, 404)
  // 已挂本 Agent：幂等返回
  const existed = agent.skills.find((s) => String(s.skillId) === String(skillId))
  if (existed) return skillRefVO(existed)
  if (agent.skills.length >= SKILL_PER_AGENT_MAX) throw err(`该 Agent 技能数已达上限（${SKILL_PER_AGENT_MAX}）`, null, 1002)
  // 本岗位其它 Agent 已引用 → 迁移（从原 Agent 摘除）
  for (const a of wb.agents) {
    a.skills = a.skills.filter((s) => String(s.skillId) !== String(skillId))
  }
  const ref = { skillId: raw.id, sortOrder: agent.skills.length }
  agent.skills.push(ref)
  addSkillRefName(raw.id, p.name)
  syncCounts(p)
  p.updatedAt = nowIso()
  persist()
  return skillRefVO(ref)
}

// 3.4.2 从指定 Agent 移除技能引用（可逆：删引用行，技能本体留库）
export async function detachSkill(agentId, skillId) {
  await delay()
  const hit = findAgent(agentId)
  if (!hit) throw err('Agent 不存在或已被删除', null, 404)
  const { p, agent } = hit
  const before = agent.skills.length
  agent.skills = agent.skills.filter((s) => String(s.skillId) !== String(skillId))
  if (agent.skills.length === before) throw err('该 Agent 未引用此技能', null, 404)
  removeSkillRefNameIfUnused(p, skillId)
  syncCounts(p)
  p.updatedAt = nowIso()
  persist()
  return {}
}

/* ============================ 岗位分配页联动（岗位名单一真相源，Q10） ============================ */

/** 按 id 取岗位名（岗位分配 mock 联动用；种子岗位名以本模块为准，原型两处不一致按 Q10 拍板归一）。 */
export function getPositionNameById(id) {
  return findPos(id)?.name || ''
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetPositionMock() {
  posSeq = 405
  agentSeq = 520
  workbench = buildWorkbenchSeed()
  positions = [
    { positionId: 401, name: '经营分析岗', description: '负责经营数据汇总、异常识别与经营分析报告输出', icon: '▤', skillIds: [301], agentCount: 3, claimedUserCount: 26, status: 'published', pendingAction: null, latestVersion: 'v2.1.0', createdAt: '2026-08-12T09:30:00+08:00', updatedAt: '2026-08-25T16:20:00+08:00' },
    { positionId: 402, name: '客户成功岗', description: '负责客户资料准备、拜访跟进与服务过程记录', icon: '◎', skillIds: [305], agentCount: 2, claimedUserCount: 18, status: 'published', pendingAction: null, latestVersion: 'v1.4.0', createdAt: '2026-08-14T10:05:00+08:00', updatedAt: '2026-08-24T14:35:00+08:00' },
    { positionId: 403, name: '财务审核岗', description: '负责报销材料核验、财务单据检查与风险提示', icon: '¥', skillIds: [301], agentCount: 1, claimedUserCount: 6, status: 'draft', pendingAction: 'PUBLISH', pendingVersion: 'v1.0.0', pendingReleaseNotes: '首个版本', latestVersion: 'v1.0.0', createdAt: '2026-08-20T15:40:00+08:00', updatedAt: '2026-08-25T10:18:00+08:00' },
    { positionId: 404, name: '市场研究岗', description: '负责行业资料整理、竞品跟踪与研究结论沉淀', icon: '⌁', skillIds: [], agentCount: 0, claimedUserCount: 0, status: 'draft', pendingAction: null, latestVersion: '', createdAt: '2026-08-23T09:42:00+08:00', updatedAt: '2026-08-23T09:42:00+08:00' }
  ]
  publications = {
    401: [
      { version: 2, versionLabel: 'v2.1.0', status: 'ACTIVE', sizeBytes: 7782, publishedBy: '管理员', publishedAt: '2026-08-25T16:20:00+08:00', delistedAt: null, releaseNotes: '当前线上版本' },
      { version: 1, versionLabel: 'v2.0.0', status: 'DELISTED', sizeBytes: 7475, publishedBy: '管理员', publishedAt: '2026-08-18T10:20:00+08:00', delistedAt: '2026-08-25T16:20:00+08:00', releaseNotes: '历史版本' }
    ],
    402: [
      { version: 2, versionLabel: 'v1.4.0', status: 'ACTIVE', sizeBytes: 7782, publishedBy: '管理员', publishedAt: '2026-08-24T14:35:00+08:00', delistedAt: null, releaseNotes: '当前线上版本' },
      { version: 1, versionLabel: 'v1.3.0', status: 'DELISTED', sizeBytes: 7475, publishedBy: '管理员', publishedAt: '2026-08-18T10:20:00+08:00', delistedAt: '2026-08-24T14:35:00+08:00', releaseNotes: '历史版本' }
    ],
    403: [],
    404: []
  }
  persist() // 持久化 2026-09-02：复位后同样落盘，避免存量快照盖回旧态
}

/* ============================ 持久化（持久化 2026-09-02） ============================ */

// 状态镜像到 localStorage；写点=上方各写操作末尾的 persist() 调用处。
// positions / publications / workbench 均为 let 且仅本模块内部引用，restore 直接重赋值即可；
// 顶层无 Map/Set（函数内 Set 均为临时变量），快照天然可 JSON 序列化。
// 依赖序：本模块 import unifiedSkillMock（技能表已先完成恢复）；本模块只存 skillId 引用、
// 不复制技能本体，交叉的 refNames 回写经 skillMock._reset 落对方模块并由对方自行持久化。
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子。
const persist = attachPersist('position', {
  version: 1,
  snapshot: () => ({ posSeq, agentSeq, positions, publications, workbench }),
  restore: (d) => {
    if (
      !d || !Number.isFinite(d.posSeq) || !Number.isFinite(d.agentSeq) ||
      !Array.isArray(d.positions) || d.positions.some((r) => !r || typeof r !== 'object') ||
      typeof d.publications !== 'object' || d.publications === null ||
      typeof d.workbench !== 'object' || d.workbench === null
    ) {
      throw new Error('position 快照形状不合法')
    }
    posSeq = d.posSeq
    agentSeq = d.agentSeq
    positions = d.positions
    publications = d.publications
    workbench = d.workbench
  }
})
