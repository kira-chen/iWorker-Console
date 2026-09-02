/**
 * 平台技能发布态口径（去分端·单轨重构）——
 * 平台技能发布不再分「FDE 工作台 / 用户端」两目标；后端 publications 去分端后至多一项 target==='USER_END'。
 * 前端据该行派生单一「展示态 state」，文案 / StatusTag 颜色 / 可执行动作 / 锁定谓词全部按 state 取，
 * 列表徽标、发布对话框、编辑器锁定共用本模块，避免口径散落漂移。
 *
 * publications 行字段（后端 PlatformSkillListItem.publications[i]）：
 *   { target, status, version, reviewPending, hasActiveSubmission, submitterId, submittedAt,
 *     reviewerId, reviewedAt, reviewComment }
 *   status        —— PENDING_REVIEW / PUBLISHED / REJECTED / DELISTED（无行=初始创建）
 *   reviewPending —— 已发布/已下架之上又提交了新版、正在审核中
 *
 * 派生展示态 state：
 *   INITIAL              无行（初始创建，尚未发布）
 *   REVIEWING            首发提交待审核
 *   PUBLISHED            已发布（线上=最新审核版，无在审新版）
 *   PUBLISHED_REVIEWING  已发布，且有新版正在审核
 *   REJECTED             首发被驳回
 *   DELISTED             已下架（无在审新版）
 *   DELISTED_REVIEWING   已下架，且有新版正在审核
 */

/* ============================ 平台技能（单轨）新口径 ============================ */

// 从 publications[] 取「用户端」那一项（去分端后至多一项 target==='USER_END'；无则 null=未发布）
export function userEndPublication(publications = []) {
  return (publications || []).find((p) => p?.target === 'USER_END') || null
}

/**
 * 把 publications[] 派生为单一展示态 state（取 USER_END 行）。
 * 无行 → INITIAL；PENDING_REVIEW → REVIEWING；PUBLISHED（含 reviewPending 分流）；REJECTED；DELISTED（含分流）。
 */
export function derivePlatformState(publications) {
  const pub = userEndPublication(publications)
  if (!pub || !pub.status) return 'INITIAL'
  const pending = pub.reviewPending === true
  // V100「停用也过审」：待审下架 = status 仍 PUBLISHED + pendingAction=DELIST。
  // 单独派生为 PUBLISHED_DELISTING（已发布·停用审核中），使列表/弹窗显「审核中」而非「已发布」，
  // 且动作矩阵给「撤回」而非再次「停用」。
  if (pub.pendingAction === 'DELIST' && pub.status === 'PUBLISHED') {
    return 'PUBLISHED_DELISTING'
  }
  switch (pub.status) {
    case 'PENDING_REVIEW':
      return 'REVIEWING'
    case 'PUBLISHED':
      return pending ? 'PUBLISHED_REVIEWING' : 'PUBLISHED'
    case 'REJECTED':
      return 'REJECTED'
    case 'DELISTED':
      return pending ? 'DELISTED_REVIEWING' : 'DELISTED'
    default:
      return 'INITIAL'
  }
}

// 展示态 → 业务友好文案
export const STATE_LABEL = {
  INITIAL: '初始创建',
  REVIEWING: '审核中',
  PUBLISHED: '已发布',
  PUBLISHED_REVIEWING: '已发布 · 新版审核中',
  PUBLISHED_DELISTING: '已发布 · 停用审核中',
  REJECTED: '已驳回',
  DELISTED: '已下架',
  DELISTED_REVIEWING: '已下架 · 新版审核中'
}

export function stateLabel(state) {
  return STATE_LABEL[state] || state || '—'
}

// 展示态 → StatusTag type（success/warning/danger/info）
export const STATE_TAG_TYPE = {
  INITIAL: 'info', // 中性
  REVIEWING: 'warning', // 进行中（在审）
  PUBLISHED: 'success', // 已发布（干净）
  PUBLISHED_REVIEWING: 'warning', // 线上供旧版，新版在审
  PUBLISHED_DELISTING: 'warning', // 线上仍可用，停用在审（V100）
  REJECTED: 'danger', // 被驳回
  DELISTED: 'info', // 已下架（中性）
  DELISTED_REVIEWING: 'warning' // 已下架，新版在审
}

