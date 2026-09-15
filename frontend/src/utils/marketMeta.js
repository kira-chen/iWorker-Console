/**
 * 连接器发布态前端元数据（标签 / 文案 / StatusTag 类型）。
 *
 * 单一来源：listing 四态、writeClass、MCP 列表三态的展示文案与 StatusTag 类型在此集中维护，各页统一引用。
 * 消费方：reviewMeta.statusMeta 复用（治理旧口径）、AdminApis.writeClassMeta、AdminMcp.mcpListStateMeta。
 *
 * 2026-09-12 死码清理（审计 J13）：原「工具市场」时代的零调用方导出——PUBLISH_STATUS_OPTIONS / TOOL_TYPE_OPTIONS /
 * 发布目标 TARGETS · TARGET_LABEL · targetLabel · TARGET_OPTIONS · TARGET_TAG_TYPE · targetTagType /
 * 逐 target 发布结果 PUBLISH_OUTCOME_LABEL · publishOutcomeLabel · isPublishOutcomeOk /
 * 六态聚合 MCP_AGG_STATUS_META · mcpAggStatusMeta · mcpServiceActions / publishActions——已删，
 * 发布目标与工具市场页随发布单元退役（2026-09-01），MCP 列表只消费三态归并。
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

// 读/写性质（本期二态）
export const WRITE_CLASS_META = {
  READ: { label: '读', type: 'info' },
  WRITE: { label: '写', type: 'warning' }
}
export function writeClassMeta(wc) {
  return WRITE_CLASS_META[wc] || null
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
