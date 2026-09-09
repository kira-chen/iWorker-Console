/**
 * 发布三态展示的单一真相（2026-09-09 代码冗余治理·第二批 批 2-2 收编）。
 *
 * 「未发布 / 审核中 / 已发布」这组 label + el-tag type 此前在 13 处映射定义里各写一份
 * （字面量逐字相同）；现收编于此，各页保留自己的枚举键名映射、只把 label/type 指到这里。
 * 注意：各模块底层状态枚举值与 URL 筛选参数拼写（draft/reviewing/review/PUBLISHED…共 10 种）
 * 是数据模型的一部分，本轮明确不统一（见方案拍板清单第 1 条），本文件只管展示词表。
 */
// 深冻结（2026-09-09 架构师验收 P2）：条目对象按引用外发全站共享，浅冻结挡不住
// 消费点误写 meta.label 污染全站，故条目本身也冻结。
export const TRI_STATE_META = Object.freeze({
  UNPUBLISHED: Object.freeze({ label: '未发布', type: 'info' }),
  REVIEWING: Object.freeze({ label: '审核中', type: 'warning' }),
  PUBLISHED: Object.freeze({ label: '已发布', type: 'success' })
})

/** 通用折叠：pendingAction 在途→审核中；status 为 published/PUBLISHED→已发布；其余→未发布。 */
export function triFromRow(row) {
  if (row?.pendingAction) return TRI_STATE_META.REVIEWING
  const s = row?.status
  if (s === 'published' || s === 'PUBLISHED') return TRI_STATE_META.PUBLISHED
  return TRI_STATE_META.UNPUBLISHED
}
