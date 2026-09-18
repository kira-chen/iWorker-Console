/**
 * 技能模块开发期内存 mock（纯前端 demo，2026-09-01 PRD 对齐改造）。
 *
 * 【定位】「技能」模块（列表 / 编辑页 / 新建弹窗 / 版本管理 / 文件层）的单一数据真相源。
 * 开关：`import.meta.env.DEV && import.meta.env.VITE_SKILL_MOCK !== '0'`（分流点在
 * unifiedSkill.js / platformSkill.js / position.js / skillCategory.js / skillFiles.js，
 * 写法参考 apiConnector.js + mcpConnectorMock.js）。
 *
 * 【状态机（对齐交互原型 v2 最终覆写态 + PRD 三态口径）】
 * 对外三态 = 未发布 / 审核中 / 已发布，由 publications 经 derivePlatformState 派生：
 *   - 提交发布（publish）→ pendingAction='publish'：
 *       无已发布版本 → PENDING_REVIEW（审核中·首发在审）；
 *       有已发布版本 → PUBLISHED + reviewPending（审核中·新版在审）。
 *     demo 不落审核结论——停在「审核中」（审核通过属审核中心模块，另一批次）。
 *   - 撤回（withdrawPublish）→ 清 pendingAction/pendingVersion/pendingReleaseNotes，
 *       按 version 空/非空恢复 未发布/已发布（对齐原型 skill-withdraw）。
 *   - 停用（delist）→ pendingAction='stop'：PUBLISHED + pendingAction=DELIST
 *       → PUBLISHED_DELISTING（审核中·停用审核）。被引用（refNames 非空）时拒绝。
 *   - 删除（remove）→ 被引用时拒绝（ApiError 携引用清单文案）。
 *
 * 【三类技能一体】岗位私有（POSITION）自本轮起接入同构发布/版本状态机（PRD 对齐清单 6/29：
 * 旧「发布/撤回草稿」本体开关废弃），三类行都携带 publications 与版本快照。
 *
 * 【技能分类同源】8 类固定分类从 fieldDictMock（skillCategory 字段）取；demo 用「分类名」
 * 同时充当 categoryId（displayCategoryId === displayCategoryName），保持前端交互闭环即可。
 *
 * 【版本历史】启用某历史版本 = 互斥启用（其余启用版本自动禁用，对齐原型 toggleHistory）；
 * 最后一个启用版本禁「禁用」（VersionHistoryList guardLastActive 前置置灰，mock 兜底拦截）。
 */
import { ApiError } from './request'
import { getFieldOptionNames } from './fieldDictMock'
import { attachPersist } from './mockPersist'
// 2026-09-09 收编：本地「现在→分钟文本」复制品改引 utils/datetime 单一真相（mock 引 utils 为既有范式）
import { nowMinuteText as nowText } from '@/utils/datetime'
// 2026-09-18 R1：提交发布 / 停用 → 审核中心 + 我的申请落行；撤回 → 摘行；审核落地前核对申请类型（见 reviewEnroll.js）
import { enrollReview, unenrollReview, reviewActionMatches } from './reviewEnroll'

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms))

/* ============================ 工具函数 ============================ */

