<script setup>
/**
 * 版本管理页（05 治理，ADMIN 专属）——管理用户端（Windows / Mac）的版本包与更新说明。
 * 依据 docs/PRD/数字员工管理端PRD/05治理/版本管理/prd.版本管理.md。
 *
 * 背景：用户端登录时 / 用户手动点【检测更新】时，会拿自己的「终端 + 当前版本号」来比对本页
 * 「已发布」的版本，有更新就提示升级并展示更新说明（PRD §二，用户端界面不在管理端 Demo 内）。
 *
 * 【页面结构】当前下发概览条 → 查询区 → 版本列表；新建 / 编辑 / 查看走右侧抽屉（VersionEditor）。
 * 【状态与操作】未发布：编辑 / 发布 / 删除；已发布：查看 / 停用；已停用：查看 / 发布（PRD §3.3 对照表）。
 * 【业务规则在 api/versionMock.js】发布顺序（须高于当前已发布版本）、同终端只留一个已发布版本、
 * (终端 + 版本号) 唯一等；本页只负责把确认文案说清楚并展示结果，规则报错原样提示。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import VersionEditor from '@/components/admin/VersionEditor.vue'
import { listVersions, getVersionOverview, publishVersion, stopVersion, deleteVersion } from '@/api/version'
import { confirmDialog } from '@/composables/useConfirm'
import { useAdminList } from '@/composables/useAdminList'
import { COL, COL_NOWRAP, opsWidth } from '@/utils/tableLayout'
import { fmtTime } from '@/utils/docMeta'
import {
  TERMINAL_OPTIONS,
  VERSION_STATUS,
  STATUS_META,
  terminalLabel,
  formatFileSize
} from '@/utils/versionMeta'

const { UNPUBLISHED, PUBLISHED, STOPPED } = VERSION_STATUS

// 排序仅发布时间列，默认倒序；未发布记录由数据层始终置顶（PRD §3.3）
// 关键字入口：访问审计「管理端操作」的【查看】跳过来时带 query.keyword（操作对象名称，如 Windows v1.2.0），
// 与其余列表页同款（首次进入还原到搜索框，之后以搜索框为准）。
const route = useRoute()
const query = reactive({ keyword: String(route?.query?.keyword || ''), terminal: '', status: '', sortDir: 'desc' })

// 取数编排统一走 useAdminList（四态 / 分页 / 竞态防护），本页只描述「取什么」
const list = useAdminList(listVersions, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const reload = list.search

function toggleSort() {
  query.sortDir = query.sortDir === 'desc' ? 'asc' : 'desc'
  reload()
}
const sortArrow = computed(() => (query.sortDir === 'asc' ? '↑' : '↓'))

const hasFilter = computed(() => !!(query.keyword.trim() || query.terminal || query.status))
const emptyText = computed(() =>
  hasFilter.value ? '暂无符合条件的版本' : '暂无版本 · 点击「＋ 新建版本」配置首个版本包'
)

/* ---------------- 当前下发概览条 ---------------- */
const overview = ref({ WINDOWS: null, MAC: null })
const overviewError = ref(false)

async function loadOverview() {
  overviewError.value = false
  try {
    overview.value = await getVersionOverview()
  } catch {
    overviewError.value = true
  }
}

/** 列表与概览条一起刷新（发布 / 停用 / 删除 / 保存之后都会影响两者）。 */
function refresh() {
  list.reload()
  loadOverview()
}

onMounted(() => {
  list.reload()
  loadOverview()
})

/* ---------------- 行操作：按状态唯一决定 ---------------- */
function rowActions(row) {
  if (row.status === UNPUBLISHED) {
    return [
      { key: 'edit', label: '编辑', type: 'primary' },
      { key: 'publish', label: '发布', type: 'success' },
      { key: 'delete', label: '删除', type: 'danger' }
    ]
  }
  if (row.status === PUBLISHED) {
    return [
      { key: 'view', label: '查看', type: 'primary' },
      { key: 'stop', label: '停用', type: 'warning' }
    ]
  }
  return [
    { key: 'view', label: '查看', type: 'primary' },
    { key: 'publish', label: '发布', type: 'success' }
  ]
}

const busy = ref({})
async function withBusy(row, action, fn) {
  busy.value = { ...busy.value, [row.id]: action }
  try {
    await fn()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败，请重试')
  } finally {
    const next = { ...busy.value }
    delete next[row.id]
    busy.value = next
  }
}

async function publish(row) {
  const label = terminalLabel(row.terminal)
  const current = overview.value[row.terminal]
  const tail = current && current.id !== row.id ? `原已发布版本 ${current.version} 将自动变为已停用。` : ''
  const ok = await confirmDialog(
    `发布后，${label} 用户端检测更新时将提示升级到 ${row.version}。${tail}`,
    '发布版本',
    { confirmText: '发布' }
  )
  if (!ok) return
  await withBusy(row, 'publish', async () => {
    await publishVersion(row.id)
    ElMessage.success(`已发布 ${row.version}（${label}）`)
    refresh()
  })
}

async function stop(row) {
  const ok = await confirmDialog(
    `停用后，${terminalLabel(row.terminal)} 用户端将不再收到 ${row.version} 的更新提示，已升级的用户不受影响。停用后该终端暂无下发版本。确认停用？`,
    '停用版本',
    { confirmText: '停用', warning: true }
  )
  if (!ok) return
  await withBusy(row, 'stop', async () => {
    await stopVersion(row.id)
    ElMessage.success(`已停用 ${row.version}`)
    refresh()
  })
}

