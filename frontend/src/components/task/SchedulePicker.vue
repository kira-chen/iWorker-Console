<script setup>
/**
 * 可视化调度选择器（PRD §7，不让用户手写 cron）。
 *
 * 单一职责：把「周期类型 + 联动控件 + 多个定点时间」编辑为契约 §0.3 的 Schedule 对象，
 * 通过 v-model:schedule 双向绑定。人话回显（summary）与「下 N 次」预览由父级调
 * preview-schedule 接口产出后经 props 传入，本组件不在前端硬算周期文案/nextFire（契约要求）。
 *
 * 时间口径（契约 §0.3）：times（"HH:mm"）、onceAt（"YYYY-MM-DDTHH:mm" 无时区）、
 * startDate/endDate（纯日期）均为「无时区本地墙钟」，入参不拼时区。
 */
import { computed, watch } from 'vue'

const props = defineProps({
  // Schedule 对象（受控）
  schedule: { type: Object, required: true },
  // 字段级错误（父级表单校验命中时传入，描红+提示）
  error: { type: String, default: '' },
  // 预览态（父级调 preview-schedule 后回传）
  previewSummary: { type: String, default: '' },
  previewTimes: { type: Array, default: () => [] },
  previewLoading: { type: Boolean, default: false },
  previewError: { type: String, default: '' }
})
const emit = defineEmits(['update:schedule', 'preview'])

const TYPES = [
  { value: 'DAILY', label: '每天' },
  { value: 'WEEKLY', label: '每周' },
  { value: 'MONTHLY', label: '每月' },
  { value: 'ONCE', label: '仅一次' }
]
const WEEK_DAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' }
]
// 每月日期 1..31（S6：去掉「月末 LAST」选项——后端发布门已拒绝月末，前端不再提供，只能选具体日期，避免选了被拒）
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))

const s = computed(() => props.schedule)

// S6：合法的每月日期集合（1..31）。历史存量可能带已下线的「月末 LAST」或其它游离值，
// 回填时须过滤，否则 multiple el-select 会出现无匹配的游离 tag（选项里没有该值）。
const VALID_MONTH_DAYS = new Set(MONTH_DAYS.map((d) => d.value))
function sanitizeDaysOfMonth(list) {
  return (Array.isArray(list) ? list : []).filter((d) => VALID_MONTH_DAYS.has(Number(d)))
}
// 展示用（过滤游离值），供 el-select model-value 使用，避免出现无匹配 tag。
const monthDays = computed(() => sanitizeDaysOfMonth(props.schedule.daysOfMonth))
// 是否检出被过滤掉的存量游离值（如已下线的「月末」）——用于一次性人话提示。
const hadStaleMonthDay = computed(
  () =>
    props.schedule.scheduleType === 'MONTHLY' &&
    (props.schedule.daysOfMonth || []).length > monthDays.value.length
)

// 统一 patch：合并字段后向上抛，附带「变更后需重新预览」信号
function patch(part) {
  emit('update:schedule', { ...props.schedule, ...part })
  emit('preview')
}

// 存量回填若含游离的每月日期（如「月末」），静默剔除并回写，避免脏值随提交带回后端。
watch(
  () => [props.schedule.scheduleType, props.schedule.daysOfMonth],
  () => {
    if (props.schedule.scheduleType !== 'MONTHLY') return
    const cleaned = sanitizeDaysOfMonth(props.schedule.daysOfMonth)
    if (cleaned.length !== (props.schedule.daysOfMonth || []).length) {
      emit('update:schedule', { ...props.schedule, daysOfMonth: cleaned })
    }
  },
  { immediate: true }
)

function onType(type) {
  if (type === props.schedule.scheduleType) return
  // 切类型时清理无关字段，保留 times / 生效区间，避免脏数据带入提交
  const next = { ...props.schedule, scheduleType: type }
  if (type !== 'WEEKLY') next.daysOfWeek = []
  if (type !== 'MONTHLY') next.daysOfMonth = []
  if (type !== 'ONCE' && (!next.times || !next.times.length)) next.times = ['09:00']
  emit('update:schedule', next)
  emit('preview')
}

