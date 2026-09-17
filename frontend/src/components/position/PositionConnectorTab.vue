<script setup>
/**
 * 岗位详情 · 「连接器」页签
 *
 * 展示该岗位引用的 MCP / API / 业务系统连接器，分三个子区列出。
 * - 可新增连接器：引用已发布的岗位私有 MCP、API 和业务系统（引用弹窗）。
 * - 列表「查看」按钮：复用各连接器的编辑器组件，只读模式打开。
 * - 只读态（isReadonly=true）：隐藏「＋ 新增连接器」入口。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import { listMcp } from '@/api/admin'
import { listApis } from '@/api/apiConnector'
import { listBizSystems } from '@/api/admin'
import { NA } from '@/utils/tableLayout'
import McpEditor from '@/components/admin/McpEditor.vue'
import ApiEditor from '@/components/admin/ApiEditor.vue'
import BizSystemEditor from '@/components/admin/BizSystemEditor.vue'

const props = defineProps({
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()

/* -------- 全量已发布连接器（用于列表展示 + 引用弹窗过滤） -------- */
const allMcps = ref([])
const allApis = ref([])
const allBizs = ref([])
const loading = ref(false)

async function loadAll() {
  loading.value = true
  try {
    const [mcpRes, apiRes, bizRes] = await Promise.all([
      listMcp({ state: 'PUBLISHED' }),
      listApis({ status: 'PUBLISHED' }),
      listBizSystems({ status: 'PUBLISHED' })
    ])
    allMcps.value = mcpRes?.list || []
    allApis.value = apiRes?.list || []
    allBizs.value = bizRes?.list || []
  } catch (e) {
    ElMessage.error(e?.message || '加载连接器失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)

/* -------- 当前岗位引用的连接器（按 store 中 ID 筛选） -------- */
const referencedMcps = computed(() => {
  const ids = store.basic?.mcpIds || []
  return allMcps.value.filter((m) => ids.includes(m.id))
})
const referencedApis = computed(() => {
  const ids = store.basic?.apiIds || []
  return allApis.value.filter((a) => ids.includes(a.id))
})
const referencedBizs = computed(() => {
  const ids = store.basic?.businessSystemIds || []
  return allBizs.value.filter((b) => ids.includes(b.id))
})

/* -------- 查看抽屉 -------- */
const viewMcpId = ref(null)
const viewMcpVisible = ref(false)
const viewApiId = ref(null)
const viewApiVisible = ref(false)
const viewBizId = ref(null)
const viewBizVisible = ref(false)

/* -------- 新增连接器引用弹窗 -------- */
const refDialogVisible = ref(false)
const refActiveType = ref('mcp') // 'mcp' | 'api' | 'biz'
const refKeyword = ref('')
const selectedMcpIds = ref([])
const selectedApiIds = ref([])
const selectedBizIds = ref([])

function openRefDialog() {
  refActiveType.value = 'mcp'
  refKeyword.value = ''
  selectedMcpIds.value = []
  selectedApiIds.value = []
  selectedBizIds.value = []
  refDialogVisible.value = true
}

// 弹窗各子区可选项：已发布且未被当前岗位引用
const availableMcps = computed(() => {
  const current = new Set(store.basic?.mcpIds || [])
  const kw = refKeyword.value.trim().toLowerCase()
  return allMcps.value.filter(
    (m) => !current.has(m.id) && (!kw || m.name.toLowerCase().includes(kw))
  )
})
const availableApis = computed(() => {
  const current = new Set(store.basic?.apiIds || [])
  const kw = refKeyword.value.trim().toLowerCase()
  return allApis.value.filter(
    (a) => !current.has(a.id) && (!kw || a.name.toLowerCase().includes(kw))
  )
})
const availableBizs = computed(() => {
  const current = new Set(store.basic?.businessSystemIds || [])
  const kw = refKeyword.value.trim().toLowerCase()
  return allBizs.value.filter(
    (b) => !current.has(b.id) && (!kw || b.name.toLowerCase().includes(kw))
  )
})

function confirmRef() {
  const hasMcp = selectedMcpIds.value.length
  const hasApi = selectedApiIds.value.length
  const hasBiz = selectedBizIds.value.length
  if (!hasMcp && !hasApi && !hasBiz) {
    ElMessage.warning('请勾选要引用的连接器')
    return
  }
  if (hasMcp) {
    store.basic = {
      ...store.basic,
      mcpIds: [...(store.basic?.mcpIds || []), ...selectedMcpIds.value]
    }
  }
  if (hasApi) {
    store.basic = {
      ...store.basic,
      apiIds: [...(store.basic?.apiIds || []), ...selectedApiIds.value]
    }
  }
  if (hasBiz) {
    store.basic = {
      ...store.basic,
      businessSystemIds: [...(store.basic?.businessSystemIds || []), ...selectedBizIds.value]
    }
  }
  refDialogVisible.value = false
  ElMessage.success('引用成功')
}

/* -------- 工具函数 -------- */
function formatTime(t) {
  if (!t) return NA
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div v-loading="loading" class="pd-pane">

    <!-- 区块头 -->
    <div class="pct-head">
      <div class="pct-title">连接器<span class="pct-sub">该岗位引用的 MCP、API 与业务系统连接器</span></div>
      <el-button v-if="!isReadonly" type="primary" @click="openRefDialog">＋ 新增连接器</el-button>
    </div>

    <!-- MCP 子区 -->
    <section class="pct-section">
      <div class="pct-section-head">
        <span class="pct-section-title">MCP</span>
        <span class="pct-section-sub">岗位私有 MCP 连接器</span>
      </div>
      <el-table :data="referencedMcps" class="pct-table" empty-text="暂无引用的 MCP 连接器">
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }">
            <div class="pct-name-cell">
              <span class="pct-icon">{{ row.icon }}</span>
              <span class="pct-name">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="描述" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description || NA }}</template>
        </el-table-column>
        <el-table-column label="工具数" width="90" align="center">
          <template #default="{ row }">{{ row.toolCount ?? (row.tools?.length ?? 0) }}</template>
        </el-table-column>
        <el-table-column label="最近更新时间" width="160">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewMcpId = row.id; viewMcpVisible = true">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- API 子区 -->
    <section class="pct-section">
      <div class="pct-section-head">
        <span class="pct-section-title">API</span>
        <span class="pct-section-sub">岗位私有 API 连接器</span>
      </div>
      <el-table :data="referencedApis" class="pct-table" empty-text="暂无引用的 API 连接器">
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }">
            <div class="pct-name-cell">
              <span class="pct-icon">{{ row.icon }}</span>
              <span class="pct-name">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="描述" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description || NA }}</template>
        </el-table-column>
        <el-table-column label="请求方式" width="100" align="center">
          <template #default="{ row }">{{ row.method || NA }}</template>
        </el-table-column>
        <el-table-column label="最近更新时间" width="160">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewApiId = row.id; viewApiVisible = true">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 业务系统子区 -->
    <section class="pct-section">
      <div class="pct-section-head">
        <span class="pct-section-title">业务系统</span>
        <span class="pct-section-sub">岗位私有业务系统连接器</span>
      </div>
      <el-table :data="referencedBizs" class="pct-table" empty-text="暂无引用的业务系统连接器">
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }">
            <div class="pct-name-cell">
              <span class="pct-icon">{{ row.icon }}</span>
              <span class="pct-name">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="描述" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description || NA }}</template>
        </el-table-column>
        <el-table-column label="业务页" width="90" align="center">
          <template #default="{ row }">{{ row.bizPagesCount ? `${row.bizPagesCount} 个` : NA }}</template>
        </el-table-column>
        <el-table-column label="最近更新时间" width="160">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewBizId = row.id; viewBizVisible = true">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 新增连接器引用弹窗 -->
    <el-dialog
      v-model="refDialogVisible"
      title="新增连接器"
      width="700px"
      :close-on-click-modal="false"
    >
      <div class="ref-dialog-body">
        <el-input
          v-model="refKeyword"
          placeholder="搜索连接器名称"
          clearable
          class="ref-search"
        />

        <el-tabs v-model="refActiveType" class="ref-tabs">
          <!-- MCP 子标签 -->
          <el-tab-pane label="MCP" name="mcp">
            <div class="ref-list">
              <el-checkbox-group v-model="selectedMcpIds">
                <div v-for="item in availableMcps" :key="item.id" class="ref-item">
                  <el-checkbox :label="item.id">
                    <span class="ref-item-icon">{{ item.icon }}</span>
                    <span class="ref-item-name">{{ item.name }}</span>
                  </el-checkbox>
                  <div class="ref-item-desc">{{ item.description }}</div>
                </div>
              </el-checkbox-group>
              <div v-if="!availableMcps.length" class="ref-empty">
                {{ refKeyword ? '未找到匹配的 MCP' : '暂无可引用的 MCP 连接器' }}
              </div>
            </div>
          </el-tab-pane>

          <!-- API 子标签 -->
          <el-tab-pane label="API" name="api">
            <div class="ref-list">
              <el-checkbox-group v-model="selectedApiIds">
                <div v-for="item in availableApis" :key="item.id" class="ref-item">
                  <el-checkbox :label="item.id">
                    <span class="ref-item-icon">{{ item.icon }}</span>
                    <span class="ref-item-name">{{ item.name }}</span>
                  </el-checkbox>
                  <div class="ref-item-desc">{{ item.description }}</div>
                </div>
              </el-checkbox-group>
              <div v-if="!availableApis.length" class="ref-empty">
                {{ refKeyword ? '未找到匹配的 API' : '暂无可引用的 API 连接器' }}
              </div>
            </div>
          </el-tab-pane>

          <!-- 业务系统子标签 -->
          <el-tab-pane label="业务系统" name="biz">
            <div class="ref-list">
              <el-checkbox-group v-model="selectedBizIds">
                <div v-for="item in availableBizs" :key="item.id" class="ref-item">
                  <el-checkbox :label="item.id">
                    <span class="ref-item-icon">{{ item.icon }}</span>
                    <span class="ref-item-name">{{ item.name }}</span>
                  </el-checkbox>
                  <div class="ref-item-desc">{{ item.description }}</div>
                </div>
              </el-checkbox-group>
              <div v-if="!availableBizs.length" class="ref-empty">
                {{ refKeyword ? '未找到匹配的业务系统' : '暂无可引用的业务系统连接器' }}
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>

      <template #footer>
        <el-button @click="refDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmRef">确认引用</el-button>
      </template>
    </el-dialog>

    <!-- 查看抽屉（各连接器只读模式） -->
    <McpEditor v-model:visible="viewMcpVisible" :mcp-id="viewMcpId" :readonly="true" />
    <ApiEditor v-model:visible="viewApiVisible" :api-id="viewApiId" :readonly="true" />
    <BizSystemEditor v-model:visible="viewBizVisible" :editing-id="viewBizId" :readonly="true" />
  </div>
</template>

<style scoped>
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.pct-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.pct-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.pct-sub {
  font-size: var(--fs-sm);
  font-weight: var(--fw-regular);
  color: var(--c-text-muted);
}

.pct-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.pct-section-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.pct-section-title {
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}

.pct-section-sub {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.pct-table {
  background: var(--bg-base);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.pct-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.pct-icon {
  font-size: 18px;
  line-height: 1;
}

.pct-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}

/* 引用弹窗 */
.ref-dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ref-search {
  width: 100%;
}

.ref-tabs :deep(.el-tabs__content) {
  padding-top: var(--space-2);
}

.ref-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
}

.ref-item {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-soft);
}

.ref-item:last-child {
  border-bottom: none;
}

.ref-item :deep(.el-checkbox) {
  width: 100%;
  align-items: flex-start;
}

.ref-item :deep(.el-checkbox__label) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: var(--fw-medium);
}

.ref-item-icon {
  font-size: 16px;
}

.ref-item-name {
  color: var(--c-text-strong);
}

.ref-item-desc {
  margin-left: 24px;
  margin-top: var(--space-1);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: 1.5;
}

.ref-empty {
  text-align: center;
  padding: var(--space-6) 0;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
</style>
