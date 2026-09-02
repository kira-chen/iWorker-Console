<script setup>
/**
 * 访问审计（治理，ADMIN 专属）—— 登录 / 登出明细，只读列表。
 *
 * 2026-09-01 按 PRD（prd.访问审计.md）+ 交互原型 v2 最终版（renderAuditMultiDevice）对齐：
 * - 查询区 = 用户名搜索（回车/【查询】生效）+ 在线状态筛选 + 查询按钮（回第 1 页）；
 * - 列 = 用户名 / 终端（仅 Windows、Mac 两类蓝标）/ 登录时间(排序) / 登出时间(排序) / 状态 / 来源 IP；
 * - 默认按登录时间倒序；登出时间为空显「—」；登录地点字段不展示（md §四）；
 * - 数据走 loginLog.js（demo 默认 loginLogMock，同一账号多终端多条记录）。
 */
import { reactive, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import { listLoginLogs } from '@/api/loginLog'
import '@/assets/connector.css'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

const query = reactive({ keyword: '', status: '', sortField: 'loginAt', sortDir: 'desc' })

// 取数编排统一走 useAdminList：四态 / 分页 / 竞态防护由其承担，本页只描述「取什么」。
const list = useAdminList(listLoginLogs, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload
// 【查询】/回车：按当前条件刷新并回第 1 页（md §二）
const reload = list.search

// 列头排序（loginAt / logoutAt 双列，切换后回第 1 页）
function onSortChange({ prop, order }) {
  if (!order) {
    // 取消排序回默认：登录时间倒序
    query.sortField = 'loginAt'
    query.sortDir = 'desc'
  } else {
    query.sortField = prop
    query.sortDir = order === 'ascending' ? 'asc' : 'desc'
  }
  reload()
}

onMounted(fetchList)

// 在线 = 会话状态权威为 ONLINE（不以 logoutAt 为空兜底，异常中断会留空登出时间）。
function isOnline(row) {
  return row.status === 'ONLINE'
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="访问审计" subtitle="查看用户的登录 / 登出记录、在线状态与来源 IP" />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索用户名"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.status" placeholder="全部在线状态" clearable class="lt-filter" @change="reload">
        <el-option label="在线" value="ONLINE" />
        <el-option label="离线" value="OFFLINE" />
      </el-select>
      <el-button @click="reload">查询</el-button>
    </ListToolbar>

    <div v-loading="loading" class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="暂无登录记录"
        @retry="fetchList"
      >
        <el-table
          :data="rows"
          class="ll-table"
          :default-sort="{ prop: 'loginAt', order: 'descending' }"
          @sort-change="onSortChange"
        >
          <el-table-column label="用户名" :width="COL.USER" show-overflow-tooltip>
            <template #default="{ row }">{{ row.username || '—' }}</template>
          </el-table-column>
          <el-table-column label="终端" :width="COL.STATUS">
            <template #default="{ row }">
              <StatusTag type="accent">{{ row.terminal }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="登录时间" prop="loginAt" sortable="custom" :width="COL.TIME">
            <template #default="{ row }">
              <span class="ll-muted">{{ row.loginAt || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="登出时间" prop="logoutAt" sortable="custom" :width="COL.TIME">
            <template #default="{ row }">
              <span class="ll-muted">{{ row.logoutAt || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" :width="COL.STATUS">
            <template #default="{ row }">
              <StatusTag :type="isOnline(row) ? 'success' : 'info'">
                {{ isOnline(row) ? '在线' : '离线' }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="来源 IP" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ll-muted">{{ row.ip || '—' }}</span>
            </template>
          </el-table-column>
        </el-table>

        <ListPagination
          v-model:page="page"
          :page-size="pageSize"
          :total="total"
          @change="fetchList"
        />
      </ListStates>
    </div>
  </div>
</template>

<style scoped>
.ll-table {
  width: 100%;
}
.ll-muted {
  color: var(--c-text-faint);
}
</style>
