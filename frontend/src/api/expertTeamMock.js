/**
 * 专家团模块内存 mock（管理端「专家 › 专家团」视图的数据层，模式同 domainExpertMock.js；开关见 expertTeam.js）。
 *
 * 依据：docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家团.md（以下简称 md）。
 * 发布 / 审核 / 版本 / 停用 / 强制回收的状态机与专家完全同构（md 零、五），差异只有三处：
 *   1. 团引用的是专家 id，不引用技能——发布前置不是「≥1 市场技能」，而是 md §三.8 的发布前检查；
 *   2. 团类型决定成员候选范围（md §三.3.1）；
 *   3. 成员状态变化（专家停用 / 回收 / 删除）会让团「缺员」（md §四），缺员实时算、不落库。
 *
 * 【与专家的依赖方向】本文件静态依赖 domainExpertMock（读专家）与 positionMock（读岗位名）；
 * 反向（专家删除前要查团引用）由 domainExpertMock 在 async 函数里动态 import 本文件，避免 ESM 成环。
 *
 * 【团的种子】3 条，成员全部取自专家种子里「已发布」的 201 / 202 / 204：
 *   301 经营研究团  市场专家团  已发布 v1.0.0  设了团长（201）
 *   302 知识问答团  通用专家团  已发布 v1.0.0  未设团长（演示「员工确认安排」那条路）
 *   303 岗位协同团  岗位私有    未发布无版本    未设团长，绑定岗位 401
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { nowIsoLocal as nowIso } from '@/utils/datetime'
import { enrollReview, unenrollReview, publishActionOf, reviewActionMatches } from './reviewEnroll'
import { EXPERT_TYPE } from './expertTypes'
import { makeRevokedInfo } from '@/utils/forceRevoke'
import { appendOpsRecord } from './accessAuditMock'
import { currentDemoUsername } from '@/utils/demoIdentity'
import { listExpertsSync } from './domainExpertMock'
import { getPositionNameById } from './positionMock'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let teamSeq = 305

/** 成员数量上下限（md §三.3.1：至少 2 位、上限 20 位）。 */
export const TEAM_MEMBER_MIN = 2
export const TEAM_MEMBER_MAX = 20

/* ---------------- 候选范围（md §三.3.1 表） ----------------
 * 三类团都可放通用专家和市场专家；岗位私有专家只能进岗位私有团（2026-10-12 负责人拍板）。 */
export function candidateTypesOf(teamType) {
  return teamType === EXPERT_TYPE.POSITION
    ? [EXPERT_TYPE.SYSTEM_DEFAULT, EXPERT_TYPE.PLATFORM, EXPERT_TYPE.POSITION]
    : [EXPERT_TYPE.SYSTEM_DEFAULT, EXPERT_TYPE.PLATFORM]
}

/* ---------------- 专家可用性（缺员判定，md §四） ---------------- */
function expertMap() {
  return new Map(listExpertsSync().map((x) => [String(x.id), x]))
}

/** 专家当前是否可作团员：已发布。返回 '' 表示可用，否则返回不可用原因文案。 */
function unavailableReasonOf(expert) {
  if (!expert) return '已删除'
  if (expert.status === 'published') return ''
  if (expert.revoked) return '已回收'
  return expert.latestVersionLabel ? '已停用' : '未发布'
}

