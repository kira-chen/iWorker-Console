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
 *
 * 2026-09-09 原型复刻批次 4B（#19）：新增 `prototype` 开关（默认 false），
 * true 时按交互原型 enhanceSchedule 的形态呈现（分段按钮 / 星期按钮条 / ⏰ 时间行 / 绿底执行预览），
 * 仅岗位「自动化任务」页签传入；数据模型、校验与提交口径完全不变。
 */
import { computed, watch, ref } from 'vue'

const props = defineProps({
  // Schedule 对象（受控）
  schedule: { type: Object, required: true },
  // 字段级错误（父级表单校验命中时传入，描红+提示）
  error: { type: String, default: '' },
  // 预览态（父级调 preview-schedule 后回传）
  previewSummary: { type: String, default: '' },
  previewTimes: { type: Array, default: () => [] },
  previewLoading: { type: Boolean, default: false },
  previewError: { type: String, default: '' },
  // 2026-09-09 原型复刻批次 4B（#19）：岗位「自动化任务」页签按交互原型 enhanceSchedule 呈现——
  // 周期类型/执行星期改分段按钮组（.pd2-task-segmented / .pd2-task-weekdays），
  // 定点时间行改「序号圆 + ⏰ 输入框 + ×」，执行预览改绿底框 + 白底药丸。
  // 默认 false：用户端 TaskEditor 走原 Element Plus 形态，零回归。
  prototype: { type: Boolean, default: false }
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

// 原型态（#19）执行星期按钮：点一下切换该星期的选中态，保持数值升序（提交口径不变）
function toggleWeekday(value) {
  const cur = props.schedule.daysOfWeek || []
  const next = cur.includes(value)
    ? cur.filter((d) => d !== value)
    : [...cur, value].sort((a, b) => a - b)
  patch({ daysOfWeek: next })
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

// 原型态（#19）执行预览药丸文案：原型 normalizePreview 把 ISO 的 T / 秒 / 时区后缀去掉，
// 只留「YYYY-MM-DD HH:mm」。非 ISO 串原样返回（后端 summary 口径不变）。
function prettyTime(t) {
  return String(t ?? '').replace(/T(\d{2}:\d{2})(?::\d{2})?(?:[+-]\d{2}:\d{2}|Z)?$/, ' $1')
}

// 每月含大日期提示（29–31 小月可能不触发）
const showMonthHint = computed(
  () =>
    props.schedule.scheduleType === 'MONTHLY' &&
    monthDays.value.some((d) => Number(d) >= 29)
)

/* ══════ prototype=true 专用：三模式调度 ══════ */

const PROTO_MODES = [
  { value: 'PERIODIC', label: '按周期' },
  { value: 'INTERVAL', label: '每间隔' },
  { value: 'ONCE', label: '单次' }
]

const PERIODIC_PRESETS = [
  { value: 'DAILY',             label: '每天',      scheduleType: 'DAILY',   daysOfWeek: [],    daysOfMonth: [] },
  { value: 'WEEKLY_MON',        label: '每周一',    scheduleType: 'WEEKLY',  daysOfWeek: [1],   daysOfMonth: [] },
  { value: 'WEEKLY_MON_WED_FRI',label: '每周一三五',scheduleType: 'WEEKLY',  daysOfWeek: [1,3,5],daysOfMonth: [] },
  { value: 'WEEKLY_FRI',        label: '每周五',    scheduleType: 'WEEKLY',  daysOfWeek: [5],   daysOfMonth: [] },
  { value: 'MONTHLY_1',         label: '每月1日',   scheduleType: 'MONTHLY', daysOfWeek: [],    daysOfMonth: [1] }
]

const INTERVAL_UNITS = [
  { value: 'HOUR', label: '小时' },
  { value: 'DAY',  label: '天' },
  { value: 'WEEK', label: '周' }
]

function onProtoMode(mode) {
  if (mode === props.schedule.scheduleMode) return
  const next = { ...props.schedule, scheduleMode: mode }
  if (mode === 'ONCE') {
    next.scheduleType = 'ONCE'
  } else if (mode === 'INTERVAL') {
    next.scheduleType = `INTERVAL_${next.intervalUnit || 'DAY'}`
  } else {
    // PERIODIC：恢复到 periodicPreset 对应的 scheduleType
    const preset = PERIODIC_PRESETS.find((p) => p.value === (next.periodicPreset || 'DAILY')) || PERIODIC_PRESETS[0]
    next.scheduleType = preset.scheduleType
    next.daysOfWeek = preset.daysOfWeek.slice()
    next.daysOfMonth = preset.daysOfMonth.slice()
    if (!next.times || !next.times.length) next.times = ['09:00']
  }
  emit('update:schedule', next)
  emit('preview')
}

function onProtoPreset(preset) {
  if (preset.value === props.schedule.periodicPreset) return
  const cur = props.schedule.times?.length ? props.schedule.times : ['09:00']
  emit('update:schedule', {
    ...props.schedule,
    scheduleMode: 'PERIODIC',
    periodicPreset: preset.value,
    scheduleType: preset.scheduleType,
    daysOfWeek: preset.daysOfWeek.slice(),
    daysOfMonth: preset.daysOfMonth.slice(),
    times: cur
  })
  emit('preview')
}

function onProtoIntervalCount(val) {
  const count = Math.max(1, parseInt(val) || 1)
  emit('update:schedule', { ...props.schedule, intervalCount: count })
  emit('preview')
}

function onProtoIntervalUnit(unit) {
  emit('update:schedule', {
    ...props.schedule,
    intervalUnit: unit,
    scheduleType: `INTERVAL_${unit}`
  })
  emit('preview')
}

function onProtoTime(val) {
  emit('update:schedule', { ...props.schedule, times: [val || '09:00'] })
  emit('preview')
}
</script>

<template>
  <div class="sp" :class="{ 'sp-error': !!error, 'sp-proto': prototype }">

    <!-- ══════ prototype=true：按周期 / 每间隔 / 单次 三模式 ══════ -->
    <template v-if="prototype">
      <!-- 顶层模式 Tab -->
      <div class="sp-row">
        <span class="sp-label">执行频率</span>
        <div class="sp-seg" role="group" aria-label="执行频率模式">
          <button
            v-for="m in PROTO_MODES"
            :key="m.value"
            type="button"
            class="sp-seg-btn"
            :class="{ on: (schedule.scheduleMode || 'PERIODIC') === m.value }"
            @click="onProtoMode(m.value)"
          >{{ m.label }}</button>
        </div>
      </div>

      <!-- 按周期：5 个预设快捷按钮 + 时间 -->
      <template v-if="(schedule.scheduleMode || 'PERIODIC') === 'PERIODIC'">
        <div class="sp-row">
          <span class="sp-label">周期</span>
          <div class="sp-seg sp-seg-preset" role="group" aria-label="周期预设">
            <button
              v-for="p in PERIODIC_PRESETS"
              :key="p.value"
              type="button"
              class="sp-seg-btn"
              :class="{ on: (schedule.periodicPreset || 'DAILY') === p.value }"
              @click="onProtoPreset(p)"
            >{{ p.label }}</button>
          </div>
        </div>
        <div class="sp-row sp-row-top">
          <span class="sp-label">定点时间</span>
          <div class="sp-times">
            <div class="sp-time-row">
              <div class="sp-time-input">
                <span class="sp-time-icon">⏰</span>
                <input
                  type="time"
                  :value="(schedule.times || ['09:00'])[0]"
                  aria-label="定点时间"
                  @input="onProtoTime($event.target.value)"
                />
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 每间隔：数字 + 单位 -->
      <template v-else-if="schedule.scheduleMode === 'INTERVAL'">
        <div class="sp-row">
          <span class="sp-label">间隔</span>
          <div class="sp-interval-row">
            <span class="sp-interval-label">每</span>
            <input
              type="number"
              min="1"
              class="sp-interval-input"
              :value="schedule.intervalCount || 1"
              aria-label="间隔数量"
              @input="onProtoIntervalCount($event.target.value)"
            />
            <div class="sp-seg" role="group" aria-label="间隔单位">
              <button
                v-for="u in INTERVAL_UNITS"
                :key="u.value"
                type="button"
                class="sp-seg-btn"
                :class="{ on: (schedule.intervalUnit || 'DAY') === u.value }"
                @click="onProtoIntervalUnit(u.value)"
              >{{ u.label }}</button>
            </div>
            <span class="sp-interval-label">执行一次</span>
          </div>
        </div>
      </template>

      <!-- 单次：日历时间选择器 -->
      <template v-else-if="schedule.scheduleMode === 'ONCE'">
        <div class="sp-row">
          <span class="sp-label">执行时间</span>
          <el-date-picker
            :model-value="schedule.onceAt"
            type="datetime"
            placeholder="选择具体日期和时间"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm"
            @update:model-value="setOnceAt"
          />
        </div>
      </template>

      <div v-if="error" class="sp-err-text">{{ error }}</div>

      <!-- 执行预览绿底框 -->
      <div class="sp-proto-preview">
        <div class="sp-proto-sched">
          <span v-if="previewLoading">正在推算执行计划…</span>
          <span v-else-if="previewError" class="is-error">{{ previewError }}</span>
          <span v-else-if="previewSummary">{{ previewSummary }}</span>
          <span v-else class="is-faint">完善周期后，这里实时显示执行计划</span>
        </div>
        <div v-if="!previewLoading && !previewError && previewTimes.length" class="sp-proto-next">
          <span class="sp-proto-next-label">接下来 {{ previewTimes.length }} 次：</span>
          <span v-for="(t, i) in previewTimes" :key="i" class="sp-proto-pill">{{ prettyTime(t) }}</span>
        </div>
      </div>
    </template>

    <!-- ══════ prototype=false（用户端 TaskEditor）：原有 Element Plus 形态，完全不变 ══════ -->
    <template v-else>
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
    </template>
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

/* ══════ 原型态（#19，prototype=true）：岗位自动化任务页签专用视觉 ══════ */
/* 行标签宽度对齐原型 .pd2-task-schedule-label（84px 栅格列） */
.sp-proto .sp-label {
  width: 84px;
}
.sp-proto .sp-err-text {
  padding-left: calc(84px + var(--space-4));
}

/* 周期类型分段按钮组（.pd2-task-segmented） */
.sp-seg,
.sp-week-seg {
  display: inline-flex;
  align-items: center;
  width: max-content;
  max-width: 100%;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-surface);
}
/* 执行星期条（.pd2-task-weekdays）：原型无圆角 */
.sp-week-seg {
  border-radius: 0;
}
.sp-seg-btn {
  min-width: 70px;
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-right: 1px solid var(--border-soft);
  background: var(--bg-surface);
  color: var(--c-text);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.sp-week-seg .sp-seg-btn {
  width: 58px;
  min-width: 0;
  height: 34px;
  padding: 0;
}
.sp-seg-btn:last-child {
  border-right: 0;
}
.sp-seg-btn:hover {
  background: var(--bg-hover);
}
.sp-seg-btn.on,
.sp-seg-btn.on:hover {
  background: var(--c-accent);
  color: var(--bg-surface);
}
.sp-seg-btn:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}

/* 定点时间行（.pd2-task-time-row：序号圆 + ⏰ 输入框 + ×） */
.sp-time-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.sp-time-no {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: 11px;
}
.sp-time-input {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  padding: 0 10px;
  background: var(--bg-surface);
  width: 140px;
}
.sp-time-input:focus-within {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
.sp-time-input input {
  border: 0;
  outline: 0;
  width: 100%;
  height: 36px;
  font-size: var(--fs-md);
  background: transparent;
  color: var(--c-text-strong);
  font-family: inherit;
}
.sp-time-icon {
  color: var(--c-text-faint);
  font-size: var(--fs-md);
}
.sp-time-remove {
  border: 0;
  background: transparent;
  color: var(--c-danger);
  cursor: pointer;
  font-size: var(--fs-md);
  padding: 2px 4px;
  line-height: 1;
}
.sp-time-remove:hover {
  opacity: 0.75;
}
.sp-add-time-link {
  border: 0;
  background: transparent;
  color: var(--c-accent);
  font-size: var(--fs-sm);
  cursor: pointer;
  padding: 4px 0;
  align-self: flex-start;
}
.sp-add-time-link:hover {
  text-decoration: underline;
}

/* 执行预览绿底框（.pd2-task-preview） */
.sp-proto-preview {
  background: var(--c-accent-fill);
  border: 1px solid var(--c-accent-soft);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
}
.sp-proto-sched {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-md);
  color: var(--c-accent);
  font-weight: var(--fw-semibold);
}
.sp-proto-sched::before {
  content: '\2731';
}
.sp-proto-sched .is-faint {
  color: var(--c-text-faint);
  font-weight: var(--fw-regular);
}
.sp-proto-sched .is-error {
  color: var(--c-danger);
  font-weight: var(--fw-regular);
}
.sp-proto-next {
  margin-top: var(--space-2);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.sp-proto-next-label {
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.sp-proto-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-surface);
  border: 1px solid var(--c-accent-soft);
  font-size: var(--fs-xs);
  color: var(--c-accent);
  font-variant-numeric: tabular-nums;
}

/* 预设按钮组宽一些（5 个按钮） */
.sp-seg-preset .sp-seg-btn {
  min-width: 88px;
}

/* 每间隔行：数字输入 + 单位按钮组内联 */
.sp-interval-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.sp-interval-label {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.sp-interval-input {
  width: 64px;
  height: 36px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  padding: 0 10px;
  background: var(--bg-surface);
  color: var(--c-text-strong);
  font-size: var(--fs-md);
  font-family: inherit;
  text-align: center;
  outline: none;
}
.sp-interval-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}

/* 窄屏：分段/星期条撑满 */
@media (max-width: 760px) {
  .sp-proto .sp-row {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .sp-seg,
  .sp-week-seg {
    width: 100%;
  }
  .sp-seg-btn {
    min-width: 0;
    flex: 1;
    padding: 0 10px;
  }
  .sp-week-seg .sp-seg-btn {
    width: auto;
    flex: 1;
  }
}
</style>
