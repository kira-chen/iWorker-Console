<script setup>
/**
 * 工具调用审计（治理，ADMIN 专属）——数字员工调用连接器工具的事后审计记录，只读。
 *
 * 2026-09-28 PRD 首次落地（prd.工具调用审计.md）：本模块此前仅存在于已退场的旧交互原型，
 * 本次按新写的 PRD 正本改造为规范实现，字段/术语已与原型有出入（role→position，
 * 时间筛选改用访问审计同款日期区间选择器）。列表分页走全站统一的 useAdminList
 * paged:'client'（2026-09-08 原型复刻批次 1 负责人拍板：全站所有列表页都分页）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { useAdminList } from '@/composables/useAdminList'
import { COL, COL_NOWRAP } from '@/utils/tableLayout'
import {
  listToolCallAudits,
  toolCallRecords,
  paramsOf,
  outputOf,
  RESULT_LABEL,
  CONFIRM_LABEL,
  NATURE_LABEL
} from '@/api/toolCallAuditMock'

const RESULT_TAG = { SUCCESS: 'success', FAILED: 'danger', BLOCKED: 'warning', CANCELLED: 'info', PENDING: 'accent' }
const CONFIRM_TAG = { NONE: 'info', CONFIRMED: 'success', PENDING: 'accent', CANCELLED: 'info' }

/* ── 时间范围（与访问审计同口径：默认近 90 天，单次最多可选 30 天跨度） ── */
function defaultRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 89)
  return [start, end]
}
function inDateRange(dateStr, range) {
  if (!range?.[0] || !range?.[1]) return true
  const t = new Date(dateStr)
  const s = new Date(range[0]); s.setHours(0, 0, 0, 0)
  const e = new Date(range[1]); e.setHours(23, 59, 59, 999)
  return t >= s && t <= e
}
const dateRange = ref(defaultRange())
const pickFirst = ref(null)
const disabledDate = computed(() => {
  const first = pickFirst.value
  return (d) => (first ? Math.abs(d - first) / 86400000 > 30 : false)
})
function onCalendarChange(val) {
  pickFirst.value = val?.[1] ? null : (val?.[0] ?? null)
}

/* ── 筛选状态 ── */
const query = reactive({ result: '', nature: '' })
const keyword = ref('')
const appliedKeyword = ref('')
const sortDir = ref('desc')
const sortArrow = computed(() => (sortDir.value === 'desc' ? '↓' : '↑'))
function toggleSort() {
  sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  list.search()
}

function filterRecords(all) {
  const kw = appliedKeyword.value
  const filtered = all.filter((r) =>
    inDateRange(r.date, dateRange.value) &&
    (!query.result || r.result === query.result) &&
    (!query.nature || r.nature === query.nature) &&
    (!kw || [r.user, r.position, r.skill, r.tool, r.id].join(' ').toLowerCase().includes(kw))
  )
  return [...filtered].sort((a, b) =>
    sortDir.value === 'desc'
      ? `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
      : `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
  )
}

// 取数编排走全站统一的 useAdminList（列表页规范，2026-09-08 负责人拍板：全站所有列表页都分页）。
// mock 返全量，本页本地筛选 + 排序后由 paged:'client' 切片分页。
const list = useAdminList(listToolCallAudits, {
  paged: 'client',
  clientPipeline: filterRecords
})
const { rows, total, page, pageSize, loading, loadError, isEmpty } = list

function applySearch() {
  appliedKeyword.value = keyword.value.trim().toLowerCase()
  list.search()
}
function onClearSearch() {
  keyword.value = ''
  applySearch()
}

onMounted(list.reload)

/* ── 统计卡片（口径基于当前时间范围 + 筛选后的全量结果，与列表联动） ──
 * listToolCallAudits() 是异步 mock 取数函数，统计卡片需要同步的全量数据源，
 * 故直接对常量数组 toolCallRecords 复用同一套 filterRecords 逻辑。 */
const statsAll = computed(() => filterRecords(toolCallRecords))

