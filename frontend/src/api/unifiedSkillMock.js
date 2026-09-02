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

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms))

/* ============================ 工具函数 ============================ */

function nowText() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

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
    status: 'published', version: 'v1.4.0',
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
 * 合并列表：keyword（名称/描述）/ type / categoryId（=分类名）/ status（三态）/ referenced（岗位私有）
 * + page/size。默认按最近更新时间由近到远。
 */
export async function listUnifiedSkills(params = {}) {
  await delay()
  const { keyword = '', type = '', categoryId = '', status = '', referenced, page = 1, size = 20 } = params
  const q = String(keyword).trim().toLowerCase()
  let list = skills.filter((s) => {
    if (q && ![s.name, s.description].some((v) => String(v || '').toLowerCase().includes(q))) return false
    if (type && s.type !== type) return false
    if (categoryId && s.category !== categoryId) return false
    if (status && displayStateOf(s) !== status) return false
    if (referenced === true && !s.refNames.length) return false
    if (referenced === false && s.refNames.length) return false
    return true
  })
  list = list
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
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
  const name = String(fileName).replace(/\.zip$/i, '')
  const stamp = nowText()
  const row = seed({
    id: newId(), type, name, icon: '', description: '', category: categoryName,
    status: 'draft', version: '',
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

/** 提交发布（进入审核中；demo 停在审核中，不落审核结论）。 */
export async function publishSkill(id, { bump = 'NONE', releaseNotes = '' } = {}) {
  await delay()
  const s = find(id)
  if (s.pendingAction) throw new ApiError({ code: 40902, message: '已有在审提交，请先撤回或等待审核结论' })
  if (!String(releaseNotes || '').trim()) throw new ApiError({ code: 40001, message: '升级说明必填，简述本次更新项' })
  s.pendingAction = 'publish'
  s.pendingVersion = s.version ? bumpVersion(s.version, bump) : 'v1.0.0'
  s.pendingReleaseNotes = String(releaseNotes).trim()
  s.delisted = false
  s.updatedAt = nowText()
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
  if (s.version) {
    s.status = 'published'
  } else {
    s.status = 'draft'
  }
  s.updatedAt = nowText()
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
  persist()
  return { skillId: s.id, publications: publicationsOf(s) }
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

function snapshotVO(sn) {
  return { ...sn, versionLabel: sn.version, verLabel: sn.version }
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
const persist = attachPersist('unifiedSkill', {
  version: 1,
  snapshot: () => ({ idSeq, skills, exampleCursor }),
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
  }
})