/* ---------------- 种子 ---------------- */
function seedTeams() {
  return [
    {
      id: 301,
      name: '经营研究团',
      type: EXPERT_TYPE.PLATFORM,
      positionIds: [],
      avatar: '◈',
      category: '投资',
      intro: '把经营数据分析和行业研究放在一起看：先识别经营异常，再用公开资料做行业与竞品对照，给出可追溯的管理建议。',
      members: [
        { expertId: 201, duty: '经营数据分析口径与管理建议' },
        { expertId: 204, duty: '行业与竞品公开资料研究' }
      ],
      leaderId: 201,
      leaderDuty: '按经营分析的口径拆解：先由团长判断经营数据里需要核对的异常，再把行业对照与竞品研究分给研究报告专家，最后由团长汇总成管理建议。',
      collab: '',
      exampleQuestions: ['把这份经营月报交给团队看一遍', '让研究报告专家先对比三家竞品', '这个结论两位专家有分歧吗'],
      trialed: false,
      status: 'published',
      pendingAction: null,
      latestVersionLabel: 'v1.0.0',
      createdAt: '2026-09-05T10:00:00+08:00',
      updatedAt: '2026-09-08T15:30:00+08:00',
      publishedAt: '2026-09-08T15:30:00+08:00'
    },
    {
      id: 302,
      name: '知识问答团',
      type: EXPERT_TYPE.SYSTEM_DEFAULT,
      positionIds: [],
      avatar: '⌕',
      category: '通用',
      intro: '解答制度、流程和业务知识类问题：由企业知识助手检索依据，经营分析专家补充数据口径，给出带出处的回答。',
      members: [
        { expertId: 202, duty: '检索制度与流程依据并标注出处' },
        { expertId: 201, duty: '补充涉及经营数据的口径说明' }
      ],
      leaderId: null,
      leaderDuty: '',
      collab: '先由企业知识助手检索制度依据；涉及数据口径的部分同时交给经营分析专家补充；两边都出结论后合并成一份带出处的回答。',
      exampleQuestions: ['帮我查一下差旅报销制度并解释口径', '让企业知识助手先把依据找出来', '两位专家的说法不一致时列出来'],
      trialed: true,
      status: 'published',
      pendingAction: null,
      latestVersionLabel: 'v1.0.0',
      createdAt: '2026-09-06T09:20:00+08:00',
      updatedAt: '2026-09-09T11:00:00+08:00',
      publishedAt: '2026-09-09T11:00:00+08:00'
    },
    {
      id: 303,
      name: '岗位协同团',
      type: EXPERT_TYPE.POSITION,
      positionIds: [401],
      avatar: '◎',
      category: '投资',
      intro: '服务经营分析岗：研究报告专家负责外部资料，企业知识助手负责内部制度依据，两边合并给出分析底稿。',
      members: [
        { expertId: 204, duty: '外部公开资料与行业研究' },
        { expertId: 202, duty: '内部制度与知识依据' }
      ],
      leaderId: null,
      leaderDuty: '',
      collab: '外部公开资料和内部制度依据同时展开，两边都出结论后合并成一份分析底稿，内外部依据冲突的地方单独列出。',
      exampleQuestions: ['把这个课题交给团队', '让研究报告专家先看外部资料', '内外部依据冲突的地方单独列出'],
      trialed: false,
      // 本条是团种子里唯一的「未发布 + 无版本 + 无在途」样本，用例依赖它验证草稿分支，勿改状态。
      status: 'draft',
      pendingAction: null,
      latestVersionLabel: '',
      createdAt: '2026-09-10T14:00:00+08:00',
      updatedAt: '2026-09-10T14:00:00+08:00',
      publishedAt: null
    }
  ]
}

function seedPublications() {
  return {
    301: [
      { id: 911, version: 1, versionLabel: 'v1.0.0', status: 'ACTIVE', sizeBytes: 5210, publishedBy: '管理员', publishedAt: '2026-09-08T15:30:00+08:00', delistedAt: null, releaseNotes: '首个版本' }
    ],
    302: [
      { id: 921, version: 1, versionLabel: 'v1.0.0', status: 'ACTIVE', sizeBytes: 4980, publishedBy: '管理员', publishedAt: '2026-09-09T11:00:00+08:00', delistedAt: null, releaseNotes: '首个版本' }
    ],
    303: []
  }
}

let teams = seedTeams()
let publications = seedPublications()
// 审核版本快照（teamId → 快照），提交模块自持，口径同 domainExpertMock.reviewSnapshots；
// 声明必须在 attachPersist 之前（restore 回调同步执行，晚声明会撞 TDZ）。
let reviewSnapshots = {}

