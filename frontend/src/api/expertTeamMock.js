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
 *   301 经营研究团  市场专家团  已发布 v1.0.0  设了主理人（201）
 *   302 知识问答团  通用专家团  已发布 v1.0.0  未设主理人（演示「员工确认安排」那条路）
 *   303 岗位协同团  岗位私有    未发布无版本    未设主理人，绑定岗位 401
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { nowIsoLocal as nowIso } from '@/utils/datetime'
import { nextSnapshotKey, archiveSnapshot, findSnapshot } from './reviewSnapshotArchive'
import { enrollReview, unenrollReview, publishActionOf, reviewActionMatches } from './reviewEnroll'
import { EXPERT_TYPE } from './expertTypes'
import { makeRevokedInfo, validateRevokeReason } from '@/utils/forceRevoke'
import { appendOpsRecord } from './accessAuditMock'
import { currentDemoUsername } from '@/utils/demoIdentity'
import { listExpertsSync } from './domainExpertMock'
import { getPositionNameById } from './positionMock'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let teamSeq = 305

/** 成员数量上下限（md §三.3.1：至少 2 位、上限 6 位；2026-10-12 负责人由 20 调为 6）。 */
export const TEAM_MEMBER_MIN = 2
export const TEAM_MEMBER_MAX = 6

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
      leaderDuty: '按经营分析的口径拆解：先由主理人判断经营数据里需要核对的异常，再把行业对照与竞品研究分给研究报告专家，最后由主理人汇总成管理建议。',
      collab: '',
      exampleQuestions: ['把这份经营月报交给团队看一遍', '让研究报告专家先对比三家竞品', '这个结论两位专家有分歧吗'],
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
// 历史归档（yuepu#76）：审核有结论 / 撤回时在审快照移入这里，「我的申请」回看已处理申请按 snapshotKey 取回提交时的配置
let snapshotArchive = {}

// v1（2026-10-12）：专家团模块首次接入持久化。
// v2（2026-10-12）：专家团去掉背景色字段，丢弃旧快照。
// v3（2026-10-12）：曾加选填「用途」purpose。
// v6（2026-10-12）：试跑拆解本期不做，去掉「已试跑」trialed 字段；成员上限 20→6，旧快照丢弃重播种子。
// v7（2026-10-14）：「团长」更名「主理人」，种子协作关系文案随改，旧快照丢弃重播种子。
// v5（2026-10-12）：行新增 pendingRevokeReason / pendingRevokeBy（停用时勾选强制回收的在审原因，同专家 v7），旧快照丢弃重播种子。
// v4（2026-10-12）：撤掉用途——客户端 PRD §5.2 写明后台团的拆解依据是「团队协作关系」（后台团为协作关系，顶替自建团的用途），丢弃含 purpose 的旧快照。
const persist = attachPersist('expertTeam', {
  // v8（2026-10-19 待办 yuepu#76）：新增 snapshotArchive（审核快照历史归档）与快照 key，旧快照丢弃重播种子。
  version: 8,
  snapshot: () => ({ teamSeq, teams, publications, reviewSnapshots, snapshotArchive }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.teamSeq) || !Array.isArray(d.teams) || typeof d.publications !== 'object' || d.publications === null) {
      throw new Error('expertTeam 快照形状不合法')
    }
    teamSeq = d.teamSeq
    teams = d.teams
    publications = d.publications
    reviewSnapshots = d.reviewSnapshots && typeof d.reviewSnapshots === 'object' ? d.reviewSnapshots : {}
    snapshotArchive = d.snapshotArchive && typeof d.snapshotArchive === 'object' ? d.snapshotArchive : {}
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
    if (!String(t.leaderDuty || '').trim()) return { field: 'leaderDuty', message: '请填写主理人职责' }
  } else if (!String(t.collab || '').trim()) {
    return { field: 'collab', message: '请填写团队协作关系' }
  }
  return null
}

/**
 * 发布前检查（md §三.8 表，检查 1–3；试跑提醒本期不做）。
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

/** 成员合法性（候选范围 + 主理人必须是成员），创建 / 更新时数据层兜底。 */
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
    throw err('主理人必须是已选成员', 'leaderId')
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
  teams = teams.filter((x) => x !== t)
  appendOpsRecord({ operator: currentDemoUsername(), module: '专家团', action: '删除', target: t.name, version: t.latestVersionLabel })
  delete publications[t.id]
  delete reviewSnapshots[String(t.id)]
  delete snapshotArchive[String(t.id)]
  persist()
  return removed
}

/* ============================ 与专家的联动（md §四） ============================ */

/** 引用某专家的团清单（任意状态都算引用）。供专家删除拦截与停用 / 回收提示。 */
export function listTeamsReferencingExpert(expertId) {
  return teams
    .filter((t) => t.members.some((m) => String(m.expertId) === String(expertId)))
    .map((t) => ({ id: t.id, name: t.name, status: t.status }))
}

