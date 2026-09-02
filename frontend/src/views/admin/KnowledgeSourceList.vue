<script setup>
/**
 * 数据源管理子页（AdminKnowledgeBase 容器 ?tab=source，2026-08-31 新增）。
 *
 * 数据源是独立一等对象（上传 / API / MCP 三类）：在这里建 / 配 / 删，知识库只引用。
 * 【列】名称 / 类型 / 概要（上传=文档数，API/MCP=连通性）/ 状态（启用·停用）/ 被引用 / 操作（配置 · 删除）。
 * 【删除保护】被知识库引用的数据源删除被后端 409 阻断（带引用清单），前端先按 referencedBy 禁用并 tooltip 说明。
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
import { SOURCE_TYPES, SOURCE_LABELS, SOURCE_STATUS_META } from '@/utils/knowledgeBaseMeta'

const keyword = ref('')
const typeFilter = ref('')

const list = useAdminList(listKnowledgeSources, {
  params: () => ({ keyword: keyword.value.trim(), sourceType: typeFilter.value })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty, reload, search } = list

const editorVisible = ref(false)
const editingId = ref(null)
const docsVisible = ref(false)
const docsTarget = ref(null)

function openCreate() {
  editingId.value = null
  editorVisible.value = true
}
function openConfig(row) {
  editingId.value = row.id
  editorVisible.value = true
}
/** 上传类专属：文档清单与库维度配置拆开管理（2026-08-31 负责人定），单独入口。 */
function openDocs(row) {
  docsTarget.value = row
  docsVisible.value = true
}
/** 概要列：上传=文档数；API/MCP=连通性结论。 */
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
    await ElMessageBox.confirm(
      row.sourceType === 'UPLOAD'
        ? `删除数据源「${row.name}」及其全部文档与切片？此操作不可恢复。`
        : `删除数据源「${row.name}」？此操作不可恢复。`,
      '删除数据源',
      { type: 'warning', confirmButtonText: '删除' }
    )
  } catch (e) {
    return
  }
  try {
    await deleteKnowledgeSource(row.id)
    ElMessage.success('已删除')
    reload()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
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
        :empty-text="keyword || typeFilter ? '暂无符合条件的数据源' : '还没有数据源 · 点「新建数据源」创建第一个'"
        @retry="reload"
      >
        <el-table v-loading="loading" :data="rows" row-key="id">
          <el-table-column label="数据源" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="kb-name">{{ row.name }}</span>
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

          <el-table-column label="状态" :width="COL.STATUS">
            <template #default="{ row }">
              <StatusTag :type="(SOURCE_STATUS_META[row.status] || SOURCE_STATUS_META.ENABLED).type">
                {{ (SOURCE_STATUS_META[row.status] || SOURCE_STATUS_META.ENABLED).label }}
              </StatusTag>
            </template>
          </el-table-column>

          <!-- 被引用：给删除保护一个可见依据 -->
          <el-table-column label="被引用" :min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.referencedBy?.length">{{ row.referencedBy.map((r) => r.name).join('、') }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" :width="opsWidth(3)" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <el-button link type="primary" size="small" @click="openConfig(row)">配置</el-button>
                <el-button v-if="row.sourceType === 'UPLOAD'" link type="primary" size="small" @click="openDocs(row)">文档管理</el-button>
                <el-tooltip
                  :disabled="!row.referencedBy?.length"
                  :content="`正被 ${row.referencedBy?.length || 0} 个知识库引用，先在知识库里移除引用`"
                  placement="top"
                >
                  <span>
                    <el-button link type="danger" size="small" :disabled="!!row.referencedBy?.length" @click="doDelete(row)">删除</el-button>
                  </span>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination :total="total" v-model:page="page" :page-size="pageSize" @change="reload" />

    <KnowledgeSourceEditor v-model:visible="editorVisible" :source-id="editingId" @saved="reload" @changed="reload" />
    <KnowledgeSourceDocsDrawer v-model:visible="docsVisible" :source="docsTarget" @changed="reload" />
  </div>
</template>

<style scoped>
.kb-name {
  color: var(--c-text-strong);
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