function parseVersion(label) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(label || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** 按 bump 计算下一版本号（无历史版本 → v1.0.0，对齐原型 previewVersion）。 */
export function bumpVersion(current, bump = 'NONE') {
  const p = parseVersion(current)
  if (!p) return 'v1.0.0'
  if (bump === 'MAJOR') return `v${p[0] + 1}.0.0`
  if (bump === 'MINOR') return `v${p[0]}.${p[1] + 1}.0`
  return `v${p[0]}.${p[1]}.${p[2] + 1}`
}

let idSeq = 400
const newId = () => `sk_${idSeq++}`

const SKILL_MD_TPL = (name, desc) =>
  `# ${name}\n\n${desc || '请填写技能说明。'}\n\n## 使用方法\n\n1. 描述用户目标\n2. 调用所需工具\n3. 返回清晰结果\n`

/* ============================ 种子数据（对齐原型 skillRows 301~307 + 补态 308/309） ============================ */

function seed(row) {
  return {
    pendingAction: null, // null | 'publish' | 'stop'
    pendingVersion: '',
    pendingReleaseNotes: '',
    delisted: false, // 曾发布后整体下架（demo 里映射「未发布」且保留版本号）
    defaultInstall: false,
    exampleQuestion: '',
    triggers: [],
    toolRefs: [],
    refNames: [],
    files: null,
    snapshots: [],
    // SKILL.md 内 name 字段（包作者定义的技术名；与本行 name／后台可编辑的展示名各管各，见
    // skillFileTree.js frontmatter 拆分区注释）。zip 导入时落值并参与全平台唯一性校验（md §三.2
    // 新建技能弹窗「skill.md 内 name 不可重名」）；种子行默认取 name（视同已占用）；手动创建
    // （SKILL.md 尚为空）不落值。
    skillMdName: row.name || null,
    ...row
  }
}

const skills = [
  seed({
    id: 'sk_301', type: 'POSITION', name: '日报周报生成', icon: '▤',
    description: '根据工作记录自动整理日报与周报', category: '办公效率',
    refNames: ['经营分析岗', '财务审核岗'], // 与 positionMock 实际引用同源（2026-09-02 种子自洽治理）
    status: 'published', version: 'v1.2.0',
    createdAt: '2026-08-23 17:20', updatedAt: '2026-08-23 17:20', publishedAt: '2026-08-23 18:10',
    exampleQuestion: '帮我把这周的工作记录整理成周报',
    toolRefs: ['mcp__baoxiao', 'api__customer', 'mcp__zhishiku'],
    files: {
      'SKILL.md': SKILL_MD_TPL('日报周报生成', '根据工作记录自动整理日报与周报'),
      'references/写作规范.md': '# 写作规范\n\n日报三段式：进展 / 风险 / 明日计划。'
    },
    snapshots: [
      { version: 'v1.2.0', status: 'ACTIVE', size: '18.6 KB', publisher: '管理员', publishedAt: '2026-08-23 18:10', disabledAt: '', notes: '当前线上版本' },
      { version: 'v1.1.0', status: 'DELISTED', size: '17.9 KB', publisher: '管理员', publishedAt: '2026-08-20 16:30', disabledAt: '2026-08-23 10:15', notes: '历史稳定版本' }
    ]
  }),
  seed({
    id: 'sk_302', type: 'PLATFORM', name: '经营数据分析', icon: '⌕',
    description: '读取经营数据并生成趋势分析和异常说明', category: '数据分析',
    refNames: ['经营分析专家', '企业知识助手', '研究报告专家'], // 与 domainExpertMock 实际引用同源
    // 审核中心种子 id 2（VERSION_PUBLISH）指向本技能，但本体原为 pendingAction 空 → 不会补播审核
    // 快照，审核人点【查看】只能撞「无法查看」。此处置为在审，与 sk_309（停用在审）同一范式。
    // 2026-09-12 对齐 md 技能 §二.3.4 L226-229（审计 K19）：在审版本号必须由线上版本自动递增得出——
    // 原 v1.2.0 < 线上 v1.4.0 不合法，改为功能更新 bumpVersion('v1.4.0','MINOR') = v1.5.0（persist v3→v4）。
    status: 'published', version: 'v1.4.0',
    pendingAction: 'publish', pendingVersion: 'v1.5.0', pendingReleaseNotes: '补充经营异常归因说明',
    createdAt: '2026-08-24 09:18', updatedAt: '2026-08-24 09:18', publishedAt: '2026-08-24 16:18',
    exampleQuestion: '帮我分析上个月的经营数据异常',
    toolRefs: ['mcp__zhishiku', 'api__customer', 'api__search', 'mcp__baoxiao', 'biz__renshi'],
    files: { 'SKILL.md': SKILL_MD_TPL('经营数据分析', '读取经营数据并生成趋势分析和异常说明') },
    snapshots: [
      { version: 'v1.4.0', status: 'ACTIVE', size: '22.4 KB', publisher: '管理员', publishedAt: '2026-08-24 16:18', disabledAt: '', notes: '当前线上版本' },
      { version: 'v1.3.0', status: 'DELISTED', size: '21.8 KB', publisher: '管理员', publishedAt: '2026-08-20 16:30', disabledAt: '2026-08-23 10:15', notes: '历史稳定版本' }
    ]
  }),
  seed({
    id: 'sk_303', type: 'SYSTEM_DEFAULT', name: '会议纪要整理', icon: '◎',
    description: '提取会议结论、待办事项与责任人', category: '办公效率',
    status: 'published', version: 'v2.1.0',
    createdAt: '2026-08-22 15:36', updatedAt: '2026-08-22 15:36', publishedAt: '2026-08-22 16:05',
    exampleQuestion: '帮我整理今天例会的会议纪要',
    toolRefs: ['mcp__zhishiku', 'api__search'],
    files: { 'SKILL.md': SKILL_MD_TPL('会议纪要整理', '提取会议结论、待办事项与责任人') },
    snapshots: [
      { version: 'v2.1.0', status: 'ACTIVE', size: '12.1 KB', publisher: '管理员', publishedAt: '2026-08-22 16:05', disabledAt: '', notes: '当前线上版本' }
    ]
  }),
  seed({
    id: 'sk_304', type: 'PLATFORM', name: '合同风险检查', icon: '§',
    description: '识别合同条款中的风险点并给出说明', category: '行业专业',
    refNames: ['经营分析专家', '法务审阅专家'], // 与 domainExpertMock 实际引用同源
    status: 'published', version: 'v1.1.0',
    pendingAction: 'publish', pendingVersion: 'v1.1.1', pendingReleaseNotes: '补充违约条款识别规则',
    createdAt: '2026-08-20 11:08', updatedAt: '2026-08-25 10:12', publishedAt: '2026-08-20 15:30',
    exampleQuestion: '帮我检查这份采购合同的风险条款',
    toolRefs: ['api__search', 'mcp__zhishiku', 'api__customer', 'mcp__baoxiao'],
    files: { 'SKILL.md': SKILL_MD_TPL('合同风险检查', '识别合同条款中的风险点并给出说明') },
    snapshots: [
      { version: 'v1.1.0', status: 'ACTIVE', size: '19.3 KB', publisher: '管理员', publishedAt: '2026-08-20 15:30', disabledAt: '', notes: '当前线上版本' }
    ]
  }),
  seed({
    id: 'sk_305', type: 'POSITION', name: '客户拜访准备', icon: '✦',
    description: '汇总客户资料并生成拜访提纲', category: '办公效率',
    refNames: ['客户成功岗'], // 与 positionMock 实际引用同源（2026-09-02 种子自洽治理：随治理改为已发布）
    status: 'published', version: 'v1.0.0',
    createdAt: '2026-08-21 10:40', updatedAt: '2026-08-21 10:40', publishedAt: '2026-08-21 15:00',
    exampleQuestion: '帮我准备明天拜访这家客户的提纲',
    toolRefs: ['api__customer', 'mcp__baoxiao'],
    files: { 'SKILL.md': SKILL_MD_TPL('客户拜访准备', '汇总客户资料并生成拜访提纲') },
    snapshots: [
      { version: 'v1.0.0', status: 'ACTIVE', size: '10.3 KB', publisher: '管理员', publishedAt: '2026-08-21 15:00', disabledAt: '', notes: '首个版本' }
    ]
  }),
  seed({
    id: 'sk_306', type: 'SYSTEM_DEFAULT', name: '公文润色', icon: '◈',
    description: '', category: '智能创作',
    status: 'published', version: 'v3.0.2',
    createdAt: '2026-08-18 10:42', updatedAt: '2026-08-19 09:40', publishedAt: '2026-08-19 09:40',
    exampleQuestion: '帮我把这段通知润色得正式一些',
    toolRefs: ['api__search'],
    files: { 'SKILL.md': SKILL_MD_TPL('公文润色', '对公文进行语言润色') },
    snapshots: [
      { version: 'v3.0.2', status: 'ACTIVE', size: '8.6 KB', publisher: '管理员', publishedAt: '2026-08-19 09:40', disabledAt: '', notes: '当前线上版本' }
    ]
  }),
  seed({
    id: 'sk_307', type: 'PLATFORM', name: '竞品信息汇总', icon: '▤',
    description: '汇总公开渠道的竞品动态', category: '数据分析',
    refNames: ['研究报告专家'], // 与 domainExpertMock 实际引用同源
    status: 'draft', version: '',
    createdAt: '2026-08-19 14:26', updatedAt: '2026-08-19 14:26', publishedAt: '',
    exampleQuestion: '帮我汇总本周主要竞品的产品动态',
    toolRefs: ['api__search', 'mcp__zhishiku', 'api__customer'],
    files: { 'SKILL.md': SKILL_MD_TPL('竞品信息汇总', '汇总公开渠道的竞品动态') }
  }),
  seed({
    id: 'sk_308', type: 'POSITION', name: '报销单智能填报', icon: '⌕',
    description: '按发票信息自动填写并提交报销单', category: '办公效率',
    status: 'draft', version: '',
    pendingAction: 'publish', pendingVersion: 'v1.0.0', pendingReleaseNotes: '首次发布',
    createdAt: '2026-08-24 14:02', updatedAt: '2026-08-25 09:30', publishedAt: '',
    exampleQuestion: '帮我把这张发票录成报销单',
    toolRefs: ['mcp__baoxiao', 'biz__renshi'],
    files: { 'SKILL.md': SKILL_MD_TPL('报销单智能填报', '按发票信息自动填写并提交报销单') }
  }),
  seed({
    id: 'sk_309', type: 'PLATFORM', name: '行业研究助手', icon: '◎',
    description: '汇总行业资料、竞品动态并生成结构化研究结论', category: '知识与学习',
    status: 'published', version: 'v1.0.0',
    pendingAction: 'stop',
    createdAt: '2026-08-17 09:12', updatedAt: '2026-08-25 11:26', publishedAt: '2026-08-18 10:00',
    exampleQuestion: '帮我生成一份行业调研报告提纲',
    toolRefs: ['api__search', 'mcp__zhishiku'],
    files: { 'SKILL.md': SKILL_MD_TPL('行业研究助手', '汇总行业资料、竞品动态并生成结构化研究结论') },
    snapshots: [
      { version: 'v1.0.0', status: 'ACTIVE', size: '15.2 KB', publisher: '管理员', publishedAt: '2026-08-18 10:00', disabledAt: '', notes: '首个版本' }
    ]
  })
]

// 每技能 files 兜底（新建/导入的空技能也保证有 SKILL.md 入口）。
function ensureFiles(s) {
  if (!s.files) s.files = { 'SKILL.md': SKILL_MD_TPL(s.name, s.description) }
  if (s.files['SKILL.md'] == null) s.files['SKILL.md'] = ''
  return s.files
}

function find(id) {
  const s = skills.find((x) => String(x.id) === String(id))
  if (!s) throw new ApiError({ code: 40400, message: '技能不存在' })
  return s
}

/**
 * 写守卫（2026-09-12 对齐 md 技能 §二.2 L120「存在审核中操作时，编辑页锁定，仅允许查看和撤回」/
 * §三.1 L141「审核锁定状态…只读」；审计 K20）：编辑页的锁只在 UI，mock 侧同样拒写，不留后门。
 * 覆盖本体字段（updateSkill / setSkillCategory）与文件层（saveSkillFile / deleteSkillFile / renameSkillFile）。
 */
function assertNotReviewing(s) {
  if (s.pendingAction) throw new ApiError({ code: 40900, message: '技能审核中，已锁定不可修改' })
}

/* ============================ publications 派生（喂 derivePlatformState） ============================ */

export function publicationsOf(s) {
  if (s.pendingAction === 'stop') {
    return [{ target: 'USER_END', status: 'PUBLISHED', pendingAction: 'DELIST', version: s.version }]
  }
  if (s.pendingAction === 'publish') {
    if (s.version) return [{ target: 'USER_END', status: 'PUBLISHED', reviewPending: true, version: s.version }]
    return [{ target: 'USER_END', status: 'PENDING_REVIEW', reviewPending: false, version: null }]
  }
  if (s.delisted) return [{ target: 'USER_END', status: 'DELISTED', version: s.version }]
  if (s.status === 'published') return [{ target: 'USER_END', status: 'PUBLISHED', version: s.version }]
  return [] // INITIAL → 未发布
}

/** 对外三态（列表筛选用）：UNPUBLISHED / REVIEWING / PUBLISHED。 */
function displayStateOf(s) {
  if (s.pendingAction) return 'REVIEWING'
  if (!s.delisted && s.status === 'published') return 'PUBLISHED'
  return 'UNPUBLISHED'
}

/* ============================ 列表 VO ============================ */

function toListItem(s) {
  const files = ensureFiles(s)
  return {
    id: s.id,
    skillId: s.id,
    type: s.type,
    name: s.name,
    icon: s.icon || '',
    description: s.description || '',
    displayCategoryId: s.category || null, // demo：分类名即 id（fieldDict 同源）
    displayCategoryName: s.category || '',
    toolCount: s.toolRefs.length,
    refCount: s.type === 'SYSTEM_DEFAULT' ? 0 : s.refNames.length,
    refNames: s.type === 'SYSTEM_DEFAULT' ? [] : [...s.refNames],
    // 兼容旧字段口径（岗位私有=岗位引用数 / 平台族=专家引用数）
    referencedByPositionCount: s.type === 'POSITION' ? s.refNames.length : 0,
    referencedByExpertCount: s.type === 'PLATFORM' ? s.refNames.length : 0,
    status: s.status,
    publications: publicationsOf(s),
    versionLabel: s.version || '',
    exampleQuestion: s.exampleQuestion || '',
    skillMd: undefined, // 列表不携正文
    hasSkillMd: !!String(files['SKILL.md'] || '').trim(),
    defaultInstall: !!s.defaultInstall,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt || s.createdAt,
    lastPublishedAt: s.publishedAt || ''
  }
}

/**
 * 合并列表：keyword（名称/描述）/ type / categoryId（=分类名）/ status（三态）
 * + page/size。默认按最近更新时间由近到远。
 */
export async function listUnifiedSkills(params = {}) {
  await delay()
  const { keyword = '', type = '', categoryId = '', status = '', page = 1, size = 20, sort = 'desc' } = params
  const q = String(keyword).trim().toLowerCase()
  let list = skills.filter((s) => {
    if (q && ![s.name, s.description].some((v) => String(v || '').toLowerCase().includes(q))) return false
    if (type && s.type !== type) return false
    if (categoryId && s.category !== categoryId) return false
    if (status && displayStateOf(s) !== status) return false
    return true
  })
  // sort=asc|desc 按最近更新时间（2026-09-08 原型复刻批次 2C · E-A1：列头切换方向作用于全量再切页，原型 L664 同口径）
  const dir = sort === 'asc' ? 1 : -1
  list = list
    .slice()
    .sort((a, b) => dir * String(a.updatedAt || a.createdAt).localeCompare(String(b.updatedAt || b.createdAt)))
  const total = list.length
  const start = (Number(page) - 1) * Number(size)
  return { list: list.slice(start, start + Number(size)).map(toListItem), total }
}

/* ============================ 详情 / 创建 / 编辑 / 删除 ============================ */

const TOOL_DIRECTORY = {
  mcp__baoxiao: { bizName: '报销系统 MCP', description: '查询和提交员工报销单', checkStatus: 'HEALTHY', type: 'MCP' },
  mcp__zhishiku: { bizName: '知识库 MCP', description: '检索企业知识库文档', checkStatus: 'HEALTHY', type: 'MCP' },
  api__customer: { bizName: '客户数据 API', description: '查询客户与商机信息', checkStatus: 'HEALTHY', type: 'API' },
  api__search: { bizName: '联网搜索 API', description: '搜索公开信息', checkStatus: 'HEALTHY', type: 'API' },
  biz__renshi: { bizName: '人事系统', description: '查询员工及组织信息', checkStatus: 'UNKNOWN', type: 'BIZ_SYSTEM' }
}

function referencedToolsOf(s) {
  return s.toolRefs.map((code) => ({
    code,
    bizName: TOOL_DIRECTORY[code]?.bizName || code,
    checkStatus: TOOL_DIRECTORY[code]?.checkStatus || 'UNKNOWN',
    requiresConfirmation: false
  }))
}

export async function getSkillDetail(id) {
  await delay()
  const s = find(id)
  const files = ensureFiles(s)
  return {
    skillId: s.id,
    id: s.id,
    type: s.type,
    name: s.name,
    icon: s.icon || '',
    description: s.description || '',
    triggers: [...(s.triggers || [])],
    exampleQuestion: s.exampleQuestion || '',
    defaultInstall: !!s.defaultInstall,
    skillMd: files['SKILL.md'] || '',
    referencedTools: referencedToolsOf(s),
    agentId: null,
    positionId: null,
    category: null,
    displayCategoryId: s.category || null,
    displayCategoryName: s.category || '',
    publications: publicationsOf(s),
    versionLabel: s.version || '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt || s.createdAt,
    lastPublishedAt: s.publishedAt || ''
  }
}

const CATEGORY_NAMES = () => getFieldOptionNames('skillCategory')

function assertCategory(name) {
  if (name && !CATEGORY_NAMES().includes(name)) {
    throw new ApiError({ code: 40001, message: '技能分类不存在，请重新选择' })
  }
}

/** 手动创建空白技能（新建弹窗「创建」）。categoryName 必选（页面已拦，mock 兜底）。 */
export async function createSkill({ name, type, categoryName }) {
  await delay()
  const clean = String(name || '').trim()
  if (!clean) throw new ApiError({ code: 40001, message: '请填写技能名' })
  if (!type) throw new ApiError({ code: 40001, message: '请选择技能类型' })
  if (!categoryName) throw new ApiError({ code: 40001, message: '请选择技能分类' })
  assertCategory(categoryName)
  const stamp = nowText()
  const row = seed({
    id: newId(), type, name: clean, icon: '', description: '', category: categoryName,
    status: 'draft', version: '',
    skillMdName: null, // 手动创建 SKILL.md 尚为空，未占用任何 skill.md name
    createdAt: stamp, updatedAt: stamp, publishedAt: '',
    files: { 'SKILL.md': '' }
  })
  skills.unshift(row)
  persist()
  return { skillId: row.id, id: row.id, name: row.name, skillType: type }
}

/** zip 导入创建技能（每包独立分类）。demo 不真正解包：以包名为技能名、生成入口 SKILL.md。 */
export async function importSkillZip({ fileName, type, categoryName }) {
  await delay(200)
  if (!/\.zip$/i.test(String(fileName || ''))) {
    throw new ApiError({ code: 40001, message: '仅支持 .zip 技能包' })
  }
  if (!type) throw new ApiError({ code: 40001, message: '请选择技能类型' })
  if (!categoryName) throw new ApiError({ code: 40001, message: '请为技能包选择分类' })
  assertCategory(categoryName)
  const name = String(fileName).replace(/\.zip$/i, '').trim()
  // skill.md 内 name 全局唯一校验（md §三.2「新建技能弹窗」）：demo 不真正解包 zip，
  // 以包名近似 skill.md 内 name 字段；命中即拒绝导入（批量场景下先导入的包已写入 skills，
  // 后续同名包同样会在此处命中，天然覆盖同批重名）。
  if (skills.some((s) => s.skillMdName && s.skillMdName === name)) {
    throw new ApiError({ code: 40906, message: `当前已有同名技能：${name}` })
  }
  const stamp = nowText()
  const row = seed({
    id: newId(), type, name, icon: '', description: '', category: categoryName,
    status: 'draft', version: '',
    skillMdName: name,
    createdAt: stamp, updatedAt: stamp, publishedAt: '',
    files: { 'SKILL.md': SKILL_MD_TPL(name, '由技能包导入，请继续完善办事流程。') }
  })
  skills.unshift(row)
  persist()
  return { skillId: row.id, id: row.id, name: row.name, skillType: type, warnings: [] }
}

/** 部分更新（name/description/exampleQuestion/defaultInstall/icon/skillMd/displayCategoryId）。 */
export async function updateSkill(id, payload = {}) {
  await delay()
  const s = find(id)
  assertNotReviewing(s) // K20
  if ('name' in payload) {
    const n = String(payload.name || '').trim()
    if (!n) throw new ApiError({ code: 40001, message: '技能名称不能为空' })
    if (n.length > 64) throw new ApiError({ code: 40001, message: '技能名称最多 64 个字符' })
    s.name = n
  }
  if ('description' in payload) {
    const d = String(payload.description ?? '')
    if (d.length > 2000) throw new ApiError({ code: 40001, message: '技能描述最多 2000 个字符' })
    s.description = d
  }
  if ('exampleQuestion' in payload) {
    const eq = String(payload.exampleQuestion ?? '')
    if (eq.length > 60) throw new ApiError({ code: 40001, message: '示例问题最多 60 个字符' })
    s.exampleQuestion = eq
  }
  if ('defaultInstall' in payload) s.defaultInstall = !!payload.defaultInstall
  if ('icon' in payload) s.icon = payload.icon || ''
  if ('displayCategoryId' in payload) {
    assertCategory(payload.displayCategoryId || '')
    s.category = payload.displayCategoryId || ''
  }
  if ('skillMd' in payload) {
    ensureFiles(s)['SKILL.md'] = String(payload.skillMd ?? '')
  }
  s.updatedAt = nowText()
  persist()
  return getSkillDetail(id)
}

export async function setSkillCategory(id, categoryId) {
  await delay()
  const s = find(id)
  assertNotReviewing(s) // K20
  assertCategory(categoryId || '')
  s.category = categoryId || ''
  s.updatedAt = nowText()
  persist()
  return { skillId: s.id, displayCategoryId: s.category || null }
}

function refBlockMessage(s, action) {
  const subject = s.type === 'POSITION' ? '岗位' : '专家'
  const names = s.refNames.length ? `（${s.refNames.join('、')}）` : ''
  return `该技能被 ${s.refNames.length} 个${subject}引用${names}，需先解除引用后再${action}。`
}

/** 删除（引用拦截）。 */
export async function removeSkill(id) {
  await delay()
  const s = find(id)
  if (s.type !== 'SYSTEM_DEFAULT' && s.refNames.length) {
    throw new ApiError({ code: 40901, message: refBlockMessage(s, '删除') })
  }
  const i = skills.indexOf(s)
  skills.splice(i, 1)
  persist()
  return { skillId: id }
}

/* ============================ 发布 / 撤回 / 停用（三态状态机） ============================ */

export async function nextVersionLabel(id) {
  await delay(60)
  const s = find(id)
  return bumpVersion(s.version, 'NONE')
}

/* ==================== 审核版本快照（2026-09-09 PRD 复核 A5） ====================
 * 负责人批注：「要不要快照是由提交模块决定的，而不在审核中心/我的申请做存储处理。
 * 例如：技能/专家/岗位单独存储了审核版本的快照」。md `prd.审核中心.md` §四 L48
 * 「岗位、专家、技能三类业务对象由所属业务模块在提交审核时生成版本快照，审核详情读取该快照」。
 *
 * 存储位置：本模块的 reviewSnapshots（skillId → 快照），随 unifiedSkill 的 localStorage 持久化。
 * 写入时机：提交发布（publishSkill）/ 提交停用（delistSkill）；清除时机：撤回（withdrawPublish）。
 * 快照内容：提交当时的技能配置（名称/图标/描述/触发词/示例问题/SKILL.md/引用工具）+ 提交元信息。
 * 缺失时：治理侧按 md §七 阻止审核并提示联系提交人重新提交。
 * （表本体 reviewSnapshots 声明在 attachPersist 之前，见文件下方持久化区块。）
 */
function skillSnapshotDetail(s) {
  const files = ensureFiles(s)
  return {
    skillId: s.id,
    id: s.id,
    type: s.type,
    name: s.name,
    icon: s.icon || '',
    description: s.description || '',
    triggers: [...(s.triggers || [])],
    exampleQuestion: s.exampleQuestion || '',
    defaultInstall: !!s.defaultInstall,
    skillMd: files['SKILL.md'] || '',
    referencedTools: referencedToolsOf(s),
    displayCategoryId: s.category || null,
    displayCategoryName: s.category || '',
    versionLabel: s.version || '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt || s.createdAt
  }
}

function writeReviewSnapshot(s, requestAction, submittedAt) {
  reviewSnapshots[String(s.id)] = {
    kind: 'SKILL',
    refId: s.id,
    requestAction,
    version: s.pendingVersion || s.version || '',
    submittedAt: submittedAt || nowText(), // 种子补播传对象自身时间，避免「提交时快照」显示成页面加载时刻（09-18 审查）
    detail: JSON.parse(JSON.stringify(skillSnapshotDetail(s)))
  }
}

/** 读取技能提交审核时的版本快照；无快照返回 null（治理侧据此阻止审核）。 */
export function getSkillReviewSnapshot(id) {
  const snap = reviewSnapshots[String(id)]
  return snap ? JSON.parse(JSON.stringify(snap)) : null
}

/** 种子在审技能若无快照则补播一份（demo 打开即有内容）。 */
function seedReviewSnapshots() {
  for (const s of skills) {
    if (!s.pendingAction || reviewSnapshots[String(s.id)]) continue
    writeReviewSnapshot(s, s.pendingAction === 'stop' ? 'DELIST' : s.version ? 'VERSION_PUBLISH' : 'FIRST_PUBLISH', s.updatedAt)
  }
}

/** 提交发布（进入审核中；demo 停在审核中，不落审核结论）。 */
export async function publishSkill(id, { bump = 'NONE', releaseNotes = '' } = {}) {
  await delay()
  const s = find(id)
  if (s.pendingAction) throw new ApiError({ code: 40902, message: '已有在审提交，请先撤回或等待审核结论' })
  if (!String(releaseNotes || '').trim()) throw new ApiError({ code: 40001, message: '升级说明必填，简述本次更新项' })
  s.pendingAction = 'publish'
  s.pendingVersion = s.version ? bumpVersion(s.version, bump) : 'v1.0.0'
  s.pendingReleaseNotes = String(releaseNotes).trim()
  // 2026-09-18 R1：这里**不再**提前清 delisted——已下架技能再提交发布时，撤回/驳回要能回到「已下架」；
  // 原实现先清掉，撤回后就变「已发布」，等于绕过审核重新上线（09-18 审查 S1）。通过时再清（见 apply）。
  s.updatedAt = nowText()
  // A5：提交审核即存版本快照（md §四 L48）
  const requestAction = s.version ? 'VERSION_PUBLISH' : 'FIRST_PUBLISH'
  writeReviewSnapshot(s, requestAction)
  enrollReview({ businessType: 'SKILL', refId: s.id, name: s.name, description: s.description, requestAction, version: s.pendingVersion, versionNotes: s.pendingReleaseNotes })
  persist()
  return { skillId: s.id, pendingVersion: s.pendingVersion, publications: publicationsOf(s) }
}

/** 撤回在审提交（发布/停用同入口）：按 version 空/非空恢复 未发布/已发布。 */
export async function withdrawPublish(id) {
  await delay()
  const s = find(id)
  if (!s.pendingAction) throw new ApiError({ code: 40903, message: '当前没有在审提交' })
  s.pendingAction = null
  s.pendingVersion = ''
  s.pendingReleaseNotes = ''
  // 恢复提交前状态：有线上版本且未下架 → 已发布；否则未发布（含已下架再提交发布的撤回，09-18 R1）
  s.status = s.version && !s.delisted ? 'published' : 'draft'
  s.updatedAt = nowText()
  delete reviewSnapshots[String(s.id)] // A5：撤回即销毁本次提交的版本快照
  unenrollReview('SKILL', s.id)
  persist()
  return { skillId: s.id, publications: publicationsOf(s) }
}

/** 停用（提交停用审核）：被引用拦截；成功后进入「审核中」（PUBLISHED_DELISTING）。 */
export async function delistSkill(id) {
  await delay()
  const s = find(id)
  if (s.type !== 'SYSTEM_DEFAULT' && s.refNames.length) {
    throw new ApiError({ code: 40901, message: refBlockMessage(s, '停用') })
  }
  if (s.pendingAction) throw new ApiError({ code: 40902, message: '已有在审提交，请先撤回或等待审核结论' })
  s.pendingAction = 'stop'
  s.updatedAt = nowText()
  writeReviewSnapshot(s, 'DELIST') // A5：停用申请同样存快照（md §四不区分申请类型）
  enrollReview({ businessType: 'SKILL', refId: s.id, name: s.name, description: s.description, requestAction: 'DELIST', version: s.version || '—', versionNotes: '申请停止该技能对外提供' })
  persist()
  return { skillId: s.id, publications: publicationsOf(s) }
}

/* ==================== 审核结果落地（2026-09-12 负责人决策 5（审计 J12）） ====================
 * 由 reviewsMock.applyReviewResult 分发到此；审核中心不直接改本模块内部数组。
 *
 * md 依据（`prd.技能.md`）：
 * - §L81「审核通过后状态变为"已发布"，自动生成 v1.0.0 版本快照并上线；审核被拒绝后回到"未发布"」；
 * - §L97「审核通过后技能变为"未发布"，客户端停止提供；被拒绝或撤回后恢复"已发布"」；
 * - §L120「审核通过后新版本自动启用、原启用版本自动禁用」；
 * - §L237「被拒绝或撤回时不生成版本快照，技能恢复提交审核前的状态」。
 */
export function applySkillReviewResult(refId, requestAction, approved) {
  const s = skills.find((x) => String(x.id) === String(refId))
  if (!s || !s.pendingAction) return false
  // 2026-09-18 R1：审核行申请类型须与对象在途事项同向，否则拒绝落地
  if (requestAction && !reviewActionMatches(requestAction, s.pendingAction)) return false
  const isDelist = s.pendingAction === 'stop'
  if (approved) {
    if (isDelist) {
      // 停用通过 → 未发布（md L97）；版本快照保留（md §六「停用通过不删除历史版本」）
      s.delisted = true
      s.status = 'draft'
    } else {
      const label = s.pendingVersion || 'v1.0.0'
      // 新版本自动启用、原启用版本自动禁用（md L120 / L253）
      s.snapshots.forEach((x) => {
        if (x.status === 'ACTIVE') {
          x.status = 'DELISTED'
          x.disabledAt = nowText()
          x.delistedAt = x.disabledAt
        }
      })
      s.snapshots.unshift({
        version: label,
        status: 'ACTIVE',
        size: '18.6 KB',
        publisher: '管理员',
        publishedAt: nowText(),
        disabledAt: '',
        notes: s.pendingReleaseNotes || ''
      })
      s.version = label
      s.status = 'published'
      s.delisted = false
      s.publishedAt = nowText()
    }
  } else {
    // 驳回：不生成快照，恢复提交前状态（md L237）——曾发布过的回已发布，首发回未发布
    s.status = s.version && !s.delisted ? 'published' : 'draft'
  }
  s.pendingAction = null
  s.pendingVersion = ''
  s.pendingReleaseNotes = ''
  s.updatedAt = nowText()
  delete reviewSnapshots[String(s.id)]
  persist()
  return true
}

/** 重新上架（demo 无入口，API 兼容保留）：清整体下架标记。 */
export async function relistSkill(id) {
  await delay()
  const s = find(id)
  s.delisted = false
  if (s.version) s.status = 'published'
  s.updatedAt = nowText()
  persist()
  return { skillId: s.id, publications: publicationsOf(s) }
}

/* ============================ 版本历史（快照启用/禁用） ============================ */

// 种子快照沿用早期字段名（size/publisher/notes/disabledAt），而消费端 VersionHistoryList
// 按专家侧的规范字段名取值（sizeBytes/publishedBy/releaseNotes/delistedAt）——不映射会让
// md §四.3 要求的「文件大小、发布人、禁用时间、升级说明」四项全部不渲染。统一在此归一化，
// 出参同时保留旧名以免其它消费点被动改。size 为 '22.4 KB' 形态的展示串，需还原成字节给 fmtSize。
const KB = 1024
function sizeToBytes(size) {
  if (typeof size === 'number') return size
  const m = /^\s*([\d.]+)\s*(B|KB|MB|GB)?\s*$/i.exec(String(size ?? ''))
  if (!m) return null
  const mult = { B: 1, KB: KB, MB: KB ** 2, GB: KB ** 3 }[(m[2] || 'B').toUpperCase()]
  return Math.round(Number(m[1]) * mult)
}
function snapshotVO(sn) {
  return {
    ...sn,
    versionLabel: sn.version,
    verLabel: sn.version,
    sizeBytes: sn.sizeBytes != null ? sn.sizeBytes : sizeToBytes(sn.size),
    publishedBy: sn.publishedBy || sn.publisher || '',
    releaseNotes: sn.releaseNotes || sn.notes || '',
    delistedAt: sn.delistedAt || sn.disabledAt || ''
  }
}

export async function listSnapshots(id) {
  await delay()
  const s = find(id)
  return s.snapshots
    .slice()
    .sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }))
    .map(snapshotVO)
}

