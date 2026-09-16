<script setup>
/**
 * 访问审计（治理，ADMIN 专属）——登录访问 / 产物下载 / 管理端操作三个子页。
 *
 * 2026-09-01 按 PRD（prd.访问审计.md）+ 交互原型 v2 最终版（renderAuditMultiDevice）对齐：
 * - 查询区 = 用户名搜索（回车/【查询】生效）+ 在线状态筛选 + 查询按钮（回第 1 页）；
 * - 列 = 用户名 / 终端（仅 Windows、Mac 两类蓝标）/ 登录时间(排序) / 登出时间(排序) / 状态 / 来源 IP；
 * - 默认按登录时间倒序；登出时间为空显「—」；登录地点字段不展示（md §四）；
 * - 数据走 loginLog.js（demo 默认 loginLogMock，同一账号多终端多条记录）。
 * 2026-09-08 原型复刻批次 2B（G-5 / A-1）：登录 / 登出时间列头改原型文字箭头；搜索框 300ms 防抖。
 * 2026-09-15 新增产物下载、管理端操作两个子页（原型 renderDownload / renderAdminOps），
 *   删去敏感知识库检索页签；数据走 accessAuditMock.js。
 */
import { ref, computed, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import { listLoginLogs } from '@/api/loginLog'
import { dlRecords, opsRecords } from '@/api/accessAuditMock'
import '@/assets/connector.css'
import { COL } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

const router = useRouter()

// 当前子页
const activeTab = ref('login')

// ── 登录访问（原有逻辑，完整保留）────────────────────────────
const query = reactive({ keyword: '', status: '', sortField: 'loginAt', sortDir: 'desc' })

const list = useAdminList(listLoginLogs, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload
const reload = list.search

function toggleSort(field) {
  if (query.sortField === field) {
    query.sortDir = query.sortDir === 'desc' ? 'asc' : 'desc'
  } else {
    query.sortField = field
    query.sortDir = 'desc'
  }
  reload()
}
function sortArrow(field) {
  if (query.sortField !== field) return '↓'
  return query.sortDir === 'asc' ? '↑' : '↓'
}

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
onMounted(fetchList)

function isOnline(row) {
  return row.status === 'ONLINE'
}

// ── 时间范围工具（三页签共用）────────────────────────────────
function defaultRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 89)  // 含今天共 90 天
  return [start, end]
}

function inRange(timeStr, range) {
  if (!range?.[0] || !range?.[1]) return true
  const t = new Date(timeStr.replace(' ', 'T'))
  const s = new Date(range[0]); s.setHours(0, 0, 0, 0)
  const e = new Date(range[1]); e.setHours(23, 59, 59, 999)
  return t >= s && t <= e
}

function makeDisabledDate(firstRef) {
  return computed(() => {
    const first = firstRef.value
    return (d) => first ? Math.abs(d - first) / 86400000 > 30 : false
  })
}

function onCalendarChange(firstRef, val) {
  firstRef.value = val?.[1] ? null : (val?.[0] ?? null)
}

// ── 登录访问：时间范围 ────────────────────────────────────────
const loginDateRange = ref(defaultRange())
const loginPickFirst = ref(null)
const loginDisabledDate = makeDisabledDate(loginPickFirst)
const loginFiltered = computed(() => rows.value.filter((r) => inRange(r.loginAt, loginDateRange.value)))

// ── 产物下载 ─────────────────────────────────────────────────
const dlKeyword = ref('')
const dlResult = ref('')
const dlSortOrder = ref('descending')
const dlSortArrow = computed(() => dlSortOrder.value === 'descending' ? '↓' : '↑')
const dlDateRange = ref(defaultRange())
const dlPickFirst = ref(null)
const dlDisabledDate = makeDisabledDate(dlPickFirst)

function toggleDlSort() {
  dlSortOrder.value = dlSortOrder.value === 'descending' ? 'ascending' : 'descending'
}

const dlFiltered = computed(() => {
  const q = dlKeyword.value.toLowerCase()
  const base = dlRecords.filter(
    (r) =>
      (!q || r.filename.toLowerCase().includes(q) || r.user.toLowerCase().includes(q)) &&
      (!dlResult.value || r.result === dlResult.value) &&
      inRange(r.time, dlDateRange.value),
  )
  return [...base].sort((a, b) =>
    dlSortOrder.value === 'descending'
      ? b.time.localeCompare(a.time)
      : a.time.localeCompare(b.time)
  )
})

