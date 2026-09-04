/**
 * 专家模块内存 mock（demo 数据层，模式同 apiConnectorMock.js / positionMock.js；开关见 domainExpert.js）。
 *
 * 【覆盖范围（2026-09-01 PRD 对齐改造）】AdminExperts.vue 列表页 + ExpertEditor.vue 编辑/查看抽屉
 * 所调接口（含版本管理侧栏 versionAdapter 所调的 publish/withdraw/next-label/publications/delist/relist）。
 *
 * 种子数据照交互原型 v2 覆写态（expertRows L277-282 + expertSeeds L1039 分类/示例问题 +
 * expertMetaSeeds L692 创建/发布时间 + seededSelections L671 技能勾选）：
 * 专家 4 条 —— 经营分析专家 v2.3.0 已发布 / 企业知识助手 v1.6.0 已发布 /
 * 法务审阅专家 未发布无版本 / 研究报告专家 已发布 v1.1.0 + 新版审核中。
 *
 * 【市场技能候选自带种子】专家只引用「市场技能」（原型 platformSkillOptions()=skillRows 中
 * type=PLATFORM 的 302/304/307 三条）。候选种子放本文件内，不依赖 platformSkill.js /
 * unifiedSkill.js（技能模块另行改造中，避免交叉耦合）。
 * 专家分类选项不在本文件重复定义——同源取 fieldDictMock 的 expertCategory（字段字典单一真相源）。
 *
 * 状态口径（与岗位 positionMock 同构，展示层三态映射在页面做）：
 * - 本体 status: draft | published；pendingAction: PUBLISH | DELIST | null。
 * - 列表 status 筛选参数：'' | draft(未发布) | review(审核中) | published(已发布)（原型 expertStatus 下拉）。
 * - 版本历史「同一时间只能启用一个版本」：relist 启用某版本时其余 ACTIVE 自动转 DELISTED；
 *   最后一个启用版本不可禁用（原型 toggleHistory 护栏，页面按钮同步置灰）。
 * - 专家的版本禁用/启用按 **publicationId** 定位（与岗位按 version、技能按 version+通道 都不同，
 *   沿用 domainExpert.js 既有端点口径）。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let expertSeq = 205

/* ---------------- 背景色（2026-09-04 PRD-20260903 新增字段，原型 expert-background-color 覆写） ----------------
 * 固定 7 色板；safeBackground 归一化（非法/缺失一律回落默认 #DCF5E4——旧持久化快照无此字段时
 * 读路径 toRow/toDetail 兜底补齐，写路径 create/update 落库前归一）。 */
export const EXPERT_BACKGROUND_COLORS = ['#FAE9DF', '#DCECF7', '#DCF5E4', '#E7E4F7', '#F7E6F2', '#F7EFCD', '#DDF0EF']
export const EXPERT_BACKGROUND_FALLBACK = '#DCF5E4'
const safeBackground = (v) =>
  /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : EXPERT_BACKGROUND_FALLBACK

/* ---------------- 专家 ↔ 知识库可见范围映射种子（2026-09-04） ----------------
 * 【注明】编辑抽屉只读「知识库」区块按「专家可见范围」过滤：企业级知识库全可见 +
 * EXPERT 型且 scopeRefId 命中本专家。但 knowledgeBaseMock 的专家 id 自成体系（ex_1/ex_2），
 * 与本模块 201-204 不同源——mock 数据不够，故在本侧做桥接映射种子（demo 演示用；
 * 真实后端应由知识库接口按专家过滤，接通后删除本映射）。 */
const EXPERT_KB_SCOPE_SEED = { 201: 'ex_1', 202: 'ex_2' }
export function getExpertKbScopeRefId(expertId) {
  return EXPERT_KB_SCOPE_SEED[String(expertId)] || null
}