const LAST_ACTIVE_TIP = '当前版本是该技能最后一个启用版本。如需停止对外提供，请先整体下架技能'

export async function delistSnapshot(id, version) {
  await delay()
  const s = find(id)
  const row = s.snapshots.find((x) => x.version === version)
  if (!row) throw new ApiError({ code: 40400, message: '版本不存在' })
  if (row.status !== 'ACTIVE') throw new ApiError({ code: 40904, message: '该版本已是禁用状态' })
  const activeCount = s.snapshots.filter((x) => x.status === 'ACTIVE').length
  if (activeCount <= 1) throw new ApiError({ code: 40905, message: LAST_ACTIVE_TIP })
  row.status = 'DELISTED'
  row.disabledAt = nowText()
  persist()
  return snapshotVO(row)
}

/** 启用某历史版本：互斥启用（其余启用版本自动禁用，对齐原型 toggleHistory）。 */
export async function relistSnapshot(id, version) {
  await delay()
  const s = find(id)
  const row = s.snapshots.find((x) => x.version === version)
  if (!row) throw new ApiError({ code: 40400, message: '版本不存在' })
  if (row.status === 'ACTIVE') throw new ApiError({ code: 40904, message: '该版本已是启用状态' })
  const stamp = nowText()
  s.snapshots.forEach((x) => {
    if (x !== row && x.status === 'ACTIVE') {
      x.status = 'DELISTED'
      x.disabledAt = stamp
    }
  })
  row.status = 'ACTIVE'
  row.disabledAt = ''
  persist()
  return snapshotVO(row)
}

