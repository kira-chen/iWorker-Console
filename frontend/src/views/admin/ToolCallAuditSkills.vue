<script setup>
/**
 * 工具调用审计 · 「技能调用」页签——用户在对话中触发，技能调用连接器工具（MCP / API / 业务系统）的
 * 事后审计记录，只读。对应 PRD §二 ~ §七（prd.工具调用审计.md）。
 *
 * 2026-09-28 PRD 首次落地：本模块此前仅存在于已退场的旧交互原型，按新写的 PRD 正本改造为规范实现，
 * 字段/术语已与原型有出入（role→position，时间筛选改用访问审计同款日期区间选择器）。
 * 同日拆页签：页头与页签外壳移到 AdminToolCallAudit.vue，取数 / 时间范围 / 排序 / 搜索收进
 * useAuditList，统计卡片与详情抽屉收进 AuditMetricGrid / AuditCallDrawer，本文件只保留
 * 「技能调用」自己的筛选、统计口径、列与时间线。
 * 列表分页走全站统一的 useAdminList paged:'client'（2026-09-08 原型复刻批次 1 负责人拍板：全站所有列表页都分页）。
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

/* ── 筛选：时间范围 / 关键词 / 排序由 useAuditList 管，这里只声明本页签自己的条件 ── */
const query = reactive({ result: '', nature: '' })

const {
  dateRange, disabledDate, onCalendarChange,
  sortArrow, toggleSort,
  keyword, applySearch, onClearSearch,
  list, statsAll
} = useAuditList({
  fetcher: listToolCallAudits,
  records: toolCallRecords,
  matches: (r) => (!query.result || r.result === query.result) && (!query.nature || r.nature === query.nature),
  keywordOf: (r) => [r.user, r.position, r.skill, r.tool, r.id]
})
const { rows, total, page, pageSize, loading, loadError, isEmpty } = list

/* ── 统计卡片（口径基于当前时间范围 + 筛选后的全量结果，与列表联动） ── */
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

const activeMetric = computed(() => {
  if (query.nature === 'WRITE') return 'write'
  if (query.result === 'FAILED') return 'failed'
  if (query.result === 'PENDING') return 'pending'
  return ''
})

function chooseMetric(key) {
  query.result = ''
  query.nature = ''
  if (key === 'write') query.nature = 'WRITE'
  if (key === 'failed') query.result = 'FAILED'
  if (key === 'pending') query.result = 'PENDING'
  list.search()
}

/* ── 统计口径说明（PRD §二，卡片下方【统计口径】入口展开） ── */
const HELP = [
  '调用请求包含成功、执行失败、执行前拦截、用户取消和待确认五类结果；一次任务内的重试按新的调用请求单独记录。',
  '执行耗时只统计工具实际执行时间，不含等待用户确认的时间；"待确认"反映当前尚未处理的请求，不是历史累计数量。'
]

/* ── 导出 CSV ── */
function exportCsv() {
  const rowsToExport = statsAll.value
  downloadCsv(
    '工具调用审计-技能调用-筛选结果.csv',
    ['请求编号', '日期', '时间', '用户', '岗位', '技能', '工具', '性质', '确认', '结果', '原因', '执行耗时', '确认等待'],
    rowsToExport.map((r) => [
      r.id, r.date, r.time, r.user, r.position, r.skill, r.tool,
      NATURE_LABEL[r.nature], CONFIRM_LABEL[r.confirm], RESULT_LABEL[r.result], r.reason, r.duration, r.wait
    ])
  )
  ElMessage.success(`已导出 ${rowsToExport.length} 条筛选结果`)
}

/* ── 详情抽屉：把一条记录翻译成抽屉需要的几份数据 ── */
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
      { label: '技能', value: d.skill },
      { label: '工具标识', value: d.tool, mono: true },
      { label: '执行耗时 / 等待确认', value: `${d.duration} / ${d.wait}` }
    ],
    steps: timelineSteps(d),
    explain: resultExplain(d),
    params: paramsOf(d),
    output: outputOf(d)
  }
})

function resultExplain(d) {
  if (d.result === 'FAILED') return '建议检查连接器状态及工具服务日志，并核对是否已有后续重试记录。'
  if (d.result === 'BLOCKED') return '请核对该岗位允许使用的工具和用户权限，再由发起人重新提交任务。'
  if (d.result === 'CANCELLED') return '本次操作已终止。如仍需执行，请由发起人重新发起。'
  if (d.result === 'PENDING') return '等待发起人在客户端处理，此页不代替用户确认。'
  return '本次调用已完成，可查看返回信息。'
}

/** 执行过程时间线：拦截 / 取消 / 待确认会在对应节点停止，不展示后续阶段（PRD §5.2）。 */
function timelineSteps(d) {
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
