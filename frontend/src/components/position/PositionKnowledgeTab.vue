<script setup>
/**
 * 岗位详情 · 「知识」页签（md §5，2026-09-08 PRD-20260908 对齐）。
 *
 * 页签内只做只读列表（走现有 api/knowledgeBase.js，不改函数签名）：
 * 取岗位知识库（kbType=POSITION）并按可见范围 = 当前岗位名过滤；
 * 工具栏（搜索名称 / 状态 / 查询）照原型 knowledgePane L1871 本地过滤；
 * 行内仅【查看】【检索测试】（md §5.3），无新建 / 编辑入口（md §5.2 已删、原型 L4021 移除按钮），
 * 两动作跳知识库模块（query 携带岗位上下文，md §11）。
 *
 * 2026-09-10 病 A 拆分（docs/调研讨论/2026-09-09-代码冗余治理第二批方案.md 第 5 项）：
 * 自 PositionDetailTabs.vue 原样抽出，DOM 结构 / class / 交互零变更；
 * 懒加载 watch 的目标 activeTab 由父层 provide（页签切换状态归父壳）。
 */
import { ref, computed, watch, inject } from 'vue'
import { useRouter } from 'vue-router'
import { usePositionStore } from '@/stores/position'
import { listKnowledgeBases } from '@/api/knowledgeBase'
import { sourcesText, hasUploadSource, stateMeta as kbStateMeta } from '@/utils/knowledgeBaseMeta'
import { kbRouteLocation } from '@/utils/knowledgeDeepLink'
import KnowledgeSearchDialog from '@/components/admin/KnowledgeSearchDialog.vue'