/* ============================ 工具坞 tool-picker ============================ */

export async function toolPicker(params = {}) {
  await delay(80)
  const { type = 'MCP', keyword = '' } = params
  const q = String(keyword).trim().toLowerCase()
  return Object.entries(TOOL_DIRECTORY)
    .filter(([, t]) => t.type === type)
    .map(([code, t]) => ({
      code,
      bizName: t.bizName,
      name: t.bizName,
      description: t.description,
      checkStatus: t.checkStatus,
      displayStatus: t.checkStatus,
      requiresConfirmation: false
    }))
    .filter((t) => !q || [t.code, t.bizName, t.description].some((v) => String(v).toLowerCase().includes(q)))
}

/* ============================ 技能包文件（基础能力：树 / 读 / 写 / 删 / 改名） ============================ */

function fileVO(path, content) {
  const name = String(path).split('/').pop()
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return {
    path,
    name,
    fileType: ext || 'md',
    isEntry: path === 'SKILL.md',
    isDir: false,
    editable: true,
    size: new Blob([String(content ?? '')]).size
  }
}

function treeVO(s) {
  const files = ensureFiles(s)
  return {
    skillId: s.id,
    entryPath: 'SKILL.md',
    files: Object.keys(files).map((p) => fileVO(p, files[p])),
    limits: { maxFiles: 50, maxDepth: 5 }
  }
}

