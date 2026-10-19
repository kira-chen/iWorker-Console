<script setup>
/**
 * 用户访问权限 · 操作记录页签（PRD 06组织/用户访问权限 §四之二）。
 *
 * 记录单元是「一次开启了完全访问的会话任务」（同工具调用审计「会话调用」）：员工开启完全访问后，
 * 数字员工在该会话里做了哪些操作，由员工端上传留痕，这里只读查看、备审计。
 * 只记原本需要用户二次确认的操作，外加被客户端直接拦截的命令（毁灭级命令、sudo -S 猜密码、approvals.deny 规则命中，标「已拦截」，没有执行）（4 项权限：读写文件、执行命令、操作业务系统（含 SOP 回放提交步）、联网与连接器），
 * 本来就不弹窗的操作（如读文件）不记。客户端本地对话不主动回传（同驾驶舱口径），所以不记会话任务名，也不展示会话 ID：一个会话的操作由客户端打包成一条记录上传，行标识由管理端自己生成。
 * 数据全部留存，管理端只展示近 90 天（时间范围不可选更早的日期，也不会列出更早的记录）。点【查看详情】在抽屉里按发生顺序看会话内的每一步操作。
 * 取数 + 时间范围 + 排序 + 搜索的编排与工具调用审计各页签同一套（composables/useAuditList）：
 * 默认展示今天向前 90 天，单次最多选 30 天跨度。没有任何写入口，记录不可改删。
 */
import { ref, computed } from 'vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuditList } from '@/composables/useAuditList'
import { listAccessOperations, accessOperationRecords } from '@/api/userAccess'
import { OPERATION_ENV, OPERATION_TYPE, OPERATION_RESULT, BLOCKED_TYPE } from '@/utils/userAccess'
import { COL, COL_NOWRAP } from '@/utils/tableLayout'

const props = defineProps({
  /** 授权名单【查看】跳转带入的员工用户名，作为初始搜索词 */
  focusKeyword: { type: String, default: '' },
  /** 【查看】按该行的运行环境带入的环境筛选；空 = 全部环境 */
  focusEnv: { type: String, default: '' }
})

const query = ref({ env: props.focusEnv, type: '' })

// 管理端只展示近 90 天（含今天）：更早的数据后端仍留存，这里既不可选也不列出
const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const windowStart = () => { const t = day(new Date()); t.setDate(t.getDate() - 89); return t }
const inWindow = (dateStr) => new Date(dateStr) >= windowStart()

const {
  dateRange, disabledDate: spanDisabled, onCalendarChange,
  sortArrow, toggleSort,
  keyword, applySearch, onClearSearch,
  list
} = useAuditList({
  fetcher: listAccessOperations,
  records: accessOperationRecords,
  // 权限类型筛选：会话里至少有一次该类型的操作就算命中
  matches: (r) => inWindow(r.date) && (!query.value.env || r.env === query.value.env) && (!query.value.type || r.ops.some((o) => o.type === query.value.type)),
  keywordOf: (r) => [r.username, r.name, ...r.ops.map((o) => o.target)],
  initialKeyword: props.focusKeyword // 首次取数前生效，不再「先查全量、再按词查」取两次
})
const { rows, total, page, pageSize, loading, loadError, loadErrorMessage, isEmpty } = list
// 在「单次最多 30 天跨度」之上，再限制不能选近 90 天之外的日期（含未来）
const disabledDate = computed(() => {
  const span = spanDisabled.value
  return (d) => span(d) || day(d) < windowStart() || day(d) > day(new Date())
})

// 会话内涉及的权限类型，去重后按首次出现顺序，列表里顿号分隔
const executed = (row) => row.ops.filter((o) => o.result !== 'BLOCKED').length
const blocked = (row) => row.ops.filter((o) => o.result === 'BLOCKED').length
const typesOf = (row) => [...new Set(row.ops.map((o) => OPERATION_TYPE[o.type]))].join('、')

/* ── 详情抽屉：会话摘要 + 会话内的操作明细（按发生顺序，不标时间点） ── */
const detailVisible = ref(false)
const current = ref(null)
function showDetail(row) {
  current.value = row
  detailVisible.value = true
}
const summary = computed(() => {
  const d = current.value
  if (!d) return []
  return [
    { label: '用户', value: `${d.name}（${d.username}）` },
    { label: '运行环境', value: OPERATION_ENV[d.env].label },
    // 会话开启时间不进摘要，放抽屉底栏左下角；免确认操作与已拦截操作并排在同一行（没有拦截时显示 0 次，版式不跳动）
    { label: '免确认操作', value: `${executed(d)} 次` },
    { label: '已拦截操作', value: `${blocked(d)} 次` }
  ]
})
</script>

