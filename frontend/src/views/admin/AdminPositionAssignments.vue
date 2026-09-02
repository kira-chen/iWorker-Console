<script setup>
/**
 * 岗位分配页（FDE 工作台，提案 20260721-2）。
 *
 * 以用户为核心：表格列 = 用户名 / 显示名 / 状态 / 绑定岗位（未绑定则空）/ 操作。
 * 可在页面上修改某用户的绑定岗位（首绑/换绑/解绑），保存即时生效（PUT /fde/position-assignments/{userId}）。
 * 页面骨架照抄 AdminUsers（conn.css 共享类 + el-table）；取数编排走 useAdminList，
 * 失败/空态走 ListStates、分页走 ListPagination（列表页规范，2026-08-22 统一）。
 *
 * 2026-09-01 PRD 对齐（原型 renderAssignments 区）：数据走 positionAssignmentMock（api 层分流）、
 * 岗位下拉只出已发布岗位并与 positionMock 联动；工具栏补【查询】按钮；用户名列加粗强调；
 * 分页底部补「共 N 条 · 每页 X 条」信息（单页时也显示）。
 */
import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import UserPositionEditDialog from '@/components/admin/UserPositionEditDialog.vue'
import { listPositionAssignments } from '@/api/positionAssignment'
import { listPositions } from '@/api/position'
import '@/assets/connector.css'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

const query = reactive({ keyword: '', status: '' })


// 已发布岗位选项（供编辑弹窗的岗位下拉复用）
const positionOptions = ref([])

const editVisible = ref(false)
const editingRow = ref(null)

// 取数编排统一走 useAdminList（见 docs/frontend/规范-管理后台列表页.md）：
// 四态 / 分页 / 空筛选项过滤 / 防空页回退 / 竞态防护均由其承担，本页只描述「取什么」。
const list = useAdminList(listPositionAssignments, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload

const reload = list.search

async function loadPositions() {
  try {
    // 只取已发布岗位（可绑定目标）；size 放大一次拉全，避免分页缺项。
    const data = await listPositions({ status: 'published', size: 200 })
    positionOptions.value = (data?.list || []).map((p) => ({ positionId: p.positionId, name: p.name }))
  } catch (e) {
    /* 岗位选项读失败：编辑下拉降级为空，不阻断列表 */
  }
}

onMounted(() => {
  fetchList()
  loadPositions()
})

// 关键词实时搜索：300ms 防抖 → reload
let kwTimer = null
watch(
  () => query.keyword,
  () => {
    if (kwTimer) clearTimeout(kwTimer)
    kwTimer = setTimeout(reload, 300)
  }
)
onBeforeUnmount(() => {
  if (kwTimer) clearTimeout(kwTimer)
})

function openEdit(row) {
  editingRow.value = { ...row }
  editVisible.value = true
}
function onSaved() {
  fetchList()
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="岗位分配" subtitle="以用户为核心查看与设置每个用户绑定的岗位，保存即时生效" />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索用户名 / 显示名"
        clearable
        class="lt-search"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select
        v-model="query.status"
        placeholder="全部状态"
        clearable
        class="lt-filter"
        @change="reload"
      >
        <el-option label="启用" value="active" />
        <el-option label="停用" value="disabled" />
      </el-select>
      <!-- 【查询】按钮（原型 pa-query）：点击回第 1 页重查 -->
      <el-button @click="reload">查询</el-button>
    </ListToolbar>

    <div v-loading="loading" class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="没有匹配的用户"
        @retry="fetchList"
      >
        <el-table :data="rows" class="pa-table">
          <!-- 用户名：本页主键信息，加粗强调（原型 fm5-name） -->
          <el-table-column label="用户名" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="pa-username">{{ row.username }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="displayName" label="显示名" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">{{ row.displayName || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" :width="COL.STATUS">
            <template #default="{ row }">
              <StatusTag :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '启用' : '停用' }}
              </StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="绑定岗位" min-width="180">
            <template #default="{ row }">
              <span v-if="row.positionName">{{ row.positionName }}</span>
              <span v-else class="pa-unbound">未绑定</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">修改绑定</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分页底部信息（原型 fm5-pager「共 N 条 · 每页 X 条」）：固定每页条数，单页时也显示总条数 -->
        <div v-if="total" class="pa-foot">
          <span class="pa-foot-info">共 {{ total }} 条 · 每页 {{ pageSize }} 条</span>
          <ListPagination
            v-model:page="page"
            :page-size="pageSize"
            :total="total"
            @change="fetchList"
          />
        </div>
      </ListStates>
    </div>

    <UserPositionEditDialog
      v-model:visible="editVisible"
      :row="editingRow"
      :position-options="positionOptions"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.pa-table {
  width: 100%;
}
.pa-username {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.pa-unbound {
  color: var(--c-text-faint);
}
/* 分页底部：左信息 + 右分页条（单页时 ListPagination 不渲染，仅剩总条数信息） */
.pa-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.pa-foot-info {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
</style>
