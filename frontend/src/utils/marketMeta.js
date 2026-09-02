/**
 * 工具市场前端元数据（标签 / 文案 / 状态→可见操作映射）。
 *
 * 单一来源：listing 状态、writeClass、toolType 的展示文案与 StatusTag 类型在此集中维护，
 * 各子页统一引用，避免散落。状态→可见操作矩阵与技术方案 §3.5 / §5.4 一一对应。
 */

// listing 四态 → StatusTag type + 中文标签
export const LISTING_STATUS_META = {
  PENDING_REVIEW: { type: 'warning', label: '待审核' },
  PUBLISHED: { type: 'success', label: '已发布' },
  REJECTED: { type: 'danger', label: '已驳回' },
  DELISTED: { type: 'info', label: '已下架' }
}

export function statusMeta(status) {
  return LISTING_STATUS_META[status] || { type: 'info', label: status || '—' }
}

// 发布管理筛选下拉选项（含「全部」由前端置空 value 表达）
export const PUBLISH_STATUS_OPTIONS = [
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'PENDING_REVIEW', label: '待审核' },
  { value: 'DELISTED', label: '已下架' },
  { value: 'REJECTED', label: '已驳回' }
]

// 工具类型
export const TOOL_TYPE_OPTIONS = [
  { value: 'MCP', label: 'MCP' },
  { value: 'API', label: 'API' }
]

/* ---------------- 发布目标 target（V36：与 skill_publication.target 同域同范式） ---------------- */
// listing 现按 (tool, target) 一行；发布对话框多选目标、列表/审核台按 target 展示徽标。
export const TARGETS = ['FDE_WORKBENCH', 'USER_END']

export const TARGET_LABEL = {
  FDE_WORKBENCH: 'FDE 工作台',
  USER_END: '用户端'
}
export function targetLabel(target) {
  return TARGET_LABEL[target] || target || '—'
}

// 目标筛选下拉（含「全部」由前端置空 value 表达）
export const TARGET_OPTIONS = [
  { value: 'FDE_WORKBENCH', label: 'FDE 工作台' },
  { value: 'USER_END', label: '用户端' }
]

// 目标徽标的 StatusTag 颜色：用户端=accent（强调，终端可见），FDE 工作台=info（中性，后台内部）。
export const TARGET_TAG_TYPE = {
  FDE_WORKBENCH: 'info',
  USER_END: 'accent'
}
export function targetTagType(target) {
  return TARGET_TAG_TYPE[target] || 'info'
}

// 逐 target 发布结果 outcome → 友好文案（部分失败提示用，§6.1 PublishTargetResultVO.outcome）
export const PUBLISH_OUTCOME_LABEL = {
  CREATED: '已提交',
  RESUBMITTED: '已重新提交',
  CONFLICT: '已存在'
}
export function publishOutcomeLabel(outcome) {
  return PUBLISH_OUTCOME_LABEL[outcome] || outcome || ''
}
// outcome 是否成功（CREATED/RESUBMITTED 成功；CONFLICT 视为未新增、提示但不算失败）
export function isPublishOutcomeOk(outcome) {
  return outcome === 'CREATED' || outcome === 'RESUBMITTED'
}

// 读/写性质（本期二态）
export const WRITE_CLASS_META = {
  READ: { label: '读', type: 'info' },
  WRITE: { label: '写', type: 'warning' }
}
export function writeClassMeta(wc) {
  return WRITE_CLASS_META[wc] || null
}

/* ---------------- MCP 服务级聚合状态（连接器改造一，契约 §3.5 / PRD §3.1） ---------------- */
// 服务级聚合态由后端按 (服务 × target) 直接返回，前端不自拼优先级，直接消费。
// 枚举：NOT_PUBLISHED | PARTIAL | PENDING_REVIEW | PUBLISHED | REJECTED | DELISTED。
// 配色：未发布灰 / 待审 warning / 全部已上架 success / 驳回 danger / 下架 info；
// PARTIAL「部分已上架」采用 warning 警觉色（PM 2026-06-26 裁决，匹配「让 FDE 警觉服务没整齐上架」的核心价值；
// PRD §3.1 已同步回写，原「success 弱化」口径作废）。
export const MCP_AGG_STATUS_META = {
  NOT_PUBLISHED: { type: 'info', label: '未发布' },
  PARTIAL: { type: 'warning', label: '部分已上架' },
  PENDING_REVIEW: { type: 'warning', label: '待审核' },
  PUBLISHED: { type: 'success', label: '全部已上架' },
  REJECTED: { type: 'danger', label: '已驳回' },
  DELISTED: { type: 'info', label: '已下架' }
}
export function mcpAggStatusMeta(status) {
  return MCP_AGG_STATUS_META[status] || { type: 'info', label: status || '—' }
}