// 北京时间「现在」→ ISO 串（mock 内时间统一带 +08:00，展示走 fmtTime 精确到分钟）
function nowIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`
  )
}

/* ---------------- 市场技能候选（原型 skillRows 中 type=PLATFORM 三条） ---------------- */
const SKILL_CANDIDATES = [
  { id: 302, name: '经营数据分析', description: '读取经营数据并生成趋势分析和异常说明', category: '数据分析' },
  { id: 304, name: '合同风险检查', description: '识别合同条款中的风险点并给出说明', category: '办公效率' },
  { id: 307, name: '竞品信息汇总', description: '汇总公开渠道的竞品动态', category: '内容创作' }
]

/* ---------------- 专家种子（照原型 expertRows + expertSeeds + expertMetaSeeds） ---------------- */
function seedExperts() {
  return [
    {
      id: 201,
      name: '经营分析专家',
      intro: '汇总经营数据，识别异常并形成管理建议',
      avatar: '▤',
      backgroundColor: '#DCF5E4', // 2026-09-04 新增：原型种子无值，归一化结果=默认色
      category: '投资',
      roleDesc: '你是一名经营分析专家。围绕收入、成本、效率和风险提供可追溯的分析结论。',
      exampleQuestions: ['帮我生成一份行业调研报告', '帮我分析本月经营数据中的异常', '帮我整理一份管理层决策建议'],
      skillIds: [302, 304],
      status: 'published',
      pendingAction: null,
      latestVersionLabel: 'v2.3.0',
      createdAt: '2026-08-12T09:20:00+08:00',
      updatedAt: '2026-08-24T14:12:00+08:00',
      publishedAt: '2026-08-20T16:30:00+08:00'
    },
    {
      id: 202,
      name: '企业知识助手',
      intro: '帮助员工检索制度、流程和业务知识',
      avatar: '⌕',
      backgroundColor: '#DCF5E4', // 2026-09-04 新增：原型种子无值，归一化结果=默认色
      category: '通用',
      roleDesc: '你负责准确回答企业知识问题，引用知识来源，并在信息不足时说明限制。',
      exampleQuestions: ['帮我查一下公司的差旅报销制度', '帮我解释这个业务流程', '帮我整理相关制度依据'],
      skillIds: [302],
      status: 'published',
      pendingAction: null,
      latestVersionLabel: 'v1.6.0',
      createdAt: '2026-08-14T10:15:00+08:00',
      updatedAt: '2026-08-23T17:45:00+08:00',
      publishedAt: '2026-08-21T11:10:00+08:00'
    },
    {
      id: 203,
      name: '法务审阅专家',
      intro: '辅助审阅合同条款并提示风险',
      avatar: '§',
      backgroundColor: '#DCF5E4', // 2026-09-04 新增：原型种子无值，归一化结果=默认色
      category: '法律',
      roleDesc: '你是一名严谨的合同审阅专家，按风险等级说明问题并给出修改建议。',
      exampleQuestions: ['帮我审阅这份合同的风险条款', '帮我生成一份合同修改建议', '帮我解释这条违约责任'],
      skillIds: [304],
      status: 'draft',
      pendingAction: null,
      latestVersionLabel: '',
      createdAt: '2026-08-22T10:30:00+08:00',
      updatedAt: '2026-08-22T10:30:00+08:00',
      publishedAt: null
    },
    {
      id: 204,
      name: '研究报告专家',
      intro: '从公开资料生成行业研究与竞品报告',
      avatar: '◎',
      backgroundColor: '#DCF5E4', // 2026-09-04 新增：原型种子无值，归一化结果=默认色
      category: '投资',
      roleDesc: '你负责完成结构化研究，区分事实、推断和待验证信息。',
      exampleQuestions: ['帮我生成一份行业调研报告', '帮我对比三家主要竞品', '帮我整理一份投资研究摘要'],
      skillIds: [302, 307],
      status: 'published',
      pendingAction: 'PUBLISH',
      pendingVersion: 'v1.2.0',
      pendingReleaseNotes: '补充竞品对比维度',
      latestVersionLabel: 'v1.1.0',
      createdAt: '2026-08-18T14:05:00+08:00',
      updatedAt: '2026-08-24T09:18:00+08:00',
      publishedAt: '2026-08-22T17:20:00+08:00'
    }
  ]
}

/* ---------------- 版本历史种子（照原型 seededHistory：当前版 + 上一版；8.4KB/8.1KB 示意值） ---------------- */
function seedPublications() {
  return {
    201: [
      { id: 811, version: 2, versionLabel: 'v2.3.0', status: 'ACTIVE', sizeBytes: 8602, publishedBy: '管理员', publishedAt: '2026-08-24T14:12:00+08:00', delistedAt: null, releaseNotes: '当前线上版本' },
      { id: 810, version: 1, versionLabel: 'v2.2.0', status: 'DELISTED', sizeBytes: 8294, publishedBy: '管理员', publishedAt: '2026-08-20T16:30:00+08:00', delistedAt: '2026-08-23T10:15:00+08:00', releaseNotes: '历史稳定版本' }
    ],
    202: [
      { id: 821, version: 2, versionLabel: 'v1.6.0', status: 'ACTIVE', sizeBytes: 8602, publishedBy: '管理员', publishedAt: '2026-08-23T17:45:00+08:00', delistedAt: null, releaseNotes: '当前线上版本' },
      { id: 820, version: 1, versionLabel: 'v1.5.0', status: 'DELISTED', sizeBytes: 8294, publishedBy: '管理员', publishedAt: '2026-08-21T11:10:00+08:00', delistedAt: '2026-08-23T10:15:00+08:00', releaseNotes: '历史稳定版本' }
    ],
    203: [],
    // 研究报告专家：v1.1.0 在线 + v1.0.0 已禁用；v1.2.0 为在审的 pendingVersion（尚无快照）
    204: [
      { id: 841, version: 2, versionLabel: 'v1.1.0', status: 'ACTIVE', sizeBytes: 8602, publishedBy: '管理员', publishedAt: '2026-08-22T17:20:00+08:00', delistedAt: null, releaseNotes: '当前线上版本' },
      { id: 840, version: 1, versionLabel: 'v1.0.0', status: 'DELISTED', sizeBytes: 8294, publishedBy: '管理员', publishedAt: '2026-08-18T15:00:00+08:00', delistedAt: '2026-08-22T17:20:00+08:00', releaseNotes: '首个版本' }
    ]
  }
}

let experts = seedExperts()
let publications = seedPublications()

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=下方所有 persist() 调用处。
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子（发包安全铁律）。
const persist = attachPersist('domainExpert', {
  version: 1,
  snapshot: () => ({ expertSeq, experts, publications }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.expertSeq) || !Array.isArray(d.experts) || typeof d.publications !== 'object' || d.publications === null) {
      throw new Error('domainExpert 快照形状不合法')
    }
    expertSeq = d.expertSeq
    experts = d.experts
    publications = d.publications
  }
})

function findExpert(id) {
  return experts.find((e) => String(e.id) === String(id))
}

/** 展示态标签（原型 expertView 同口径）：审核中 > 已发布 > 未发布 */
function viewLabelOf(e) {
  if (e.pendingAction) return 'review'
  if (e.status === 'published') return 'published'
  return 'draft'
}

function parseVersion(label) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(label || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const normQuestions = (qs) => [0, 1, 2].map((i) => String((qs || [])[i] || ''))

/** 出参行（浅拷贝防组件误改内存种子） */
function toRow(e) {
  return {
    id: e.id,
    name: e.name,
    intro: e.intro,
    avatar: e.avatar,
    backgroundColor: safeBackground(e.backgroundColor), // 读路径归一化（旧快照无此字段 → 默认色）
    category: e.category,
    skillIds: [...e.skillIds],
    skillCount: e.skillIds.length,
    status: e.status,
    pendingAction: e.pendingAction,
    pendingVersion: e.pendingVersion || null,
    latestVersionLabel: e.latestVersionLabel || '',
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    publishedAt: e.publishedAt || null
  }
}

/** 详情出参：行 + 职责描述 + 示例问题 + 已引用技能明细（实时按候选表解析——引用非复制） */
function toDetail(e) {
  return {
    ...toRow(e),
    roleDesc: e.roleDesc,
    exampleQuestions: normQuestions(e.exampleQuestions),
    skills: e.skillIds
      .map((id) => SKILL_CANDIDATES.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => ({ skillId: s.id, name: s.name, description: s.description, category: s.category }))
  }
}

/* ============================ 列表 / 详情 / CRUD ============================ */

// params: { page, size, keyword, category, status(''|draft|review|published), sort(asc|desc，按 updatedAt) }
export async function listExperts(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const category = String(params.category || '')
  const status = String(params.status || '')
  const sort = params.sort === 'asc' ? 'asc' : 'desc'
  let list = experts.filter(
    (e) =>
      (!kw || [e.name, e.intro, e.category].some((v) => String(v || '').toLowerCase().includes(kw))) &&
      (!category || e.category === category) &&
      (!status || viewLabelOf(e) === status)
  )
  list = [...list].sort((a, b) =>
    sort === 'desc'
      ? String(b.updatedAt).localeCompare(String(a.updatedAt))
      : String(a.updatedAt).localeCompare(String(b.updatedAt))
  )
  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 20
  return { list: list.slice((page - 1) * size, page * size).map(toRow), total }
}

export async function getExpert(id) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  return toDetail(e)
}

// 新建（payload: { name, category, avatar, intro, roleDesc, exampleQuestions[3], skillIds[] }）。初始 draft。
export async function createExpert(payload = {}) {
  await delay()
  const name = String(payload.name || '').trim()
  if (!name) throw err('请填写专家名', 'name')
  if (name.length > 64) throw err('专家名不超过 64 字', 'name')
  if (experts.some((e) => e.name === name)) throw err('专家名已存在', 'name', 1005)
  const now = nowIso()
  const e = {
    id: expertSeq++,
    name,
    intro: String(payload.intro || '').trim(),
    avatar: String(payload.avatar || '').trim(),
    backgroundColor: safeBackground(payload.backgroundColor),
    category: String(payload.category || '').trim(),
    roleDesc: String(payload.roleDesc || ''),
    exampleQuestions: normQuestions(payload.exampleQuestions),
    skillIds: Array.isArray(payload.skillIds) ? [...payload.skillIds] : [],
    status: 'draft',
    pendingAction: null,
    latestVersionLabel: '',
    createdAt: now,
    updatedAt: now,
    publishedAt: null
  }
  experts.unshift(e)
  publications[e.id] = []
  persist()
  return toDetail(e)
}

// 编辑（部分更新：只传的字段才改）。审核中锁定（审核对象=提交那刻的快照）。
export async function updateExpert(id, payload = {}) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  if (e.pendingAction) throw err('审核中，专家已锁定不可修改', null, 409)
  if (payload.name !== undefined) {
    const name = String(payload.name || '').trim()
    if (!name) throw err('请填写专家名', 'name')
    if (experts.some((x) => x !== e && x.name === name)) throw err('专家名已存在', 'name', 1005)
    e.name = name
  }
  if (payload.intro !== undefined) e.intro = String(payload.intro || '').trim()
  if (payload.avatar !== undefined) e.avatar = String(payload.avatar || '').trim()
  if (payload.backgroundColor !== undefined) e.backgroundColor = safeBackground(payload.backgroundColor)
  if (payload.category !== undefined) e.category = String(payload.category || '').trim()
  if (payload.roleDesc !== undefined) e.roleDesc = String(payload.roleDesc || '')
  if (payload.exampleQuestions !== undefined) e.exampleQuestions = normQuestions(payload.exampleQuestions)
  if (payload.skillIds !== undefined) e.skillIds = Array.isArray(payload.skillIds) ? [...payload.skillIds] : []
  e.updatedAt = nowIso()
  persist()
  return toDetail(e)
}

// 删除前影响面（接口保留；2026-09-01 起页面删除确认的 N 直接取行数据 skillCount，不再前置调用本接口）
export async function getExpertDeleteImpact(id) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  return {
    name: e.name,
    skillRefCount: e.skillIds.length,
    publicationCount: (publications[e.id] || []).length,
    published: e.status === 'published'
  }
}

// 删除（解除技能引用，技能本体不受影响）。返回被解除的引用数。confirmName 兼容旧签名，不再校验。
export async function deleteExpert(id) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  const removed = e.skillIds.length
  experts = experts.filter((x) => x !== e)
  delete publications[e.id]
  persist()
  return removed
}

/* ============================ 市场技能候选 / 引用 ============================ */

// 市场技能候选（编辑抽屉内嵌选择器）。params: { keyword?（按名称/描述/分类过滤） }
export async function listExpertSkillCandidates(params = {}) {
  await delay(120)
  const kw = String(params.keyword || '').trim().toLowerCase()
  return SKILL_CANDIDATES.filter(
    (s) => !kw || [s.name, s.description, s.category].some((v) => String(v).toLowerCase().includes(kw))
  ).map((s) => ({ ...s }))
}

// 引用一个市场技能（幂等）。返回更新后的详情。
export async function addExpertSkill(id, skillId) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  if (!SKILL_CANDIDATES.some((s) => String(s.id) === String(skillId))) throw err('市场技能不存在', null, 404)
  if (!e.skillIds.some((x) => String(x) === String(skillId))) e.skillIds.push(Number(skillId))
  e.updatedAt = nowIso()
  persist()
  return toDetail(e)
}

// 解除引用（幂等）。技能本体不动。
export async function removeExpertSkill(id, skillId) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  e.skillIds = e.skillIds.filter((x) => String(x) !== String(skillId))
  e.updatedAt = nowIso()
  persist()
  return toDetail(e)
}

// 批量重排技能顺序（能力保留：Z7 拍板 reorder 不删；当前无 UI 调用方）
export async function reorderExpertSkills(id, skillIds) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  const wanted = (Array.isArray(skillIds) ? skillIds : []).map(Number)
  e.skillIds = [...wanted.filter((x) => e.skillIds.includes(x)), ...e.skillIds.filter((x) => !wanted.includes(x))]
  e.updatedAt = nowIso()
  persist()
  return toDetail(e)
}

/* ============================ 发布 / 撤回 / 停用 ============================ */

// 建议的下一个展示版本号：最新历史版 patch+1；无历史 → v1.0.0（首发固定，抽屉按发布态判首发）
export async function getExpertNextVersionLabel(id) {
  await delay(120)
  const rows = publications[String(findExpert(id)?.id)] || []
  const latest = parseVersion(rows[0]?.versionLabel)
  if (!latest) return 'v1.0.0'
  return `v${latest[0]}.${latest[1]}.${latest[2] + 1}`
}

// 提交发布 → 进入审核（pendingAction=PUBLISH）。payload: { bump, releaseNotes }。
export async function publishExpert(id, payload = {}) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  if (e.pendingAction) throw err('该专家已有在途审核，请先撤回')
  if (!e.skillIds.length) throw err('至少引用 1 个市场技能才能发布')
  const rows = publications[e.id] || []
  const latest = parseVersion(rows[0]?.versionLabel)
  let label = 'v1.0.0'
  if (latest) {
    const bump = payload.bump || 'NONE'
    if (bump === 'MAJOR') label = `v${latest[0] + 1}.0.0`
    else if (bump === 'MINOR') label = `v${latest[0]}.${latest[1] + 1}.0`
    else label = `v${latest[0]}.${latest[1]}.${latest[2] + 1}`
  }
  e.pendingAction = 'PUBLISH'
  e.pendingVersion = label
  e.pendingReleaseNotes = String(payload.releaseNotes || '').trim()
  e.updatedAt = nowIso()
  persist()
  return {}
}

// 撤回在途审核（发布/停用同口径）：清 pendingAction/pendingVersion/pendingReleaseNotes，回到修改前状态
export async function withdrawExpert(id) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  if (!e.pendingAction) throw err('该专家没有在途审核')
  e.pendingAction = null
  delete e.pendingVersion
  delete e.pendingReleaseNotes
  e.updatedAt = nowIso()
  persist()
  return {}
}

// 停用（整专家下架）→ 提交停用审核（pendingAction=DELIST）。审核通过前客户端仍可使用。
export async function unpublishExpert(id) {
  await delay()
  const e = findExpert(id)
  if (!e) throw err('专家不存在', null, 404)
  if (e.status !== 'published') throw err('仅已发布专家可停用')
  if (e.pendingAction) throw err('该专家已有在途审核，请先撤回')
  e.pendingAction = 'DELIST'
  e.updatedAt = nowIso()
  persist()
  return {}
}

/* ============================ 版本历史 + 禁用/启用（互斥） ============================ */

export async function listExpertPublications(id) {
  await delay()
  const e = findExpert(id)
  const rows = (e && publications[e.id]) || []
  return rows.map((r) => ({ ...r }))
}

// 禁用某版本（按 publicationId 定位——专家端点口径）。最后一个启用版本不可禁用。
export async function delistExpertPublication(expertId, publicationId) {
  await delay()
  const e = findExpert(expertId)
  const rows = (e && publications[e.id]) || []
  const row = rows.find((r) => String(r.id) === String(publicationId))
  if (!row) throw err('版本不存在', null, 404)
  if (row.status !== 'ACTIVE') throw err('该版本已是禁用状态', null, 409)
  if (rows.filter((r) => r.status === 'ACTIVE').length <= 1) {
    throw err('当前版本是该专家最后一个启用版本。如需停止对外提供，请先整体下架专家。', null, 409)
  }
  row.status = 'DELISTED'
  row.delistedAt = nowIso()
  persist()
  return { ...row }
}

// 启用某版本：同一时间只能启用一个版本 —— 其余 ACTIVE 自动转禁用（互斥）。
export async function relistExpertPublication(expertId, publicationId) {
  await delay()
  const e = findExpert(expertId)
  const rows = (e && publications[e.id]) || []
  const row = rows.find((r) => String(r.id) === String(publicationId))
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
  if (e) e.latestVersionLabel = rows.find((r) => r.status === 'ACTIVE')?.versionLabel || e.latestVersionLabel
  persist()
  return { ...row }
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetExpertMock() {
  expertSeq = 205
  experts = seedExperts()
  publications = seedPublications()
  persist()
}