function saveVO(s, { treeChanged = true, refsChanged = false } = {}) {
  return {
    tree: treeChanged ? treeVO(s) : null,
    treeChanged,
    refsChanged,
    referencedTools: refsChanged ? referencedToolsOf(s) : null,
    warnings: []
  }
}

export async function listSkillFiles(id) {
  await delay(80)
  return treeVO(find(id))
}

export async function getSkillFile(id, path) {
  await delay(60)
  const s = find(id)
  const files = ensureFiles(s)
  if (!(path in files)) throw new ApiError({ code: 40400, message: '文件不存在' })
  return { ...fileVO(path, files[path]), content: files[path] ?? '' }
}

export async function saveSkillFile(id, { path, content } = {}) {
  await delay(80)
  const s = find(id)
  assertNotReviewing(s) // K20
  const files = ensureFiles(s)
  const isNew = !(path in files)
  files[path] = String(content ?? '')
  s.updatedAt = nowText()
  persist()
  return saveVO(s, { treeChanged: isNew, refsChanged: false })
}

export async function deleteSkillFile(id, path) {
  await delay(80)
  const s = find(id)
  assertNotReviewing(s) // K20
  if (path === 'SKILL.md') throw new ApiError({ code: 40001, message: '入口 SKILL.md 不可删除' })
  const files = ensureFiles(s)
  if (!(path in files)) throw new ApiError({ code: 40400, message: '文件不存在' })
  delete files[path]
  s.updatedAt = nowText()
  persist()
  return saveVO(s, { treeChanged: true, refsChanged: false })
}