/* ---------------- MCP 列表页三态（2026-08-20 决策） ---------------- */
/**
 * MCP 服务级聚合态 → 列表页展示的<b>三态</b>：未发布 / 审核中 / 已发布。
 *
 * <p>口径对齐「模型」页（V96）：一个 MCP 服务是一个发布单位，列表只回答「这个服务发布到哪一步」。
 * 三态由六态聚合归并而来：</p>
 * <ul>
 *   <li><b>已发布</b> ← PUBLISHED</li>
 *   <li><b>审核中</b> ← PENDING_REVIEW</li>
 *   <li><b>未发布</b> ← NOT_PUBLISHED / DELISTED / REJECTED（驳回原因另行悬浮说明，不占状态位）</li>
 * </ul>
 *
 * <p><b>PARTIAL 为什么仍保留映射</b>：服务级发布已把「同服务全部工具同一发布态」立为强不变量
 * （后端逐工具端点对 MCP 拒绝 + 审核台服务级批量审批 + 新工具自动继承），正常路径不再产生 PARTIAL。
 * 此处保留兜底，仅防改造前的存量脏数据或直连库改数据时渲染出裸枚举——与模型页保留
 * PENDING_REVIEW/REJECTED 兜底同理。归入「未发布」是保守选择：它确实没整齐上架。</p>
 */
export const MCP_LIST_STATE_META = {
  PUBLISHED: { type: 'success', label: '已发布' },
  PENDING_REVIEW: { type: 'warning', label: '审核中' },
  NOT_PUBLISHED: { type: 'info', label: '未发布' },
  DELISTED: { type: 'info', label: '未发布' },
  REJECTED: { type: 'info', label: '未发布' },
  PARTIAL: { type: 'info', label: '未发布' }
}
export function mcpListStateMeta(aggStatus) {
  return MCP_LIST_STATE_META[aggStatus] || { type: 'info', label: '未发布' }
}

/**
 * 服务级聚合态 → 该 target 上可执行的服务级动作（驱动发布抽屉按钮显隐）。
 * publish：未发布/部分/已驳回均可一键发布（幂等推齐）；withdraw：待审可撤回；
 * delist：已上架/部分已上架可下架；relist：已下架可重新上架。
 * 与契约 §3.2~§3.4 服务级端点对应（动作只对状态合法的工具行生效，后端跳过非法行）。
 */
export function mcpServiceActions(aggStatus) {
  switch (aggStatus) {
    case 'PENDING_REVIEW':
      return ['withdraw']
    case 'PUBLISHED':
      return ['delist']
    case 'PARTIAL':
      // 部分已上架：既可继续一键发布把剩余工具推齐，也可整体下架已上架部分
      return ['publish', 'delist']
    case 'DELISTED':
      return ['relist', 'publish']
    case 'REJECTED':
    case 'NOT_PUBLISHED':
      return ['publish']
    default:
      return ['publish']
  }
}

/**
 * 状态 → 发布管理可见操作（§5.4 映射表，与 §3.5 流转矩阵一一对应）。
 * 前端按钮可见性的唯一依据；不得放出矩阵标 ✗ 的动作。
 */
export function publishActions(status) {
  switch (status) {
    case 'PENDING_REVIEW':
      // 撤回（删行）+ 编辑元数据（仍在审）
      return { withdraw: true, edit: true }
    case 'PUBLISHED':
      // 下架 + 编辑元数据（改名/描述原地；改安全字段触发重审，由后端裁决）
      return { delist: true, edit: true }
    case 'REJECTED':
      // 重提（同行 reset 回 PENDING）+ 重提前可改元数据；展示驳回意见
      return { resubmit: true, edit: true }
    case 'DELISTED':
      // 重新上架 + 编辑元数据
      return { relist: true, edit: true }
    default:
      return {}
  }
}
