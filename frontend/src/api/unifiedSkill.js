import request from './request'
import { listSkills, createStandaloneSkill, deleteSkill, setSkillStatus, updateSkill } from './position'
import { platformSkillApi, systemSkillApi } from './platformSkill'
import * as mock from './unifiedSkillMock'
import { derivePlatformState, stateActions } from '@/utils/skillPublication'

/**
 * 合并技能管理页 API 层（ADMIN 专属）。
 *
 * 【demo mock（2026-09-01 PRD 对齐改造）】项目为纯前端 demo：读列表默认走 unifiedSkillMock
 * （`VITE_SKILL_MOCK=0` 可关闭走真实接口路径，模式同 apiConnector.js）。
 * 写操作仍按 row.type 经 apiFor 分流到三套命名空间；三套命名空间内部各自做 mock 分流
 * （platformSkill.js 工厂 / position.js 技能函数），本模块不重复分流。
 *
 * 【读】真实路径走聚合端点 /fde/admin-skills（单请求、服务端分页、跨类型全序）。
 * 【写】一律回原三套端点命名空间，本模块只做「按 row.type 选命名空间」的路由。
 */
export const SKILL_MOCK_ENABLED = import.meta.env.DEV && import.meta.env.VITE_SKILL_MOCK !== '0'

/** 技能类型判别式（与后端 UnifiedSkillQueryService.TYPE_* 同值）。 */
export const SKILL_TYPE = {
  SYSTEM_DEFAULT: 'SYSTEM_DEFAULT',
  POSITION: 'POSITION',
  PLATFORM: 'PLATFORM'
}

/**
 * 类型 → 页面文案单一真相源（2026-09-01 PRD 对齐：POSITION 岗位私有 / PLATFORM 市场技能 /
 * SYSTEM_DEFAULT 通用技能，对齐交互原型 v2 最终覆写态 typeLabels）。
 * 全页文案一律从这里取，禁止就地三元（2026-08-19 的 4 处串台 bug 即三元所致）。
 */
export const SKILL_TYPE_LABEL = {
  [SKILL_TYPE.SYSTEM_DEFAULT]: '通用技能',
  [SKILL_TYPE.POSITION]: '岗位私有',
  [SKILL_TYPE.PLATFORM]: '市场技能'
}

/**
 * 类型选项（顺序按 PRD md，2026-09-01 定：岗位私有 / 市场技能 / 通用技能）。
 * 同时驱动两处，改这里两处同步生效：列表页顶部「技能类型」筛选下拉、新建技能弹窗内的类型单选。
 */
export const SKILL_TYPE_OPTIONS = [
  { value: SKILL_TYPE.POSITION, label: SKILL_TYPE_LABEL[SKILL_TYPE.POSITION] },
  { value: SKILL_TYPE.PLATFORM, label: SKILL_TYPE_LABEL[SKILL_TYPE.PLATFORM] },
  { value: SKILL_TYPE.SYSTEM_DEFAULT, label: SKILL_TYPE_LABEL[SKILL_TYPE.SYSTEM_DEFAULT] }
]

/** 类型 → el-tag type（三类视觉可分辨；列表列已改普通文本，保留供他处徽标使用）。 */
export const SKILL_TYPE_TAG = {
  [SKILL_TYPE.SYSTEM_DEFAULT]: 'warning',
  [SKILL_TYPE.POSITION]: 'info',
  [SKILL_TYPE.PLATFORM]: 'primary'
}

/** 类型 → 整页编辑器路由名（三类各自的既有编辑路由，编辑器零改动）。 */
export const SKILL_EDIT_ROUTE = {
  [SKILL_TYPE.SYSTEM_DEFAULT]: 'SysConfigSystemSkillEdit',
  [SKILL_TYPE.POSITION]: 'AdminSkillEdit',
  [SKILL_TYPE.PLATFORM]: 'SysConfigSkillEdit'
}

// 读：合并列表（keyword/type/status/categoryId + page/size 走后端过滤与分页）
export function listUnifiedSkills(params = {}) {
  if (SKILL_MOCK_ENABLED) return mock.listUnifiedSkills(params)
  return request.get('/fde/admin-skills', { params })
}