// v1（2026-10-12）：专家团模块首次接入持久化。
// v2（2026-10-12）：专家团去掉背景色字段，丢弃旧快照。
// v3（2026-10-12）：曾加选填「用途」purpose。
// v4（2026-10-12）：撤掉用途——客户端 PRD §5.2 写明后台团的拆解依据是「团队协作关系」（后台团为协作关系，顶替自建团的用途），丢弃含 purpose 的旧快照。
const persist = attachPersist('expertTeam', {
  version: 4,
  snapshot: () => ({ teamSeq, teams, publications, reviewSnapshots }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.teamSeq) || !Array.isArray(d.teams) || typeof d.publications !== 'object' || d.publications === null) {
      throw new Error('expertTeam 快照形状不合法')
    }
    teamSeq = d.teamSeq
    teams = d.teams
    publications = d.publications
    reviewSnapshots = d.reviewSnapshots && typeof d.reviewSnapshots === 'object' ? d.reviewSnapshots : {}
  }
})

function findTeam(id) {
  return teams.find((t) => String(t.id) === String(id))
}

/** 展示态标签：审核中 > 已发布 > 未发布（同专家 viewLabelOf）。 */
function viewLabelOf(t) {
  if (t.pendingAction) return 'review'
  if (t.status === 'published') return 'published'
  return 'draft'
}