<template>
  <div class="ua-pane">
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
      <el-select v-model="query.env" placeholder="全部运行环境" clearable class="lt-filter" @change="list.search()">
        <el-option v-for="(meta, key) in OPERATION_ENV" :key="key" :label="meta.label" :value="key" />
      </el-select>
      <el-select v-model="query.type" placeholder="全部权限类型" clearable class="lt-filter" @change="list.search()">
        <el-option v-for="(label, key) in OPERATION_TYPE" :key="key" :label="label" :value="key" />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="搜索员工 / 操作对象"
        clearable
        class="lt-search"
        @keyup.enter="applySearch"
        @clear="onClearSearch"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button @click="applySearch">查询</el-button>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates :loading="loading" :error="loadError" :error-message="loadErrorMessage" :empty="isEmpty" empty-text="没有符合条件的操作记录" @retry="list.reload">
        <el-table v-loading="loading" :data="rows" row-key="id">
          <el-table-column :width="COL.TIME + 24" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #header>
              <button type="button" class="time-sort" @click="toggleSort">
                会话开启时间 <span class="time-sort-arrow">{{ sortArrow }}</span>
              </button>
            </template>
            <template #default="{ row }"><span class="ua-muted">{{ row.date }} {{ row.time }}</span></template>
          </el-table-column>
          <el-table-column label="用户名" min-width="130" show-overflow-tooltip>
            <template #default="{ row }"><span class="ua-name">{{ row.username }}</span></template>
          </el-table-column>
          <el-table-column prop="name" label="显示名" min-width="90" show-overflow-tooltip />
          <el-table-column label="运行环境" :width="COL.STATUS + 16" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              <StatusTag :type="OPERATION_ENV[row.env].tag">{{ OPERATION_ENV[row.env].label }}</StatusTag>
            </template>
          </el-table-column>
          <el-table-column label="免确认操作" width="130" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }">
              {{ executed(row) }} 次
            </template>
          </el-table-column>
          <el-table-column label="已拦截操作" width="110" :class-name="COL_NOWRAP" :label-class-name="COL_NOWRAP">
            <template #default="{ row }"><span v-if="blocked(row)" class="ua-warn">{{ blocked(row) }} 次</span><span v-else class="ua-muted">—</span></template>
          </el-table-column>
          <el-table-column label="涉及权限类型" :min-width="COL.DESC_MIN" show-overflow-tooltip>
            <template #default="{ row }">{{ typesOf(row) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="showDetail(row)">查看详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" @change="list.reload" />

    <DrawerEditor v-model:visible="detailVisible" title="会话详情" readonly size="720px">
      <div class="detail-section">
        <h3>会话摘要</h3>
        <el-descriptions :column="2" border class="ua-summary">
          <el-descriptions-item v-for="item in summary" :key="item.label" :label="item.label" :span="item.span || 1">{{ item.value }}</el-descriptions-item>
        </el-descriptions>
      </div>
      <div v-if="current" class="detail-section">
        <h3>
          操作明细
          <!-- 口径说明收进 ? 图标，点击浮层显示，不占抽屉底部一大块 -->
          <el-popover placement="bottom-start" trigger="click" :width="340" popper-class="ua-help-popper">
            <template #reference>
              <el-icon class="ua-help-icon" aria-label="操作明细口径说明"><QuestionFilled /></el-icon>
            </template>
            <ul class="ua-help-list">
              <li>这些操作原本都需要员工逐次二次确认；该会话开启了完全访问，数字员工直接执行，这里留痕备审计。</li>
              <li>毁灭级命令、sudo -S 猜密码、命中管理规则（approvals.deny）的命令始终被客户端直接拦截、未执行，也记在这里并标「已拦截」，便于审计看到有没有人反复尝试危险操作。</li>
              <li>操作对象为脱敏后的内容：路径只保留前两级目录，接口入参只保留参数名，不含参数值、表单内容与密钥口令。</li>
            </ul>
          </el-popover>
        </h3>
        <el-timeline class="detail-timeline">
          <el-timeline-item v-for="(op, i) in current.ops" :key="i" :type="OPERATION_RESULT[op.result].tag" placement="top">
            <div class="ua-op-head">
              <StatusTag :type="op.type === BLOCKED_TYPE.key ? 'warning' : 'accent'">{{ OPERATION_TYPE[op.type] }}</StatusTag>
              <StatusTag :type="OPERATION_RESULT[op.result].tag">{{ OPERATION_RESULT[op.result].label }}</StatusTag>
            </div>
            <p class="ua-op-target">{{ op.target }}</p>
            <p v-if="op.reason" class="ua-danger">{{ op.reason }}</p>
          </el-timeline-item>
        </el-timeline>
      </div>
      <!-- 底栏：左下角放会话开启时间，右侧关闭（同其他详情抽屉的底栏范式） -->
      <template #footer>
        <span class="ua-foot-time">会话开启时间：{{ current ? `${current.date} ${current.time}` : '' }}</span>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </DrawerEditor>
  </div>
</template>

<style scoped>
.ua-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
/* 用户名加粗（同用户页 .users-name） */
.ua-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.ua-muted {
  color: var(--c-text-faint);
}
.ua-warn {
  color: var(--c-warning);
}
/* 摘要两列对齐：表格定宽布局，两组「标签 | 值」各占一半，标签列同宽，值列同宽 */
.ua-summary :deep(.el-descriptions__table) {
  table-layout: fixed;
}
.ua-summary :deep(.el-descriptions__label) {
  width: 110px;
}
.ua-foot-time {
  margin-right: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ua-danger {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.detail-section {
  margin-bottom: var(--space-4);
}
.detail-section h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
  font-size: 14px;
}
.ua-help-icon {
  font-size: 14px;
  color: var(--c-text-muted);
  cursor: pointer;
}
.ua-help-icon:hover {
  color: var(--c-accent);
}
.ua-op-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ua-op-target {
  margin: 6px 0 0;
  font-family: Consolas, monospace;
  font-size: var(--fs-sm);
  word-break: break-all;
}
/* 时间列排序按钮样式（对齐专家页「最近更新时间」） */
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
.lt-date-range {
  width: 240px;
  flex-shrink: 0;
}
</style>

<!-- el-popover 挂 body，scoped 命不中 -->
<style>
.ua-help-popper .ua-help-list {
  margin: 0;
  padding-left: 16px;
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text-muted);
}
</style>