/* ---------------- 多定点时间（DAILY/WEEKLY/MONTHLY） ---------------- */
const times = computed(() => props.schedule.times || [])

function addTime() {
  patch({ times: [...times.value, '09:00'] })
}
function setTime(idx, val) {
  // el-time-picker valueFormat=HH:mm 直出字符串；空值忽略
  const next = times.value.slice()
  next[idx] = val || ''
  patch({ times: next })
}
function removeTime(idx) {
  patch({ times: times.value.filter((_, i) => i !== idx) })
}

/* ---------------- ONCE：日期时间（本地墙钟，无时区后缀） ---------------- */
function setOnceAt(val) {
  // el-date-picker valueFormat="YYYY-MM-DDTHH:mm" 直出无时区字符串
  patch({ onceAt: val || '' })
}

/* ---------------- 生效/失效区间（P1，纯日期） ---------------- */
function setStartDate(val) {
  patch({ startDate: val || '' })
}
function setEndDate(val) {
  patch({ endDate: val || '' })
}

// 每月含大日期提示（29–31 小月可能不触发）
const showMonthHint = computed(
  () =>
    props.schedule.scheduleType === 'MONTHLY' &&
    monthDays.value.some((d) => Number(d) >= 29)
)
</script>

<template>
  <div class="sp" :class="{ 'sp-error': !!error }">
    <!-- 第一步：周期类型 -->
    <div class="sp-row">
      <span class="sp-label">周期类型</span>
      <el-radio-group :model-value="s.scheduleType" @update:model-value="onType">
        <el-radio-button v-for="t in TYPES" :key="t.value" :value="t.value">
          {{ t.label }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <!-- 每周：星期多选 -->
    <div v-if="s.scheduleType === 'WEEKLY'" class="sp-row">
      <span class="sp-label">执行星期</span>
      <el-checkbox-group
        :model-value="s.daysOfWeek || []"
        class="sp-week"
        @update:model-value="patch({ daysOfWeek: $event })"
      >
        <el-checkbox-button v-for="d in WEEK_DAYS" :key="d.value" :value="d.value">
          周{{ d.label }}
        </el-checkbox-button>
      </el-checkbox-group>
    </div>

    <!-- 每月：日期多选 -->
    <div v-if="s.scheduleType === 'MONTHLY'" class="sp-row sp-row-top">
      <span class="sp-label">执行日期</span>
      <div class="sp-month-wrap">
        <el-select
          :model-value="monthDays"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="选择每月执行日期"
          no-data-text="没有可选日期"
          no-match-text="没有匹配的日期"
          class="sp-month"
          @update:model-value="patch({ daysOfMonth: $event })"
        >
          <el-option
            v-for="d in MONTH_DAYS"
            :key="d.value"
            :label="`${d.value} 日`"
            :value="d.value"
          />
        </el-select>
        <!-- S6：存量「月末」已下线，检出即提示用户重挑具体日期 -->
        <p v-if="hadStaleMonthDay" class="sp-tip">原「月末」已下线，请重新选择具体日期。</p>
        <p v-if="showMonthHint" class="sp-tip">
          所选含 29–31 日，遇小月（如 2 月）当月不触发，请注意挑选合适的日期。
        </p>
      </div>
    </div>

    <!-- 仅一次：具体日期时间 -->
    <div v-if="s.scheduleType === 'ONCE'" class="sp-row">
      <span class="sp-label">执行时间</span>
      <el-date-picker
        :model-value="s.onceAt"
        type="datetime"
        placeholder="选择具体日期和时间"
        format="YYYY-MM-DD HH:mm"
        value-format="YYYY-MM-DDTHH:mm"
        @update:model-value="setOnceAt"
      />
    </div>

    <!-- 多定点时间（非 ONCE） -->
    <div v-if="s.scheduleType !== 'ONCE'" class="sp-row sp-row-top">
      <span class="sp-label">定点时间</span>
      <div class="sp-times">
        <div v-for="(t, i) in times" :key="i" class="sp-time-item">
          <el-time-picker
            :model-value="t"
            placeholder="HH:mm"
            format="HH:mm"
            value-format="HH:mm"
            @update:model-value="setTime(i, $event)"
          />
          <el-button
            v-if="times.length > 1"
            link
            class="sp-time-del"
            @click="removeTime(i)"
          >
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <el-button link class="sp-add-time" @click="addTime">
          <el-icon><Plus /></el-icon> 添加时间
        </el-button>
        <p class="sp-tip">支持一天多个定点（如 09:00 / 11:00 / 13:00），同日自动去重。</p>
      </div>
    </div>

    <!-- 生效/失效区间（可选，P1） -->
    <div class="sp-row sp-row-top">
      <span class="sp-label">起止日期</span>
      <div class="sp-range">
        <el-date-picker
          :model-value="s.startDate"
          type="date"
          placeholder="从哪天开始（不填=立即）"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          @update:model-value="setStartDate"
        />
        <span class="sp-range-sep">至</span>
        <el-date-picker
          :model-value="s.endDate"
          type="date"
          placeholder="到哪天结束（不填=一直有效）"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          @update:model-value="setEndDate"
        />
      </div>
    </div>

    <div v-if="error" class="sp-err-text">{{ error }}</div>

    <!-- 人话回显 + 下 N 次预览（由父级 preview-schedule 产出） -->
    <div class="sp-preview">
      <div class="sp-preview-head">
        <el-icon class="sp-preview-icon"><MagicStick /></el-icon>
        <span v-if="previewLoading" class="sp-preview-summary">正在推算执行计划…</span>
        <span v-else-if="previewError" class="sp-preview-summary is-error">{{ previewError }}</span>
        <span v-else-if="previewSummary" class="sp-preview-summary">{{ previewSummary }}</span>
        <span v-else class="sp-preview-summary is-faint">完善周期后，这里实时显示执行计划</span>
      </div>
      <ul v-if="!previewLoading && !previewError && previewTimes.length" class="sp-next">
        <li class="sp-next-label">接下来 {{ previewTimes.length }} 次：</li>
        <li v-for="(t, i) in previewTimes" :key="i" class="sp-next-item">{{ t }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.sp {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.sp-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.sp-row-top {
  align-items: flex-start;
}
.sp-label {
  width: 72px;
  flex-shrink: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  padding-top: 2px;
}
.sp-week :deep(.el-checkbox-button__inner) {
  border-radius: 0;
}

.sp-month-wrap {
  flex: 1;
  min-width: 0;
}
.sp-month {
  width: 100%;
  max-width: 420px;
}
.sp-tip {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-warning);
  line-height: var(--lh-base);
}

.sp-times {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}
.sp-time-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.sp-time-del {
  color: var(--c-text-faint);
}
.sp-time-del:hover {
  color: var(--c-danger);
}
.sp-add-time {
  color: var(--c-accent);
}
.sp-times .sp-tip {
  color: var(--c-text-faint);
}

.sp-range {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.sp-range-sep {
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}

.sp-err-text {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  padding-left: calc(72px + var(--space-4));
}

/* 预览区：淡强调底信息条（承载人话回显 + 下 N 次） */
.sp-preview {
  margin-top: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--c-accent-soft);
  border-radius: var(--radius-md);
  background: var(--c-accent-soft);
}
.sp-preview-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.sp-preview-icon {
  color: var(--c-accent);
}
.sp-preview-summary {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.sp-preview-summary.is-faint {
  color: var(--c-text-faint);
  font-weight: var(--fw-regular);
}
.sp-preview-summary.is-error {
  color: var(--c-danger);
  font-weight: var(--fw-regular);
}
.sp-next {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.sp-next-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.sp-next-item {
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  color: var(--c-accent);
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}
.sp-error {
  /* 容器级描红仅作弱提示，具体字段错误用 sp-err-text */
}
</style>
