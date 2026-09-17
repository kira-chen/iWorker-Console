<script setup>
/**
 * 岗位详情 · 「连接器」页签
 *
 * 三个区域：岗位私有 MCP / 岗位私有 API / 岗位私有业务系统
 * 列表样式与连接器管理页（AdminMcp / AdminApis）保持一致，只展示字段不同。
 *
 * MCP     — 名称+描述 / 工具数 / 最近更新时间 / 操作（查看·移除）
 * API     — 名称+描述 / 请求方式 / 最近更新时间 / 操作
 * 业务系统 — 名称+描述 / 登录地址 / 最近更新时间 / 操作
 */
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import { listMcp } from '@/api/admin'
import { listApis } from '@/api/apiConnector'
import { listBizSystems } from '@/api/admin'
import { fmtTime } from '@/utils/docMeta'
import { COL, opsWidth } from '@/utils/tableLayout'
import { iconIsUrl } from '@/utils/iconDisplay'
import ListStates from '@/components/admin/ListStates.vue'
import McpEditor from '@/components/admin/McpEditor.vue'
import ApiEditor from '@/components/admin/ApiEditor.vue'
import BizSystemEditor from '@/components/admin/BizSystemEditor.vue'

const props = defineProps({
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()

// ══════════════════════════════════════════════════════════════
// § 1  私有 MCP
// ══════════════════════════════════════════════════════════════
const mcpAll = ref([])
const mcpBound = ref([])
const mcpLoading = ref(false)
const mcpError = ref(false)
const mcpSort = ref('desc')

const mcpSorted = computed(() => {
  return [...mcpBound.value].sort((a, b) => {
    const ta = a.updatedAt || ''
    const tb = b.updatedAt || ''
    return mcpSort.value === 'desc' ? tb.localeCompare(ta) : ta.localeCompare(tb)
  })
})
const mcpSortArrow = computed(() => mcpSort.value === 'desc' ? '↓' : '↑')
function toggleMcpSort() { mcpSort.value = mcpSort.value === 'desc' ? 'asc' : 'desc' }

const mcpViewVisible = ref(false)
const mcpViewId = ref(null)
function viewMcp(row) { mcpViewId.value = row.id; mcpViewVisible.value = true }

const mcpDialogVisible = ref(false)
const mcpDialogKeyword = ref('')
const mcpDialogSelected = ref([])

const mcpAvailable = computed(() => {
  const ids = store.basic?.connectorMcpIds || []
  const kw = mcpDialogKeyword.value.trim().toLowerCase()
  return mcpAll.value.filter(m =>
    !ids.includes(m.id) && (!kw || (m.name || '').toLowerCase().includes(kw))
  )
})

async function loadMcpBound() {
  const ids = store.basic?.connectorMcpIds || []
  if (!ids.length) { mcpBound.value = []; return }
  mcpLoading.value = true
  mcpError.value = false
  try {
    const data = await listMcp({})
    const all = Array.isArray(data) ? data : data?.list || []
    mcpBound.value = all.filter(m => ids.includes(m.id))
  } catch (e) {
    mcpError.value = true
    ElMessage.error(e?.message || '加载 MCP 失败')
  } finally {
    mcpLoading.value = false
  }
}

async function openMcpDialog() {
  if (props.isReadonly) return
  mcpDialogKeyword.value = ''
  mcpDialogSelected.value = []
  mcpDialogVisible.value = true
  try {
    const data = await listMcp({})
    mcpAll.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    ElMessage.error(e?.message || '加载 MCP 失败')
  }
}

function confirmMcp() {
  if (!mcpDialogSelected.value.length) { ElMessage.warning('请选择要绑定的 MCP'); return }
  const current = store.basic?.connectorMcpIds || []
  store.basic = { ...store.basic, connectorMcpIds: [...current, ...mcpDialogSelected.value] }
  mcpDialogVisible.value = false
  loadMcpBound()
  ElMessage.success('绑定成功')
}

async function removeMcp(row) {
  try {
    await ElMessageBox.confirm(`确定移除「${row.name}」与该岗位的绑定关系？`, '移除连接器', {
      type: 'warning', confirmButtonText: '确定移除', cancelButtonText: '取消'
    })
  } catch { return }
  store.basic = { ...store.basic, connectorMcpIds: (store.basic?.connectorMcpIds || []).filter(id => id !== row.id) }
  loadMcpBound()
  ElMessage.success('已移除')
}

// ══════════════════════════════════════════════════════════════
// § 2  私有 API
// ══════════════════════════════════════════════════════════════
const apiAll = ref([])
const apiBound = ref([])
const apiLoading = ref(false)
const apiError = ref(false)
const apiSort = ref('desc')

const apiSorted = computed(() => {
  return [...apiBound.value].sort((a, b) => {
    const ta = a.updatedAt || ''
    const tb = b.updatedAt || ''
    return apiSort.value === 'desc' ? tb.localeCompare(ta) : ta.localeCompare(tb)
  })
})
const apiSortArrow = computed(() => apiSort.value === 'desc' ? '↓' : '↑')
function toggleApiSort() { apiSort.value = apiSort.value === 'desc' ? 'asc' : 'desc' }

const apiViewVisible = ref(false)
const apiViewId = ref(null)
function viewApi(row) { apiViewId.value = row.id; apiViewVisible.value = true }

const apiDialogVisible = ref(false)
const apiDialogKeyword = ref('')
const apiDialogSelected = ref([])

const apiAvailable = computed(() => {
  const ids = store.basic?.connectorApiIds || []
  const kw = apiDialogKeyword.value.trim().toLowerCase()
  return apiAll.value.filter(a =>
    !ids.includes(a.id) && (!kw || (a.name || '').toLowerCase().includes(kw))
  )
})

async function loadApiBound() {
  const ids = store.basic?.connectorApiIds || []
  if (!ids.length) { apiBound.value = []; return }
  apiLoading.value = true
  apiError.value = false
  try {
    const data = await listApis({})
    const all = Array.isArray(data) ? data : data?.list || []
    apiBound.value = all.filter(a => ids.includes(a.id))
  } catch (e) {
    apiError.value = true
    ElMessage.error(e?.message || '加载 API 失败')
  } finally {
    apiLoading.value = false
  }
}

async function openApiDialog() {
  if (props.isReadonly) return
  apiDialogKeyword.value = ''
  apiDialogSelected.value = []
  apiDialogVisible.value = true
  try {
    const data = await listApis({})
    apiAll.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    ElMessage.error(e?.message || '加载 API 失败')
  }
}

function confirmApi() {
  if (!apiDialogSelected.value.length) { ElMessage.warning('请选择要绑定的 API'); return }
  const current = store.basic?.connectorApiIds || []
  store.basic = { ...store.basic, connectorApiIds: [...current, ...apiDialogSelected.value] }
  apiDialogVisible.value = false
  loadApiBound()
  ElMessage.success('绑定成功')
}

async function removeApi(row) {
  try {
    await ElMessageBox.confirm(`确定移除「${row.name}」与该岗位的绑定关系？`, '移除连接器', {
      type: 'warning', confirmButtonText: '确定移除', cancelButtonText: '取消'
    })
  } catch { return }
  store.basic = { ...store.basic, connectorApiIds: (store.basic?.connectorApiIds || []).filter(id => id !== row.id) }
  loadApiBound()
  ElMessage.success('已移除')
}

// ══════════════════════════════════════════════════════════════
// § 3  业务系统
// ══════════════════════════════════════════════════════════════
const bizAll = ref([])
const bizBound = ref([])
const bizLoading = ref(false)
const bizError = ref(false)
const bizSort = ref('desc')

const bizSorted = computed(() => {
  return [...bizBound.value].sort((a, b) => {
    const ta = a.updatedAt || ''
    const tb = b.updatedAt || ''
    return bizSort.value === 'desc' ? tb.localeCompare(ta) : ta.localeCompare(tb)
  })
})
const bizSortArrow = computed(() => bizSort.value === 'desc' ? '↓' : '↑')
function toggleBizSort() { bizSort.value = bizSort.value === 'desc' ? 'asc' : 'desc' }

const bizViewVisible = ref(false)
const bizViewId = ref(null)
function viewBiz(row) { bizViewId.value = row.id; bizViewVisible.value = true }

const bizDialogVisible = ref(false)
const bizDialogKeyword = ref('')
const bizDialogSelected = ref([])

const bizAvailable = computed(() => {
  const ids = store.basic?.businessSystemIds || []
  const kw = bizDialogKeyword.value.trim().toLowerCase()
  return bizAll.value.filter(b =>
    !ids.includes(b.id) && (!kw || (b.name || '').toLowerCase().includes(kw))
  )
})

async function loadBizBound() {
  const ids = store.basic?.businessSystemIds || []
  if (!ids.length) { bizBound.value = []; return }
  bizLoading.value = true
  bizError.value = false
  try {
    const data = await listBizSystems({})
    const all = Array.isArray(data) ? data : data?.list || []
    bizBound.value = all.filter(b => ids.includes(b.id))
  } catch (e) {
    bizError.value = true
    ElMessage.error(e?.message || '加载业务系统失败')
  } finally {
    bizLoading.value = false
  }
}

async function openBizDialog() {
  if (props.isReadonly) return
  bizDialogKeyword.value = ''
  bizDialogSelected.value = []
  bizDialogVisible.value = true
  try {
    const data = await listBizSystems({})
    bizAll.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    ElMessage.error(e?.message || '加载业务系统失败')
  }
}

function confirmBiz() {
  if (!bizDialogSelected.value.length) { ElMessage.warning('请选择要绑定的业务系统'); return }
  const current = store.basic?.businessSystemIds || []
  store.basic = { ...store.basic, businessSystemIds: [...current, ...bizDialogSelected.value] }
  bizDialogVisible.value = false
  loadBizBound()
  ElMessage.success('绑定成功')
}

async function removeBiz(row) {
  try {
    await ElMessageBox.confirm(`确定移除「${row.name}」与该岗位的绑定关系？`, '移除连接器', {
      type: 'warning', confirmButtonText: '确定移除', cancelButtonText: '取消'
    })
  } catch { return }
  store.basic = { ...store.basic, businessSystemIds: (store.basic?.businessSystemIds || []).filter(id => id !== row.id) }
  loadBizBound()
  ElMessage.success('已移除')
}

// ── 初始加载 ──────────────────────────────────────────────────
loadMcpBound()
loadApiBound()
loadBizBound()
</script>

<template>
  <div class="pd-pane">

    <!-- ══ 区域一：岗位私有 MCP ══════════════════════════════ -->
    <section class="conn-section">
      <div class="section-head">
        <div class="section-title">岗位私有 MCP</div>
        <span class="section-sub">展示绑定该岗位专属的 MCP 连接器</span>
        <span class="section-sp" />
        <el-button v-if="!isReadonly" type="primary" size="small" @click="openMcpDialog">＋ 新增</el-button>
      </div>

      <div class="table-wrap conn-table-wrap">
        <ListStates
          :loading="mcpLoading"
          :error="mcpError"
          :empty="!mcpLoading && !mcpError && !mcpBound.length"
          empty-text="暂无绑定的私有 MCP"
          @retry="loadMcpBound"
        >
          <el-table v-loading="mcpLoading" :data="mcpSorted" row-key="id">
            <el-table-column label="名称" :min-width="160">
              <template #default="{ row }">
                <div class="mc-name-cell">
                  <span v-if="row.icon" class="mc-icon">
                    <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="mc-icon-img" />
                    <span v-else>{{ row.icon }}</span>
                  </span>
                  <span class="mc-name">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="描述" :min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mc-desc">{{ row.description || '—' }}</span>
              </template>
            </el-table-column>

            <el-table-column label="工具数" :width="COL.COUNT" align="center" class-name="col-nowrap" label-class-name="col-nowrap">
              <template #default="{ row }">
                <span v-if="row.tools?.length || row.toolCount">{{ row.tools?.length ?? row.toolCount }}</span>
                <span v-else class="cell-na">—</span>
              </template>
            </el-table-column>

            <el-table-column :width="COL.TIME + 24" class-name="col-nowrap" label-class-name="col-nowrap">
              <template #header>
                <button type="button" class="time-sort" @click="toggleMcpSort">
                  最近更新时间 <span class="time-sort-arrow">{{ mcpSortArrow }}</span>
                </button>
              </template>
              <template #default="{ row }">
                <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
                <span v-else class="cell-na">—</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
              <template #default="{ row }">
                <div class="tbl-ops">
                  <el-button link type="primary" @click="viewMcp(row)">查看</el-button>
                  <el-button v-if="!isReadonly" link type="danger" @click="removeMcp(row)">移除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </ListStates>
      </div>
    </section>

    <!-- ══ 区域二：岗位私有 API ══════════════════════════════ -->
    <section class="conn-section">
      <div class="section-head">
        <div class="section-title">岗位私有 API</div>
        <span class="section-sub">展示绑定该岗位专属的 API 连接器</span>
        <span class="section-sp" />
        <el-button v-if="!isReadonly" type="primary" size="small" @click="openApiDialog">＋ 新增</el-button>
      </div>

      <div class="table-wrap conn-table-wrap">
        <ListStates
          :loading="apiLoading"
          :error="apiError"
          :empty="!apiLoading && !apiError && !apiBound.length"
          empty-text="暂无绑定的私有 API"
          @retry="loadApiBound"
        >
          <el-table v-loading="apiLoading" :data="apiSorted" row-key="id">
            <el-table-column label="名称" :min-width="160">
              <template #default="{ row }">
                <div class="mc-name-cell">
                  <span v-if="row.icon" class="mc-icon">
                    <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="mc-icon-img" />
                    <span v-else>{{ row.icon }}</span>
                  </span>
                  <span class="mc-name">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="描述" :min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mc-desc">{{ row.description || '—' }}</span>
              </template>
            </el-table-column>

            <el-table-column label="请求方式" :width="COL.TAG" align="center" class-name="col-nowrap" label-class-name="col-nowrap">
              <template #default="{ row }">
                <el-tag size="small" type="info" effect="plain">{{ row.method || '—' }}</el-tag>
              </template>
            </el-table-column>

            <el-table-column :width="COL.TIME + 24" class-name="col-nowrap" label-class-name="col-nowrap">
              <template #header>
                <button type="button" class="time-sort" @click="toggleApiSort">
                  最近更新时间 <span class="time-sort-arrow">{{ apiSortArrow }}</span>
                </button>
              </template>
              <template #default="{ row }">
                <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
                <span v-else class="cell-na">—</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
              <template #default="{ row }">
                <div class="tbl-ops">
                  <el-button link type="primary" @click="viewApi(row)">查看</el-button>
                  <el-button v-if="!isReadonly" link type="danger" @click="removeApi(row)">移除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </ListStates>
      </div>
    </section>

    <!-- ══ 区域三：岗位私有业务系统 ══════════════════════════ -->
    <section class="conn-section">
      <div class="section-head">
        <div class="section-title">岗位私有业务系统</div>
        <span class="section-sub">展示绑定该岗位专属的业务系统</span>
        <span class="section-sp" />
        <el-button v-if="!isReadonly" type="primary" size="small" @click="openBizDialog">＋ 新增</el-button>
      </div>

      <div class="table-wrap conn-table-wrap">
        <ListStates
          :loading="bizLoading"
          :error="bizError"
          :empty="!bizLoading && !bizError && !bizBound.length"
          empty-text="暂无绑定的业务系统"
          @retry="loadBizBound"
        >
          <el-table v-loading="bizLoading" :data="bizSorted" row-key="id">
            <el-table-column label="名称" :min-width="160">
              <template #default="{ row }">
                <div class="mc-name-cell">
                  <span v-if="row.icon" class="mc-icon">
                    <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="mc-icon-img" />
                    <span v-else>{{ row.icon }}</span>
                  </span>
                  <span class="mc-name">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="描述" :min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mc-desc">{{ row.description || '—' }}</span>
              </template>
            </el-table-column>

            <el-table-column label="登录地址" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <a v-if="row.loginUrl" :href="row.loginUrl" target="_blank" rel="noopener" class="biz-login-url">{{ row.loginUrl }}</a>
                <span v-else class="cell-na">—</span>
              </template>
            </el-table-column>

            <el-table-column :width="COL.TIME + 24" class-name="col-nowrap" label-class-name="col-nowrap">
              <template #header>
                <button type="button" class="time-sort" @click="toggleBizSort">
                  最近更新时间 <span class="time-sort-arrow">{{ bizSortArrow }}</span>
                </button>
              </template>
              <template #default="{ row }">
                <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
                <span v-else class="cell-na">—</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
              <template #default="{ row }">
                <div class="tbl-ops">
                  <el-button link type="primary" @click="viewBiz(row)">查看</el-button>
                  <el-button v-if="!isReadonly" link type="danger" @click="removeBiz(row)">移除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </ListStates>
      </div>
    </section>

    <!-- ══ 绑定弹窗 — MCP ════════════════════════════════════ -->
    <el-dialog v-model="mcpDialogVisible" title="绑定私有 MCP" width="620px" :close-on-click-modal="false">
      <div class="bind-dialog">
        <el-input v-model="mcpDialogKeyword" placeholder="搜索名称" clearable class="bind-search" />
        <div class="bind-list">
          <el-checkbox-group v-model="mcpDialogSelected">
            <div v-for="item in mcpAvailable" :key="item.id" class="bind-item">
              <el-checkbox :label="item.id">
                <span class="bind-icon">{{ item.icon || '⚙' }}</span>
                <span class="bind-name">{{ item.name }}</span>
              </el-checkbox>
              <div class="bind-desc">{{ item.description }}</div>
            </div>
          </el-checkbox-group>
          <div v-if="!mcpAvailable.length" class="bind-empty">
            {{ mcpDialogKeyword ? '未找到匹配的 MCP' : '暂无可绑定的 MCP' }}
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="mcpDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmMcp">确认绑定</el-button>
      </template>
    </el-dialog>

    <!-- ══ 绑定弹窗 — API ════════════════════════════════════ -->
    <el-dialog v-model="apiDialogVisible" title="绑定私有 API" width="620px" :close-on-click-modal="false">
      <div class="bind-dialog">
        <el-input v-model="apiDialogKeyword" placeholder="搜索名称" clearable class="bind-search" />
        <div class="bind-list">
          <el-checkbox-group v-model="apiDialogSelected">
            <div v-for="item in apiAvailable" :key="item.id" class="bind-item">
              <el-checkbox :label="item.id">
                <span class="bind-icon">{{ item.icon || '⚡' }}</span>
                <span class="bind-name">{{ item.name }}</span>
              </el-checkbox>
              <div class="bind-desc">{{ item.description }}</div>
            </div>
          </el-checkbox-group>
          <div v-if="!apiAvailable.length" class="bind-empty">
            {{ apiDialogKeyword ? '未找到匹配的 API' : '暂无可绑定的 API' }}
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="apiDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmApi">确认绑定</el-button>
      </template>
    </el-dialog>

    <!-- ══ 绑定弹窗 — 业务系统 ══════════════════════════════ -->
    <el-dialog v-model="bizDialogVisible" title="绑定业务系统" width="620px" :close-on-click-modal="false">
      <div class="bind-dialog">
        <el-input v-model="bizDialogKeyword" placeholder="搜索名称" clearable class="bind-search" />
        <div class="bind-list">
          <el-checkbox-group v-model="bizDialogSelected">
            <div v-for="item in bizAvailable" :key="item.id" class="bind-item">
              <el-checkbox :label="item.id">
                <span class="bind-icon">{{ item.icon || '🔗' }}</span>
                <span class="bind-name">{{ item.name }}</span>
              </el-checkbox>
              <div class="bind-desc">{{ item.description }}</div>
            </div>
          </el-checkbox-group>
          <div v-if="!bizAvailable.length" class="bind-empty">
            {{ bizDialogKeyword ? '未找到匹配的业务系统' : '暂无可绑定的业务系统' }}
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="bizDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmBiz">确认绑定</el-button>
      </template>
    </el-dialog>

    <!-- ══ 只读详情抽屉 ══════════════════════════════════════ -->
    <McpEditor v-model:visible="mcpViewVisible" :mcp-id="mcpViewId" :readonly="true" />
    <ApiEditor v-model:visible="apiViewVisible" :api-id="apiViewId" :readonly="true" />
    <BizSystemEditor v-model:visible="bizViewVisible" :biz-id="bizViewId" :readonly="true" />

  </div>
</template>

<style scoped>
.pd-pane {
  width: 100%;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

/* ── 区块结构 ─────────────────────────────────────────────── */
.conn-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.section-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  flex-shrink: 0;
}

.section-sub {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
}

.section-sp {
  flex: 1;
}

/* ── 名称列（图标 + 名称，不含描述） ────────────────────────── */
.mc-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.mc-name {
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 登录地址列 */
.biz-login-url {
  color: var(--c-accent);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}
.biz-login-url:hover { text-decoration: underline; }

/* 描述列 */
.mc-desc {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

/* 空态高度：此页上下文不需要原始 340px，缩小到 100px 即可 */
.conn-table-wrap :deep(.ls-empty) {
  height: 100px;
}

/* 图标（对齐 AdminMcp mc-icon 样式） */
.mc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: none;
  font-size: 15px;
  line-height: 1;
  vertical-align: middle;
  border-radius: 5px;
  background: var(--bg-sunken);
  overflow: hidden;
}

.mc-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* ── 时间列排序按钮（对齐 AdminMcp time-sort 样式） ─────────── */
.time-sort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: none;
  color: var(--c-text-base);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: color 0.2s;
}

.time-sort:hover {
  color: var(--c-accent);
}

.time-sort-arrow {
  font-size: 12px;
  color: var(--c-text-base);
  font-weight: var(--fw-medium);
}

/* ── 绑定弹窗 ─────────────────────────────────────────────── */
.bind-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.bind-search { width: 100%; }

.bind-list {
  max-height: 380px;
  overflow-y: auto;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  padding: var(--space-2);
}

.bind-item {
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}

.bind-item:last-child { border-bottom: none; }

.bind-item :deep(.el-checkbox) { width: 100%; }

.bind-item :deep(.el-checkbox__label) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.bind-icon { font-size: 16px; }

.bind-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}

.bind-desc {
  margin-left: 26px;
  margin-top: var(--space-1);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: 1.5;
}

.bind-empty {
  text-align: center;
  padding: var(--space-8) 0;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
</style>