async function remove(row) {
  const ok = await confirmDialog(
    `删除后版本 ${row.version} 及其版本包将不可恢复。确认删除？`,
    '删除版本',
    { confirmText: '删除', danger: true }
  )
  if (!ok) return
  await withBusy(row, 'delete', async () => {
    await deleteVersion(row.id)
    ElMessage.success('版本已删除')
    refresh()
  })
}

/* ---------------- 新建 / 编辑 / 查看抽屉 ---------------- */
const editorVisible = ref(false)
const editingVersion = ref(null)
const editorReadonly = ref(false)

function openEditor(row, readonly) {
  editingVersion.value = row ? { ...row } : null
  editorReadonly.value = readonly
  editorVisible.value = true
}

function onAction(key, row) {
  if (key === 'edit') openEditor(row, false)
  else if (key === 'view') openEditor(row, true)
  else if (key === 'publish') publish(row)
  else if (key === 'stop') stop(row)
  else if (key === 'delete') remove(row)
}
</script>

<template>
  <div class="list-page">
    <PageHeader
      title="版本管理"
      subtitle="管理用户端（Windows / Mac）的版本包与更新说明，发布后用户端检测更新时将提示升级"
    />

    <!-- 当前下发概览条：一眼看清用户端此刻会被提示升级到哪一版（只读） -->
    <div class="vs-overview">
      <div v-if="overviewError" class="vs-overview-error">
        概览加载失败
        <el-button link type="primary" @click="loadOverview">重试</el-button>
      </div>
      <template v-else>
        <div v-for="t in TERMINAL_OPTIONS" :key="t.value" class="vs-card" :data-terminal="t.value">
          <div class="vs-card-head">
            <StatusTag type="accent">{{ t.label }}</StatusTag>
            <span class="vs-card-label">当前下发版本</span>
          </div>
          <template v-if="overview[t.value]">
            <div class="vs-card-version">{{ overview[t.value].version }}</div>
            <div class="vs-card-meta">发布于 {{ fmtTime(overview[t.value].publishedAt) }}</div>
          </template>
          <div v-else class="vs-card-empty">暂无下发版本</div>
        </div>
      </template>
    </div>

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索版本号 / 更新说明"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.terminal" placeholder="全部终端" clearable class="lt-filter" @change="reload">
        <el-option v-for="t in TERMINAL_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter" @change="reload">
        <el-option v-for="(m, key) in STATUS_META" :key="key" :label="m.label" :value="key" />
      </el-select>
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openEditor(null, false)">＋ 新建版本</el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates :loading="loading" :error="loadError" :empty="isEmpty" :empty-text="emptyText" @retry="list.reload">
        <el-table v-loading="loading" :data="rows" row-key="id">
          <!-- 列宽：合计需在 1440 屏（内容区约 1170px）内不出横向滚动，故版本号 / 终端 / 发布人比通用列宽略收 -->
          <el-table-column label="版本号" :width="100" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }"><span class="vs-version">{{ row.version }}</span></template>
          </el-table-column>

          <el-table-column label="终端" :width="104" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <StatusTag type="accent">{{ terminalLabel(row.terminal) }}</StatusTag>
            </template>
          </el-table-column>

          <el-table-column label="版本包" :min-width="190" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.packageName }} <span class="vs-muted">· {{ formatFileSize(row.packageSize) }}</span>
            </template>
          </el-table-column>

          <!-- 更新说明：最多两行缩略，悬停看全文 -->
          <el-table-column label="更新说明" :min-width="200">
            <template #default="{ row }">
              <div class="vs-notes" :title="row.releaseNotes">{{ row.releaseNotes }}</div>
            </template>
          </el-table-column>

          <el-table-column label="状态" :width="COL.STATUS" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <StatusTag :type="STATUS_META[row.status]?.tagType">{{ STATUS_META[row.status]?.label }}</StatusTag>
            </template>
          </el-table-column>

          <el-table-column :width="COL.TIME" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #header>
              <button type="button" class="time-sort" :title="sortArrow === '↓' ? '倒序' : '正序'" @click="toggleSort">
                发布时间 <span class="time-sort-arrow">{{ sortArrow }}</span>
              </button>
            </template>
            <template #default="{ row }">
              <span v-if="row.publishedAt">{{ fmtTime(row.publishedAt) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!-- 发布人记登录用户名（如 xiaomei），比姓名长，故给 120 并保留悬停看全 -->
          <el-table-column label="发布人" :width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.publishedBy">{{ row.publishedBy }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" :width="opsWidth(3)" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <template v-for="(a, i) in rowActions(row)" :key="a.key">
                  <span v-if="i > 0" class="tbl-ops-sep" aria-hidden="true"></span>
                  <el-button
                    link
                    :type="a.type"
                    :loading="busy[row.id] === a.key"
                    :disabled="!!busy[row.id]"
                    @click="onAction(a.key, row)"
                  >
                    {{ a.label }}
                  </el-button>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" @change="list.reload" />

    <VersionEditor
      v-model:visible="editorVisible"
      :version="editingVersion"
      :readonly="editorReadonly"
      @saved="refresh"
    />
  </div>
</template>

<style scoped>
/* 概览条：两张只读卡片并排 */
.vs-overview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}
.vs-card {
  padding: var(--space-4);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.vs-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.vs-card-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.vs-card-version {
  margin-top: var(--space-2);
  font-size: 22px;
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.vs-card-meta {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.vs-card-empty {
  margin-top: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  line-height: 32px;
}
.vs-overview-error {
  grid-column: 1 / -1;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
@media (max-width: 720px) {
  .vs-overview {
    grid-template-columns: 1fr;
  }
}

.vs-version {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.vs-muted {
  color: var(--c-text-faint);
}
.vs-notes {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  white-space: pre-line;
  color: var(--c-text);
}

/* 发布时间列头排序按钮（同角色页 / 审核中心） */
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
</style>