export async function renameSkillFile(id, { fromPath, toPath } = {}) {
  await delay(80)
  const s = find(id)
  assertNotReviewing(s) // K20
  if (fromPath === 'SKILL.md' || toPath === 'SKILL.md') {
    throw new ApiError({ code: 40001, message: '入口 SKILL.md 不可改名' })
  }
  const files = ensureFiles(s)
  if (!(fromPath in files)) throw new ApiError({ code: 40400, message: '文件不存在' })
  if (toPath in files) throw new ApiError({ code: 40900, message: '目标文件已存在' })
  files[toPath] = files[fromPath]
  delete files[fromPath]
  s.updatedAt = nowText()
  persist()
  return saveVO(s, { treeChanged: true, refsChanged: false })
}

/* ============================ 示例问题 AI 生成（mock） ============================ */

const EXAMPLE_POOL = [
  '帮我记一条今天的客户拜访',
  '帮我查一下本周的工作进展',
  '帮我总结今天的工作日志',
  '帮我安排明天的会议日程'
]

/** 按名称和描述从固定例句池生成（同一技能重复点击按序轮换 → 覆盖式重新生成可感知）。 */
const exampleCursor = {}
export async function aiGenerateExampleQuestion({ id, name = '', description = '' } = {}) {
  await delay(180)
  const seedText = `${name}${description}`
  let base = 0
  for (let i = 0; i < seedText.length; i++) base = (base + seedText.charCodeAt(i)) % EXAMPLE_POOL.length
  const key = String(id ?? seedText)
  const offset = exampleCursor[key] ?? 0
  exampleCursor[key] = offset + 1
  persist()
  return { question: EXAMPLE_POOL[(base + offset) % EXAMPLE_POOL.length] }
}