function parseVersion(label) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(label || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const normQuestions = (qs) => [0, 1, 2].map((i) => String((qs || [])[i] || ''))
const normPositionIds = (ids) => (Array.isArray(ids) ? [...new Set(ids.filter((id) => id != null))] : [])
const normMembers = (ms) => {
  const seen = new Set()
  const out = []
  for (const m of Array.isArray(ms) ? ms : []) {
    const expertId = m?.expertId ?? m?.id
    if (expertId == null || seen.has(String(expertId))) continue
    seen.add(String(expertId))
    out.push({ expertId: Number(expertId), duty: String(m?.duty || '').trim() })
  }
  return out
}

/** 成员配置里会影响「试跑结果」的部分的签名；变了就要清掉「已试跑」（md §三.9）。 */
const structureSig = (t) =>
  JSON.stringify([t.members.map((m) => [m.expertId, m.duty]), t.leaderId ?? null, t.leaderDuty || '', t.collab || ''])

/* ---------------- 出参 ---------------- */

/** 解析成员明细 + 缺员信息（实时按专家当前状态算，引用非复制）。 */
function resolveMembers(t) {
  const map = expertMap()
  return t.members.map((m) => {
    const x = map.get(String(m.expertId))
    const reason = unavailableReasonOf(x)
    return {
      expertId: m.expertId,
      duty: m.duty, // 管理员填的原始值（可空，编辑回显用）
      // 生效内容：填了用填的，没填取该专家当前的简介（现取不复制，专家简介改了跟着变）
      effectiveDuty: String(m.duty || '').trim() || x?.intro || '',
      intro: x?.intro || '',
      name: x?.name || `（专家 ${m.expertId}）`,
      avatar: x?.avatar || '',
      backgroundColor: x?.backgroundColor || '',
      category: x?.category || '',
      expertType: x?.type || '',
      positionIds: x?.positionIds || [],
      unavailable: reason,
      revoked: x?.revoked ? { ...x.revoked } : null
    }
  })
}

function toRow(t) {
  const members = resolveMembers(t)
  const missing = members.filter((m) => m.unavailable)
  const leader = members.find((m) => String(m.expertId) === String(t.leaderId))
  return {
    id: t.id,
    name: t.name,
    type: t.type || EXPERT_TYPE.PLATFORM,
    positionIds: t.type === EXPERT_TYPE.POSITION ? normPositionIds(t.positionIds) : [],
    positionCount: t.type === EXPERT_TYPE.POSITION ? normPositionIds(t.positionIds).length : 0,
    avatar: t.avatar,
    category: t.category,
    intro: t.intro,
    memberCount: members.length,
    memberNames: members.map((m) => m.name),
    leaderId: t.leaderId ?? null,
    leaderName: leader?.name || '',
    trialed: !!t.trialed,
    missingCount: missing.length,
    missing: missing.map((m) => ({ expertId: m.expertId, name: m.name, reason: m.unavailable })),
    status: t.status,
    pendingAction: t.pendingAction,
    pendingVersion: t.pendingVersion || null,
    latestVersionLabel: t.latestVersionLabel || '',
    revoked: t.revoked ? { ...t.revoked } : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    publishedAt: t.publishedAt || null
  }
}

function toDetail(t) {
  return {
    ...toRow(t),
    members: resolveMembers(t),
    leaderDuty: t.leaderDuty || '',
    collab: t.collab || '',
    exampleQuestions: normQuestions(t.exampleQuestions)
  }
}

/* ---------------- 校验 ---------------- */

/** 保存校验（md §三.8「保存」）：返回第一个未通过项 { field, message } 或 null。 */
export function checkTeamSavable(t) {
  if (!String(t.name || '').trim()) return { field: 'name', message: '请填写团名称' }
  if (!String(t.type || '').trim()) return { field: 'type', message: '请选择团类型' }
  if (!String(t.category || '').trim()) return { field: 'category', message: '请选择专家分类' }
  if (!String(t.avatar || '').trim()) return { field: 'avatar', message: '请选择图标' }
  if (!String(t.intro || '').trim()) return { field: 'intro', message: '请填写团介绍' }
  if (!normQuestions(t.exampleQuestions).every((q) => q.trim())) return { field: 'examples', message: '请填写 3 条"团队帮你做"示例问题' }
  const members = t.members || []
  if (members.length < TEAM_MEMBER_MIN) return { field: 'members', message: '至少 2 位成员' }
  if (t.leaderId != null) {
    if (!String(t.leaderDuty || '').trim()) return { field: 'leaderDuty', message: '请填写团长职责' }
  } else if (!String(t.collab || '').trim()) {
    return { field: 'collab', message: '请填写团队协作关系' }
  }
  return null
}

/**
 * 发布前检查（md §三.8 表，检查 1–3；检查 4「试跑提醒」不阻断，由页面处理）。
 * 返回 { field?, message } 或 null。
 */
export function checkTeamPublishable(t) {
  const base = checkTeamSavable(t)
  if (base) return base
  const map = expertMap()
  for (const m of t.members) {
    const x = map.get(String(m.expertId))
    const reason = unavailableReasonOf(x)
    if (reason) return { field: 'members', message: `成员「${x?.name || m.expertId}」${reason}，请移除或替换后再发布` }
  }
  if (t.type === EXPERT_TYPE.POSITION && normPositionIds(t.positionIds).length) {
    for (const m of t.members) {
      const x = map.get(String(m.expertId))
      if (x?.type !== EXPERT_TYPE.POSITION) continue
      const bound = new Set((x.positionIds || []).map(String))
      const lack = normPositionIds(t.positionIds).find((pid) => !bound.has(String(pid)))
      if (lack != null) {
        return { field: 'members', message: `成员「${x.name}」未绑定岗位「${getPositionNameById(lack) || lack}」，该岗位员工将无法使用，请调整` }
      }
    }
  }
  return null
}

/** 成员合法性（候选范围 + 团长必须是成员），创建 / 更新时数据层兜底。 */
function assertMembersLegal(type, members, leaderId) {
  if (members.length > TEAM_MEMBER_MAX) throw err(`成员最多 ${TEAM_MEMBER_MAX} 位`, 'members')
  const allowed = new Set(candidateTypesOf(type))
  const map = expertMap()
  for (const m of members) {
    const x = map.get(String(m.expertId))
    if (!x) throw err('成员专家不存在', 'members', 404)
    if (!allowed.has(x.type)) throw err(`「${x.name}」不能加入该类型的团`, 'members')
  }
  if (leaderId != null && !members.some((m) => String(m.expertId) === String(leaderId))) {
    throw err('团长必须是已选成员', 'leaderId')
  }
}

/* ============================ 列表 / 详情 / CRUD ============================ */

// params: { page, size, keyword, type, category, status(''|draft|review|published), sort(asc|desc，按 updatedAt) }
export async function listTeams(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const type = String(params.type || '')
  const category = String(params.category || '')
  const status = String(params.status || '')
  const sort = params.sort === 'asc' ? 'asc' : 'desc'
  let list = teams.filter(
    (t) =>
      (!kw || [t.name, t.intro, t.category].some((v) => String(v || '').toLowerCase().includes(kw))) &&
      (!type || t.type === type) &&
      (!category || t.category === category) &&
      (!status || viewLabelOf(t) === status)
  )
  list = [...list].sort((a, b) =>
    sort === 'desc' ? String(b.updatedAt).localeCompare(String(a.updatedAt)) : String(a.updatedAt).localeCompare(String(b.updatedAt))
  )
  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 20
  return { list: list.slice((page - 1) * size, page * size).map(toRow), total }
}

export async function getTeam(id) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  return toDetail(t)
}

