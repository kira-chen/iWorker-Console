<script setup>
/**
 * ListToolbar —— 管理后台列表页统一工具栏（2026-08-26 统一）。
 *
 * 【解决什么】改造前 15 个列表页各写一套 `<div class="toolbar|conn-toolbar|rev-toolbar|usr-toolbar">`
 * 与配套 scoped CSS，控件宽度 / 间距 / 换行 / 新建按钮位置全部漂移。本组件固化结构，
 * 样式走 assets/list-page.css 的全局类（.list-toolbar / .lt-search / .lt-filter / .lt-create）。
 *
 * 【结构口径】一行两组：
 *   默认插槽（左）= 搜索框(.lt-search) → 筛选下拉(.lt-filter)… →（可选「查询」按钮）
 *   #right 插槽（右）= 页面主操作，通常是唯一的 primary「新建 XX」(.lt-create)
 *
 * 用法：
 *   <ListToolbar>
 *     <el-input v-model="query.keyword" placeholder="搜索名称" clearable class="lt-search">
 *       <template #prefix><el-icon><Search /></el-icon></template>
 *     </el-input>
 *     <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter" @change="reload">…</el-select>
 *     <template #right>
 *       <el-button type="primary" class="lt-create" @click="openCreate"><el-icon><Plus /></el-icon> 新建岗位</el-button>
 *     </template>
 *   </ListToolbar>
 *
 * 没有筛选项的页面（如角色）也用本组件只放 #right，保证「新建」按钮全站同一位置（工具行右端），
 * 而不是有的在页头 actions、有的在工具行。
 */
</script>

<template>
  <div class="list-toolbar">
    <slot />
    <div v-if="$slots.right" class="list-toolbar-right">
      <slot name="right" />
    </div>
  </div>
</template>