const dlDeniedCount = computed(() => dlFiltered.value.filter((r) => r.result !== 'SUCCESS').length)

// ── 管理端操作 ───────────────────────────────────────────────
const opsKeyword = ref('')
const opsModule = ref('')
const opsAction = ref('')
const opsSortOrder = ref('descending')
const opsSortArrow = computed(() => opsSortOrder.value === 'descending' ? '↓' : '↑')
const opsDateRange = ref(defaultRange())
const opsPickFirst = ref(null)
const opsDisabledDate = makeDisabledDate(opsPickFirst)

function toggleOpsSort() {
  opsSortOrder.value = opsSortOrder.value === 'descending' ? 'ascending' : 'descending'
}

const opsFiltered = computed(() => {
  const q = opsKeyword.value.toLowerCase()
  const base = opsRecords.filter(
    (r) =>
      (!q || r.operator.toLowerCase().includes(q) || r.target.toLowerCase().includes(q)) &&
      (!opsModule.value || r.module === opsModule.value) &&
      (!opsAction.value || r.action === opsAction.value) &&
      inRange(r.time, opsDateRange.value),
  )
  return [...base].sort((a, b) =>
    opsSortOrder.value === 'descending'
      ? b.time.localeCompare(a.time)
      : a.time.localeCompare(b.time)
  )
})

// 原型 actColors / resColor 映射到本地 tag 样式类
const RES_CLS = { SUCCESS: 'tag-green', FAILED: 'tag-red' }
const MOD_CLS = {
  岗位: 'tag-green',
  专家: 'tag-blue',
  技能: 'tag-blue',
  知识库: 'tag-orange',
  MCP: 'tag-purple',
  API: 'tag-gray',
  业务系统: 'tag-gray',
  模型: 'tag-orange',
  审核中心: 'tag-green',
  用户技能审核: 'tag-orange',
}
const ACT_CLS = {
  发布: 'tag-green',
  停用: 'tag-orange',
  撤回: 'tag-orange',
  删除: 'tag-red',
  审核通过: 'tag-green',
  审核驳回: 'tag-red',
}

// 模块 → 路由映射（点「查看操作」跳转对应模块页并注入搜索条件）
const VERSION_MODULES = new Set(['岗位', '专家', '技能'])

const MODULE_ROUTE = {
  岗位:       { name: 'AdminPositions' },
  专家:       { name: 'AdminExperts' },
  技能:       { name: 'AdminSkillsUnified' },
  知识库:     { name: 'AdminKnowledgeBase' },
  MCP:        { name: 'AdminConnector', extraQuery: { tab: 'mcp' } },
  API:        { name: 'AdminConnector', extraQuery: { tab: 'api' } },
  业务系统:   { name: 'AdminConnector', extraQuery: { tab: 'bizsystem' } },
  模型:       { name: 'AdminModels' },
  审核中心:   { name: 'UnifiedReview' },
  用户技能审核: { name: 'SysConfigUserSkillReviews' },
}

