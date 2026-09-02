<script setup>
/**
 * 列表页分页条统一封装（2026-08-22 统一）。
 *
 * 【解决什么】改造前 13 个页面各写一遍 el-pagination，layout 已漂出两种
 * （12 个 `prev, pager, next, total`、1 个漏了 `total` —— 漏了用户就不知道总共多少条）；
 * 每页条数也漂出 10/12/20 三种。本组件固化 layout 与默认页长，页面不再各写。
 *
 * 【默认每页 20】负责人 2026-08-22 定，与 useAdminList 同源（见该文件注释）。
 *
 * 【只在需要时出现】总数不超过一页时不渲染——一条分页条杵在 3 行数据下面是纯噪音。
 *
 * 用法（配 useAdminList）：
 *   <ListPagination :total="l.total" v-model:page="l.page" :page-size="l.pageSize"
 *                   @change="l.reload" />
 */
import { computed } from 'vue'

const props = defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 }
})
const emit = defineEmits(['update:page', 'change'])

// 单页装得下就不出分页条（避免 3 行数据下面挂一条无意义的分页）
const visible = computed(() => props.total > props.pageSize)

function onCurrentChange(n) {
  emit('update:page', n)
  emit('change', n)
}
</script>

<template>
  <div v-if="visible" class="list-pager">
    <!-- layout 固化含 total：用户需要知道「一共多少条」，这是分页条最基本的信息 -->
    <el-pagination
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="prev, pager, next, total"
      background
      @current-change="onCurrentChange"
    />
  </div>
</template>

<style scoped>
/* 分页条统一右对齐，与各页表格右边缘齐 */
.list-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-3);
}
</style>
