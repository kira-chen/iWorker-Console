/**
 * 岗位列表页 + 岗位工作台内存 mock（demo 数据层，模式同 apiConnectorMock.js；开关见 position.js 头注释）。
 *
 * 【覆盖范围】
 * - 2026-09-01 PRD 对齐改造：AdminPositions.vue 列表页与 AdminPositionAssignments.vue 所调用的
 *   接口（含版本管理侧栏 versionAdapter 所调接口）。
 * - 2026-09-02 工作台补 mock（负责人拍板沿用 PositionDetailTabs 完整独立页）：岗位详情树
 *   getPosition / updatePosition、技能引用 attach/detach、平台技能候选。
 *   与列表页 4 条岗位种子同源联动：skillIds(技能数) 由工作台 skills 引用推导，
 *   技能本体从 unifiedSkillMock 同源取（不造第二份真相），引用变化回写技能 refNames。
 * - 2026-11-09 产品优化需求-202611：R1 取消 Agent，岗位直接引用技能（工作台 agents[].skills[] → skills[]）；
 *   R13 新增「专家与专家团」页签的引用读写（绑定关系存在专家 / 团的 positionIds，见 bindPositionExpert 等）。
 * - 工作档案（数据表）与样例任务的工作台数据在 dataTableMock.js / sampleTaskMock.js（同开关）。
 *
 * 种子数据照交互原型 v2（renderPositions 区，约 L1157）：
 * 岗位 4 条 —— 经营分析岗 v2.1.0 已发布 / 客户成功岗 v1.4.0 已发布 / 财务审核岗 审核中 /
 * 市场研究岗 未发布无版本；含 claimCount / skillIds、创建与更新时间；
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
// 2026-09-09 收编：本地 nowIso（带 +08:00 本地 ISO）复制品改引 utils/datetime 单一真相
import { nowIsoLocal as nowIso } from '@/utils/datetime'
import { nextSnapshotKey, archiveSnapshot, findSnapshot } from './reviewSnapshotArchive'
// 2026-09-18 R1：提交发布 / 停用 → 审核中心 + 我的申请落行；撤回 → 摘行；审核落地前核对申请类型（见 reviewEnroll.js）
import { enrollReview, unenrollReview, publishActionOf, reviewActionMatches } from './reviewEnroll'
// 2026-09-23 待办 yuepu#9①：领用数改由分配表实时派生，不再是本模块的静态字段（与 positionAssignmentMock
// 互相 import 属有意的循环依赖——双方都只在函数体内调用对方导出，模块顶层不触发，ESM 环境下安全）
import { countAssignedUsers } from './positionAssignmentMock'
// 2026-09-23 待办 yuepu#9⑥：删岗级联清理自动化任务 / 工作档案 / 运行规格里残留的本岗位引用，
// 否则 posSeq 复用旧 id 时新岗位会「继承」上一轮同 id 岗位遗留的数据（runtimeSpecMock 已反向
// import 本模块，同属有意的循环依赖，函数体内调用，安全）
import {
  deleteAllForPosition as deleteAllSampleTasksForPosition,
  listTasksUsingExecTarget,
  listTasksUsingSkill,
  listTasksWithExecTarget,
  countTasksByExecTarget,
  countSampleTasks
} from './sampleTaskMock'
// 各项字数 / 条数 / 个数上限一律引用 utils/positionModel 的常量（页面校验与本 mock 同源，避免两处各写一份而失配）
import { computePublishCheck, LIMITS, DESCRIPTION_MAX_LEN, CLAIM_NOTE_MAX, CLAIM_NOTE_LEN, EXAMPLE_Q_MAX_LEN, SOP_BRIEF_MAX_LEN } from '@/utils/positionModel'
import { deleteAllForPosition as deleteAllDataTablesForPosition } from './dataTableMock'
import { unassignPositionFromAllSpecs } from './runtimeSpecMock'
// 删岗 / 改名时回写其它模块里存的岗位引用（专家 positionIds、三个连接器的 referencedByPositions 冻结副本，待办 yuepu#23⑤⑥）
import { removePositionFromExperts, listExpertsBoundToPosition, listExpertsSync, bindExpertToPosition, unbindExpertFromPosition } from './domainExpertMock'
// R13「专家与专家团」页签：团的绑定同样存在团的 positionIds。expertTeamMock 反向 import 本模块（取岗位名），
// 属有意的循环依赖——双方都只在函数体内调用对方导出，模块顶层不触发（detailVO 在顶层 seedReviewSnapshots 里
// 会被调用，所以专家 / 团的引用不进 detailVO，走单独的 getPositionExperts）
import { listTeamsSync, bindTeamToPosition, unbindTeamFromPosition } from './expertTeamMock'
import { EXPERT_TYPE, EXPERT_TYPE_LABEL } from './expertTypes'
import { removePositionRefs as removeMcpPositionRefs, renamePositionRefs as renameMcpPositionRefs, syncPositionRefs as syncMcpPositionRefs } from './mcpConnectorMock'
import { removePositionRefs as removeApiPositionRefs, renamePositionRefs as renameApiPositionRefs, syncPositionRefs as syncApiPositionRefs } from './apiConnectorMock'
import { removePositionRefs as removeBizPositionRefs, renamePositionRefs as renameBizPositionRefs, syncPositionRefs as syncBizPositionRefs } from './bizSystemMock'
import { revokedConnectorNames } from './positionRevokedRefs'
import { clearPositionScope as clearKnowledgeBaseScope } from './knowledgeBaseMock'
import { appendOpsRecord } from './accessAuditMock'
import { currentDemoUsername } from '@/utils/demoIdentity'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let posSeq = 405

// 口径（J61，2026-10-10 浦月批复）：水位线只升不降；只有整体重置 __resetPositionMock（含清站点数据 / resetMock=1）会把它归零，其它模块的重置不联动。
/* ---------------- 岗位 id 水位线（待办 yuepu#52） ----------------
 * 按 positionId 存数据的模块（分配 / 自动化任务 / 工作档案 / 运行规格 / 知识库 / 专家 / 三个连接器）各自持久化，
 * 而本模块升版本会丢弃旧快照、posSeq 回到 405——新建岗位复用旧 id，立刻「继承」旧岗位遗留的任务 / 档案 / 领用关系。
 * 做法：另存一个**不随快照版本走**的 id 水位线（localStorage 单独一个 key），启动时再取旧快照里的 posSeq / 最大岗位 id
 * 兜底（升级当次旧快照还没被丢弃前先读到），posSeq 只升不降。resetMock=1 / 清站点数据会连同水位线一起清掉。 */
const ID_FLOOR_KEY = 'iworker-demo-mock:position-id-floor'
function readIdFloor() {
  try {
    const s = globalThis.localStorage
    if (!s) return 405
    let floor = Number(s.getItem(ID_FLOOR_KEY)) || 405
    const old = JSON.parse(s.getItem('iworker-demo-mock:position') || 'null')?.data // 旧版本快照：mockPersist 随后会把它丢弃
    if (old) {
      floor = Math.max(floor, Number(old.posSeq) || 0, ...(Array.isArray(old.positions) ? old.positions.map((p) => Number(p?.positionId) + 1 || 0) : []))
    }
    return floor
  } catch {
    return 405
  }
}
function writeIdFloor() {
  try {
    globalThis.localStorage?.setItem(ID_FLOOR_KEY, String(posSeq))
  } catch {
    /* 存储不可用：退化为仅内存 posSeq */
  }
}
const idFloorAtBoot = readIdFloor()