function opsGoto(row) {
  const def = MODULE_ROUTE[row.module]
  if (!def) {
    ElMessage.info(`正式系统中将跳转至「${row.module}」模块`)
    return
  }
  router.push({
    name: def.name,
    query: { ...(def.extraQuery || {}), keyword: row.target }
  })
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="访问审计" subtitle="记录用户登录访问、产物下载与管理端操作的完整行为轨迹" />

    <el-tabs v-model="activeTab" class="aa-tabs">

      <!-- ── 登录访问 ─────────────────────────────────────────── -->
      <el-tab-pane label="登录访问" name="login">
      <ListToolbar>
        <el-date-picker
          v-model="loginDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :disabled-date="loginDisabledDate"
          @calendar-change="(v) => onCalendarChange(loginPickFirst, v)"
          class="lt-date-range"
        />
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
          <el-table :data="loginFiltered" class="ll-table">
            <el-table-column label="用户名" :width="COL.USER" show-overflow-tooltip>
              <template #default="{ row }">{{ row.username || '—' }}</template>
            </el-table-column>
            <el-table-column label="终端" :width="COL.TAG" class-name="col-nowrap" label-class-name="col-nowrap">
              <template #default="{ row }">
                <StatusTag type="accent">{{ row.terminal }}</StatusTag>
              </template>
            </el-table-column>
            <el-table-column :width="COL.TIME" class-name="col-nowrap" label-class-name="col-nowrap">
              <template #header>
                <button type="button" class="ll-sort" @click="toggleSort('loginAt')">
                  登录时间 <span class="ll-sort-arrow">{{ sortArrow('loginAt') }}</span>
                </button>
              </template>
              <template #default="{ row }">
                <span class="ll-muted">{{ row.loginAt || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column :width="COL.TIME" class-name="col-nowrap" label-class-name="col-nowrap">
              <template #header>
                <button type="button" class="ll-sort" @click="toggleSort('logoutAt')">
                  登出时间 <span class="ll-sort-arrow">{{ sortArrow('logoutAt') }}</span>
                </button>
              </template>
              <template #default="{ row }">
                <span class="ll-muted">{{ row.logoutAt || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" :width="COL.STATUS" class-name="col-nowrap" label-class-name="col-nowrap">
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
        </ListStates>
      </div>

      <ListPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
        @change="fetchList"
      />
      </el-tab-pane>

      <!-- ── 产物下载 ─────────────────────────────────────────── -->
      <el-tab-pane label="产物下载" name="download">
      <ListToolbar>
        <el-date-picker
          v-model="dlDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :disabled-date="dlDisabledDate"
          @calendar-change="(v) => onCalendarChange(dlPickFirst, v)"
          class="lt-date-range"
        />
        <el-input
          v-model="dlKeyword"
          placeholder="搜索文件名 / 用户名"
          clearable
          class="lt-search"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="dlResult" placeholder="全部访问结果" clearable class="lt-filter">
          <el-option label="成功" value="SUCCESS" />
          <el-option label="失败" value="FAILED" />
        </el-select>
        <el-button>查询</el-button>
        <div class="lt-spacer" />
        <el-button @click="ElMessage.info('CSV 导出已开始，请稍候…')">导出 CSV</el-button>
      </ListToolbar>

      <div class="aa-stats-bar">
        <span>今日下载 <strong>1,904</strong> 次</span>
        <span>失败 <strong class="danger">{{ dlDeniedCount }}</strong> 次</span>
        <span>筛选结果 <strong>{{ dlFiltered.length }}</strong> 条</span>
      </div>

      <div class="table-wrap">
        <el-table :data="dlFiltered" class="ll-table">
          <el-table-column width="170" class-name="col-nowrap">
            <template #header>
              <button type="button" class="ll-sort" @click="toggleDlSort">
                时间 <span class="ll-sort-arrow">{{ dlSortArrow }}</span>
              </button>
            </template>
            <template #default="{ row }"><span class="ll-muted">{{ row.time }}</span></template>
          </el-table-column>
          <el-table-column label="用户名" width="90">
            <template #default="{ row }">{{ row.user }}</template>
          </el-table-column>
          <el-table-column label="产物文件名" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.filename }}</template>
          </el-table-column>
          <el-table-column label="终端" :width="COL.TAG" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <StatusTag type="accent">{{ row.channel }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="访问结果" width="120">
            <template #default="{ row }">
              <span :class="['aa-tag', RES_CLS[row.result] || 'tag-gray']">
                {{ row.result === 'SUCCESS' ? '成功' : '失败' }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      </el-tab-pane>

      <!-- ── 管理端操作 ───────────────────────────────────────── -->
      <el-tab-pane label="管理端操作" name="admin-ops">
      <ListToolbar>
        <el-date-picker
          v-model="opsDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :disabled-date="opsDisabledDate"
          @calendar-change="(v) => onCalendarChange(opsPickFirst, v)"
          class="lt-date-range"
        />
        <el-input
          v-model="opsKeyword"
          placeholder="搜索操作人 / 操作对象"
          clearable
          class="lt-search"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="opsModule" placeholder="全部模块" clearable class="lt-filter">
          <el-option v-for="m in ['岗位','专家','技能','知识库','MCP','API','业务系统','模型','审核中心','用户技能审核']"
            :key="m" :label="m" :value="m" />
        </el-select>
        <el-select v-model="opsAction" placeholder="全部动作" clearable class="lt-filter">
          <el-option v-for="a in ['发布','停用','撤回','删除','审核通过','审核驳回']"
            :key="a" :label="a" :value="a" />
        </el-select>
        <el-button>查询</el-button>
        <div class="lt-spacer" />
        <el-button @click="ElMessage.info('CSV 导出已开始，请稍候…')">导出 CSV</el-button>
      </ListToolbar>

      <div class="aa-stats-bar">
        <span>近 30 日共 <strong>1,208</strong> 条操作记录</span>
        <span>筛选结果 <strong>{{ opsFiltered.length }}</strong> 条</span>
      </div>

      <div class="table-wrap">
        <el-table :data="opsFiltered" class="ll-table">
          <el-table-column width="170" class-name="col-nowrap">
            <template #header>
              <button type="button" class="ll-sort" @click="toggleOpsSort">
                时间 <span class="ll-sort-arrow">{{ opsSortArrow }}</span>
              </button>
            </template>
            <template #default="{ row }"><span class="ll-muted">{{ row.time }}</span></template>
          </el-table-column>
          <el-table-column label="操作人" width="110" show-overflow-tooltip>
            <template #default="{ row }">{{ row.operator }}</template>
          </el-table-column>
          <el-table-column label="模块" width="110">
            <template #default="{ row }">
              <span :class="['aa-tag', MOD_CLS[row.module] || 'tag-gray']">{{ row.module }}</span>
            </template>
          </el-table-column>
          <el-table-column label="动作" width="100">
            <template #default="{ row }">
              <span :class="['aa-tag', ACT_CLS[row.action] || 'tag-gray']">{{ row.action }}</span>
            </template>
          </el-table-column>
          <el-table-column label="变更内容" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ll-muted">{{ row.detail || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作对象" min-width="200">
            <template #default="{ row }">
              <span class="ops-target">
                <span class="ops-target-name">{{ row.target }}</span>
                <span v-if="VERSION_MODULES.has(row.module) && row.version" class="ops-version">{{ row.version }}</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="opsGoto(row)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      </el-tab-pane>

    </el-tabs>
  </div>
</template>

<style scoped>
.ll-table {
  width: 100%;
}
.ll-muted {
  color: var(--c-text-faint);
}
.ll-sort {
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.ll-sort-arrow {
  margin-left: 2px;
  color: var(--c-text-base);
  font-weight: var(--fw-medium);
}

/* Tab 导航（对齐连接器页 connector-tabs 样式） */
.aa-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}
.aa-tabs :deep(.el-tabs__content) {
  overflow: visible;
}

/* 操作对象单元格：名称 + 版本号 */
.ops-target {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ops-target-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ops-version {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 3px;
  background: var(--c-bg-soft);
  color: var(--c-text-muted);
  font-size: 11px;
  font-weight: var(--fw-medium);
  letter-spacing: 0.2px;
}

/* 统计摘要栏（原型 aa-stats-bar） */
.aa-stats-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 10px 14px;
  margin: 12px 0 14px;
  border-radius: 8px;
  background: var(--c-bg-soft);
  color: var(--c-text-muted);
  font-size: 13px;
}
.aa-stats-bar strong {
  color: var(--c-text-strong);
}
.aa-stats-bar strong.danger {
  color: var(--c-danger);
}

/* 工具栏弹性占位（「导出 CSV」推到右侧） */
.lt-spacer {
  flex: 1;
}

/* 时间范围选择器（三页签共用） */
.lt-date-range {
  width: 240px;
  flex-shrink: 0;
}

/* 彩色小标签（对应原型 P.tag 各颜色） */
.aa-tag {
  display: inline-flex;
  height: 22px;
  align-items: center;
  padding: 0 7px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.tag-green  { background: #e0f4ed; color: #067a54; }
.tag-red    { background: #fde8e8; color: #c0392b; }
.tag-orange { background: #fff3e0; color: #c07200; }
.tag-blue   { background: #e3eeff; color: #2563c0; }
.tag-purple { background: #f0ebff; color: #6d28d9; }
.tag-gray   { background: #f0f2f0; color: #5a6661; }
</style>
