/**
 * 发布态统一前端层（发布统一方案 B3）——把「岗位 / 专家 / 技能」三类的发布态展示派生收敛为一套。
 *
 * 【为什么要这层】三类此前各写各的：技能有 utils/skillPublication.js 的 7 态派生（审核流），
 * 岗位/专家在列表页里硬编码 `status === 'published' ? …` 二态三元。本模块把「(kind, 数据源) → 展示视图」
 * 统一到一处，前端一套派生 + 一套弹窗 + 一套操作列复用。
 *
 * 【核心：可配置审核】与后端 PublishableKind 对齐——技能 reviewRequired=true（走 7 态审核流），
 * 岗位/专家 reviewRequired=false（免审短路，只可能 INITIAL/PUBLISHED 二态子集）。派生按 kind 分流：
 *   - 技能：委托既有 skillPublication.js（derivePlatformState 等），逻辑一字不动（久经测试）。
 *   - 岗位/专家：本模块的免审映射（本体 draft/published → INITIAL/PUBLISHED 展示态）。
 * 两条路径产出同一套 { state, label, tagType, actions }，供统一弹窗/操作列消费。
 *
 * 【T1/T2 呼应后端】前端不碰落库值；可见性/发布态语义与后端 PublishState/PublishVisibility 同口径。
 */
import {
  derivePlatformState,
  stateLabel as skillStateLabel,
  stateTagType as skillStateTagType,
  stateActions as skillStateActions,
  skillOnlineState,
  isLocked as skillIsLocked
} from './skillPublication'

/** 三类种类标识（与后端 PublishableKind 对齐）。 */
export const KIND = {
  POSITION: 'POSITION',
  DOMAIN_EXPERT: 'DOMAIN_EXPERT',
  SKILL: 'SKILL'
}

/** 各类是否需审核（决策点 R：前端同后端一套口径，技能需审、岗位/专家免审）。 */
export function isReviewRequired(kind) {
  // V103/V104：岗位、专家纳入审核，三类均需审核（与后端 PublishableKind 一致）。
  return kind === KIND.SKILL || kind === KIND.POSITION || kind === KIND.DOMAIN_EXPERT
}

/* ============================ 免审类（岗位/专家）本体二态派生 ============================ */

/**
 * 本体 status（小写 draft/published）+ pending_action → 统一展示态（岗位/专家，V103/V104 纳入审核）。
 *
 * 岗位/专家的审核态由 pending_action 叠加（本体 status 仍二态）：
 *   - pending_action=PUBLISH：本体 draft→REVIEWING（首发在审）/ 本体 published→PUBLISHED_REVIEWING（迭代新版在审，线上供旧版）；
 *   - pending_action=DELIST（本体仍 published）→ PUBLISHED_DELISTING（已发布·停用审核中）；
 *   - 无 pending_action：published→PUBLISHED / draft→INITIAL。
 */
export function deriveBodyState(bodyStatus, pendingAction) {
  // pending=PUBLISH 有两种（2026-08-22「已发布迭代新版」后）：
  //   · 本体 draft   → 首发在审 REVIEWING（线上尚无版本）
  //   · 本体 published → 迭代在审 PUBLISHED_REVIEWING（线上供旧版，新版在审，与技能同口径）
  if (pendingAction === 'PUBLISH') {
    return bodyStatus === 'published' ? 'PUBLISHED_REVIEWING' : 'REVIEWING'
  }
  if (pendingAction === 'DELIST') return 'PUBLISHED_DELISTING'
  return bodyStatus === 'published' ? 'PUBLISHED' : 'INITIAL'
}