/* ---------------- 岗位种子（照原型 positionRows + positionCountSeeds） ---------------- */
let positions = [
  {
    positionId: 401,
    name: '经营分析岗',
    description: '负责经营数据汇总、异常识别与经营分析报告输出',
    icon: '▤',
    skillIds: [301],
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
    status: 'draft',
    pendingAction: 'PUBLISH',
    pendingVersion: 'v1.0.0',
    pendingReleaseNotes: '首个版本',
    // 首版在审、尚无审核通过的发布，故最新版本为空（md §二.1：不展示待审核版本号）
    latestVersion: '',
    createdAt: '2026-08-20T15:40:00+08:00',
    updatedAt: '2026-08-25T10:18:00+08:00'
  },
  {
    positionId: 404,
    name: '市场研究岗',
    description: '负责行业资料整理、竞品跟踪与研究结论沉淀',
    icon: '⌁',
    // 2026-09-09 补全为「未发布 + 六项齐备」样本（见 workbench 404 注释）。
    // skillIds 与其余种子同为数值口径（syncCounts 走 numericSkillId 归一，'sk_309'→309）
    // 2026-09-23 待办 yuepu#9⑤：303（会议纪要整理，通用技能）改 305（客户拜访准备，岗位私有）
    skillIds: [305],
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

/* ---------------- 工作台详情种子（身份卡字段 + 技能引用） ----------------
 * 与列表种子同源联动口径：skills 引用的技能 = 列表 skillIds。
 * 技能只存引用 { skillId, sortOrder }，本体（名称/描述/工具）渲染时从 unifiedSkillMock 同源取。
 * 2026-11-09 产品优化需求-202611 R1：取消 Agent，原各 Agent 下的技能合并为岗位的 skills。 */
function buildWorkbenchSeed() {
  return {
    401: {
      intro: '面向经营层的经营数据分析 AI 同事',
      iconSource: 'library',
      claimDesc: [
        { emoji: '📊', content: '每天自动汇总经营数据，异常主动提醒' },
        { emoji: '📝', content: '一句话生成经营分析周报' }
      ],
      // 领用页文案（原「岗位认领说明」，2026-09-08 PRD-20260908 md §2.4 改名；新原型 ensure() 种子口径，纯文本一行一条）
      claimDescriptions: ['自动汇总各业务线经营数据', '识别异常波动并分析原因', '生成周度经营分析报告'],
      // 示例问题（3 条）+ 岗位 SOP（编号步骤式）
      exampleQuestions: ['汇总昨天的经营数据', '本月营收有什么异常', '生成上周的经营周报'],
      positionSop:
        '1. 理解用户目标并确认所需信息。\n2. 根据任务选择合适的技能、专家、知识库与工具。\n3. 执行任务并核对关键结果与数据口径。\n4. 向用户输出结论、依据和后续建议。',
      // SOP 简版（修改点 18 演示样本）：客户端岗位卡片展示用
      positionSopBrief: '1. 确认目标和所需信息\n2. 选用技能、专家、知识库与工具\n3. 执行并核对关键结果\n4. 输出结论和后续建议',
      // 引用的已发布业务系统（bizSystemMock 同源取行；仅 biz_2101 是已发布种子）
      businessSystemIds: ['biz_2101'],
      // 岗位私有 MCP / API 引用（连接器页签前两个区域）：与 mcp/apiConnectorMock 种子的
      // referencedByPositions 双向同源——连接器页写「被 401 引用」，这里 401 详情就必须列出它（待办 yuepu#42）
      connectorMcpIds: ['expense_mcp'],
      connectorApiIds: ['api_1101'],
      persona: '稳、细、主动。先给结论，再给数据依据；发现异常主动提示影响面与建议动作。',
      intakeSchema: [
        { label: '负责业务线', key: 'biz_line', type: 'text', required: true, options: [] },
        { label: '关注指标', key: 'focus_metric', type: 'single_select', required: false, options: ['营收', '毛利', '回款'] }
      ],
      skills: [{ skillId: 'sk_301', sortOrder: 0 }]
    },
    402: {
      intro: '负责客户资料准备与拜访跟进的客户成功 AI 同事',
      iconSource: 'library',
      claimDesc: [{ emoji: '🤝', content: '拜访前自动准备客户资料与提纲' }],
      claimDescriptions: ['拜访前自动准备客户资料与提纲', '拜访后整理跟进记录并沉淀服务过程'],
      exampleQuestions: ['帮我准备明天拜访的客户资料', '整理本周的客户跟进记录', '生成客户拜访提纲'],
      positionSop:
        '1. 确认拜访对象与目标，收集客户基础资料。\n2. 调用客户拜访准备技能生成拜访提纲。\n3. 拜访后整理跟进记录，沉淀到工作档案。',
      businessSystemIds: ['biz_2101'],
      // md 岗位 §8「只能引用已发布」：原先绑的 mail_center（未发布）/ crm（审核中）不合规，改为暂无（yuepu#57⑧）
      connectorMcpIds: [],
      connectorApiIds: ['api_1103', 'api_1104'], // api_1104 是「已回收」样例：md 规定回收后岗位引用保留并标「已回收」（yuepu#83）
      persona: '热情、周到。拜访前主动准备资料，拜访后提醒记录跟进事项。',
      intakeSchema: [{ label: '负责客户区域', key: 'region', type: 'text', required: true, options: [] }],
      skills: [{ skillId: 'sk_305', sortOrder: 0 }]
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
      intakeSchema: [{ label: '所属部门', key: 'department', type: 'text', required: true, options: [] }],
      skills: [{ skillId: 'sk_301', sortOrder: 0 }]
    },
    // 2026-09-09 负责人要求补全：原为全空的「空白岗位」样本，每次发布校验都被报 4 项缺失，
    // 且新做的「发布前检查弹窗」在种子数据下永远点不到（唯一的未发布岗位恰好不完整）。
    // 补齐后：市场研究岗成为「未发布 + 阻断项齐备」的可演示样本，点【发布】即弹检查窗（2026-09-21 起阻断项含采集字段 ≥1 个，故补 1 个）。
    404: {
      intro: '负责行业资料整理与竞品跟踪的研究 AI 同事',
      iconSource: 'library',
      claimDesc: [{ emoji: '⌁', content: '行业资料自动整理，竞品动态定期跟踪' }],
      claimDescriptions: ['行业资料自动整理，竞品动态定期跟踪'],
      exampleQuestions: ['整理这个行业的最新政策变化', '汇总主要竞品上季度的动作', '生成一份行业研究摘要'],
      positionSop:
        '1. 明确研究主题与范围，收集公开行业资料。\n2. 汇总竞品动作与市场变化。\n3. 区分事实与推断，标注待验证信息。\n4. 输出结构化研究结论并沉淀到工作档案。',
      businessSystemIds: [],
      persona: '客观、审慎。只写有来源的结论，推断与事实分开表述。',
      intakeSchema: [{ label: '关注行业', key: 'industry', type: 'text', required: false, options: [] }],
      // 2026-09-23 待办 yuepu#9⑤：原引用通用技能 sk_303（会议纪要整理），违反 md §6.4「只能
      // 引用岗位私有类型的技能」；sk_305（客户拜访准备）虽主题非完全贴合，但类型正确、已发布，
      // 同一岗位私有技能允许被多个岗位重复引用（md §6.4），能让 404 继续保持「六项齐备可发布」样本
      skills: [{ skillId: 'sk_305', sortOrder: 0 }]
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
    // 2026-09-04 PRD-20260903 对齐新增：领用页文案（claimDescriptions）/ 示例问题（3 条）/ 岗位 SOP / 引用业务系统
    claimDescriptions: Array.isArray(payload.claimDescriptions) ? payload.claimDescriptions.map(String) : [],
    exampleQuestions: normEq(payload.exampleQuestions),
    positionSop: String(payload.positionSop || ''),
    positionSopBrief: String(payload.positionSopBrief || ''),
    businessSystemIds: Array.isArray(payload.businessSystemIds) ? [...payload.businessSystemIds] : [],
    // md 岗位 §8.1 L506 / §8.2 L524：连接器页签「岗位私有 MCP / API」引用清单，与 businessSystemIds 同型
    connectorMcpIds: Array.isArray(payload.connectorMcpIds) ? [...payload.connectorMcpIds] : [],
    connectorApiIds: Array.isArray(payload.connectorApiIds) ? [...payload.connectorApiIds] : [],
    persona: String(payload.persona || ''),
    intakeSchema: Array.isArray(payload.intakeSchema) ? payload.intakeSchema.map((r) => ({ ...r, options: [...(r.options || [])] })) : [],
    skills: []
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

/**
 * 出参行（不带 mock 内部字段裸引用，浅拷贝防组件误改内存种子）。
 * 读前先 syncCounts 自愈 skillIds：技能本体可能在技能模块被直接删除（不经过本模块
 * 的 attachPositionSkill/detachPositionSkill），那条路径不会主动回写本岗位的缓存计数，skillCount 会一直停在
 * 删除前的旧值（2026-09-23 待办 yuepu#9⑤）。
 */
function toRow(p) {
  syncCounts(p)
  return {
    positionId: p.positionId,
    name: p.name,
    description: p.description,
    icon: p.icon,
    skillIds: [...p.skillIds],
    skillCount: p.skillIds.length,
    claimedUserCount: countAssignedUsers(p.positionId),
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
  // 上限取 DESCRIPTION_MAX_LEN（一览表描述类统一规则，页面与本 mock 同源；曾因本处还卡在旧的 500 而与页面失配）
  if (String(payload.description || '').trim().length > DESCRIPTION_MAX_LEN) throw err(`岗位描述最多 ${DESCRIPTION_MAX_LEN} 个字符`, 'description')
  const now = nowIso()
  const p = {
    positionId: posSeq++,
    name,
    description: String(payload.description || '').trim(),
    intro: String(payload.intro || '').trim(),
    // 2026-09-21 起岗位图标必填（发布阻断，见 utils/positionModel.js COMPLETENESS_ITEMS）：新建时不再静默补默认图标
    // （原 '♟' 兜底会让必填形同虚设），由配置者在人格页签自行选择；列表 / 抽屉对空图标走各自占位。
    icon: payload.icon || '',
    skillIds: [],
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
  // payload 带连接器 id 时同样回写连接器侧「被岗位引用」清单，与 updatePosition 同口径（yuepu#90①；UI 新建弹窗不传这些字段）
  const wb = workbench[String(p.positionId)]
  if ('businessSystemIds' in payload) syncBizPositionRefs(p.positionId, p.name, wb.businessSystemIds)
  if ('connectorMcpIds' in payload) syncMcpPositionRefs(p.positionId, p.name, wb.connectorMcpIds)
  if ('connectorApiIds' in payload) syncApiPositionRefs(p.positionId, p.name, wb.connectorApiIds)
  writeIdFloor()
  persist()
  return detailVO(p)
}

export async function deletePosition(id) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在', null, 404)
  // md §3.6 L98「有被用户领用时不可删除」；此前只在 AdminPositions.vue 按 claimedUserCount 拦，
  // mock 数据层不拦，绕过 UI 直调可删掉仍被领用的岗位（2026-09-23 待办 yuepu#9①）
  const claimed = countAssignedUsers(p.positionId)
  if (claimed > 0) throw err(`该岗位已被 ${claimed} 个用户领用，需先解除领用后再删除`)
  // md 岗位 §3.6 / §4：仅「未发布」且「不在审核中」的岗位可删；此前只靠列表页按钮态兜，数据层直调可删审核中 / 已发布岗位（yuepu#57①）
  if (p.pendingAction) throw err('审核中的岗位不可删除，请先撤回审核')
  if (p.status !== 'draft') throw err('已发布的岗位不可删除，请先停用')
  // 引用联动：删岗前把岗位名从所引用技能的 refNames 摘掉
  const wb = ensureWb(p.positionId)
  const ids = new Set()
  wb.skills.forEach((s) => ids.add(s.skillId))
  wb.skills = []
  ids.forEach((skillId) => removeSkillRefNameIfUnused(p, skillId))
  positions = positions.filter((x) => x !== p)
  appendOpsRecord({ operator: currentDemoUsername(), module: '岗位', action: '删除', target: p.name, version: p.latestVersion })
  delete publications[p.positionId]
  delete workbench[String(p.positionId)]
  delete workbench[p.positionId]
  // 删岗级联（2026-09-23 待办 yuepu#9⑥）：自动化任务 / 工作档案按 positionId 整份清掉；
  // 运行规格只清「本岗位」这一条引用，规格本体和其它岗位的配置不受影响
  deleteAllSampleTasksForPosition(p.positionId)
  deleteAllDataTablesForPosition(p.positionId)
  unassignPositionFromAllSpecs(p.positionId)
  // 专家 positionIds / 连接器「被岗位引用」清单同样只清本岗位这一条（待办 yuepu#23⑤⑥）
  removePositionFromExperts(p.positionId)
  // 岗位私有专家团同理（prd.专家团.md §四）；动态 import 避免 positionMock ⇄ expertTeamMock 成环
  const { removePositionFromTeams } = await import('./expertTeamMock')
  removePositionFromTeams(p.positionId)
  removeMcpPositionRefs(p.positionId)
  removeApiPositionRefs(p.positionId)
  removeBizPositionRefs(p.positionId)
  clearKnowledgeBaseScope(p.positionId) // 从岗位知识库可见范围里摘掉本岗位（待办 yuepu#52：此前悬空，id 复用时还会挂到新岗位上；R3 起可见范围多选）
  persist()
  return {}
}

/**
 * 岗位绑定的专家团 / 岗位专家（删除确认文案用，prd.岗位.md §3.6）。团走动态 import：
 * expertTeamMock 静态依赖本文件，反向静态引会成环。
 */
export async function getPositionBindings(id) {
  const { listTeamsBoundToPosition } = await import('./expertTeamMock')
  return { teams: listTeamsBoundToPosition(id), experts: listExpertsBoundToPosition(id) }
}

export async function getDeleteImpact(id) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在', null, 404)
  return {
    positionName: p.name,
    skillCount: p.skillIds.length,
    claimedUserCount: countAssignedUsers(p.positionId)
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

/* ==================== 审核版本快照（2026-09-09 PRD 复核 A5） ====================
 * 负责人批注：「要不要快照是由提交模块决定的，而不在审核中心/我的申请做存储处理。
 * 例如：技能/专家/岗位单独存储了审核版本的快照」。md `prd.审核中心.md` §四 L48
 * 「岗位、专家、技能三类业务对象由所属业务模块在提交审核时生成版本快照，审核详情读取该快照」。
 *
 * 存储位置：本模块的 reviewSnapshots（positionId → 快照对象），随 position 的 localStorage 持久化。
 * 写入时机：提交发布（publishPosition）/ 提交停用（unpublishPosition）——即「提交审核」两个入口。
 * 清除时机：撤回（withdrawPosition）。审核通过/驳回由 demo 治理侧独立管理，不动本表。
 * 快照内容：detailVO(p) 的完整只读配置 + 提交元信息（submittedAt / requestAction / version）。
 * 缺失时：审核详情按 md §七「业务快照缺失（岗位/专家/技能）→ 阻止审核并提示联系提交人重新提交」。
 */
let reviewSnapshots = {}
// 历史归档（yuepu#76）：审核有结论 / 撤回时在审快照移入这里，「我的申请」回看已处理申请按 snapshotKey 取回提交时的配置
let snapshotArchive = {}

// withExpertRefs：快照带上提交当时引用的专家 / 专家团（R13 §2：引用关系随岗位发布生效）。模块顶层的种子补播传 false——
// 那时 domainExpertMock / expertTeamMock 可能还没初始化完（循环依赖），读不了，审核详情回落到当前引用。
function writeReviewSnapshot(p, requestAction, submittedAt, { withExpertRefs = true } = {}) {
  const snap = {
    key: nextSnapshotKey(reviewSnapshots, snapshotArchive, p.positionId),
    kind: 'POSITION',
    refId: p.positionId,
    requestAction,
    version: p.pendingVersion || p.latestVersion || '',
    submittedAt: submittedAt || nowIso(), // 种子补播传对象自身时间（09-18 审查：不再显示成页面加载时刻）
    // 提交当时的完整岗位配置（人格要素 / 技能 / 采集 schema 等；专家与专家团只存名称）
    detail: JSON.parse(JSON.stringify({ ...detailVO(p), ...(withExpertRefs ? { expertRefs: snapshotExpertRefs(p.positionId) } : {}) }))
  }
  reviewSnapshots[String(p.positionId)] = snap
  return snap
}

/**
 * 读取岗位提交审核时的版本快照；无快照返回 null（治理侧据此阻止审核）。
 * 不传 key：只看在审快照（审核中心）；传 key：在审 + 历史归档里按 key 取（「我的申请」回看已处理申请，yuepu#76）。
 */
export function getPositionReviewSnapshot(id, key) {
  return findSnapshot(reviewSnapshots, snapshotArchive, id, key)
}

// 提交发布 → 进入审核（pendingAction=PUBLISH）。bump 由抽屉算好展示号后仍上送类型，
// mock 按同一 bump 规则落 pendingVersion（与抽屉 previewLabel 一致）。
export async function publishPosition(id, payload = {}) {
  await delay()
  const p = findPos(id)
  if (!p) throw err('岗位不存在', null, 404)
  if (p.pendingAction) throw err('该岗位已有在途审核，请先撤回')
  // 发布前完整性复核（md 岗位 §9.1）：与详情页「发布前检查」同一个 computePublishCheck，UI 拦得住的，绕过 UI 的调用也必须拦得住——
  // 否则本函数会成为「API 层可发布无图标 / 无领用页文案 / 无采集字段的岗位」的参考实现（待办 yuepu#18②）
  // R13：引用的专家 / 专家团不可用（未发布、已回收、缺员、团里的岗位私有成员没加入本岗位）同样阻断
  const check = computePublishCheck({ ...detailVO(p), ...positionExpertRefs(p.positionId), sampleTaskCount: countSampleTasks(p.positionId) })
  if (!check.blockingPassed) {
    const failed = check.items.filter((i) => i.blocking && !i.ok)
    throw err(`发布前检查未通过：${failed.map((i) => i.detail).join('；')}`)
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
  // latestVersion 只记「最近一次审核通过并正式发布」的版本（md §二.1：不展示待审核版本号），
  // 在审版本一律走 pendingVersion；审核通过落快照时才推进 latestVersion。
  p.updatedAt = nowIso()
  // A5：提交审核即存版本快照（md §四 L48）
  const requestAction = publishActionOf(rows.length > 0)
  const snap = writeReviewSnapshot(p, requestAction)
  enrollReview({ businessType: 'POSITION', snapshotKey: snap.key, refId: p.positionId, name: p.name, description: p.description, requestAction, version: label, versionNotes: p.pendingReleaseNotes })
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
  // A5：撤回即销毁本次提交的版本快照（下次提交重新生成）
  archiveSnapshot(reviewSnapshots, snapshotArchive, p.positionId) // yuepu#76：撤回的申请快照入归档，我的申请仍可回看
  unenrollReview('POSITION', p.positionId)
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
  // md §3.5 L90「有被用户领用时不可停用」；同 deletePosition，mock 数据层此前不拦（yuepu#9①）
  const claimed = countAssignedUsers(p.positionId)
  if (claimed > 0) throw err(`该岗位已被 ${claimed} 个用户领用，需先解除领用后再停用`)
  p.pendingAction = 'DELIST'
  p.updatedAt = nowIso()
  const snap = writeReviewSnapshot(p, 'DELIST') // A5：停用申请同样存快照（md §四不区分申请类型）
  enrollReview({ businessType: 'POSITION', snapshotKey: snap.key, refId: p.positionId, name: p.name, description: p.description, requestAction: 'DELIST', version: p.latestVersion || '—', versionNotes: '申请停用该岗位' })
  persist()
  return {}
}

/* ==================== 审核结果落地（2026-09-12 负责人决策 5（审计 J12）） ====================
 * 审核中心 mock 点【通过】/【驳回】后由 reviewsMock.applyReviewResult 分发到此，业务对象随之改态；
 * 审核中心不直接改本模块的内部数组（模块边界）。
 *
 * md 依据（`prd.岗位.md`）：
 * - §3.3 L78「审核通过后状态变为"已发布"，自动生成版本号并上线；审核被拒绝后回到"未发布"」；
 * - §3.5 L92「审核通过后岗位变为"未发布"……被拒绝或撤回后恢复"已发布"」；
 * - §八 L117「已发布岗位提交新版本：……审核通过后新版本自动启用」；
 * - §二.1 L44「最新版本：展示最近一次审核通过并正式发布的版本号」——通过时才推进 latestVersion。
 * 驳回口径与 withdrawPosition 同向（md §3.4 L84「撤回后恢复提交审核前的状态」，驳回同理）。
 */
export function applyPositionReviewResult(refId, requestAction, approved) {
  const p = findPos(refId)
  if (!p || !p.pendingAction) return false
  // 2026-09-18 R1：审核行说的发布/停用必须与对象自己记的在途事项同向，否则拒绝落地（返回 false）
  if (requestAction && !reviewActionMatches(requestAction, p.pendingAction)) return false
  const isDelist = p.pendingAction === 'DELIST'
  if (approved) {
    if (isDelist) {
      p.status = 'draft' // 停用通过 → 未发布（md §3.5 L92）；版本历史不删（审核中心 md §六 L91）
    } else {
      const label = p.pendingVersion || 'v1.0.0'
      const rows = publications[p.positionId] || (publications[p.positionId] = [])
      // 新版本自动成为唯一启用版本，原启用版本自动禁用（md §八 L117）
      rows.forEach((r) => {
        if (r.status === 'ACTIVE') {
          r.status = 'DELISTED'
          r.delistedAt = nowIso()
        }
      })
      rows.unshift({
        version: (rows[0]?.version || 0) + 1,
        versionLabel: label,
        status: 'ACTIVE',
        sizeBytes: 7782,
        publishedBy: '管理员',
        publishedAt: nowIso(),
        delistedAt: null,
        releaseNotes: p.pendingReleaseNotes || ''
      })
      p.status = 'published'
      p.latestVersion = label
    }
  } else {
    // 驳回 = 恢复提交前状态（md §二.4 L116「被拒绝或撤回后恢复提交前状态」、L117「审核期间当前已发布版本
    // 继续可用」）。提交时 status 本就没动过，所以这里**不改 status**——原实现 `isDelist ? 'published' : 'draft'`
    // 把已发布岗位的迭代驳回打成「未发布」，线上版本被下线（09-18 审查 P1 / 实走 D）。
    if (!isDelist) p.latestVersion = publications[p.positionId]?.[0]?.versionLabel || ''
  }
  p.pendingAction = null
  delete p.pendingVersion
  delete p.pendingReleaseNotes
  p.updatedAt = nowIso()
  archiveSnapshot(reviewSnapshots, snapshotArchive, p.positionId) // 审核已结论：在审快照入归档（yuepu#76 保留历史快照），审核中心不再把它当在审快照
  persist()
  return true
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

/* ============================ 工作台：岗位详情 + 技能引用（2026-09-02 补 mock；2026-11-09 R1 取消 Agent） ============================ */

const SKILL_MAX = LIMITS.SKILL_MAX // 产品优化需求-202611 R1：每个岗位最多引用 100 个技能（原「每个 Agent 100 个」）

const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)

/** 'sk_301' → 301（列表 skillIds 沿用数字口径）；非常规 id 原样保留。 */
function numericSkillId(id) {
  const m = /(\d+)$/.exec(String(id))
  return m ? Number(m[1]) : id
}

/**
 * 技能引用变化后回写列表行计数（同源联动：skillIds→skillCount）。
 * 悬空引用（技能本体已被删除）不计入 skillCount——否则删除技能后列表仍显示旧计数，
 * 跟展示层的「（技能已删除）」占位对不上（2026-09-23 待办 yuepu#9⑤）。
 */
function syncCounts(p) {
  const wb = ensureWb(p.positionId)
  const ids = new Set()
  wb.skills.forEach((s) => { if (skillMock._getRaw(s.skillId)) ids.add(s.skillId) })
  p.skillIds = [...ids].map(numericSkillId)
}

/**
 * 技能引用行 → 技能行 summary VO（本体字段从 unifiedSkillMock 同源取）。
 * `deleted:true` 标记悬空引用（技能本体已被删除）：展示仍走「（技能已删除）」占位提示管理员清理，
 * 但不应计入 skillCount / 发布门的「至少引用 1 个技能」判定——见 syncCounts 与
 * utils/positionModel.js skillsRefOk（2026-09-23 待办 yuepu#9⑤）。
 */
function skillRefVO(ref) {
  const raw = skillMock._getRaw(ref.skillId)
  if (!raw) {
    return { skillId: ref.skillId, name: '（技能已删除）', icon: '', description: '', category: 'QUERY', displayCategoryName: '', status: 'draft', versionLabel: '', sortOrder: ref.sortOrder ?? 0, toolCount: 0, deleted: true }
  }
  // 类别派生口径与后端一致：引用业务系统/数据表 → 操作类，否则查询类
  const isOperation = (raw.toolRefs || []).some((c) => String(c).startsWith('biz__') || String(c).startsWith('table__'))
  return {
    skillId: raw.id,
    name: raw.name,
    icon: raw.icon || '',
    description: raw.description || '',
    category: isOperation ? 'OPERATION' : 'QUERY',
    // md §6.4「技能行展示：技能名称、技能分类、工具数量」：技能分类 = 技能本体的分类名（选项由字段字典维护（读时同源取自
    // unifiedSkillMock，与技能 VO 的 displayCategoryName 同名同义）；上面的 category 仅是操作类 / 查询类派生值（yuepu#61②）
    // 分类已在字段字典删掉 → 空，岗位「技能」页签显示「未分类」（与技能列表同口径，产品优化需求-202611 修改点 15）
    displayCategoryName: skillMock.displayCategoryNameOf(raw),
    status: raw.status,
    versionLabel: raw.version || '',
    sortOrder: ref.sortOrder ?? 0,
    // 2026-09-10 D1（md §6.4「工具数量」）：summary 形状补工具数——读时派生自
    // 技能本体 toolRefs（unifiedSkillMock 单一真相），非落盘字段，无需 bump persist version。
    toolCount: (raw.toolRefs || []).length,
    deleted: false,
    // 强制回收标记（技能 PRD §3.5.1「引用关系保留、标记失效」）：读时同源取自技能本体，
    // 岗位侧只标「已回收」、不自动解除引用；回收后技能回未发布，故也不会再出现在选技能的候选里
    revoked: raw.revoked ? { ...raw.revoked } : null
  }
}

/** 岗位详情 VO（PositionDetailVO：身份卡字段 + skills[]）。专家 / 专家团引用不在这里，见 getPositionExperts。 */
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
    positionSopBrief: wb.positionSopBrief || '',
    businessSystemIds: [...(wb.businessSystemIds || [])],
    connectorMcpIds: [...(wb.connectorMcpIds || [])],
    connectorApiIds: [...(wb.connectorApiIds || [])],
    // 发布前检查用：引用里已被强制回收的连接器名（读时派生，不落盘）
    revokedConnectors: revokedConnectorNames(wb),
    persona: wb.persona || '',
    intakeSchema: (wb.intakeSchema || []).map((r) => ({ ...r, options: [...(r.options || [])] })),
    status: p.status,
    pendingAction: p.pendingAction,
    latestVersion: p.latestVersion || '',
    // 2026-09-08 原型复刻批次 2B（G-4）：治理侧岗位只读抽屉 .page-time 行「最近更新时间」取用
    createdAt: p.createdAt || '',
    updatedAt: p.updatedAt || '',
    skills: wb.skills.slice().sort(bySort).map(skillRefVO)
  }
}

/** 引用联动：把本岗位名加进技能 refNames（unifiedSkillMock 单一真相，不复制本体）。 */
function addSkillRefName(skillId, posName) {
  const raw = skillMock._getRaw(skillId)
  if (raw && !(raw.refNames || []).includes(posName)) {
    skillMock._reset(skillId, { refNames: [...(raw.refNames || []), posName] })
  }
}
/** 本岗位已不再引用该技能时，把岗位名从技能 refNames 摘掉。 */
function removeSkillRefNameIfUnused(p, skillId) {
  const wb = ensureWb(p.positionId)
  if (wb.skills.some((s) => String(s.skillId) === String(skillId))) return
  const raw = skillMock._getRaw(skillId)
  if (raw && (raw.refNames || []).includes(p.name)) {
    skillMock._reset(skillId, { refNames: raw.refNames.filter((n) => n !== p.name) })
  }
}

// 1.2 岗位详情
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
      wb.skills.forEach(({ skillId }) => {
        const raw = skillMock._getRaw(skillId)
        if (raw && (raw.refNames || []).includes(p.name)) {
          skillMock._reset(skillId, { refNames: raw.refNames.map((n) => (n === p.name ? name : n)) })
        }
      })
      p.name = name
      // 连接器「被岗位引用」清单存的是含岗位名的冻结副本，改名后同步，免得三个连接器页显示旧名（待办 yuepu#23⑥）
      renameMcpPositionRefs(p.positionId, name)
      renameApiPositionRefs(p.positionId, name)
      renameBizPositionRefs(p.positionId, name)
    }
  }
  if ('description' in payload) {
    const description = String(payload.description || '').trim()
    if (description.length > DESCRIPTION_MAX_LEN) throw err(`岗位描述最多 ${DESCRIPTION_MAX_LEN} 个字符`, 'description')
    p.description = description
  }
  if ('intro' in payload) wb.intro = String(payload.intro || '').trim()
  // 图标必填只在「发布」时阻断（保存不拦，见 publishPosition）：这里必须允许清空，且与 createPosition 的 `payload.icon || ''` 同口径——
  // 原 `|| p.icon` 让图标永远清不掉，也让「必填不形同虚设」的去兜底（61dbd19）只做了一半（待办 yuepu#18③）
  if ('icon' in payload) p.icon = String(payload.icon || '').trim()
  if ('iconSource' in payload) wb.iconSource = payload.iconSource || 'library'
  if ('claimDesc' in payload) wb.claimDesc = Array.isArray(payload.claimDesc) ? payload.claimDesc.map((c) => ({ ...c })) : []
  // 2026-09-04 PRD-20260903 对齐新增字段（部分更新语义：payload 未含即不改）
  if ('claimDescriptions' in payload) {
    const notes = Array.isArray(payload.claimDescriptions) ? payload.claimDescriptions.map((s) => String(s ?? '').trim()).filter(Boolean) : []
    // 2026-09-08 PRD-20260908 对齐：「岗位认领说明」→「领用页文案」（md §2.4）、≤6 条；
    // 2026-09-21 起必填（至少 1 条）但只在发布时拦（md §9.1），保存仍允许空列表，故此处不校验最少条数；
    // 条数 / 每条字数取 CLAIM_NOTE_MAX / CLAIM_NOTE_LEN（页面与本 mock 同源）
    if (notes.length > CLAIM_NOTE_MAX) throw err(`领用页文案最多 ${CLAIM_NOTE_MAX} 条`, 'claimDescriptions')
    if (notes.some((s) => s.length > CLAIM_NOTE_LEN)) throw err(`领用页文案每条最多 ${CLAIM_NOTE_LEN} 个字符`, 'claimDescriptions')
    wb.claimDescriptions = notes
  }
  if ('exampleQuestions' in payload) {
    const qs = normEq(payload.exampleQuestions)
    if (qs.some((q) => q.trim().length > EXAMPLE_Q_MAX_LEN)) throw err(`示例问题每条最多 ${EXAMPLE_Q_MAX_LEN} 个字符`, 'exampleQuestions')
    wb.exampleQuestions = qs
  }
  if ('positionSop' in payload) {
    const sop = String(payload.positionSop || '')
    if (sop.length > 4000) throw err('岗位 SOP 最多 4000 个字符', 'positionSop')
    wb.positionSop = sop
  }
  // SOP 简版（修改点 18）：选填，最多 200 字
  if ('positionSopBrief' in payload) {
    const brief = String(payload.positionSopBrief || '')
    if (brief.length > SOP_BRIEF_MAX_LEN) throw err(`SOP 简版最多 ${SOP_BRIEF_MAX_LEN} 个字符`, 'positionSopBrief')
    wb.positionSopBrief = brief
  }
  if ('businessSystemIds' in payload) {
    wb.businessSystemIds = Array.isArray(payload.businessSystemIds) ? [...payload.businessSystemIds] : []
  }
  // 2026-09-23 待办 yuepu#7①④：岗位私有 MCP/API 引用此前只写 Pinia store、未透传进保存 payload，
  // toast「绑定成功」→ 保存 → 刷新即丢；补齐与 businessSystemIds 同型的写点
  if ('connectorMcpIds' in payload) {
    wb.connectorMcpIds = Array.isArray(payload.connectorMcpIds) ? [...payload.connectorMcpIds] : []
  }
  if ('connectorApiIds' in payload) {
    wb.connectorApiIds = Array.isArray(payload.connectorApiIds) ? [...payload.connectorApiIds] : []
  }
  // 绑定 / 解绑后回写连接器侧「被岗位引用」清单（待办 yuepu#51），列表计数与引用清单弹窗同源
  if ('businessSystemIds' in payload) syncBizPositionRefs(p.positionId, p.name, wb.businessSystemIds)
  if ('connectorMcpIds' in payload) syncMcpPositionRefs(p.positionId, p.name, wb.connectorMcpIds)
  if ('connectorApiIds' in payload) syncApiPositionRefs(p.positionId, p.name, wb.connectorApiIds)
  if ('persona' in payload) wb.persona = String(payload.persona || '')
  if ('intakeSchema' in payload) {
    wb.intakeSchema = Array.isArray(payload.intakeSchema) ? payload.intakeSchema.map((r) => ({ ...r, options: [...(r.options || [])] })) : []
  }
  p.updatedAt = nowIso()
  persist()
  return { ...detailVO(p), warnings: [] }
}

/* ---------------- 技能引用（产品优化需求-202611 R1：技能直接引用到岗位，attach 引用 / detach 可逆移除） ---------------- */

// 引用技能。候选口径：已发布、未回收的岗位私有技能，同一岗位内同一技能只引用一次；每个岗位最多 100 个（1002）。
export async function attachPositionSkill(positionId, skillId) {
  await delay()
  const p = findPos(positionId)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  const wb = ensureWb(p.positionId)
  const raw = skillMock._getRaw(skillId)
  if (!raw) throw err('技能不存在或已被删除', null, 404)
  // md §6.4「只能引用岗位私有类型的技能」——UI 候选已按岗位私有过滤，mock 数据层兜底
  // 不留后门（2026-09-23 待办 yuepu#9⑤：种子 404 曾误引用通用技能 sk_303，即此规则此前无人校验）
  if (raw.type !== 'POSITION') throw err('岗位只能引用岗位私有类型的技能')
  // md 岗位 §6.4：候选为「已发布」的岗位私有技能，数据层同样兜底（yuepu#57②；已发布且有新版在审的仍是 published，放行）
  if (raw.status !== 'published') throw err('仅已发布的岗位私有技能可被岗位引用')
  const existed = wb.skills.find((s) => String(s.skillId) === String(skillId))
  if (existed) return skillRefVO(existed)
  if (wb.skills.length >= SKILL_MAX) throw err(`每个岗位最多引用 ${SKILL_MAX} 个技能`, null, 1002)
  const ref = { skillId: raw.id, sortOrder: wb.skills.length }
  wb.skills.push(ref)
  addSkillRefName(raw.id, p.name)
  syncCounts(p)
  p.updatedAt = nowIso()
  persist()
  return skillRefVO(ref)
}

/**
 * 「添加技能」抽屉候选（产品优化需求-202611 修改点 1）：已发布的岗位私有技能，排除本岗位已引用的。
 * 「已发布」与 attachPositionSkill 同一把尺——按技能本体 status === 'published' 判：有新版本在审、停用在审的仍算已发布
 * （修改点 4 同口径）；停用通过、强制回收后技能回 draft，自然不在候选里。不走技能列表的「已发布」筛选——
 * 那是展示三态，审核中的技能会被算成「审核中」漏掉。
 */
export async function listPositionSkillCandidates(positionId, keyword) {
  const p = findPos(positionId)
  const ownIds = new Set(p ? ensureWb(p.positionId).skills.map((s) => String(s.skillId)) : [])
  const res = await skillMock.listUnifiedSkills({ type: 'POSITION', size: 500, ...(keyword ? { keyword } : {}) })
  return (res?.list || [])
    .filter((s) => s.status === 'published' && !ownIds.has(String(s.id)))
    .map((s) => ({ id: s.id, skillId: s.id, name: s.name, description: s.description || '', category: s.displayCategoryName || '' }))
}

/** 移除技能的拦截文案：本岗位自动化任务的「引用技能」里还引用着它时不能移除；能移除返回 ''。 */
function skillDetachBlockMessage(positionId, skillId) {
  const tasks = listTasksUsingSkill(positionId, skillId)
  if (!tasks.length) return ''
  const name = skillMock._getRaw(skillId)?.name || '该技能'
  return `「${name}」正被自动化任务「${tasks.join('」「')}」引用，请先从任务里移除`
}

// 移除前预检（修改点 1：点【移除】先查，被任务引用时直接提示、不弹确认）：回拦截文案，'' = 可以移除
export async function checkDetachPositionSkill(positionId, skillId) {
  await delay(80)
  const p = findPos(positionId)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  return skillDetachBlockMessage(p.positionId, skillId)
}

// 移除技能引用（可逆：删引用行，技能本体留库）
export async function detachPositionSkill(positionId, skillId) {
  await delay()
  const p = findPos(positionId)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  const wb = ensureWb(p.positionId)
  // 本岗位自动化任务的「引用技能」里还引用着它时不能移除（岗位私有技能要被本岗位引用，任务才能引用）；
  // 页面已先预检，这里数据层再兜一次（文案与预检同源）
  const blocked = skillDetachBlockMessage(p.positionId, skillId)
  if (blocked) throw err(blocked)
  const before = wb.skills.length
  wb.skills = wb.skills.filter((s) => String(s.skillId) !== String(skillId))
  if (wb.skills.length === before) throw err('该岗位未引用此技能', null, 404)
  removeSkillRefNameIfUnused(p, skillId)
  syncCounts(p)
  p.updatedAt = nowIso()
  persist()
  return {}
}

/**
 * 自动化任务「引用技能」候选（2026-11-09 负责人定；原「引用平台技能」只含市场技能）：
 * 已发布的通用技能、市场技能，加上本岗位「技能」页签引用的岗位私有技能（同样须已发布）。
 * 「已发布」按技能本体 status 判：有新版本在审、停用在审的仍是 published（线上版本照常可用），与专家引用市场技能、
 * 岗位引用技能同一口径；已回收的技能不是 published，自然排除。本岗位的排前面，其次市场、通用。
 * 类型名同 unifiedSkill.SKILL_TYPE_LABEL——不能直接 import：unifiedSkill.js → position.js → 本模块成环。
 */
const TASK_SKILL_TYPE = {
  POSITION: { order: 0, label: '岗位私有' },
  PLATFORM: { order: 1, label: '市场技能' },
  SYSTEM_DEFAULT: { order: 2, label: '通用技能' }
}
export async function listTaskSkillCandidates(positionId, keyword) {
  const p = findPos(positionId)
  const ownIds = new Set(p ? ensureWb(p.positionId).skills.map((s) => String(s.skillId)) : [])
  const res = await skillMock.listUnifiedSkills({ size: 500, ...(keyword ? { keyword } : {}) })
  return (res?.list || [])
    .filter((s) => s.status === 'published' && TASK_SKILL_TYPE[s.type] && (s.type !== 'POSITION' || ownIds.has(String(s.id))))
    .sort((a, b) => TASK_SKILL_TYPE[a.type].order - TASK_SKILL_TYPE[b.type].order)
    .map((s) => ({
      id: s.id,
      skillId: s.id,
      code: String(s.id),
      name: s.name,
      description: s.description || '',
      category: s.displayCategoryName || '',
      type: s.type,
      typeLabel: TASK_SKILL_TYPE[s.type].label
    }))
}

/* ---------------- 专家与专家团（产品优化需求-202611 R13） ----------------
 * 绑定关系只存一处：专家 / 团自己的 positionIds（domainExpertMock / expertTeamMock）。
 * 岗位页签读写的是同一份数据，专家页的「所属岗位」改为只读展示。 */

/** 专家 / 团当前是否可用：已发布才可用；否则返回原因（口径同 expertTeamMock 的缺员判定）。 */
function unavailableReasonOf(row) {
  if (row.status === 'published') return ''
  if (row.revoked) return '已回收'
  return row.latestVersionLabel ? '已停用' : '未发布'
}

const boundTo = (row, positionId) => (row.positionIds || []).some((id) => String(id) === String(positionId))

function expertRefVO(x) {
  return {
    expertId: x.id,
    name: x.name,
    type: x.type,
    typeLabel: EXPERT_TYPE_LABEL[x.type] || '',
    avatar: x.avatar || '',
    backgroundColor: x.backgroundColor || '',
    category: x.category || '',
    skillCount: x.skillCount,
    status: x.status,
    revoked: x.revoked ? { ...x.revoked } : null,
    unavailable: unavailableReasonOf(x)
  }
}

const TEAM_TYPE_LABEL = {
  [EXPERT_TYPE.POSITION]: '岗位私有',
  [EXPERT_TYPE.PLATFORM]: '市场专家团',
  [EXPERT_TYPE.SYSTEM_DEFAULT]: '通用专家团'
}

function teamRefVO(t, positionId) {
  // 团里的岗位私有成员必须同样被本岗位引用，否则本岗位员工用不了这个团（原专家团发布前检查第 3 项，R13 挪到岗位侧）
  const unboundMembers = (t.members || [])
    .filter((m) => m.expertType === EXPERT_TYPE.POSITION && !(m.positionIds || []).some((id) => String(id) === String(positionId)))
    .map((m) => ({ expertId: m.expertId, name: m.name }))
  return {
    teamId: t.id,
    name: t.name,
    type: t.type,
    typeLabel: TEAM_TYPE_LABEL[t.type] || '',
    avatar: t.avatar || '',
    category: t.category || '',
    memberCount: t.memberCount,
    memberIds: (t.members || []).map((m) => m.expertId),
    leaderId: t.leaderId,
    leaderName: t.leaderName,
    missingCount: t.missingCount,
    missing: (t.missing || []).map((m) => ({ ...m })),
    unboundMembers,
    status: t.status,
    revoked: t.revoked ? { ...t.revoked } : null,
    unavailable: unavailableReasonOf(t)
  }
}

/** 岗位审核快照里的专家与专家团：只留 id 和名称，审核详情只读展示。 */
function snapshotExpertRefs(positionId) {
  const { experts, teams } = boundExpertRefs(positionId)
  return {
    experts: experts.map((x) => ({ expertId: x.expertId, name: x.name })),
    teams: teams.map((t) => ({ teamId: t.teamId, name: t.name }))
  }
}

/** 引用本岗位的专家 / 团（读时派生）。 */
function boundExpertRefs(positionId) {
  return {
    experts: listExpertsSync().filter((x) => x.type === EXPERT_TYPE.POSITION && boundTo(x, positionId)).map(expertRefVO),
    teams: listTeamsSync().filter((t) => t.type === EXPERT_TYPE.POSITION && boundTo(t, positionId)).map((t) => teamRefVO(t, positionId))
  }
}

/**
 * 自动化任务执行对象候选（R13 §4；2026-11-09 负责人定：与「引用技能」同一范围）：
 * 已发布、未回收的通用 / 市场专家（团），加上本岗位「专家与专家团」页签里状态正常的岗位私有专家（团）。
 * 专家团另须不缺员、岗位私有成员都已加入本岗位；没设主理人的团同样可选（leaderId 为 null，R13-6，2026-11-16 确认）。
 */
function execTargetCandidates(positionId) {
  const open = (row) => row.type !== EXPERT_TYPE.POSITION && row.status === 'published' && !row.revoked
  const bound = boundExpertRefs(positionId)
  return {
    experts: [...bound.experts, ...listExpertsSync().filter(open).map(expertRefVO)].filter((x) => !x.unavailable),
    teams: [...bound.teams, ...listTeamsSync().filter(open).map((t) => teamRefVO(t, positionId))].filter(
      (t) => !t.unavailable && !t.missingCount && !t.unboundMembers.length
    )
  }
}

/** 执行对象已不能用的任务（停用、回收、缺员、被删除或已从本岗位移除；没设主理人不算，R13-6）：岗位发布前检查逐条阻断。 */
function execTargetIssues(positionId) {
  const { experts, teams } = execTargetCandidates(positionId)
  const usable = {
    EXPERT: new Set(experts.map((x) => String(x.expertId))),
    TEAM: new Set(teams.map((t) => String(t.teamId)))
  }
  return listTasksWithExecTarget(positionId)
    .filter((s) => !usable[s.execType].has(String(s.execTargetId)))
    .map((s) => {
      const isExpert = s.execType === 'EXPERT'
      const target = (isExpert ? listExpertsSync() : listTeamsSync()).find((x) => String(x.id) === String(s.execTargetId))
      return { taskName: s.name, targetName: target?.name || (isExpert ? '已删除的专家' : '已删除的专家团') }
    })
}

/** 岗位侧专家引用全貌：引用的专家 / 团 + 执行对象不能用的任务。页签读写与 publishPosition 的发布前复核都用它。 */
function positionExpertRefs(positionId) {
  return { ...boundExpertRefs(positionId), execTargetIssues: execTargetIssues(positionId) }
}

// 岗位详情「专家与专家团」页签：{ experts, teams }
export async function getPositionExperts(positionId) {
  await delay()
  if (!findPos(positionId)) throw err('岗位不存在或已被删除', null, 404)
  return positionExpertRefs(positionId)
}

// 添加抽屉候选：已发布、未回收、不在审核中的岗位私有专家 / 团，排除已引用本岗位的
export async function listPositionExpertCandidates(positionId) {
  await delay()
  const usable = (row) => row.type === EXPERT_TYPE.POSITION && row.status === 'published' && !row.pendingAction && !row.revoked && !boundTo(row, positionId)
  return {
    experts: listExpertsSync().filter(usable).map((x) => ({ ...expertRefVO(x), intro: x.intro || '' })),
    teams: listTeamsSync().filter(usable).map((t) => ({ ...teamRefVO(t, positionId), intro: t.intro || '' }))
  }
}

// 专家 / 专家团在岗位侧的使用情况（R13 §5：停用、强制回收确认窗口的影响范围）：{ positionCount, taskCount }
export async function getExpertUsage(kind, id) {
  await delay()
  const execType = kind === 'TEAM' ? 'TEAM' : 'EXPERT'
  const row = (execType === 'TEAM' ? listTeamsSync() : listExpertsSync()).find((x) => String(x.id) === String(id))
  return {
    positionCount: (row?.positionIds || []).filter((pid) => findPos(pid)).length,
    taskCount: countTasksByExecTarget(execType, id)
  }
}

/** 全部专家 / 专家团的 id → 名称（不论状态）：已选对象不在候选里时，编辑页仍要显示它的名字。 */
function execTargetNames() {
  const toMap = (rows) => Object.fromEntries(rows.map((x) => [String(x.id), x.name]))
  return { EXPERT: toMap(listExpertsSync()), TEAM: toMap(listTeamsSync()) }
}

// 自动化任务「执行动作」选专家 / 专家团时的下拉候选：{ experts, teams, names }（口径见 execTargetCandidates）。
// names = { EXPERT: { id: 名称 }, TEAM: { id: 名称 } }：所选对象已停用、回收、缺员或已移除时，下拉仍显示「名称（不可用）」
// 而不是裸 id（产品优化需求-202611 修改点 3）；查不到名称的是已被删除的对象
export async function listTaskExecTargetCandidates(positionId) {
  await delay()
  if (!findPos(positionId)) throw err('岗位不存在或已被删除', null, 404)
  return { ...execTargetCandidates(positionId), names: execTargetNames() }
}

function assertEditablePosition(positionId) {
  const p = findPos(positionId)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  if (p.pendingAction) throw err('审核中不可编辑，如需修改请先撤回')
  return p
}

export async function bindPositionExpert(positionId, expertId) {
  await delay()
  const p = assertEditablePosition(positionId)
  bindExpertToPosition(expertId, p.positionId)
  p.updatedAt = nowIso()
  persist()
  return positionExpertRefs(p.positionId)
}

export async function bindPositionTeam(positionId, teamId) {
  await delay()
  const p = assertEditablePosition(positionId)
  bindTeamToPosition(teamId, p.positionId)
  p.updatedAt = nowIso()
  persist()
  return positionExpertRefs(p.positionId)
}

/**
 * 移除专家 / 专家团的拦截文案：正被本岗位自动化任务选为执行对象时不能移除（R13 §3「移除」）；能移除返回 ''。
 * execType: 'EXPERT' | 'TEAM'。
 */
function execTargetBlockMessage(positionId, execType, id) {
  const tasks = listTasksUsingExecTarget(positionId, execType, id)
  if (!tasks.length) return ''
  const name = (execType === 'TEAM' ? listTeamsSync() : listExpertsSync()).find((x) => String(x.id) === String(id))?.name || ''
  return `「${name}」正被自动化任务「${tasks.join('」「')}」使用，请先修改任务的执行动作`
}

// 移除前预检（产品优化需求-202611 修改点 2：点【移除】先查，是执行对象时直接提示、不弹确认）：回拦截文案，'' = 可以移除
export async function checkUnbindPositionExpert(positionId, expertId) {
  await delay(80)
  const p = findPos(positionId)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  return execTargetBlockMessage(p.positionId, 'EXPERT', expertId)
}
export async function checkUnbindPositionTeam(positionId, teamId) {
  await delay(80)
  const p = findPos(positionId)
  if (!p) throw err('岗位不存在或已被删除', null, 404)
  return execTargetBlockMessage(p.positionId, 'TEAM', teamId)
}

// 移除专家 / 专家团：页面已先预检，这里数据层再兜一次（文案与预检同源）
export async function unbindPositionExpert(positionId, expertId) {
  await delay()
  const p = assertEditablePosition(positionId)
  const blocked = execTargetBlockMessage(p.positionId, 'EXPERT', expertId)
  if (blocked) throw err(blocked)
  unbindExpertFromPosition(expertId, p.positionId)
  p.updatedAt = nowIso()
  persist()
  return positionExpertRefs(p.positionId)
}

export async function unbindPositionTeam(positionId, teamId) {
  await delay()
  const p = assertEditablePosition(positionId)
  const blocked = execTargetBlockMessage(p.positionId, 'TEAM', teamId)
  if (blocked) throw err(blocked)
  unbindTeamFromPosition(teamId, p.positionId)
  p.updatedAt = nowIso()
  persist()
  return positionExpertRefs(p.positionId)
}

/* ============================ 岗位分配页联动（岗位名单一真相源，Q10） ============================ */

/** 按 id 取岗位名（岗位分配 mock 联动用；种子岗位名以本模块为准，原型两处不一致按 Q10 拍板归一）。 */
export function getPositionNameById(id) {
  return findPos(id)?.name || ''
}

/**
 * 全量岗位候选（{id, name}，id 用真实 positionId）：供知识库等模块的「岗位」可见范围选择器读取，
 * 不再各自维护一份脱节的岗位名单（2026-09-23 待办 yuepu#9④：knowledgeBaseMock 此前硬编码
 * 一份 POSITIONS，id 空间（'ps_1'）与本模块（401）都对不上，新岗位永远选不到、改名也不同步）。
 */
export function listAllPositions() {
  return positions.map((p) => ({ id: p.positionId, name: p.name }))
}

/**
 * 岗位是否可被绑定（md 岗位管理 §六 L89「可绑定岗位包括"已发布"及"审核中"岗位；未发布岗位（含首次
 * 发布审核中）不进入下拉选项」——status='published' 已经同时覆盖「纯已发布」与「已发布上再提交新版本/
 * 停用审核中」两种情况，草稿态无论是否在审核中都不算；口径与 AdminPositionAssignments.vue 的
 * `p.status === 'published'` 候选过滤一致，供分配表 mock 侧兜底校验用（2026-09-23 待办 yuepu#9③）。
 */
export function isPositionBindable(id) {
  return findPos(id)?.status === 'published'
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetPositionMock() {
  posSeq = 405
  try { globalThis.localStorage?.removeItem(ID_FLOOR_KEY) } catch { /* ignore */ }
  workbench = buildWorkbenchSeed()
  positions = [
    { positionId: 401, name: '经营分析岗', description: '负责经营数据汇总、异常识别与经营分析报告输出', icon: '▤', skillIds: [301], status: 'published', pendingAction: null, latestVersion: 'v2.1.0', createdAt: '2026-08-12T09:30:00+08:00', updatedAt: '2026-08-25T16:20:00+08:00' },
    { positionId: 402, name: '客户成功岗', description: '负责客户资料准备、拜访跟进与服务过程记录', icon: '◎', skillIds: [305], status: 'published', pendingAction: null, latestVersion: 'v1.4.0', createdAt: '2026-08-14T10:05:00+08:00', updatedAt: '2026-08-24T14:35:00+08:00' },
    { positionId: 403, name: '财务审核岗', description: '负责报销材料核验、财务单据检查与风险提示', icon: '¥', skillIds: [301], status: 'draft', pendingAction: 'PUBLISH', pendingVersion: 'v1.0.0', pendingReleaseNotes: '首个版本', latestVersion: '', createdAt: '2026-08-20T15:40:00+08:00', updatedAt: '2026-08-25T10:18:00+08:00' },
    { positionId: 404, name: '市场研究岗', description: '负责行业资料整理、竞品跟踪与研究结论沉淀', icon: '⌁', skillIds: [305], status: 'draft', pendingAction: null, latestVersion: '', createdAt: '2026-08-23T09:42:00+08:00', updatedAt: '2026-08-23T09:42:00+08:00' }
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
  reviewSnapshots = {} // A5：审核版本快照随种子复位，再按在审岗位补播
  snapshotArchive = {}
  seedReviewSnapshots()
  persist() // 持久化 2026-09-02：复位后同样落盘，避免存量快照盖回旧态
}

/* ============================ 持久化（持久化 2026-09-02） ============================ */

// 状态镜像到 localStorage；写点=上方各写操作末尾的 persist() 调用处。
// positions / publications / workbench 均为 let 且仅本模块内部引用，restore 直接重赋值即可；
// 顶层无 Map/Set（函数内 Set 均为临时变量），快照天然可 JSON 序列化。
// 依赖序：本模块 import unifiedSkillMock（技能表已先完成恢复）；本模块只存 skillId 引用、
// 不复制技能本体，交叉的 refNames 回写经 skillMock._reset 落对方模块并由对方自行持久化。
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子。
// version 2（2026-09-09 PRD 复核 G3G6 · A5）：新增 reviewSnapshots（审核版本快照，提交模块自持），
// 旧快照无该键 → restore 兜底为 {}，并对种子在审岗位补播一份，避免既有在审行「快照缺失」误拦。
const persist = attachPersist('position', {
  // v3（2026-09-09 发布前收口）：财务审核岗种子 latestVersion 由 'v1.0.0' 改空——首版在审不应
  // 展示待审版本号（md §二.1）。种子结构变更须 bump，否则存量快照会把旧值带回来。
  // v4（2026-09-09 负责人要求）：市场研究岗（404）由全空补全为「未发布 + 六项齐备」样本。
  // v5（2026-09-12 负责人决策 6）：删除 recommendedQuestions（「推荐问题固定 4 格」）——该字段只存在于
  // 已退役的交互原型，md 全文无此功能，界面早已无入口，仅在数据层静默透传。存量快照带该键 → 丢弃回种子。
  // v6（2026-09-23 待办 yuepu#9①⑤）：claimedUserCount 不再是种子字段（改实时派生，见 toRow）；404
  // 的 Agent 改引 sk_305（原 sk_303 违反 md §6.4 岗位私有类型限制）。存量快照结构/引用已过期，丢弃回种子。
  // v7（2026-09-28 待办 yuepu#42）：401/402 种子补 connectorMcpIds / connectorApiIds（与连接器侧
  // referencedByPositions 同源）；旧快照缺这两个键，不 bump 则演示环境仍显示「暂无绑定」。
  // v10（2026-10-09 待办 yuepu#57⑧）：402 种子不再绑未发布的 mail_center / 审核中的 crm（connectorMcpIds 清空，与 mcpConnector v10
  // 的引用清单同步）；connectorApiIds 保留已回收样例 api_1104（引用保留是 md 规则，yuepu#83）；旧快照仍带这两项 → 丢弃回种子。
  // v9（2026-10-09 待办 yuepu#61②）：技能引用 VO 新增 displayCategoryName（技能分类），种子在审岗位的审核版本快照
  // （reviewSnapshots）里内嵌了该 VO，快照形状变了；存量快照缺这个字段 → 丢弃回种子。
  // v11（2026-10-19 待办 yuepu#76）：新增 snapshotArchive（审核快照历史归档）与快照 key，旧快照弃用回种子。
  // v12（2026-10-19 待办 yuepu#77）：种子技能的工具引用补了几条（api_1101 / mail_center / biz_2101），岗位在审快照里内嵌的技能引用随之变，旧快照弃用回种子。
  // v13（2026-11-09 产品优化需求-202611 R1）：取消 Agent，工作台 agents[].skills[] 改为 skills[]，列表行去掉 agentCount；
  // 快照结构变了，旧快照丢弃回种子。
  // v14（2026-11-12 产品优化需求-202611 修改点 18）：工作台新增 positionSopBrief（SOP 简版），401 种子补一份，旧快照丢弃回种子。
  version: 14,
  snapshot: () => ({ posSeq, positions, publications, workbench, reviewSnapshots, snapshotArchive }),
  restore: (d) => {
    if (
      !d || !Number.isFinite(d.posSeq) ||
      !Array.isArray(d.positions) || d.positions.some((r) => !r || typeof r !== 'object') ||
      typeof d.publications !== 'object' || d.publications === null ||
      typeof d.workbench !== 'object' || d.workbench === null
    ) {
      throw new Error('position 快照形状不合法')
    }
    posSeq = d.posSeq
    positions = d.positions
    publications = d.publications
    workbench = d.workbench
    reviewSnapshots = d.reviewSnapshots && typeof d.reviewSnapshots === 'object' ? d.reviewSnapshots : {}
    snapshotArchive = d.snapshotArchive && typeof d.snapshotArchive === 'object' ? d.snapshotArchive : {}
    seedReviewSnapshots()
  }
})

// 水位线兜底：快照被丢弃 / 版本升级后 posSeq 回到种子值，这里抬回到旧水位之上（只升不降），避免复用旧 id（待办 yuepu#52）
posSeq = Math.max(posSeq, idFloorAtBoot)

/** 种子在审岗位（pendingAction 非空）若无快照则补播一份，保证 demo 打开即有内容（A5）。 */
function seedReviewSnapshots() {
  for (const p of positions) {
    if (!p.pendingAction) continue
    if (reviewSnapshots[String(p.positionId)]) continue
    writeReviewSnapshot(p, p.pendingAction === 'DELIST' ? 'DELIST' : p.latestVersion ? 'VERSION_PUBLISH' : 'FIRST_PUBLISH', p.updatedAt, { withExpertRefs: false })
  }
}
seedReviewSnapshots()