/**
 * 成员候选（md §三.3.1）：已发布专家，按团类型限定范围。
 */
export async function listTeamMemberCandidates({ type, keyword } = {}) {
  await delay(120)
  const kw = String(keyword || '').trim().toLowerCase()
  const allowed = new Set(candidateTypesOf(type))
  return listExpertsSync()
    .filter((x) => x.status === 'published' && allowed.has(x.type))
    .filter((x) => !kw || [x.name, x.intro, x.category].some((v) => String(v || '').toLowerCase().includes(kw)))
    .map((x) => ({
      id: x.id, name: x.name, intro: x.intro, avatar: x.avatar, backgroundColor: x.backgroundColor,
      category: x.category, type: x.type, positionIds: x.positionIds
    }))
}

export async function createTeam(payload = {}) {
  await delay()
  const name = String(payload.name || '').trim()
  if (!name) throw err('请填写团名称', 'name')
  if (name.length > 64) throw err('团名称最多 64 个字符', 'name')
  if (teams.some((t) => t.name === name)) throw err('团名称已存在', 'name', 1005)
  const type = payload.type ? String(payload.type) : ''
  if (!Object.values(EXPERT_TYPE).includes(type)) throw err('请选择团类型', 'type')
  const members = normMembers(payload.members)
  const leaderId = payload.leaderId != null && payload.leaderId !== '' ? Number(payload.leaderId) : null
  assertMembersLegal(type, members, leaderId)
  const now = nowIso()
  const t = {
    id: teamSeq++,
    name,
    type,
    positionIds: type === EXPERT_TYPE.POSITION ? normPositionIds(payload.positionIds) : [],
    avatar: String(payload.avatar || '').trim(),
    category: String(payload.category || '').trim(),
    intro: String(payload.intro || '').trim(),
    members,
    leaderId,
    leaderDuty: leaderId != null ? String(payload.leaderDuty || '') : '',
    collab: String(payload.collab || ''),
    exampleQuestions: normQuestions(payload.exampleQuestions),
    trialed: !!payload.trialed,
    status: 'draft',
    pendingAction: null,
    latestVersionLabel: '',
    createdAt: now,
    updatedAt: now,
    publishedAt: null
  }
  teams.unshift(t)
  publications[t.id] = []
  persist()
  return toDetail(t)
}

// 部分更新：团类型创建后不可改（带了也忽略）；所属岗位仅岗位私有团可增减；审核中锁定。
export async function updateTeam(id, payload = {}) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  if (t.pendingAction) throw err('审核中，专家团已锁定不可修改', null, 409)
  const sigBefore = structureSig(t)
  if (payload.name !== undefined) {
    const name = String(payload.name || '').trim()
    if (!name) throw err('请填写团名称', 'name')
    if (name.length > 64) throw err('团名称最多 64 个字符', 'name')
    if (teams.some((x) => x !== t && x.name === name)) throw err('团名称已存在', 'name', 1005)
    t.name = name
  }
  if (payload.avatar !== undefined) t.avatar = String(payload.avatar || '').trim()
  if (payload.category !== undefined) t.category = String(payload.category || '').trim()
  if (payload.intro !== undefined) t.intro = String(payload.intro || '').trim()
  if (payload.positionIds !== undefined && t.type === EXPERT_TYPE.POSITION) t.positionIds = normPositionIds(payload.positionIds)
  if (payload.exampleQuestions !== undefined) t.exampleQuestions = normQuestions(payload.exampleQuestions)
  if (payload.members !== undefined || payload.leaderId !== undefined) {
    const members = payload.members !== undefined ? normMembers(payload.members) : t.members
    const leaderId = payload.leaderId !== undefined ? (payload.leaderId != null && payload.leaderId !== '' ? Number(payload.leaderId) : null) : t.leaderId
    assertMembersLegal(t.type, members, leaderId)
    t.members = members
    t.leaderId = leaderId
  }
  if (payload.leaderDuty !== undefined) t.leaderDuty = String(payload.leaderDuty || '')
  if (payload.collab !== undefined) t.collab = String(payload.collab || '')
  // 「已试跑」：结构被改过则清零，除非本次明确带了 trialed=true（编辑器在改动后重新试跑过）
  if (payload.trialed !== undefined) t.trialed = !!payload.trialed
  else if (structureSig(t) !== sigBefore) t.trialed = false
  t.updatedAt = nowIso()
  persist()
  return toDetail(t)
}

