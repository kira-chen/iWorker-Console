<script setup>
/**
 * 数据源管理子页（AdminKnowledgeBase 容器 ?tab=source）。
 * 2026-09-04 按 PRD-20260903《prd.知识库.md》§四 + 交互原型 renderSourceList 最终覆写态
 * （含后置精修层的启用/停用状态筛选）对齐重排。
 *
 * 【筛选】关键词（名称模糊）/ 类型（上传·API·MCP）/ 状态（启用·停用，后置精修层）+ 查询。
 * 【列】数据源 / 类型 / 概要（上传=文档数，API·MCP=连通性，失败警示样式）/ 状态 / 被引用 / 操作。
 * 【操作】查看·编辑固定；上传类+文档管理；未被引用+删除（二次确认），被引用时删除置灰并
 *   提示「正被知识库引用，请先解除引用」（md §四.2，逐字）。
 */
import { ref, onMounted, onActivated } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus } from '@element-plus/icons-vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import KnowledgeSourceEditor from '@/components/admin/KnowledgeSourceEditor.vue'
import KnowledgeSourceDocsDrawer from '@/components/admin/KnowledgeSourceDocsDrawer.vue'
import { listKnowledgeSources, deleteKnowledgeSource } from '@/api/knowledgeBase'
import { useAdminList } from '@/composables/useAdminList'
import { COL, opsWidth } from '@/utils/tableLayout'
import { SOURCE_TYPES, SOURCE_LABELS, SOURCE_STATUS_META, SOURCE_REFERENCED_TIP } from '@/utils/knowledgeBaseMeta'

const keyword = ref('')
const typeFilter = ref('')
const statusFilter = ref('')