/** 绑定了某岗位的岗位团（岗位删除确认文案用）。 */
export function listTeamsBoundToPosition(positionId) {
  return teams
    .filter((t) => t.type === EXPERT_TYPE.POSITION && normPositionIds(t.positionIds).some((id) => String(id) === String(positionId)))
    .map((t) => ({ id: t.id, name: t.name, status: t.status }))
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
  const snap = {
    key: nextSnapshotKey(reviewSnapshots, snapshotArchive, t.id),
    kind: 'EXPERT_TEAM',
    refId: t.id,
    requestAction,
    version: t.pendingVersion || '',
    submittedAt: submittedAt || nowIso(),
    detail: JSON.parse(JSON.stringify(toDetail(t)))
  }
  reviewSnapshots[String(t.id)] = snap
  return snap
}

/** 不传 key 只看在审快照（审核中心）；传 key 连历史归档一起查（我的申请回看已处理申请，yuepu#76）。 */
export function getTeamReviewSnapshot(id, key) {
  return findSnapshot(reviewSnapshots, snapshotArchive, id, key)
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
  const snap = writeReviewSnapshot(t, requestAction)
  enrollReview({ businessType: 'EXPERT_TEAM', snapshotKey: snap.key, refId: t.id, name: t.name, description: t.intro, requestAction, version: label, versionNotes: t.pendingReleaseNotes })
  persist()
  return {}
}

export async function withdrawTeam(id) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  if (!t.pendingAction) throw err('该专家团没有在途审核')
  t.pendingAction = null
  delete t.pendingRevokeReason // 撤回强制回收申请：不留任何回收后果
  delete t.pendingRevokeBy
  delete t.pendingVersion
  delete t.pendingReleaseNotes
  t.updatedAt = nowIso()
  archiveSnapshot(reviewSnapshots, snapshotArchive, t.id) // 在审快照入归档（yuepu#76 保留历史快照），我的申请仍可回看
  unenrollReview('EXPERT_TEAM', t.id)
  persist()
  return {}
}

// 停用 → 提交停用审核。同专家：不刷新最近更新时间、不受引用拦截、不影响成员专家。
// 强制回收（prd.专家团.md §二.3.6）是停用弹窗里的勾选项：入参 { forceRevoke, reason }，与普通停用走同一条审核链路，
// 提交后对象状态完全一致（审核中、仍已发布、仍可用）；只多记 pendingRevokeReason，审核通过才写 revoked 并落审计。
export async function unpublishTeam(id, { forceRevoke = false, reason = '' } = {}) {
  await delay()
  const t = findTeam(id)
  if (!t) throw err('专家团不存在', null, 404)
  if (t.status !== 'published') throw err('仅已发布专家团可停用')
  if (t.pendingAction) throw err('该专家团已有在途审核，请先撤回')
  let revokeReason = ''
  if (forceRevoke) {
    const msg = validateRevokeReason(reason)
    if (msg) throw err(msg, 'reason', 40001)
    revokeReason = String(reason).trim()
  }
  t.pendingAction = 'DELIST'
  if (revokeReason) {
    t.pendingRevokeReason = revokeReason
    t.pendingRevokeBy = currentDemoUsername() // 操作人 = 提交申请的管理员，不是审核人
  }
  const snap = writeReviewSnapshot(t, 'DELIST')
  enrollReview({
    businessType: 'EXPERT_TEAM', snapshotKey: snap.key, refId: t.id, name: t.name, description: t.intro,
    requestAction: 'DELIST', version: t.latestVersionLabel || '—',
    versionNotes: revokeReason ? '申请强制回收该专家团：' + revokeReason : '申请停止该专家团对外提供',
    ...(revokeReason ? { forceRevokeReason: revokeReason } : {})
  })
  persist()
  return {}
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
      if (t.pendingRevokeReason) {
        // 强制回收：审核通过才生效——打「已回收」标记并落访问审计
        const revokeBy = t.pendingRevokeBy || currentDemoUsername()
        t.revoked = makeRevokedInfo(t.pendingRevokeReason, revokeBy)
        appendOpsRecord({ operator: revokeBy, module: '专家团', action: '强制回收', target: t.name, detail: t.pendingRevokeReason, version: t.latestVersionLabel })
      }
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
  delete t.pendingRevokeReason // 通过已落地 / 驳回丢弃：回收原因随在途事项一并清掉
  delete t.pendingRevokeBy
  delete t.pendingVersion
  delete t.pendingReleaseNotes
  t.updatedAt = nowIso()
  archiveSnapshot(reviewSnapshots, snapshotArchive, t.id) // 在审快照入归档（yuepu#76 保留历史快照），我的申请仍可回看
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
  snapshotArchive = {}
  persist()
}