const metrics = computed(() => {
  const all = statsAll.value
  const count = (result) => all.filter((r) => r.result === result).length
  const writes = all.filter((r) => r.nature === 'WRITE')
  return [
    {
      key: 'all',
      label: '调用请求总数',
      value: all.length,
      sub: `成功 ${count('SUCCESS')} / 拦截 ${count('BLOCKED')} / 取消 ${count('CANCELLED')}`
    },
    {
      key: 'write',
      label: '写操作请求',
      value: writes.length,
      sub: `需要确认 ${writes.filter((r) => r.confirm !== 'NONE').length} / 已确认 ${writes.filter((r) => r.confirm === 'CONFIRMED').length}`
    },
    {
      key: 'failed',
      label: '执行失败',
      value: count('FAILED'),
      sub: '已尝试执行但未成功',
      danger: true
    },
    {
      key: 'pending',
      label: '当前待确认',
      value: count('PENDING'),
      sub: '等待用户确认，尚未执行',
      warn: true
    }
  ]
})

function chooseMetric(key) {
  query.result = ''
  query.nature = ''
  if (key === 'write') query.nature = 'WRITE'
  if (key === 'failed') query.result = 'FAILED'
  if (key === 'pending') query.result = 'PENDING'
  list.search()
}

/* ── 统计口径说明（默认收起） ── */
const helpOpen = ref(false)

/* ── 导出 CSV ── */
function exportCsv() {
  const rowsToExport = statsAll.value
  const header = ['请求编号', '日期', '时间', '用户', '岗位', '技能', '工具', '性质', '确认', '结果', '原因', '执行耗时', '确认等待']
  const body = rowsToExport.map((r) => [
    r.id, r.date, r.time, r.user, r.position, r.skill, r.tool,
    NATURE_LABEL[r.nature], CONFIRM_LABEL[r.confirm], RESULT_LABEL[r.result], r.reason, r.duration, r.wait
  ])
  const csv = '﻿' + [header, ...body]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '工具调用审计-筛选结果.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  ElMessage.success(`已导出 ${rowsToExport.length} 条筛选结果`)
}

/* ── 详情抽屉 ── */
const detailVisible = ref(false)
const current = ref(null)
const detailTab = ref('input')

function showDetail(row) {
  current.value = row
  detailTab.value = 'input'
  detailVisible.value = true
}

const currentParams = computed(() => (current.value ? paramsOf(current.value) : []))
const currentOutput = computed(() => (current.value ? outputOf(current.value) : null))

const resultExplain = computed(() => {
  const d = current.value
  if (!d) return ''
  if (d.result === 'FAILED') return '建议检查连接器状态及工具服务日志，并核对是否已有后续重试记录。'
  if (d.result === 'BLOCKED') return '请核对该岗位允许使用的工具和用户权限，再由发起人重新提交任务。'
  if (d.result === 'CANCELLED') return '本次操作已终止。如仍需执行，请由发起人重新发起。'
  if (d.result === 'PENDING') return '等待发起人在客户端处理，此页不代替用户确认。'
  return '本次调用已完成，可查看返回信息。'
})

/** 执行过程时间线：拦截 / 取消 / 待确认会在对应节点停止，不展示后续阶段（PRD §5.2）。 */
const timelineSteps = computed(() => {
  const d = current.value
  if (!d) return []
  const steps = [
    { time: d.time, title: '发起调用', desc: `${d.user} 通过「${d.position}」执行「${d.skill}」。`, type: 'primary' }
  ]
  if (d.result === 'BLOCKED') {
    steps.push({ time: '', title: '检查未通过，已拦截', desc: `${d.reason}。请求未进入工具执行阶段。`, type: 'danger' })
    return steps
  }
  steps.push({ time: '', title: '调用检查通过', desc: '请求进入后续处理。', type: 'primary' })
  if (d.confirm === 'CONFIRMED') {
    steps.push({ time: d.confirmedAt || '【待补充】', title: '用户已确认', desc: `确认人：${d.user} / 客户端 / 等待 ${d.wait}`, type: 'success' })
  } else if (d.confirm === 'PENDING' || d.confirm === 'CANCELLED') {
    steps.push({
      time: '',
      title: d.confirm === 'PENDING' ? '待确认' : '已取消',
      desc: d.confirm === 'PENDING' ? '请发起人在客户端确认。' : '用户在客户端取消，工具未执行。',
      type: 'danger'
    })
    return steps
  } else {
    steps.push({ time: '', title: '无需用户确认', desc: '按当前工具确认策略直接进入执行阶段。', type: 'primary' })
  }
  steps.push({
    time: d.endAt || '',
    title: RESULT_LABEL[d.result],
    desc: `工具执行耗时 ${d.duration}${d.reason ? ' / ' + d.reason : ''}`,
    type: d.result === 'FAILED' ? 'danger' : 'success'
  })
  return steps
})
</script>