/** 本体二态展示态（含审核）→ 文案 / StatusTag type / 动作。 */
const BODY_STATE_META = {
  INITIAL: { label: '草稿', tagType: 'info', actions: ['submit'] },
  // 已发布可提新版（2026-08-22 补齐迭代能力，与技能 PUBLISHED→submit 同口径）。整体停用挪列表操作列，不再走弹窗 delist。
  PUBLISHED: { label: '已发布', tagType: 'success', actions: ['submit'] },
  REVIEWING: { label: '发布审核中', tagType: 'warning', actions: ['withdraw'] },
  // 已发布·新版审核中：线上供旧版，新版在审，仅可撤回（与技能 PUBLISHED_REVIEWING 同）。
  PUBLISHED_REVIEWING: { label: '已发布 · 新版审核中', tagType: 'warning', actions: ['withdraw'] },
  PUBLISHED_DELISTING: { label: '已发布 · 停用审核中', tagType: 'warning', actions: ['withdraw'] }
}

/* ============================ 统一入口：(kind, source) → 展示视图 ============================ */

/**
 * 统一发布态展示视图。
 *
 * @param {string} kind   KIND.*（决定 reviewRequired 与派生路径）
 * @param {object} source 数据源：
 *                        - 技能：{ publications: [...] }（或直接传 row，取 row.publications）
 *                        - 岗位/专家：{ status: 'draft'|'published' }（或直接传 row，取 row.status）
 * @returns {{ state, label, tagType, actions, reviewRequired }}
 */
export function derivePublishView(kind, source) {
  // 技能：发布态承载在 publications[] 发布行，委托既有 skillPublication.js（逻辑不动）。
  if (kind === KIND.SKILL) {
    const publications = source?.publications ?? source ?? []
    const state = derivePlatformState(publications)
    return {
      state,
      label: skillStateLabel(state),
      tagType: skillStateTagType(state),
      actions: skillStateActions(state),
      reviewRequired: true
    }
  }
  // 岗位/专家：发布态承载在本体 status（二态）+ pending_action（V103/V104 审核态叠加）。
  const bodyStatus = source?.status ?? source
  const pendingAction = source?.pendingAction ?? null
  const state = deriveBodyState(bodyStatus, pendingAction)
  const meta = BODY_STATE_META[state] || BODY_STATE_META.INITIAL
  return {
    state,
    label: meta.label,
    tagType: meta.tagType,
    actions: meta.actions,
    reviewRequired: isReviewRequired(kind)
  }
}

/**
 * 「本体/整体是否对下游可见」谓词（前端侧，呼应后端 PublishVisibility）。
 * 免审类：published 即可见；技能：USER_END 发布行 PUBLISHED 即在线（含新版在审，线上供旧版）。
 */
export function isVisibleDownstream(kind, source) {
  if (kind === KIND.SKILL) {
    // publications 可能显式为 undefined（行未带发布数据）→ 落到 []，不要回退到 source 对象本身。
    const pubs = Array.isArray(source) ? source : (source?.publications ?? [])
    return skillOnlineState(pubs) === 'ONLINE'
  }
  // 岗位/专家：本体 published 即可见（待审停用期间 status 仍 published → 仍可见，与后端一致）。
  return (source?.status ?? source) === 'published'
}

/** 编辑锁定谓词：技能审核中锁定；岗位/专家有待审动作（pending_action）时锁定（审核对象=提交那刻）。 */
export function isLocked(kind, source) {
  if (kind === KIND.SKILL) {
    const pubs = Array.isArray(source) ? source : (source?.publications ?? [])
    return skillIsLocked(pubs)
  }
  return !!(source?.pendingAction)
}

/**
 * 删除资格谓词（统一「未启用状态才可删」，技能/岗位/专家一套口径）。
 *
 * 可删 ⟺ 未对下游可见（未发布/已下架/草稿）且 不在审核中。语义即用户规格「未启用状态允许删除」：
 *   - INITIAL（草稿）/ DELISTED（已下架）→ 未启用 → 可删；
 *   - PUBLISHED（启用中）→ 不可删（先停用）；
 *   - REVIEWING / PENDING_REVIEW / PUBLISHED_DELISTING（在审）→ 不可删（先撤回）。
 * 注：仅为前端"防误删"前置门；后端引用保护仍是最终防线（可删态下若被引用照样拦）。
 */
export function canDelete(kind, source) {
  return !isVisibleDownstream(kind, source) && !isLocked(kind, source)
}