/**
 * 岗位私有技能「命名空间适配器」：把 position.js 的散装函数包成与 platformSkillApi 同形状，
 * 好让调用方一律写 `apiFor(row).remove(row.id)` 而不必再分支。
 *
 * 2026-09-01 PRD 对齐（清单 6/29）：岗位私有技能接入统一审核状态机——补齐同构的
 * publish / withdrawPublish / delist / relist / nextVersionLabel / listSnapshots / *Snapshot。
 * demo 阶段这些能力仅 mock 路径可用（后端无对应端点）；`VITE_SKILL_MOCK=0` 时调用会抛错提示，
 * 保持 fail-fast（不静默打到不存在的端点上）。
 */
function mockOnly(name) {
  return () => {
    throw new Error(`岗位私有技能的「${name}」仅 demo mock 路径可用（后端无对应端点）`)
  }
}

const positionSkillApi = {
  list: listSkills,
  create: createStandaloneSkill,
  update: updateSkill,
  remove: deleteSkill,
  setStatus: setSkillStatus, // 旧本体 draft/published 开关（已被统一状态机取代，保留兼容）
  get: (id) => (SKILL_MOCK_ENABLED ? mock.getSkillDetail(id) : mockOnly('详情聚合')()),
  publish: (id, payload) => (SKILL_MOCK_ENABLED ? mock.publishSkill(id, payload) : mockOnly('提交发布')()),
  withdrawPublish: (id) => (SKILL_MOCK_ENABLED ? mock.withdrawPublish(id) : mockOnly('撤回提交')()),
  delist: (id) => (SKILL_MOCK_ENABLED ? mock.delistSkill(id) : mockOnly('停用审核')()),
  relist: (id) => (SKILL_MOCK_ENABLED ? mock.relistSkill(id) : mockOnly('重新上架')()),
  nextVersionLabel: (id) => (SKILL_MOCK_ENABLED ? mock.nextVersionLabel(id) : mockOnly('建议版本号')()),
  listSnapshots: (id) => (SKILL_MOCK_ENABLED ? mock.listSnapshots(id) : mockOnly('版本历史')()),
  delistSnapshot: (id, version) =>
    SKILL_MOCK_ENABLED ? mock.delistSnapshot(id, version) : mockOnly('禁用版本')(),
  relistSnapshot: (id, version) =>
    SKILL_MOCK_ENABLED ? mock.relistSnapshot(id, version) : mockOnly('启用版本')()
}

/**
 * 按行类型取 api 命名空间。**所有行内写操作的唯一入口**——
 * 组件里不得再出现 `isPlatform ? platformSkillApi : ...` 这类就地三元。
 *
 * 未知 type 直接抛（fail-fast）：若静默回落到某一类，一个 type 缺失的行会拿着 A 类 id 去打 B 类前缀，
 * 后端跨通道守卫会 404（安全），但用户看到的是莫名其妙的「技能不存在」，难以定位。
 */
export function apiFor(row) {
  switch (row?.type) {
    case SKILL_TYPE.POSITION:
      return positionSkillApi
    case SKILL_TYPE.PLATFORM:
      return platformSkillApi // /fde/platform-skills（钉 MARKET；mock 分流在其工厂内）
    case SKILL_TYPE.SYSTEM_DEFAULT:
      return systemSkillApi // /fde/system-skills（钉 SYSTEM_DEFAULT；mock 分流在其工厂内）
    default:
      throw new Error(`未知技能类型，拒绝分流写操作: ${row?.type}`)
  }
}

/** 该行是否属平台族。三类操作/状态机已统一（2026-09-01），本判据仅供少数遗留分支使用。 */
export function isPlatformFamily(row) {
  return row?.type === SKILL_TYPE.PLATFORM || row?.type === SKILL_TYPE.SYSTEM_DEFAULT
}

/** 类型文案（未知类型兜底为空串，不抛——纯展示路径不该因脏数据白屏）。 */
export function typeLabel(type) {
  return SKILL_TYPE_LABEL[type] || ''
}

/**
 * 按类型建空白技能（新建弹窗「创建」）。2026-09-01 起手动创建带必选「技能分类」：
 * mock 路径把 categoryName 一并落库；真实路径保持各命名空间原契约（仅 name，分类由编辑页补）。
 */