// 删除（md §二.3.8）：仅「未发布且无审核中」可删；专家本体不受影响。返回被解除的成员引用数。
export async function deleteTeam(id) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  if (t.pendingAction) throw err('审核中的专家团不可删除，请先撤回或等待审核完成', null, 409)
  if (t.status !== 'draft') throw err('已发布的专家团不可删除，需先完成停用审核', null, 409)
  const removed = t.members.length
  // 委派给本团的岗位自动化任务清空委派对象（动态 import 避免与 sampleTaskMock 成环）
  const { clearExecTeamRef } = await import('./sampleTaskMock')
  clearExecTeamRef(t.id)
  teams = teams.filter((x) => x !== t)
  delete publications[t.id]
  delete reviewSnapshots[String(t.id)]
  persist()
  return removed
}

/* ============================ 试跑拆解（md §三.9） ============================ */

/**
 * 试跑拆解：只给出「安排预览」，不执行、不产生任务记录。入参取编辑器当前表单（未保存也能试），
 * { members:[{expertId,duty}], leaderId, leaderDuty, collab, task }。
 * demo 不接模型：先后按成员排位 + 协作关系里的关键词做确定性推演——
 * 第一位「先做」；协作关系含「再 / 之后 / 最后 / 核对」时，最后一位「等 X 完成后」；其余「同时」。
 */
export async function trialTeam(payload = {}) {
  await delay(500)
  const members = normMembers(payload.members)
  if (members.length < TEAM_MEMBER_MIN) throw err('请先选择至少 2 位成员')
  const task = String(payload.task || '').trim()
  if (!task) throw err('请输入试跑任务描述', 'task')
  const leaderId = payload.leaderId != null && payload.leaderId !== '' ? Number(payload.leaderId) : null
  const collab = String(payload.collab || '')
  const map = expertMap()
  const nameOf = (m) => map.get(String(m.expertId))?.name || String(m.expertId)
  const sequential = /再|之后|最后|核对|接力/.test(collab)
  const plan = members.map((m, i) => {
    let order = '同时'
    if (i === 0) order = '先做'
    else if (sequential && i === members.length - 1) order = `等 ${nameOf(members[0])} 完成后`
    // 没填「团内负责什么」时取该专家的简介（同详情页口径）
    const duty = String(m.duty || '').trim() || map.get(String(m.expertId))?.intro || '按专业口径处理这一块'
    return { expertId: m.expertId, name: nameOf(m), duty, order }
  })
  return {
    mode: leaderId != null ? 'leader' : 'system',
    leaderName: leaderId != null ? nameOf({ expertId: leaderId }) : '',
    task,
    plan
  }
}

/* ============================ 与专家的联动（md §四） ============================ */

/** 引用某专家的团清单（任意状态都算引用）。供专家删除拦截与停用 / 回收提示。 */
export function listTeamsReferencingExpert(expertId) {
  return teams
    .filter((t) => t.members.some((m) => String(m.expertId) === String(expertId)))
    .map((t) => ({ id: t.id, name: t.name, status: t.status }))
}

/**
 * 岗位自动化任务「执行动作 = 专家团」的候选（prd.岗位.md §7.6）：已发布，且员工在该岗位下一定拿得到——
 * 绑定了本岗位的岗位团 + 通用团（市场团要员工自己召唤，岗位下发的任务不能保证他有，不放进候选）。
 */
