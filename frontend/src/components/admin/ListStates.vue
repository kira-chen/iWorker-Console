<script setup>
/**
 * 列表页「加载失败 / 空态」统一呈现（2026-08-22 统一）。
 *
 * 【解决什么】改造前完全相同的「加载失败 + 重试」模板在 15 个页面各写一遍；
 * 空态则一半用 el-table 的 empty-text、一半用 el-empty，文案格式也各不相同。
 *
 * 【口径】（写进 docs/frontend/规范-管理后台列表页.md）
 *  - 加载失败优先于空态：取数失败时不该显示「还没有数据」——那是在撒谎，
 *    用户会以为真的没数据，而实际是没取到。必须给出重试入口。
 *  - 空态文案两种句式：有创建入口用「还没有X · 点「Y」创建第一个」（给下一步动作），
 *    筛选结果为空用「暂无符合条件的X」（提示是筛选条件的问题，不是没数据）。
 *
 * 用法：包在 el-table 外层，失败/空态由本组件出，有数据时渲染默认插槽（表格）。
 *   <ListStates :loading="l.loading" :error="l.loadError" :empty="l.isEmpty"
 *               empty-text="还没有角色 · 点「新建角色」创建第一个" @retry="l.reload">
 *     <el-table :data="l.rows"> ... </el-table>
 *   </ListStates>
 */
defineProps({
  /** 取数中——加载态由内部的 el-table v-loading 承担，此处仅用于避免空态闪现 */
  loading: { type: Boolean, default: false },
  /** 取数失败 */
  error: { type: Boolean, default: false },
  /** 无数据（非加载中、非失败） */
  empty: { type: Boolean, default: false },
  /** 空态文案，见上方口径 */
  emptyText: { type: String, default: '暂无数据' },
  /** 空态副文案（可选，2026-09-04 岗位申请审批空态「新的用户岗位申请会显示在这里」补充） */
  emptySubText: { type: String, default: '' }
})
defineEmits(['retry'])
</script>

<template>
  <!-- 失败优先：取数失败时只出重试，不出空态（空态会被误读成「真的没数据」） -->
  <el-empty v-if="error" :image-size="96" description="加载失败">
    <el-button @click="$emit('retry')">重试</el-button>
  </el-empty>

  <el-empty v-else-if="empty" :image-size="96" :description="emptyText">
    <span v-if="emptySubText" class="ls-subtext">{{ emptySubText }}</span>
  </el-empty>

  <slot v-else />
</template>

<style scoped>
.ls-subtext {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
