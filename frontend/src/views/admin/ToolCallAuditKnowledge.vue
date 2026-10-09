<script setup>
/**
 * 工具调用审计 · 「知识库检索」页签——用户提问时，岗位 / 专家引用的知识库经 API / MCP 数据源
 * 向第三方知识服务发出的检索请求的事后审计记录，只读。对应 PRD §九。
 *
 * 和另两个页签的差别：
 *   - 只记外部调用：上传型数据源走平台 RAG，不入本页；管理端的「检索测试」「测试连接」是管理操作，也不入本页；
 *   - 只读、不需确认，结果只有 成功 / 执行失败 / 执行前拦截（如用户无该知识库访问权限）；
 *   - 命中 0 条属于「成功」，用「命中条数」区分，统计卡片单列「无命中检索」；
 *   - 审计关心的是「检索词发给了谁、命中了哪些内容」，所以列表看检索词与命中条数，没有操作性质 / 确认；
 *   - 检索词的记录与脱敏口径产品尚未定义，页面按原文展示并标【待补充】（docs/04-待补需求定义/）。
 */
import { computed, reactive, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import AuditMetricGrid from '@/components/admin/AuditMetricGrid.vue'
import AuditStepsDrawer from '@/components/admin/AuditStepsDrawer.vue'
import { useAuditList } from '@/composables/useAuditList'
import { downloadCsv } from '@/utils/downloadCsv'
import { COL, COL_NOWRAP } from '@/utils/tableLayout'
import {
  listKnowledgeCallAudits,
  knowledgeCallRecords,
  knowledgeParamsOf,
  knowledgeOutputOf,
  RESULT_LABEL,
  UNATTENDED_RESULTS
} from '@/api/toolCallAuditMock'

const RESULT_TAG = { SUCCESS: 'success', FAILED: 'danger', BLOCKED: 'warning' }
const SOURCE_TYPES = ['API', 'MCP']
const HIT_LABEL = { HIT: '有命中', NONE: '无命中' }

/** 数据源类型取自 source 前缀（「MCP·法规库检索」→ MCP）。 */
const sourceTypeOf = (r) => r.source.split('·')[0]
/** 「无命中」= 检索成功但命中 0 条；失败 / 拦截的检索没有命中一说。 */
const isNoHit = (r) => r.result === 'SUCCESS' && r.hitCount === 0

/* ── 筛选：时间范围 / 关键词 / 排序由 useAuditList 管，这里只声明本页签自己的条件 ── */
const query = reactive({ result: '', sourceType: '', hit: '' })

const {
  dateRange, disabledDate, onCalendarChange,
  sortArrow, toggleSort,
  keyword, applySearch, onClearSearch,
  list, statsAll
} = useAuditList({
  fetcher: listKnowledgeCallAudits,
  records: knowledgeCallRecords,
  matches: (r) =>
    (!query.result || r.result === query.result) &&
    (!query.sourceType || sourceTypeOf(r) === query.sourceType) &&
    (!query.hit || (query.hit === 'NONE' ? isNoHit(r) : r.result === 'SUCCESS' && r.hitCount > 0)),
  keywordOf: (r) => [r.user, r.position, r.kb, r.source, r.query, r.id]
})
const { rows, total, page, pageSize, loading, loadError, isEmpty } = list

/* ── 统计卡片（PRD §九.2） ── */
const metrics = computed(() => {
  const all = statsAll.value
  const count = (result) => all.filter((r) => r.result === result).length
  return [
    {
      key: 'all',
      label: '检索请求总数',
      value: all.length,
      sub: `成功 ${count('SUCCESS')} / 失败 ${count('FAILED')} / 拦截 ${count('BLOCKED')}`
    },
    {
      key: 'nohit',
      label: '无命中检索',
      value: all.filter(isNoHit).length,
      sub: '检索成功但命中 0 条',
      warn: true
    },
    {
      key: 'failed',
      label: '执行失败',
      value: count('FAILED'),
      sub: '已尝试检索但未成功',
      danger: true
    },
    {
      key: 'blocked',
      label: '执行前拦截',
      value: count('BLOCKED'),
      sub: '未向数据源发出请求',
      warn: true
    }
  ]
})

const activeMetric = computed(() => {
  if (query.hit === 'NONE') return 'nohit'
  if (query.result === 'FAILED') return 'failed'
  if (query.result === 'BLOCKED') return 'blocked'
  return ''
})

function chooseMetric(key) {
  query.result = ''
  query.sourceType = ''
  query.hit = ''
  if (key === 'nohit') query.hit = 'NONE'
  if (key === 'failed') query.result = 'FAILED'
  if (key === 'blocked') query.result = 'BLOCKED'
  list.search()
}

const HELP = [
  '检索请求指经 API / MCP 数据源向第三方知识服务发出的检索，包含成功、执行失败和执行前拦截三类结果；上传型数据源走平台检索，不在此记录。',
  '命中 0 条的检索属于"成功"，单独统计为"无命中检索"。执行耗时为数据源实际响应时间。'
]

/* ── 导出 CSV ── */
function exportCsv() {
  const rowsToExport = statsAll.value
  downloadCsv(
    '工具调用审计-知识库检索-筛选结果.csv',
    ['请求编号', '日期', '时间', '用户', '岗位', '知识库', '数据源', '检索工具', '检索词', '返回条数上限', '命中条数', '结果', '原因', '执行耗时'],
    rowsToExport.map((r) => [
      r.id, r.date, r.time, r.user, r.position, r.kb, r.source, r.tool, r.query, r.topK,
      r.result === 'SUCCESS' ? r.hitCount : '', RESULT_LABEL[r.result], r.reason, r.duration
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
    title: `检索详情 · ${d.id}`,
    result: { label: RESULT_LABEL[d.result], type: RESULT_TAG[d.result] },
    summary: [
      { label: '用户 / 岗位', value: `${d.user} / ${d.position}` },
      { label: '知识库', value: d.kb },
      { label: '数据源', value: d.source, mono: true },
      { label: '检索工具', value: d.tool || '—', mono: true },
      { label: '命中条数', value: d.result === 'SUCCESS' ? String(d.hitCount) : '—' },
      { label: '执行耗时', value: d.duration }
    ],
    steps: timelineSteps(d),
    explain: resultExplain(d),
    params: knowledgeParamsOf(d),
    output: knowledgeOutputOf(d),
    paramsHint: '检索词按用户提问原文记录，脱敏口径【待补充】'
  }
})

function resultExplain(d) {
  if (d.result === 'FAILED') return '建议在知识库的"数据源管理"中重新测试该数据源的连接，并检查第三方知识服务状态。'
  if (d.result === 'BLOCKED') return '请核对该用户所属岗位是否引用了该知识库，以及用户的知识库访问权限。'
  if (d.hitCount === 0) return '检索成功但没有命中内容，可核对检索词与数据源内容是否匹配。'
  return '本次检索已完成，可查看命中的内容来源。'
}

/** 执行过程时间线：被拦截的检索在「调用检查」节点停止，不展示后续阶段（PRD §九.5）。 */
function timelineSteps(d) {
  const steps = [
    { time: d.time, title: '发起检索', desc: `${d.user} 通过「${d.position}」提问，引用的知识库「${d.kb}」向数据源「${d.source}」发起检索。`, type: 'primary' }
  ]
  if (d.result === 'BLOCKED') {
    steps.push({ time: '', title: '检查未通过，已拦截', desc: `${d.reason}。请求未发送到数据源。`, type: 'danger' })
    return steps
  }
  steps.push({ time: '', title: '调用检查通过', desc: '请求发送到数据源。', type: 'primary' })
  steps.push({
    time: '',
    title: RESULT_LABEL[d.result],
    desc: d.result === 'SUCCESS' ? `检索耗时 ${d.duration}，命中 ${d.hitCount} 条` : `检索耗时 ${d.duration} / ${d.reason}`,
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
      <el-select v-model="query.sourceType" placeholder="全部数据源类型" clearable class="lt-filter" @change="list.search()">
        <el-option v-for="t in SOURCE_TYPES" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="query.hit" placeholder="全部命中情况" clearable class="lt-filter" @change="list.search()">
        <el-option v-for="(label, key) in HIT_LABEL" :key="key" :label="label" :value="key" />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="搜索用户 / 岗位 / 知识库 / 检索词"
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
        empty-text="暂无符合条件的检索记录"
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
          <el-table-column label="知识库 / 数据源" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.kb }}<span class="tca-secondary tca-mono">{{ row.source }}</span>
            </template>
          </el-table-column>
          <el-table-column label="检索词" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.query }}</template>
          </el-table-column>
          <el-table-column label="命中条数" :width="COL.COUNT + 8" align="center" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">{{ row.result === 'SUCCESS' ? row.hitCount : '—' }}</template>
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

    <AuditStepsDrawer v-model:visible="detailVisible" v-bind="detail || {}" />
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