export async function listTeamsForAutomation(positionId) {
  await delay(120)
  return teams
    .filter(
      (t) =>
        t.status === 'published' &&
        (t.type === EXPERT_TYPE.SYSTEM_DEFAULT ||
          (t.type === EXPERT_TYPE.POSITION && normPositionIds(t.positionIds).some((id) => String(id) === String(positionId))))
    )
    .map((t) => {
      const r = toRow(t)
      return { id: r.id, name: r.name, type: r.type, leaderId: r.leaderId, leaderName: r.leaderName }
    })
}

/** 岗位被删后把它从岗位私有团的 positionIds 摘掉（口径同 removePositionFromExperts）。 */
export function removePositionFromTeams(positionId) {
  let changed = false
  teams.forEach((t) => {
    if (!Array.isArray(t.positionIds) || !t.positionIds.some((id) => String(id) === String(positionId))) return
    t.positionIds = t.positionIds.filter((id) => String(id) !== String(positionId))
    changed = true
  })
  if (changed) persist()
}

/* ============================ 发布 / 撤回 / 停用 ============================ */

export async function getTeamNextVersionLabel(id) {
  await delay(120)
  const rows = publications[String(findTeam(id)?.id)] || []
  const latest = parseVersion(rows[0]?.versionLabel)
  if (!latest) return 'v1.0.0'
  return `v${latest[0]}.${latest[1]}.${latest[2] + 1}`
}

/* 审核版本快照：提交模块自持（口径同 domainExpertMock，md 审核中心 §四），撤回 / 审核落地时销毁。 */
function writeReviewSnapshot(t, requestAction, submittedAt) {
  reviewSnapshots[String(t.id)] = {
    kind: 'EXPERT_TEAM',
    refId: t.id,
    requestAction,
    version: t.pendingVersion || '',
    submittedAt: submittedAt || nowIso(),
    detail: JSON.parse(JSON.stringify(toDetail(t)))
  }
}

export function getTeamReviewSnapshot(id) {
  const s = reviewSnapshots[String(id)]
  return s ? JSON.parse(JSON.stringify(s)) : null
}

// 提交发布 → 进入审核。payload: { bump, releaseNotes }。发布前检查见 checkTeamPublishable。
export async function publishTeam(id, payload = {}) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  if (t.pendingAction) throw err('该专家团已有在途审核，请先撤回')
  const blocked = checkTeamPublishable(t)
  if (blocked) throw err(blocked.message, blocked.field)
  if (!String(payload.releaseNotes || '').trim()) throw err('升级说明必填，简述本次更新项', 'releaseNotes')
  const rows = publications[t.id] || []
  const latest = parseVersion(rows[0]?.versionLabel)
  let label = 'v1.0.0'
  if (latest) {
    const bump = payload.bump || 'NONE'
    if (bump === 'MAJOR') label = `v${latest[0] + 1}.0.0`
    else if (bump === 'MINOR') label = `v${latest[0]}.${latest[1] + 1}.0`
    else label = `v${latest[0]}.${latest[1]}.${latest[2] + 1}`
  }
  t.pendingAction = 'PUBLISH'
  t.pendingVersion = label
  t.pendingReleaseNotes = String(payload.releaseNotes || '').trim()
  t.updatedAt = nowIso()
  const requestAction = publishActionOf(rows.length > 0)
  writeReviewSnapshot(t, requestAction)
  enrollReview({ businessType: 'EXPERT_TEAM', refId: t.id, name: t.name, description: t.intro, requestAction, version: label, versionNotes: t.pendingReleaseNotes })
  persist()
  return {}
}

export async function withdrawTeam(id) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  if (!t.pendingAction) throw err('该专家团没有在途审核')
  t.pendingAction = null
  delete t.pendingVersion
  delete t.pendingReleaseNotes
  t.updatedAt = nowIso()
  delete reviewSnapshots[String(t.id)]
  unenrollReview('EXPERT_TEAM', t.id)
  persist()
  return {}
}