/* ============================ 测试辅助 ============================ */

/** 仅供单测：读取内部行（拷贝）。 */
export function _getRaw(id) {
  const s = skills.find((x) => String(x.id) === String(id))
  return s ? JSON.parse(JSON.stringify(s)) : null
}

/** 仅供单测：重置某技能的 pending 状态（positionMock 引用联动回写也走此入口）。 */
export function _reset(id, patch = {}) {
  const s = skills.find((x) => String(x.id) === String(id))
  if (s) {
    Object.assign(s, patch)
    persist() // 持久化 2026-09-02：refNames 等回写同样落盘
  }
}

/* ============================ 持久化（持久化 2026-09-02） ============================ */

// 状态镜像到 localStorage；写点=上方各写操作末尾的 persist() 调用处。
// skills / exampleCursor 为 const，restore 就地覆写、不换对象引用（positionMock 经
// _getRaw/_reset 按 id 查本表，行对象可整体替换，但数组本体必须保持同一引用）；
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子。
// 依赖序：本模块 import fieldDictMock（分类字典已先完成恢复），positionMock 在本模块之后恢复。
// A5 审核版本快照表（skillId → 快照）；实现说明见上方 publishSkill 前的「审核版本快照」区块。
// 声明必须在 attachPersist 之前：restore 回调在 attachPersist 内同步执行，晚声明会撞 TDZ。
let reviewSnapshots = {}