<template>
  <div class="list-page">
    <PageHeader title="工具调用审计" subtitle="追溯每次工具调用的发起人、确认过程与执行结果">
      <template #actions>
        <el-button @click="helpOpen = !helpOpen">统计口径</el-button>
      </template>
    </PageHeader>

    <div v-if="helpOpen" class="tca-help">
      <p>调用请求包含成功、执行失败、执行前拦截、用户取消和待确认五类结果；一次任务内的重试按新的调用请求单独记录。</p>
      <p>执行耗时只统计工具实际执行时间，不含等待用户确认的时间；"待确认"反映当前尚未处理的请求，不是历史累计数量。</p>
    </div>

    <div class="metric-grid">
      <button
        v-for="m in metrics"
        :key="m.key"
        type="button"
        class="metric-card"
        :class="{ 'is-danger': m.danger, 'is-warn': m.warn, 'is-active': (m.key === 'write' && query.nature === 'WRITE') || (m.key === 'failed' && query.result === 'FAILED') || (m.key === 'pending' && query.result === 'PENDING') }"
        @click="chooseMetric(m.key)"
      >
        <span class="metric-label">{{ m.label }}</span>
        <strong class="metric-value">{{ m.value }}</strong>
        <span class="metric-sub">{{ m.sub }}</span>
      </button>
    </div>

    <ListToolbar>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        :disabled-date="disabledDate"
        @calendar-change="onCalendarChange"
        @change="list.search()"
        class="lt-date-range"
      />
      <el-select v-model="query.result" placeholder="全部执行结果" clearable class="lt-filter" @change="list.search()">
        <el-option v-for="(label, key) in RESULT_LABEL" :key="key" :label="label" :value="key" />
      </el-select>
      <el-select v-model="query.nature" placeholder="全部操作性质" clearable class="lt-filter" @change="list.search()">
        <el-option v-for="(label, key) in NATURE_LABEL" :key="key" :label="label" :value="key" />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="搜索用户 / 岗位 / 技能 / 工具"
        clearable
        class="lt-search"
        @keyup.enter="applySearch"
        @clear="onClearSearch"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button @click="applySearch">查询</el-button>
      <template #right>
        <el-button @click="exportCsv">导出筛选结果 CSV</el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="暂无符合条件的调用记录"
        @retry="list.reload"
      >
        <el-table :data="rows" class="tca-table">
          <el-table-column :width="COL.TIME" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #header>
              <button type="button" class="tca-sort" @click="toggleSort">
                请求时间 <span class="tca-sort-arrow">{{ sortArrow }}</span>
              </button>
            </template>
            <template #default="{ row }">
              {{ row.time }}<span class="tca-secondary">{{ row.date }}</span>
            </template>
          </el-table-column>
          <el-table-column label="用户 / 岗位" :width="COL.USER" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.user }}<span class="tca-secondary">{{ row.position }}</span>
            </template>
          </el-table-column>
          <el-table-column label="技能 / 工具" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.skill }}<span class="tca-secondary tca-mono">{{ row.tool }}</span>
            </template>
          </el-table-column>
          <el-table-column label="性质" :width="COL.TAG" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <StatusTag :type="row.nature === 'WRITE' ? 'accent' : 'info'">{{ NATURE_LABEL[row.nature] }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="用户确认" :width="COL.TAG" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <StatusTag :type="CONFIRM_TAG[row.confirm]">{{ CONFIRM_LABEL[row.confirm] }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="执行结果 / 原因" min-width="180">
            <template #default="{ row }">
              <StatusTag :type="RESULT_TAG[row.result]">{{ RESULT_LABEL[row.result] }}</StatusTag>
              <span v-if="row.reason" class="tca-secondary">{{ row.reason }}</span>
            </template>
          </el-table-column>
          <el-table-column label="执行 / 等待确认" width="140">
            <template #default="{ row }">
              {{ row.duration }}<span class="tca-secondary">确认：{{ row.wait }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="showDetail(row)">查看详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
      @change="list.reload"
    />

    <DrawerEditor
      v-model:visible="detailVisible"
      :title="`调用详情 · ${current?.id || ''}`"
      readonly
      size="720px"
    >
      <template v-if="current">
        <div class="detail-section">
          <h3>操作摘要 <StatusTag :type="RESULT_TAG[current.result]">{{ RESULT_LABEL[current.result] }}</StatusTag></h3>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="用户 / 岗位">{{ current.user }} / {{ current.position }}</el-descriptions-item>
            <el-descriptions-item label="技能">{{ current.skill }}</el-descriptions-item>
            <el-descriptions-item label="工具标识"><span class="tca-mono">{{ current.tool }}</span></el-descriptions-item>
            <el-descriptions-item label="执行耗时 / 等待确认">{{ current.duration }} / {{ current.wait }}</el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="detail-section">
          <h3>执行过程</h3>
          <el-timeline class="detail-timeline">
            <el-timeline-item
              v-for="(step, i) in timelineSteps"
              :key="i"
              :timestamp="step.time"
              :type="step.type"
              placement="top"
            >
              <strong>{{ step.title }}</strong>
              <p class="tca-step-desc">{{ step.desc }}</p>
            </el-timeline-item>
          </el-timeline>
        </div>

        <el-alert :title="resultExplain" type="info" :closable="false" show-icon class="detail-section" />

        <div class="detail-section">
          <div class="tca-tabs">
            <el-button :type="detailTab === 'input' ? 'primary' : 'default'" size="small" @click="detailTab = 'input'">实际请求参数</el-button>
            <el-button :type="detailTab === 'output' ? 'primary' : 'default'" size="small" @click="detailTab = 'output'">实际响应结果</el-button>
          </div>

          <template v-if="detailTab === 'input'">
            <p class="tca-tab-hint">敏感字段已脱敏</p>
            <el-table :data="currentParams" size="small" border>
              <el-table-column label="参数 / 技术标识">
                <template #default="{ row }">
                  {{ row[0] }}<span class="tca-secondary tca-mono">{{ row[1] }}</span>
                </template>
              </el-table-column>
              <el-table-column label="本次请求值">
                <template #default="{ row }">{{ row[2] }}</template>
              </el-table-column>
            </el-table>
          </template>

          <template v-else-if="currentOutput">
            <p v-if="currentOutput.summary">{{ currentOutput.summary }}</p>
            <el-table v-if="currentOutput.rows" :data="currentOutput.rows" size="small" border>
              <el-table-column>
                <template #default="{ row }">{{ row[0] }}</template>
              </el-table-column>
              <el-table-column>
                <template #default="{ row }">{{ row[1] }}</template>
              </el-table-column>
            </el-table>
            <p v-if="currentOutput.text">{{ currentOutput.text }}</p>
            <p v-if="currentOutput.note" class="tca-secondary">{{ currentOutput.note }}</p>
          </template>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </DrawerEditor>
  </div>
</template>

<style scoped>
.tca-help {
  margin: 0 0 var(--space-4);
  padding: 14px 16px;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.tca-help p {
  margin: 4px 0;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0 0 var(--space-4);
}
.metric-card {
  position: relative;
  text-align: left;
  padding: 14px 16px;
  background: var(--bg-base);
  border: 1px solid var(--border-soft);
  border-top: 3px solid var(--c-success);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.metric-card.is-danger { border-top-color: var(--c-danger); }
.metric-card.is-warn { border-top-color: var(--c-warning); }
.metric-card.is-active { border-color: var(--c-accent); box-shadow: 0 0 0 1px var(--c-accent) inset; }
.metric-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.metric-value {
  font-size: 26px;
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.metric-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.lt-date-range {
  width: 240px;
  flex-shrink: 0;
}

.tca-sort {
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.tca-sort-arrow {
  margin-left: 2px;
  font-weight: var(--fw-medium);
}
.tca-secondary {
  display: block;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin-top: 2px;
}
.tca-mono {
  font-family: Consolas, monospace;
}

.detail-section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 14px;
}
.detail-timeline {
  margin-top: 8px;
}
.tca-step-desc {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.tca-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tca-tab-hint {
  margin: 0 0 8px;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