// 停用 → 提交停用审核。同专家：不刷新最近更新时间、不受引用拦截、不影响成员专家。
export async function unpublishTeam(id) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  if (t.status !== 'published') throw err('仅已发布专家团可停用')
  if (t.pendingAction) throw err('该专家团已有在途审核，请先撤回')
  t.pendingAction = 'DELIST'
  writeReviewSnapshot(t, 'DELIST')
  enrollReview({ businessType: 'EXPERT_TEAM', refId: t.id, name: t.name, description: t.intro, requestAction: 'DELIST', version: t.latestVersionLabel || '—', versionNotes: '申请停止该专家团对外提供' })
  persist()
  return {}
}

// 强制回收（md §二.3.6）：不走审核、立即生效；成员专家不受影响。
export async function forceRevokeTeam(id, { reason } = {}) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  if (t.status !== 'published' || t.pendingAction) throw err('专家团状态已变化，请刷新后重试', null, 409)
  const text = String(reason || '').trim()
  if (!text) throw err('请输入回收原因', 'reason')
  if (text.length > 500) throw err('回收原因最多 500 字', 'reason')
  t.status = 'draft'
  t.revoked = makeRevokedInfo(text)
  appendOpsRecord({ operator: currentDemoUsername(), module: '专家团', action: '强制回收', objectId: t.id, target: t.name, detail: text, version: t.latestVersionLabel })
  persist()
  return { revoked: { ...t.revoked } }
}

// 审核结果落地（reviewsMock 经动态 import 分发到此），规则同 applyExpertReviewResult。
export function applyTeamReviewResult(refId, requestAction, approved) {
  const t = findTeam(refId)
  if (!t || !t.pendingAction) return false
  if (requestAction && !reviewActionMatches(requestAction, t.pendingAction)) return false
  const isDelist = t.pendingAction === 'DELIST'
  if (approved) {
    if (isDelist) {
      t.status = 'draft'
    } else {
      const label = t.pendingVersion || 'v1.0.0'
      const rows = publications[t.id] || (publications[t.id] = [])
      rows.forEach((r) => {
        if (r.status === 'ACTIVE') {
          r.status = 'DELISTED'
          r.delistedAt = nowIso()
        }
      })
      rows.unshift({
        id: (rows[0]?.id || 900) + 1,
        version: (rows[0]?.version || 0) + 1,
        versionLabel: label,
        status: 'ACTIVE',
        sizeBytes: 5210,
        publishedBy: '管理员',
        publishedAt: nowIso(),
        delistedAt: null,
        releaseNotes: t.pendingReleaseNotes || ''
      })
      t.status = 'published'
      t.latestVersionLabel = label
      t.publishedAt = nowIso()
      delete t.revoked
    }
  }
  t.pendingAction = null
  delete t.pendingVersion
  delete t.pendingReleaseNotes
  t.updatedAt = nowIso()
  delete reviewSnapshots[String(t.id)]
  persist()
  return true
}

/* ============================ 版本历史 + 禁用/启用（互斥） ============================ */

export async function listTeamPublications(id) {
  await delay()
  const t = findTeam(id)
  const rows = (t && publications[t.id]) || []
  return rows.map((r) => ({ ...r }))
}

export async function delistTeamPublication(teamId, publicationId) {
  await delay()
  const t = findTeam(teamId)
  const rows = (t && publications[t.id]) || []
  const row = rows.find((r) => String(r.id) === String(publicationId))
  if (!row) throw err('版本不存在', null, 404)
  if (row.status !== 'ACTIVE') throw err('该版本已是禁用状态', null, 409)
  if (rows.filter((r) => r.status === 'ACTIVE').length <= 1) {
    throw err('当前版本是该专家团最后一个启用版本。如需停止对外提供，请先整体下架专家团。', null, 409)
  }
  row.status = 'DELISTED'
  row.delistedAt = nowIso()
  persist()
  return { ...row }
}

export async function relistTeamPublication(teamId, publicationId) {
  await delay()
  const t = findTeam(teamId)
  const rows = (t && publications[t.id]) || []
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
  persist()
  return { ...row }
}

/** 测试辅助：重置种子。 */
export function __resetTeamMock() {
  teamSeq = 305
  teams = seedTeams()
  publications = seedPublications()
  reviewSnapshots = {}
  persist()
}