export function createSkillOfType(type, { name, categoryName } = {}) {
  if (SKILL_MOCK_ENABLED) return mock.createSkill({ name, type, categoryName })
  switch (type) {
    case SKILL_TYPE.POSITION:
      return createStandaloneSkill({ name })
    case SKILL_TYPE.PLATFORM:
      return platformSkillApi.create({ name })
    case SKILL_TYPE.SYSTEM_DEFAULT:
      return systemSkillApi.create({ name })
    default:
      throw new Error(`未知技能类型，拒绝创建: ${type}`)
  }
}

/* ============================ 三态展示视图（列表/编辑页/版本抽屉共用口径） ============================ */

/** 内部发布态 → 对外三态（未发布 / 审核中 / 已发布）。 */
export const SKILL_DISPLAY_STATE = {
  PUBLISHED: 'PUBLISHED',
  REVIEWING: 'REVIEWING',
  PUBLISHED_REVIEWING: 'REVIEWING',
  DELISTED_REVIEWING: 'REVIEWING',
  PUBLISHED_DELISTING: 'REVIEWING', // V100 停用审核中 → 审核中
  INITIAL: 'UNPUBLISHED',
  REJECTED: 'UNPUBLISHED',
  DELISTED: 'UNPUBLISHED'
}
export const SKILL_DISPLAY_LABEL = {
  PUBLISHED: '已发布',
  REVIEWING: '审核中',
  UNPUBLISHED: '未发布'
}
export const SKILL_DISPLAY_TAG = {
  PUBLISHED: 'success',
  REVIEWING: 'warning',
  UNPUBLISHED: 'info'
}

/**
 * publications → 三态展示视图（VersionDrawer adapter.deriveView 直接可用）：
 * state 保留内部原始态（首发判定 INITIAL / 动作矩阵用），label/tagType 用三态口径。
 */
export function deriveSkillDisplayView(publications) {
  const st = derivePlatformState(publications || [])
  const display = SKILL_DISPLAY_STATE[st] || 'UNPUBLISHED'
  return {
    state: st,
    display,
    label: SKILL_DISPLAY_LABEL[display],
    tagType: SKILL_DISPLAY_TAG[display],
    actions: stateActions(st)
  }
}

/* ============================ 发布就绪谓词（列表【发布】按钮与编辑页共用） ============================ */

/**
 * 发布必填集（交互原型 v2 skillPublishReadiness，逐字段同序）：
 * 技能名称 / 技能类型 / 技能分类 / 图标 / 技能描述 / 示例问题 / SKILL.md。
 *
 * @param {Object} s 技能行或编辑态。字段口径：
 *   name / type / displayCategoryId(或 category) / icon / description / exampleQuestion /
 *   skillMd（编辑页传正文）或 hasSkillMd（列表行传布尔）。
 * @returns {{ ready: boolean, missing: string[] }}
 */
export function skillPublishReadiness(s = {}) {
  const text = (v) => String(v == null ? '' : v).trim()
  const missing = []
  if (!text(s.name)) missing.push('技能名称')
  if (!text(s.type)) missing.push('技能类型')
  if (!text(s.displayCategoryId ?? s.category)) missing.push('技能分类')
  if (!text(s.icon) && !text(s.iconImage)) missing.push('图标')
  if (!text(s.description)) missing.push('技能描述')
  if (!text(s.exampleQuestion)) missing.push('示例问题')
  const hasMd = s.skillMd !== undefined ? !!text(s.skillMd) : !!s.hasSkillMd
  if (!hasMd) missing.push('SKILL.md')
  return { ready: missing.length === 0, missing }
}

/** 就绪 → 发布提示；未就绪 → 缺项提示（列表与编辑页【发布】按钮 title 共用）。 */
export const PUBLISH_READY_TIP = '发布将提交审核，审核通过后生成版本快照并上线'
export function publishDisabledTitle(readiness) {
  return `请先补齐必填项：${(readiness?.missing || []).join('、')}`
}

/**
 * 示例问题「AI 生成」（编辑页按钮）：mock 按名称和描述从固定例句生成、重复点击覆盖。
 * demo 无后端，真实路径暂无端点（接回后端时在此补契约）。
 */
export function generateExampleQuestion({ id, name, description } = {}) {
  if (SKILL_MOCK_ENABLED) return mock.aiGenerateExampleQuestion({ id, name, description })
  return Promise.reject(new Error('示例问题 AI 生成仅 demo mock 路径可用'))
}
