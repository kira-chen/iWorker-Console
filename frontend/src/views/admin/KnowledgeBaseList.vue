<script setup>
/**
 * 知识库管理子页（AdminKnowledgeBase 容器 ?tab=kb）。
 * 设计：docs/frontend/交互设计-知识库管理.md §2；骨架走规范 §7（页头收口在容器）。
 *
 * 【列】知识库 / 类型 / 数据源（引用连排）/ 文档（仅上传类引用）/ 可见范围 / 状态 / 操作（配置 · 检索测试）。
 * 【状态】三态对齐模型页 V98：未发布 / 审核中 / 已发布（pendingAction 优先判定）。
 */
import { ref, onMounted, onActivated } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import KnowledgeBaseEditor from '@/components/admin/KnowledgeBaseEditor.vue'
import KnowledgeSearchDialog from '@/components/admin/KnowledgeSearchDialog.vue'
import { listKnowledgeBases } from '@/api/knowledgeBase'
import { useAdminList } from '@/composables/useAdminList'
import { COL, opsWidth } from '@/utils/tableLayout'
import {
  KB_TYPE_OPTIONS,
  KB_TYPE_LABELS,
  STATUS_OPTIONS,
  stateMeta,
  scopeText,
  sourcesText,
  hasUploadSource
} from '@/utils/knowledgeBaseMeta'

const keyword = ref('')
const typeFilter = ref('')
const statusFilter = ref('')

const list = useAdminList(listKnowledgeBases, {
  params: () => ({ keyword: keyword.value.trim(), kbType: typeFilter.value, status: statusFilter.value })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty, reload, search } = list

const editorVisible = ref(false)
const editingId = ref(null)
const searchVisible = ref(false)
const searchTarget = ref(null)

function openCreate() {
  editingId.value = null
  editorVisible.value = true
}
function openConfig(row) {
  editingId.value = row.id
  editorVisible.value = true
}
function openSearch(row) {
  searchTarget.value = row
  searchVisible.value = true
}
function fmtCount(n) {
  return Number(n || 0).toLocaleString('en-US')
}

onMounted(reload)
// 数据源子页里改了名称 / 启停会影响本页展示，切回时刷新
onActivated(reload)
</script>

<template>
  <div class="list-page">
    <ListToolbar>
      <el-input
        v-model="keyword"
        placeholder="搜索知识库名"
        clearable
        class="lt-search"
        @keyup.enter="search"
        @clear="search"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="typeFilter" placeholder="全部类型" clearable class="lt-filter" @change="search">
        <el-option v-for="o in KB_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="statusFilter" placeholder="全部状态" clearable class="lt-filter" @change="search">
        <el-option v-for="o in STATUS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="search">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建知识库
        </el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        :empty-text="keyword || typeFilter || statusFilter ? '暂无符合条件的知识库' : '还没有知识库 · 点「新建知识库」创建第一个'"
        @retry="reload"
      >
        <el-table v-loading="loading" :data="rows" row-key="id">
          <el-table-column label="知识库" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="kb-name">{{ row.name }}</span>
            </template>
          </el-table-column>

          <el-table-column label="类型" :width="COL.TAG">
            <template #default="{ row }">
              <el-tag size="small" type="info" effect="plain">{{ KB_TYPE_LABELS[row.kbType] || row.kbType }}</el-tag>
            </template>
          </el-table-column>

          <!-- 数据源：引用的启用中数据源按「上传 · API · MCP」固定顺序连排，同类多份带 ×N -->
          <el-table-column label="数据源" :width="140">
            <template #default="{ row }">
              <span v-if="sourcesText(row)">{{ sourcesText(row) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!-- 文档数只对引用了上传类数据源的库有意义 -->
          <el-table-column label="文档" :width="COL.COUNT" align="center">
            <template #default="{ row }">
              <span v-if="hasUploadSource(row)" class="kb-num">{{ fmtCount(row.docCount) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <el-table-column label="可见范围" :min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ scopeText(row) }}</template>
          </el-table-column>

          <el-table-column label="状态" :width="COL.STATUS">
            <template #default="{ row }">
              <StatusTag :type="stateMeta(row).type">{{ stateMeta(row).label }}</StatusTag>
            </template>
          </el-table-column>

          <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <el-button link type="primary" size="small" @click="openConfig(row)">配置</el-button>
                <el-button link type="primary" size="small" @click="openSearch(row)">检索测试</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination :total="total" v-model:page="page" :page-size="pageSize" @change="reload" />

    <KnowledgeBaseEditor v-model:visible="editorVisible" :kb-id="editingId" @saved="reload" @changed="reload" />
    <KnowledgeSearchDialog v-model:visible="searchVisible" :kb="searchTarget" />
  </div>
</template>

<style scoped>
.kb-name {
  color: var(--c-text-strong);
}
.kb-num {
  font-variant-numeric: tabular-nums;
}
</style>