const list = useAdminList(listKnowledgeSources, {
  params: () => ({ keyword: keyword.value.trim(), sourceType: typeFilter.value, status: statusFilter.value })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty, reload, search } = list

const editorVisible = ref(false)
const editingId = ref(null)
const editorMode = ref('edit') // 'edit' | 'view'
const docsVisible = ref(false)
const docsTarget = ref(null)
/** 防重复提交（md §八.2） */
const rowBusy = ref('')

function openCreate() {
  editingId.value = null
  editorMode.value = 'edit'
  editorVisible.value = true
}
function openEdit(row) {
  editingId.value = row.id
  editorMode.value = 'edit'
  editorVisible.value = true
}
function openView(row) {
  editingId.value = row.id
  editorMode.value = 'view'
  editorVisible.value = true
}
/** 上传类专属：文档清单与库维度配置拆开管理，单独入口（md §四.2 / §五.3）。 */
function openDocs(row) {
  docsTarget.value = row
  docsVisible.value = true
}
/** 概要列（md §四.2）：上传=文档总数；API/MCP=已连通 / 连接失败（警示样式）/ 未验证。 */
function summaryOf(row) {
  if (row.sourceType === 'UPLOAD') return `${Number(row.docCount || 0).toLocaleString('en-US')} 篇文档`
  if (row.verifyStatus === 'SUCCESS') return '已连通'
  if (row.verifyStatus === 'FAILED') return '连接失败'
  return '未验证'
}
function summaryClass(row) {
  if (row.sourceType === 'UPLOAD') return 'kb-num'
  return row.verifyStatus === 'SUCCESS' ? 'src-ok' : row.verifyStatus === 'FAILED' ? 'src-bad' : 'cell-na'
}
async function doDelete(row) {
  try {
    // 删除未被引用的数据源需二次确认（md §四.2）；文案照交互原型 modal
    await ElMessageBox.confirm('删除后配置无法恢复，确认删除？', '删除数据源', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch (e) {
    return
  }
  rowBusy.value = row.id
  try {
    await deleteKnowledgeSource(row.id)
    ElMessage.success('数据源已删除')
    reload()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    rowBusy.value = ''
  }
}

onMounted(reload)
// 知识库子页里改了引用关系会影响「被引用」列，切回时刷新
onActivated(reload)
</script>

<template>
  <div class="list-page">
    <ListToolbar>
      <el-input
        v-model="keyword"
        placeholder="搜索数据源名"
        clearable
        class="lt-search"
        @keyup.enter="search"
        @clear="search"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="typeFilter" placeholder="全部类型" clearable class="lt-filter" @change="search">
        <el-option v-for="t in SOURCE_TYPES" :key="t" :label="SOURCE_LABELS[t]" :value="t" />
      </el-select>
      <el-select v-model="statusFilter" placeholder="全部状态" clearable class="lt-filter" @change="search">
        <el-option label="启用" value="ENABLED" />
        <el-option label="停用" value="DISABLED" />
      </el-select>
      <el-button @click="search">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建数据源
        </el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        :empty-text="keyword || typeFilter || statusFilter ? '暂无符合条件的数据源' : '还没有数据源 · 点「新建数据源」创建第一个'"
        @retry="reload"
      >
        <el-table v-loading="loading" :data="rows" row-key="id">
          <el-table-column label="数据源" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              <!-- 名称点击进入配置（md §四.2） -->
              <span class="kb-name kb-link" @click="openEdit(row)">{{ row.name }}</span>
            </template>
          </el-table-column>

          <el-table-column label="类型" :width="COL.TAG">
            <template #default="{ row }">
              <el-tag size="small" type="info" effect="plain">{{ SOURCE_LABELS[row.sourceType] || row.sourceType }}</el-tag>
            </template>
          </el-table-column>

          <el-table-column label="概要" :min-width="120">
            <template #default="{ row }">
              <span :class="summaryClass(row)">{{ summaryOf(row) }}</span>
            </template>
          </el-table-column>

          <!-- 停用数据源不会参与知识检索（md §四.2） -->
          <el-table-column label="状态" :width="COL.STATUS">
            <template #default="{ row }">
              <StatusTag :type="(SOURCE_STATUS_META[row.status] || SOURCE_STATUS_META.ENABLED).type">
                {{ (SOURCE_STATUS_META[row.status] || SOURCE_STATUS_META.ENABLED).label }}
              </StatusTag>
            </template>
          </el-table-column>

          <!-- 被引用：删除保护的可见依据 -->
          <el-table-column label="被引用" :min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.referencedBy?.length">{{ row.referencedBy.map((r) => r.name).join('、') }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!-- 操作（md §四.2）：查看·编辑固定；上传类+文档管理；被引用时删除置灰+提示 -->
          <el-table-column label="操作" :width="opsWidth(4)" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <el-button link type="primary" size="small" @click="openView(row)">查看</el-button>
                <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
                <el-button v-if="row.sourceType === 'UPLOAD'" link type="primary" size="small" @click="openDocs(row)">文档管理</el-button>
                <el-tooltip :disabled="!row.referencedBy?.length" :content="SOURCE_REFERENCED_TIP" placement="top">
                  <span>
                    <el-button
                      link
                      type="danger"
                      size="small"
                      :disabled="!!row.referencedBy?.length || rowBusy === row.id"
                      @click="doDelete(row)"
                    >删除</el-button>
                  </span>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination :total="total" v-model:page="page" :page-size="pageSize" @change="reload" />

    <KnowledgeSourceEditor v-model:visible="editorVisible" :source-id="editingId" :mode="editorMode" @saved="reload" @changed="reload" />
    <KnowledgeSourceDocsDrawer v-model:visible="docsVisible" :source="docsTarget" @changed="reload" />
  </div>
</template>

<style scoped>
.kb-name {
  color: var(--c-text-strong);
}
.kb-link {
  cursor: pointer;
}
.kb-link:hover {
  color: var(--c-accent);
}
.kb-num {
  font-variant-numeric: tabular-nums;
}
.src-ok {
  color: var(--c-success);
}
.src-bad {
  color: var(--c-danger);
}
</style>
