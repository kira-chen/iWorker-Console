<script setup>
/**
 * 工具调用审计 · 「岗位自动化任务」页签——岗位自动化任务按调度计划触发（无人值守）后，
 * 通过「引用工具」或所引用的技能 / Agent 调用连接器工具的事后审计记录，只读。对应 PRD §八。
 *
 * 和「技能调用」页签的差别都来自「没有用户在场」：
 *   - user / position 是任务所属用户（领用该岗位的用户）及其岗位，不是发起人；触发的是调度计划；
 *   - 写操作无法当场确认，演示口径为「任务里预授权」——已预授权才执行，否则执行前拦截
 *     （该授权配置入口岗位 PRD 尚未定义，见 docs/04-待补需求定义/，此处只呈现调用发生时的结果）；
 *   - 因此没有「用户取消 / 待确认」两种结果，统计卡片里的「当前待确认」换成「执行前拦截」；
 *   - 一次任务运行会连续调多次工具，runId（任务运行编号）把同一次运行内的调用串起来。
 */
import { computed, reactive, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import AuditMetricGrid from '@/components/admin/AuditMetricGrid.vue'
import AuditCallDrawer from '@/components/admin/AuditCallDrawer.vue'
import { useAuditList } from '@/composables/useAuditList'
import { downloadCsv } from '@/utils/downloadCsv'
import { COL, COL_NOWRAP } from '@/utils/tableLayout'
import {
  listTaskCallAudits,
  taskCallRecords,
  paramsOf,
  outputOf,
  RESULT_LABEL,
  NATURE_LABEL,
  AUTH_LABEL,
  UNATTENDED_RESULTS
} from '@/api/toolCallAuditMock'

const RESULT_TAG = { SUCCESS: 'success', FAILED: 'danger', BLOCKED: 'warning' }
const AUTH_TAG = { NONE: 'info', AUTHORIZED: 'success', UNAUTHORIZED: 'warning' }

/* ── 筛选：时间范围 / 关键词 / 排序由 useAuditList 管，这里只声明本页签自己的条件 ── */
const query = reactive({ result: '', nature: '' })

const {
  dateRange, disabledDate, onCalendarChange,
  sortArrow, toggleSort,
  keyword, applySearch, onClearSearch,
  list, statsAll
} = useAuditList({
  fetcher: listTaskCallAudits,
  records: taskCallRecords,
  matches: (r) => (!query.result || r.result === query.result) && (!query.nature || r.nature === query.nature),
  keywordOf: (r) => [r.user, r.position, r.task, r.tool, r.id, r.runId]
})
const { rows, total, page, pageSize, loading, loadError, isEmpty } = list

/* ── 统计卡片（PRD §八.3） ── */
const metrics = computed(() => {
  const all = statsAll.value
  const count = (result) => all.filter((r) => r.result === result).length
  const writes = all.filter((r) => r.nature === 'WRITE')
  return [
    {
      key: 'all',
      label: '调用请求总数',
      value: all.length,
      sub: `成功 ${count('SUCCESS')} / 拦截 ${count('BLOCKED')}`
    },
    {
      key: 'write',
      label: '写操作请求',
      value: writes.length,
      sub: `已预授权 ${writes.filter((r) => r.auth === 'AUTHORIZED').length} / 未授权拦截 ${writes.filter((r) => r.auth === 'UNAUTHORIZED').length}`
    },
    {
      key: 'failed',
      label: '执行失败',
      value: count('FAILED'),
      sub: '已尝试执行但未成功',
      danger: true
    },
    {
      key: 'blocked',
      label: '执行前拦截',
      value: count('BLOCKED'),
      sub: '未进入工具执行阶段',
      warn: true
    }
  ]
})

const activeMetric = computed(() => {
  if (query.nature === 'WRITE') return 'write'
  if (query.result === 'FAILED') return 'failed'
  if (query.result === 'BLOCKED') return 'blocked'
  return ''
})

function chooseMetric(key) {
  query.result = ''
  query.nature = ''
  if (key === 'write') query.nature = 'WRITE'
  if (key === 'failed') query.result = 'FAILED'
  if (key === 'blocked') query.result = 'BLOCKED'
  list.search()
}

const HELP = [
  '调用请求包含成功、执行失败和执行前拦截三类结果；任务无人值守，不存在用户取消和待确认。一次任务运行内的重试按新的调用请求单独记录，可用任务运行编号串联。',
  '写操作需在任务中预先授权：已预授权的执行，未授权的在执行前拦截。执行耗时只统计工具实际执行时间。'
]

/* ── 导出 CSV ── */
function exportCsv() {
  const rowsToExport = statsAll.value
  downloadCsv(
    '工具调用审计-岗位自动化任务-筛选结果.csv',
    ['请求编号', '任务运行编号', '日期', '时间', '用户', '岗位', '任务', '触发方式', '工具', '性质', '写操作授权', '结果', '原因', '执行耗时'],
    rowsToExport.map((r) => [
      r.id, r.runId, r.date, r.time, r.user, r.position, r.task, r.trigger, r.tool,
      NATURE_LABEL[r.nature], AUTH_LABEL[r.auth], RESULT_LABEL[r.result], r.reason, r.duration
    ])
  )
  ElMessage.success(`已导出 ${rowsToExport.length} 条筛选结果`)
}

/* ── 详情抽屉 ── */
const detailVisible = ref(false)
const current = ref(null)

function showDetail(row) {
  current.value = row
  detailVisible.value = true
}

const detail = computed(() => {
  const d = current.value
  if (!d) return null
  return {
    title: `调用详情 · ${d.id}`,
    result: { label: RESULT_LABEL[d.result], type: RESULT_TAG[d.result] },
    summary: [
      { label: '用户 / 岗位', value: `${d.user} / ${d.position}` },
      { label: '自动化任务', value: d.task },
      { label: '触发方式', value: d.trigger },
      { label: '任务运行编号', value: d.runId, mono: true },
      { label: '工具标识', value: d.tool, mono: true },
      { label: '执行耗时', value: d.duration }
    ],
    steps: timelineSteps(d),
    explain: resultExplain(d),
    params: paramsOf(d),
    output: outputOf(d)
  }
})

function resultExplain(d) {
  if (d.result === 'FAILED') return '建议检查连接器状态及工具服务日志，并按任务运行编号核对同一次运行内是否已有后续重试记录。'
  if (d.result === 'BLOCKED' && d.auth === 'UNAUTHORIZED') {
    return '该任务未对写操作预授权，无人值守时不会自动执行。如需执行，请在岗位自动化任务中核对工具授权，或改由用户在对话中发起。'
  }
  if (d.result === 'BLOCKED') return '请核对该岗位允许使用的工具和任务所属用户权限，任务下次运行时会重新检查。'
  return '本次调用已完成，可查看返回信息。'
}

/** 执行过程时间线：被拦截的调用在「调用检查」节点停止，不展示后续阶段（PRD §八.6）。 */
function timelineSteps(d) {
  const steps = [
    { time: d.time, title: '任务触发', desc: `按「${d.trigger}」触发任务「${d.task}」，所属用户 ${d.user}（${d.position}）。`, type: 'primary' }
  ]
  if (d.result === 'BLOCKED') {
    steps.push({ time: '', title: '检查未通过，已拦截', desc: `${d.reason}。请求未进入工具执行阶段。`, type: 'danger' })
    return steps
  }
  steps.push({ time: '', title: '调用检查通过', desc: '请求进入后续处理。', type: 'primary' })
  if (d.auth === 'AUTHORIZED') {
    steps.push({ time: '', title: '写操作已预授权', desc: `任务保存时由 ${d.authBy} 授权（${d.authAt}），运行期间无需再次确认。`, type: 'success' })
  } else {
    steps.push({ time: '', title: '无需授权', desc: '读操作直接进入执行阶段。', type: 'primary' })
  }
  steps.push({
    time: d.endAt || '',
    title: RESULT_LABEL[d.result],
    desc: `工具执行耗时 ${d.duration}${d.reason ? ' / ' + d.reason : ''}`,
    type: d.result === 'FAILED' ? 'danger' : 'success'
  })
  return steps
}
</script>

<template>
  <div class="list-page">
    <AuditMetricGrid :metrics="metrics" :active-key="activeMetric" :help="HELP" @choose="chooseMetric" />

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
        <el-option v-for="key in UNATTENDED_RESULTS" :key="key" :label="RESULT_LABEL[key]" :value="key" />
      </el-select>
      <el-select v-model="query.nature" placeholder="全部操作性质" clearable class="lt-filter" @change="list.search()">
        <el-option v-for="(label, key) in NATURE_LABEL" :key="key" :label="label" :value="key" />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="搜索用户 / 岗位 / 任务 / 工具"
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
          <el-table-column label="任务 / 工具" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.task }}<span class="tca-secondary tca-mono">{{ row.tool }}</span>
            </template>
          </el-table-column>
          <el-table-column label="触发方式" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.trigger }}</template>
          </el-table-column>
          <el-table-column label="性质" :width="COL.TAG" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <StatusTag :type="row.nature === 'WRITE' ? 'accent' : 'info'">{{ NATURE_LABEL[row.nature] }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="写操作授权" :width="COL.TAG" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <StatusTag :type="AUTH_TAG[row.auth]">{{ AUTH_LABEL[row.auth] }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="执行结果 / 原因" min-width="180">
            <template #default="{ row }">
              <StatusTag :type="RESULT_TAG[row.result]">{{ RESULT_LABEL[row.result] }}</StatusTag>
              <span v-if="row.reason" class="tca-secondary">{{ row.reason }}</span>
            </template>
          </el-table-column>
          <el-table-column label="执行耗时" width="110">
            <template #default="{ row }">{{ row.duration }}</template>
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

    <AuditCallDrawer v-model:visible="detailVisible" v-bind="detail || {}" />
  </div>
</template>

<style scoped>
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
</style>