// version 2（2026-09-09 PRD 复核 G3G6 · A5）：新增 reviewSnapshots；旧快照无该键 → 兜底 {} 并对
// 种子在审技能补播，避免既有在审行「快照缺失」误拦。
// version 3（2026-09-09 发布前收口）：sk_302 补 pendingAction:'publish' + pendingVersion v1.2.0——
// 审核中心 id 2 引用它，原种子无在途标记 → 无审核快照，审核人点【查看】只能撞「无法查看」。
// version 4（2026-09-12 审计 K19）：sk_302 在审版本 v1.2.0 → v1.5.0（md L226-229 在审号必须由线上 v1.4.0 递增得出），
// bump 丢弃旧快照重播种子。
// version 5（2026-09-18 技能同名校验）：新增 skillMdName（SKILL.md 内 name 字段，zip 导入全局唯一校验用）；
// 旧快照无该键 → bump 丢弃重播种子，避免存量行 skillMdName 缺失导致校验漏判。
const persist = attachPersist('unifiedSkill', {
  version: 5,
  snapshot: () => ({ idSeq, skills, exampleCursor, reviewSnapshots }),
  restore: (d) => {
    if (
      !d || !Number.isFinite(d.idSeq) || !Array.isArray(d.skills) ||
      d.skills.some((r) => !r || typeof r !== 'object' || !r.id)
    ) {
      throw new Error('unifiedSkill 快照形状不合法')
    }
    idSeq = d.idSeq
    skills.length = 0
    skills.push(...d.skills)
    Object.keys(exampleCursor).forEach((k) => delete exampleCursor[k])
    if (d.exampleCursor && typeof d.exampleCursor === 'object') Object.assign(exampleCursor, d.exampleCursor)
    reviewSnapshots = d.reviewSnapshots && typeof d.reviewSnapshots === 'object' ? d.reviewSnapshots : {}
    seedReviewSnapshots()
  }
})
seedReviewSnapshots() // 无存量快照（首次加载 / 版本不符回种子）时同样补播