defineProps({
  // 只读态 prop 与其余页签保持同一接口；本页签本就是只读列表，模板未消费
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()
const router = useRouter()

const kbRows = ref([])
// 工具栏筛选（原型 posKbSearch / posKbStatus / query-pos-kb）：输入即存草稿，点【查询】生效
const kbKeyword = ref('')
const kbStatus = ref('')
const kbApplied = ref({ keyword: '', status: '' })
function applyKbQuery() {
  kbApplied.value = { keyword: kbKeyword.value.trim().toLowerCase(), status: kbStatus.value }
}
const kbVisibleRows = computed(() => {
  const { keyword, status } = kbApplied.value
  return kbRows.value.filter(
    (r) => (!keyword || String(r.name || '').toLowerCase().includes(keyword)) && (!status || kbStateMeta(r).label === status)
  )
})
const kbLoading = ref(false)
const kbError = ref(false)
const kbLoaded = ref(false)
async function loadPositionKbs() {
  kbLoading.value = true
  kbError.value = false
  try {
    const data = await listKnowledgeBases({ kbType: 'POSITION', page: 1, size: 200 })
    const list = Array.isArray(data) ? data : data?.list || []
    const posName = String(store.basic?.name || '').trim()
    kbRows.value = list.filter((r) => (r.scopeRefName || '') === posName)
    kbLoaded.value = true
  } catch {
    kbError.value = true
  } finally {
    kbLoading.value = false
  }
}
// 首次切到「知识」页签时懒加载。immediate：深链直接落在知识页签（?tab=knowledge，如列表页跳转带页签）时，
// activeTab 初值就已是 knowledge、不会再触发变更回调，此前会渲染成空列表（2026-09-09 PRD 复核·G1 顺手修）。
// activeTab 由父层 provide（拆分前为同文件闭包引用）。
const activeTab = inject('pdActiveTab', ref(''))
watch(activeTab, (tab) => {
  if (tab === 'knowledge' && !kbLoaded.value && !kbLoading.value) loadPositionKbs()
}, { immediate: true })
// 知识库三态标签：2026-09-09 冗余治理批 2-1 收编——本地复制品删除，改用 utils/knowledgeBaseMeta
// 的 stateMeta(row)（pendingAction 在途→审核中；PUBLISHED→已发布；DRAFT→未发布，输出逐字相同）
// 「数据源」列汇总（上传 ×N / API ×N / MCP ×N）与「文档数量」口径同知识库列表页 / 专家抽屉
const kbSourcesText = (row) => sourcesText(row) || '-'
const kbDocText = (row) => (hasUploadSource(row) ? Number(row.docCount || 0).toLocaleString('en-US') : '-')
// 跳知识库模块：query 携带岗位上下文（positionId/positionName）+ 深链动作（action/kbId），
// 键名与消费端 KnowledgeBaseList 同源于 utils/knowledgeDeepLink（2026-09-08 原型复刻批次 1 · C-H2：
// 此前发 kbAction/fromPositionId 与消费端 action/positionId 不对齐，跳过去抽屉不开、岗位上下文不生效，已修）。
/* 【检索测试】（md §5.3 / Q455，2026-09-09 PRD 复核 A19）：在当前页面直接打开检索测试弹窗、不跳模块。
 * 全平台各入口（知识库列表行内、专家抽屉知识库卡、此处）共用同一个 KnowledgeSearchDialog 组件。
 * 注意仅【检索测试】改原地弹窗，【查看】按 md §5.3 仍跳知识库模块（gotoKbModule('view')）。 */
const kbSearchVisible = ref(false)
const kbSearchRow = ref(null)
function openKbSearch(row) {
  kbSearchRow.value = row
  kbSearchVisible.value = true
}

function gotoKbModule(action, row) {
  router.push(
    kbRouteLocation({
      action,
      kbId: row?.id,
      positionId: store.positionId,
      positionName: store.basic?.name || ''
    })
  )
}
</script>

<template>
  <div class="pd-pane">
    <!-- 区块头照原型 pdHead('知识库','该岗位可见范围内的知识库')；新建按钮已删（md §5.2 / 原型 L4021） -->
    <div class="pd-list-head">
      <div class="pd-list-title">知识库<span class="pd-list-sub">该岗位可见范围内的知识库</span></div>
    </div>
    <!-- 工具栏照原型 pd2-kb-toolbar：搜索知识库名称 / 全部状态 / 查询 -->
    <div class="pd-kb-toolbar">
      <el-input v-model="kbKeyword" placeholder="搜索知识库名称" clearable class="pd-kb-search" @keyup.enter="applyKbQuery" />
      <el-select v-model="kbStatus" placeholder="全部状态" clearable class="pd-kb-status">
        <el-option label="未发布" value="未发布" />
        <el-option label="审核中" value="审核中" />
        <el-option label="已发布" value="已发布" />
      </el-select>
      <el-button @click="applyKbQuery">查询</el-button>
    </div>
    <div v-if="kbError" class="pd-empty">
      知识库加载失败
      <el-button link type="primary" @click="loadPositionKbs">重试</el-button>
    </div>
    <!-- 列照 md §5.1 / 原型 L1871：知识库名称 / 描述 / 数据源 / 文档数量 / 状态 / 操作；空态照原型 -->
    <el-table
      v-else
      v-loading="kbLoading"
      :data="kbVisibleRows"
      class="pd-table"
      empty-text="暂无该岗位可见的知识库"
    >
      <el-table-column label="知识库名称" min-width="200">
        <template #default="{ row }">
          <span class="pd-kb-name" :title="row.description || ''">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column label="知识库描述" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.description || '-' }}</template>
      </el-table-column>
      <el-table-column label="数据源" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ kbSourcesText(row) }}</template>
      </el-table-column>
      <el-table-column label="文档数量" width="90" align="right">
        <template #default="{ row }">{{ kbDocText(row) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="kbStateMeta(row).type" effect="plain">{{ kbStateMeta(row).label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="gotoKbModule('view', row)">查看</el-button>
          <el-button
            v-if="row.status === 'PUBLISHED'"
            link
            type="primary"
            @click="openKbSearch(row)"
          >
            检索测试
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- 检索测试弹窗（md §5.3 / Q455）：知识页签行内【检索测试】原地打开，全平台同一个独立弹窗 -->
  <KnowledgeSearchDialog v-model:visible="kbSearchVisible" :kb="kbSearchRow" />
</template>

<style scoped>
/* 样式随模板自 PositionDetailTabs.vue 原样搬入（病 A 拆分）。
   .pd-list-head / .pd-table / .pd-empty 为全局 assets/position-detail.css 提供。 */
/* 常规内容页：照原型 pd2-pane 居中限宽（max-width 1180px），卡片纵向排布 */
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
/* 知识页签：知识库名称 */
.pd-kb-name {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
/* 知识页签工具栏（原型 pd2-kb-toolbar：搜索 220 / 状态 130 / 查询，gap 12） */
.pd-kb-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.pd-kb-search {
  width: 220px;
}
.pd-kb-status {
  width: 130px;
}
</style>
