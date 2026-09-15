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

// ── 产物下载 ─────────────────────────────────────────────────
const dlKeyword = ref('')
const dlResult = ref('')

const dlFiltered = computed(() => {
  const q = dlKeyword.value.toLowerCase()
  return dlRecords.filter(
    (r) =>
      (!q || r.filename.toLowerCase().includes(q) || r.user.toLowerCase().includes(q)) &&
      (!dlResult.value || r.result === dlResult.value),
  )
})

const dlDeniedCount = computed(() => dlFiltered.value.filter((r) => r.result !== 'SUCCESS').length)

// ── 管理端操作 ───────────────────────────────────────────────
const opsKeyword = ref('')
const opsModule = ref('')
const opsAction = ref('')

const opsFiltered = computed(() => {
  const q = opsKeyword.value.toLowerCase()
  return opsRecords.filter(
    (r) =>
      (!q || r.operator.toLowerCase().includes(q) || r.target.toLowerCase().includes(q)) &&
      (!opsModule.value || r.module === opsModule.value) &&
      (!opsAction.value || r.action === opsAction.value),
  )
})

// 原型 modColors / actColors / chanColor / resColor 映射到本地 tag 样式类
const CHAN_CLS = { Web: 'tag-orange', Windows: 'tag-blue', Mac: 'tag-purple' }
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

function opsGoto(module) {
  ElMessage.info(`正式系统中将跳转至「${module}」模块`)
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="访问审计" subtitle="查看用户的登录 / 登出记录、在线状态与来源 IP" />

    <!-- 子页 Tab 导航（原型 aa-nav-tabs 样式） -->
    <div class="aa-nav-tabs">
      <button
        v-for="tab in [['login', '登录访问'], ['download', '产物下载'], ['admin-ops', '管理端操作']]"
        :key="tab[0]"
        :class="['aa-nav-tab', activeTab === tab[0] && 'active']"
        @click="activeTab = tab[0]"
      >{{ tab[1] }}</button>
    </div>

    <!-- ── 登录访问 ─────────────────────────────────────────── -->
    <template v-if="activeTab === 'login'">
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
          <el-table :data="rows" class="ll-table">
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
    </template>

    <!-- ── 产物下载 ─────────────────────────────────────────── -->
    <template v-else-if="activeTab === 'download'">
      <ListToolbar>
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
          <el-table-column label="时间" width="160" class-name="col-nowrap">
            <template #default="{ row }"><span class="ll-muted">{{ row.time }}</span></template>
          </el-table-column>
          <el-table-column label="用户名" width="90">
            <template #default="{ row }">{{ row.user }}</template>
          </el-table-column>
          <el-table-column label="产物文件名" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.filename }}</template>
          </el-table-column>
          <el-table-column label="访问端" width="100">
            <template #default="{ row }">
              <span :class="['aa-tag', CHAN_CLS[row.channel] || 'tag-gray']">{{ row.channel }}</span>
            </template>
          </el-table-column>
          <el-table-column label="链接有效期" width="110" class-name="col-nowrap">
            <template #default="{ row }"><span class="ll-muted">{{ row.validMins }} 分钟</span></template>
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
    </template>

    <!-- ── 管理端操作 ───────────────────────────────────────── -->
    <template v-else-if="activeTab === 'admin-ops'">
      <ListToolbar>
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
          <el-table-column label="时间" width="160" class-name="col-nowrap">
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
          <el-table-column label="操作对象" width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.target }}</template>
          </el-table-column>
          <el-table-column label="变更内容" min-width="200" show-overflow-tooltip>
            <template #default="{ row }"><span class="ll-muted" style="font-size:13px">{{ row.detail }}</span></template>
          </el-table-column>
          <el-table-column width="72">
            <template #default="{ row }">
              <el-button link @click="opsGoto(row.module)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
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

/* 子页 Tab 导航（原型 aa-nav-tabs） */
.aa-nav-tabs {
  display: flex;
  align-items: center;
  gap: 0;
  margin: 0 0 2px;
  border-bottom: 1px solid var(--c-border);
  overflow-x: auto;
}
.aa-nav-tab {
  height: 44px;
  padding: 0 18px;
  border: 0;
  background: transparent;
  color: var(--c-text-muted);
  font-size: 14px;
  font-weight: 500;
  position: relative;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
}
.aa-nav-tab:hover {
  color: var(--c-text-base);
}
.aa-nav-tab.active {
  color: var(--c-primary);
  font-weight: 650;
}
.aa-nav-tab.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--c-primary);
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
