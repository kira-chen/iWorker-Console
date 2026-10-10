<script setup>
/**
 * 工具调用审计 · 「岗位自动化任务」页签——岗位自动化任务按调度计划触发（无人值守）的一次任务运行，
 * 运行中通过任务「引用工具」或所引用的技能 / Agent 调用连接器工具的事后审计记录，只读。对应 PRD §八。
 *
 * 2026-10-09 记录单元改版（与研发梅竹讨论后）：记录单元从「一次工具调用」改为「一次任务运行」，
 * 与「技能调用」页签同一套模型，工具调用明细挪进详情（§8.5）。同轮讨论拍板：自动化任务全部
 * 操作免授权、不经确认，读写一致处理——原「写操作预授权」（已预授权 / 未授权）整套字段废弃；
 * 原「任务运行编号」字段随之废弃，记录本身已是运行级，不必再用字段串联。
 *
 * 和「技能调用」页签的差别都来自「没有用户在场」：user / position 是任务所属用户（领用该岗位
 * 的用户）及其岗位，不是发起人，触发的是调度计划；没有用户确认、没有授权环节，读写操作展示
 * 规则一致；不展示「进行中」——免授权不会运行到一半停下等人处理。
 *
 * 2026-10-09 同日改版：不展示耗时与具体执行时刻——系统本来就不采集单次工具调用的过程时间
 * 数据。执行结果收窄为**成功 / 失败**两态（原「执行前拦截」并入「失败」，原因文案保留）——
 * 与技能调用完全同构，判定规则与标签都直接复用（deriveExec / EXEC_RESULT_LABEL）。
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
  EXEC_RESULT_LABEL,
  RESULT_LABEL,
  NATURE_LABEL
} from '@/api/toolCallAuditMock'

const RUN_RESULT_TAG = { SUCCESS: 'success', FAILED: 'danger' }
const CALL_RESULT_TAG = { SUCCESS: 'success', FAILED: 'danger' }
const YES_NO = { true: '是', false: '否' }
const YES_NO_TAG = (v) => (v ? 'accent' : 'info')

/* ── 筛选：时间范围 / 关键词 / 排序由 useAuditList 管，这里只声明本页签自己的条件 ── */
const query = reactive({ result: '', hasWrite: '' })

const {
  dateRange, disabledDate, onCalendarChange,
  sortArrow, toggleSort,
  keyword, applySearch, onClearSearch,
  list, statsAll
} = useAuditList({
  fetcher: listTaskCallAudits,
  records: taskCallRecords,
  matches: (r) => (!query.result || r.result === query.result) && (query.hasWrite === '' || r.hasWrite === query.hasWrite),
  keywordOf: (r) => [r.user, r.position, r.task, r.trigger, r.id, ...r.calls.map((c) => c.tool)]
})
const { rows, total, page, pageSize, loading, loadError, isEmpty } = list

/* ── 统计卡片（PRD §8.2） ── */
const metrics = computed(() => {
  const all = statsAll.value
  const count = (result) => all.filter((r) => r.result === result).length
  const writes = all.filter((r) => r.hasWrite)
  return [
    {
      key: 'all',
      label: '运行总数',
      value: all.length,
      sub: `成功 ${count('SUCCESS')} / 失败 ${count('FAILED')}`
    },
    {
      key: 'write',
      label: '涉及写操作的运行',
      value: writes.length,
      sub: `成功 ${writes.filter((r) => r.result === 'SUCCESS').length} / 失败 ${writes.filter((r) => r.result === 'FAILED').length}`
    },
    {
      key: 'failed',
      label: '执行失败',
      value: count('FAILED'),
      sub: '按整体结果判定',
      danger: true
    }
  ]
})

const activeMetric = computed(() => {
  if (query.hasWrite === true) return 'write'
  if (query.result === 'FAILED') return 'failed'
  return ''
})

function chooseMetric(key) {
  query.result = ''
  query.hasWrite = ''
  if (key === 'write') query.hasWrite = true
  if (key === 'failed') query.result = 'FAILED'
  list.search()
}

const HELP = [
  '执行结果只有成功、失败两类：任务无人值守、全部操作免授权，不会运行到一半停下等人处理，没有"进行中"。按整体是否完成预期产出判定成功 / 失败——哪怕中途有工具调用失败，只要后续被兜底 / 重试成功，整体仍记"成功"。',
  '单次工具调用的具体耗时与执行时刻不采集，不在本页展示。'
]

/* ── 导出 CSV ── */
function exportCsv() {
  const rowsToExport = statsAll.value
  downloadCsv(
    '工具调用审计-岗位自动化任务-筛选结果.csv',
    ['请求编号', '日期', '时间', '用户', '岗位', '任务', '触发方式', '涉及写操作', '执行结果', '原因'],
    rowsToExport.map((r) => [
      r.id, r.date, r.time, r.user, r.position, r.task, r.trigger,
      YES_NO[r.hasWrite], EXEC_RESULT_LABEL[r.result], r.reason
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
    title: `运行详情 · ${d.id}`,
    result: { label: EXEC_RESULT_LABEL[d.result], type: RUN_RESULT_TAG[d.result] },
    summary: [
      { label: '用户 / 岗位', value: `${d.user} / ${d.position}` },
      { label: '自动化任务', value: d.task },
      { label: '触发方式', value: d.trigger },
      { label: '涉及写操作', value: YES_NO[d.hasWrite] }
    ],
    calls: d.calls.map((c) => ({
      tool: c.tool,
      nature: { label: NATURE_LABEL[c.nature], type: c.nature === 'WRITE' ? 'accent' : 'info' },
      confirm: null,
      result: { label: RESULT_LABEL[c.result], type: CALL_RESULT_TAG[c.result] },
      reason: c.reason,
      // 2026-10-09 收窄展示范围：成功的只读调用不展示参数/响应，规则同技能调用页签（§8.5）。
      showParams: c.nature === 'WRITE' || c.result !== 'SUCCESS',
      params: paramsOf(c),
      output: outputOf(c)
    })),
    explain: resultExplain(d),
    emptyCallsText: '本次运行未调用外部工具'
  }
})

function resultExplain(d) {
  if (d.result === 'FAILED') return '建议对照下方工具调用明细，核对出问题的具体工具的连接器状态或权限，并确认是否已有后续重试记录。'
  return '本次运行已完成，可在工具调用明细中查看具体过程。'
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
      <el-select v-model="query.result" placeholder="全部结果" clearable class="lt-filter" @change="list.search()">
        <el-option v-for="(label, key) in EXEC_RESULT_LABEL" :key="key" :label="label" :value="key" />
      </el-select>
      <el-select v-model="query.hasWrite" placeholder="全部" clearable class="lt-filter" @change="list.search()">
        <el-option label="是" :value="true" />
        <el-option label="否" :value="false" />
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
        empty-text="暂无符合条件的运行记录"
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
          <el-table-column label="任务" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">{{ row.task }}</template>
          </el-table-column>
          <el-table-column label="触发方式" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.trigger }}</template>
          </el-table-column>
          <el-table-column label="涉及写操作" :width="COL.TAG" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <StatusTag :type="YES_NO_TAG(row.hasWrite)">{{ YES_NO[row.hasWrite] }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="执行结果 / 原因" min-width="220">
            <template #default="{ row }">
              <StatusTag :type="RUN_RESULT_TAG[row.result]">{{ EXEC_RESULT_LABEL[row.result] }}</StatusTag>
              <span v-if="row.reason" class="tca-secondary">{{ row.reason }}</span>
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
</style>