export function stateTagType(state) {
  return STATE_TAG_TYPE[state] || 'info'
}

/**
 * 「发布」弹窗内当前可执行的动作（技能级上/下线不在弹窗内管理——见 skillOnlineState，落操作列）：
 *   submit   —— 提交发布 / 提交新版（首发 / 已发布提新版 / 下架提新版 / 驳回后重提）
 *   withdraw —— 撤回在审提交（首发在审=删行回未发布；新版在审=仅作废提交，线上不动）
 */
export function stateActions(state) {
  switch (state) {
    case 'REVIEWING':
    case 'PUBLISHED_REVIEWING':
    case 'DELISTED_REVIEWING':
    case 'PUBLISHED_DELISTING':
      return ['withdraw']
    default:
      // INITIAL / REJECTED / PUBLISHED / DELISTED：可提交（新版）发布
      return ['submit']
  }
}

/**
 * 技能级「上/下线」态（供操作列「技能下线 / 技能上线」）——去分端后按 USER_END 发布行 status 判定：
 *   ONLINE  —— status=PUBLISHED（含新版在审 PUBLISHED_REVIEWING）：当前对客户端可下载 → 可「技能下线」
 *   OFFLINE —— status=DELISTED（含新版在审）：整技能已下线 → 可「技能上线」
 *   NONE    —— 无发布行 / 首发在审 / 驳回：从未上线，无上下线概念（操作列不显该动作）
 */
export function skillOnlineState(publications) {
  const pub = userEndPublication(publications)
  if (!pub || !pub.status) return 'NONE'
  // V100：待审下架期间（PUBLISHED + pendingAction=DELIST）已提交停用审核 → 不再给「停用」入口
  // （否则重复提交，后端 409）。归 NONE，操作列改由弹窗的「撤回」承载。
  if (pub.pendingAction === 'DELIST' && pub.status === 'PUBLISHED') return 'NONE'
  if (pub.status === 'PUBLISHED') return 'ONLINE'
  if (pub.status === 'DELISTED') return 'OFFLINE'
  return 'NONE'
}

/**
 * 「锁定（禁编辑）」谓词：技能有在审提交时锁定编辑器（首发在审 / 已发布新版在审 / 已下架新版在审）。
 * 未锁定态（初始创建 / 已发布干净 / 已驳回 / 已下架干净）正常可编辑。
 */
export function isLocked(publications) {
  const state = derivePlatformState(publications)
  return (
    state === 'REVIEWING' ||
    state === 'PUBLISHED_REVIEWING' ||
    state === 'DELISTED_REVIEWING' ||
    state === 'PUBLISHED_DELISTING' // V100：停用审核中也锁编辑（审核对象=提交那刻的技能）
  )
}

/* ============================ 连接器（工具市场）旧口径，沿用不动 ============================ */
// 发布目标枚举（连接器/版本历史仍分端；平台技能单轨已不用）
export const TARGETS = ['FDE_WORKBENCH', 'USER_END']

export const TARGET_LABEL = {
  FDE_WORKBENCH: 'FDE 工作台',
  USER_END: '用户端'
}

export function targetLabel(target) {
  return TARGET_LABEL[target] || target || '—'
}

/**
 * 【连接器（工具市场）沿用】某原始 status 当前可执行的发布操作：
 *   NONE / REJECTED → publish；PENDING_REVIEW → withdraw；PUBLISHED → delist；DELISTED → relist。
 */
export function targetActions(status) {
  switch (status) {
    case 'PENDING_REVIEW':
      return ['withdraw']
    case 'PUBLISHED':
      return ['delist']
    case 'DELISTED':
      return ['relist']
    case 'REJECTED':
    case 'NONE':
    default:
      return ['publish']
  }
}
