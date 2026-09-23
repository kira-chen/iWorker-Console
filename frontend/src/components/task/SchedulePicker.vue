<script setup>
/**
 * 可视化调度选择器（md 岗位 §7.3 调度计划，不让用户手写 cron）。
 *
 * 单一职责：把「执行频率三模式 + 联动控件 + 定点时间 + 起止日期」编辑为 Schedule 对象，
 * 通过 v-model:schedule 双向绑定。人话回显（summary）与「接下来 N 次」预览由父级调
 * preview-schedule 接口产出后经 props 传入，本组件不在前端硬算周期文案 / nextFire。
 *
 * Schedule 字段（四模式，2026-09-12 对齐 md §7.3 L392-397，审计 J5 / K3；2026-09-23 负责人拍板新增「闲时」
 * 与「执行位置」只读展示）：
 * - execLocations：只读展示字段，不可编辑（2026-09-23 负责人拍板：执行位置无法改变）。由 scheduleMode
 *   派生——闲时模式为 [CLOUD, WEB]（本地环境不具备负载监测能力，不支持闲时）；其余三个模式固定为
 *   [CLOUD, WEB, LOCAL]（全部环境可用）。纯计算属性，不写回 schedule，buildSchedule 侧按同一规则派生。
 * - scheduleMode：PERIODIC 按周期 / INTERVAL 每间隔 / ONCE 单次 / IDLE 闲时；
 * - PERIODIC：periodicPreset（每天 / 每周一 / 每周一三五 / 每周五 / 每月 1 日）派生 scheduleType +
 *   daysOfWeek / daysOfMonth；times[] 多个定点时间（【＋ 添加时间】，同一天自动去重）；
 * - INTERVAL：intervalCount + intervalUnit（HOUR / DAY / WEEK）派生 scheduleType=INTERVAL_*；
 *   times[0] 为起始时刻；
 * - ONCE：onceAt（"YYYY-MM-DDTHH:mm" 无时区）；
 * - IDLE（无定点时间，系统在时段内择机执行）：idleCount + idleCountUnit（DAY / WEEK / MONTH，
 *   如「每天 1 次」）+ idleWindow（NIGHT 夜间闲时 00:00–06:00 / ANYTIME 不限时段按负载调度）。
 * - 起止日期 startDate / endDate（纯日期，不填 = 立即生效 / 一直有效；单次模式仅设起始）。
 * 时间口径：times（"HH:mm"）、onceAt、startDate/endDate 均为「无时区本地墙钟」，入参不拼时区。
 *
 * 2026-09-12 审计 J5：退役原 `prototype` 开关——false 分支（Element Plus 周期类型 / 星期多选 /
 * 每月日期）唯一消费方 views/TaskEditor.vue 已被占位页替换，无人再走；组件只留模式 Tab 形态。
 */
import { computed } from 'vue'

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

// 执行位置：只读展示，不可编辑（md §7.3，2026-09-23 负责人拍板：执行位置无法改变）
const EXEC_LOCATIONS = [
  { value: 'CLOUD', label: '云端' },
  { value: 'WEB', label: 'Web 端' },
  { value: 'LOCAL', label: '本地' }
]

/* ---------------- 四模式常量（md §7.3 L392-395；2026-09-23 新增「闲时」） ---------------- */
const MODES = [
  { value: 'PERIODIC', label: '按周期' },
  { value: 'INTERVAL', label: '每间隔' },
  { value: 'ONCE', label: '单次' },
  { value: 'IDLE', label: '闲时' }
]

const PERIODIC_PRESETS = [
  { value: 'DAILY',              label: '每天',       scheduleType: 'DAILY',   daysOfWeek: [],        daysOfMonth: [] },
  { value: 'WEEKLY_MON',         label: '每周一',     scheduleType: 'WEEKLY',  daysOfWeek: [1],       daysOfMonth: [] },
  { value: 'WEEKLY_MON_WED_FRI', label: '每周一三五', scheduleType: 'WEEKLY',  daysOfWeek: [1, 3, 5], daysOfMonth: [] },
  { value: 'WEEKLY_FRI',         label: '每周五',     scheduleType: 'WEEKLY',  daysOfWeek: [5],       daysOfMonth: [] },
  { value: 'MONTHLY_1',          label: '每月1日',    scheduleType: 'MONTHLY', daysOfWeek: [],        daysOfMonth: [1] }
]

const INTERVAL_UNITS = [
  { value: 'HOUR', label: '小时' },
  { value: 'DAY',  label: '天' },
  { value: 'WEEK', label: '周' }
]

// 闲时：执行次数单位 + 执行时段（md §7.3 闲时模式专属字段，2026-09-23 新增）
const IDLE_COUNT_UNITS = [
  { value: 'DAY',   label: '天' },
  { value: 'WEEK',  label: '周' },
  { value: 'MONTH', label: '月' }
]
const IDLE_WINDOWS = [
  { value: 'NIGHT',    label: '夜间闲时（00:00–06:00）' },
  { value: 'ANYTIME',  label: '不限时段，按系统负载调度' }
]

const DEFAULT_TIME = '09:00'

const mode = computed(() => props.schedule.scheduleMode || 'PERIODIC')
const times = computed(() => (props.schedule.times?.length ? props.schedule.times : [DEFAULT_TIME]))
// 执行位置只读展示，由 scheduleMode 派生，不可编辑（md §7.3，2026-09-23）
const execLocations = computed(() => (mode.value === 'IDLE' ? ['CLOUD', 'WEB'] : ['CLOUD', 'WEB', 'LOCAL']))

// 统一 patch：合并字段后向上抛，附带「变更后需重新预览」信号
function patch(part) {
  emit('update:schedule', { ...props.schedule, ...part })
  emit('preview')
}

// 把 sc 就地改写成 next 模式对应的字段形态（onMode 与「执行位置切本地时闲时被迫退回」共用）
function applyModeFields(sc, next) {
  sc.scheduleMode = next
  if (next === 'ONCE') {
    sc.scheduleType = 'ONCE'
    // md §7.3 L397：单次模式仅设起始时间，结束日期随之清空
    sc.endDate = ''
  } else if (next === 'INTERVAL') {
    sc.scheduleType = `INTERVAL_${sc.intervalUnit || 'DAY'}`
    sc.intervalCount = sc.intervalCount || 1
    sc.intervalUnit = sc.intervalUnit || 'DAY'
    // 每间隔模式只取一个起始时刻
    sc.times = [(sc.times?.length ? sc.times : [DEFAULT_TIME])[0] || DEFAULT_TIME]
  } else if (next === 'IDLE') {
    // 闲时不设定点时间，只定执行次数 + 执行时段
    sc.scheduleType = 'IDLE'
    sc.idleCount = sc.idleCount || 1
    sc.idleCountUnit = sc.idleCountUnit || 'DAY'
    sc.idleWindow = sc.idleWindow || 'NIGHT'
    sc.times = []
  } else {
    // PERIODIC：恢复到 periodicPreset 对应的 scheduleType / 星期 / 日期
    const preset = PERIODIC_PRESETS.find((p) => p.value === (sc.periodicPreset || 'DAILY')) || PERIODIC_PRESETS[0]
    sc.periodicPreset = preset.value
    sc.scheduleType = preset.scheduleType
    sc.daysOfWeek = preset.daysOfWeek.slice()
    sc.daysOfMonth = preset.daysOfMonth.slice()
    if (!sc.times?.length) sc.times = [DEFAULT_TIME]
  }
}

/* ---------------- 执行频率：模式切换 ---------------- */
function onMode(next) {
  if (next === mode.value) return
  const sc = { ...props.schedule }
  applyModeFields(sc, next)
  emit('update:schedule', sc)
  emit('preview')
}

/* ---------------- 按周期：固定周期预设 ---------------- */
function onPreset(preset) {
  if (preset.value === props.schedule.periodicPreset) return
  patch({
    scheduleMode: 'PERIODIC',
    periodicPreset: preset.value,
    scheduleType: preset.scheduleType,
    daysOfWeek: preset.daysOfWeek.slice(),
    daysOfMonth: preset.daysOfMonth.slice(),
    times: times.value.slice()
  })
}

/* ---------------- 每间隔：间隔数 + 单位 ---------------- */
function onIntervalCount(val) {
  patch({ intervalCount: Math.max(1, parseInt(val) || 1) })
}
function onIntervalUnit(unit) {
  patch({ intervalUnit: unit, scheduleType: `INTERVAL_${unit}` })
}

/* ---------------- 闲时：执行次数 + 执行时段 ---------------- */
function onIdleCount(val) {
  patch({ idleCount: Math.max(1, parseInt(val) || 1) })
}
function onIdleCountUnit(unit) {
  patch({ idleCountUnit: unit })
}
function onIdleWindow(win) {
  patch({ idleWindow: win })
}

/* ---------------- 定点时间（md §7.3 L396：多时间点 + 同一天去重；每间隔模式为单个起始时刻） ---------------- */
// 同一天时间去重（保留首次出现顺序）；空值剔除
function uniqTimes(list) {
  return [...new Set((list || []).filter(Boolean))]
}
// 【＋ 添加时间】：新行默认取一个尚未使用的整点，避免一加就与已有时间重复被去重
function addTime() {
  const used = new Set(times.value)
  const candidates = [DEFAULT_TIME, '12:00', '15:00', '18:00', '21:00', '06:00']
  const next = candidates.find((t) => !used.has(t)) || `${String(times.value.length % 24).padStart(2, '0')}:00`
  patch({ times: [...times.value, next] })
}
function setTime(idx, val) {
  const next = times.value.slice()
  next[idx] = val || ''
  patch({ times: uniqTimes(next) })
}
function removeTime(idx) {
  patch({ times: times.value.filter((_, i) => i !== idx) })
}

/* ---------------- 单次：日期时间（本地墙钟，无时区后缀） ---------------- */
function setOnceAt(val) {
  // el-date-picker valueFormat="YYYY-MM-DDTHH:mm" 直出无时区字符串
  patch({ onceAt: val || '' })
}

/* ---------------- 起止日期（md §7.3 L397，纯日期） ---------------- */
function setStartDate(val) {
  patch({ startDate: val || '' })
}
function setEndDate(val) {
  patch({ endDate: val || '' })
}

// 执行预览药丸文案：把 ISO 的 T / 秒 / 时区后缀去掉，只留「YYYY-MM-DD HH:mm」；非 ISO 串原样返回
function prettyTime(t) {
  return String(t ?? '').replace(/T(\d{2}:\d{2})(?::\d{2})?(?:[+-]\d{2}:\d{2}|Z)?$/, ' $1')
}
</script>

<template>
  <div class="sp" :class="{ 'sp-error': !!error }">
    <!-- 执行位置：云端 / Web 端 / 本地，只读展示，随执行频率派生，不可编辑（md §7.3，2026-09-23） -->
    <div class="sp-row sp-row-top">
      <span class="sp-label">执行位置</span>
      <div class="sp-loc-col">
        <div class="sp-seg sp-seg-location" role="group" aria-label="执行位置（只读）">
          <span
            v-for="l in EXEC_LOCATIONS"
            :key="l.value"
            class="sp-seg-btn sp-seg-readonly"
            :class="{ on: execLocations.includes(l.value) }"
          >{{ l.label }}</span>
        </div>
        <p class="sp-tip">执行位置由执行频率自动决定，不可单独修改；闲时模式仅云端 / Web 端可用。</p>
      </div>
    </div>

    <!-- 执行频率：按周期 / 每间隔 / 单次 / 闲时（md §7.3 L392） -->
    <div class="sp-row">
      <span class="sp-label">执行频率</span>
      <div class="sp-seg sp-seg-mode" role="group" aria-label="执行频率模式">
        <button
          v-for="m in MODES"
          :key="m.value"
          type="button"
          class="sp-seg-btn"
          :class="{ on: mode === m.value }"
          @click="onMode(m.value)"
        >{{ m.label }}</button>
      </div>
    </div>

    <!-- 按周期：5 个固定周期（md §7.3 L393） -->
    <div v-if="mode === 'PERIODIC'" class="sp-row">
      <span class="sp-label">周期</span>
      <div class="sp-seg sp-seg-preset" role="group" aria-label="周期预设">
        <button
          v-for="p in PERIODIC_PRESETS"
          :key="p.value"
          type="button"
          class="sp-seg-btn"
          :class="{ on: (schedule.periodicPreset || 'DAILY') === p.value }"
          @click="onPreset(p)"
        >{{ p.label }}</button>
      </div>
    </div>

    <!-- 每间隔：间隔数 + 单位（md §7.3 L394） -->
    <div v-else-if="mode === 'INTERVAL'" class="sp-row">
      <span class="sp-label">间隔</span>
      <div class="sp-interval-row">
        <span class="sp-interval-label">每</span>
        <input
          type="number"
          min="1"
          class="sp-interval-input"
          :value="schedule.intervalCount || 1"
          aria-label="间隔数量"
          @input="onIntervalCount($event.target.value)"
        />
        <div class="sp-seg" role="group" aria-label="间隔单位">
          <button
            v-for="u in INTERVAL_UNITS"
            :key="u.value"
            type="button"
            class="sp-seg-btn"
            :class="{ on: (schedule.intervalUnit || 'DAY') === u.value }"
            @click="onIntervalUnit(u.value)"
          >{{ u.label }}</button>
        </div>
        <span class="sp-interval-label">执行一次</span>
      </div>
    </div>

    <!-- 单次：具体日期时间（md §7.3 L395） -->
    <div v-else-if="mode === 'ONCE'" class="sp-row">
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

    <!-- 闲时：执行次数 + 执行时段（md §7.3 闲时模式专属字段，2026-09-23 新增）；不设定点时间 -->
    <template v-else>
      <div class="sp-row">
        <span class="sp-label">执行次数</span>
        <div class="sp-interval-row">
          <span class="sp-interval-label">每</span>
          <div class="sp-seg" role="group" aria-label="执行次数周期单位">
            <button
              v-for="u in IDLE_COUNT_UNITS"
              :key="u.value"
              type="button"
              class="sp-seg-btn"
              :class="{ on: (schedule.idleCountUnit || 'DAY') === u.value }"
              @click="onIdleCountUnit(u.value)"
            >{{ u.label }}</button>
          </div>
          <input
            type="number"
            min="1"
            class="sp-interval-input"
            :value="schedule.idleCount || 1"
            aria-label="执行次数"
            @input="onIdleCount($event.target.value)"
          />
          <span class="sp-interval-label">次</span>
        </div>
      </div>
      <div class="sp-row">
        <span class="sp-label">执行时段</span>
        <div class="sp-seg" role="group" aria-label="执行时段">
          <button
            v-for="w in IDLE_WINDOWS"
            :key="w.value"
            type="button"
            class="sp-seg-btn"
            :class="{ on: (schedule.idleWindow || 'NIGHT') === w.value }"
            @click="onIdleWindow(w.value)"
          >{{ w.label }}</button>
        </div>
      </div>
      <p class="sp-tip sp-idle-tip">系统会在所选时段内、云端资源负载低于 30% 时择机执行；执行完成即送达，不等时段结束。</p>
    </template>

    <!-- 定点时间（md §7.3 L396）：按周期多时间点 + 【＋ 添加时间】；每间隔模式为单个起始时刻 -->
    <div v-if="mode !== 'ONCE' && mode !== 'IDLE'" class="sp-row sp-row-top">
      <span class="sp-label">定点时间</span>
      <div class="sp-times">
        <div v-for="(t, i) in times" :key="i" class="sp-time-row">
          <span v-if="mode === 'PERIODIC' && times.length > 1" class="sp-time-no">{{ i + 1 }}</span>
          <div class="sp-time-input">
            <span class="sp-time-icon">⏰</span>
            <input
              type="time"
              :value="t"
              :aria-label="mode === 'INTERVAL' ? '起始时刻' : '定点时间'"
              @input="setTime(i, $event.target.value)"
            />
          </div>
          <button
            v-if="mode === 'PERIODIC' && times.length > 1"
            type="button"
            class="sp-time-remove"
            title="移除该时间点"
            aria-label="移除该时间点"
            @click="removeTime(i)"
          >×</button>
        </div>
        <button v-if="mode === 'PERIODIC'" type="button" class="sp-add-time-link" @click="addTime">＋ 添加时间</button>
        <p class="sp-tip">
          {{ mode === 'INTERVAL' ? '每间隔模式下为起始时刻，系统按固定间隔循环触发。' : '支持一天多个时间点，系统自动对同一天时间去重。' }}
        </p>
      </div>
    </div>

    <!-- 起止日期（md §7.3 L397）：不填 = 立即生效 / 一直有效；单次模式仅设起始 -->
    <div class="sp-row sp-row-top">
      <span class="sp-label">起止日期</span>
      <div class="sp-range">
        <el-date-picker
          :model-value="schedule.startDate"
          type="date"
          placeholder="从哪天开始（不填 = 立即生效）"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          @update:model-value="setStartDate"
        />
        <template v-if="mode !== 'ONCE'">
          <span class="sp-range-sep">至</span>
          <el-date-picker
            :model-value="schedule.endDate"
            type="date"
            placeholder="到哪天结束（不填 = 一直有效）"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            @update:model-value="setEndDate"
          />
        </template>
      </div>
    </div>

    <div v-if="error" class="sp-err-text">{{ error }}</div>

    <!-- 执行预览（md §7.3 L401）：人话回显 + 接下来 N 次，由父级 preview-schedule 产出 -->
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
/* 行标签宽度 84px（原 .pd2-task-schedule-label 栅格列） */
.sp-label {
  width: 84px;
  flex-shrink: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  padding-top: 2px;
}
.sp-tip {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: var(--lh-base);
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
  padding-left: calc(84px + var(--space-4));
}
.sp-error {
  /* 容器级描红仅作弱提示，具体字段错误用 sp-err-text */
}

/* 分段按钮组（执行频率 / 周期预设 / 间隔单位） */
.sp-seg {
  display: inline-flex;
  align-items: center;
  width: max-content;
  max-width: 100%;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-surface);
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
.sp-seg-btn:last-child {
  border-right: 0;
}
.sp-seg-btn:hover {
  background: var(--bg-hover);
}
.sp-seg-btn.on,
.sp-seg-btn.on:hover {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}
.sp-seg-btn:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}
/* 预设按钮组宽一些（5 个按钮） */
.sp-seg-preset .sp-seg-btn {
  min-width: 88px;
}
/* 执行位置：按钮组 + 提示文案纵向排列（md §7.3，2026-09-23） */
.sp-loc-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
/* 只读展示态：不可点击、未命中项弱化显示（md §7.3，2026-09-23：执行位置无法改变） */
.sp-seg-readonly {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}
.sp-seg-readonly:hover {
  background: var(--bg-surface);
}
.sp-seg-readonly.on:hover {
  background: var(--c-accent);
}
.sp-seg-readonly:not(.on) {
  color: var(--c-text-faint);
}

/* 定点时间：多行「序号圆 + ⏰ 输入框 + ×」+ 「＋ 添加时间」 */
.sp-times {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}
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

/* 执行预览绿底框 */
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

/* 窄屏：分段按钮组撑满 */
@media (max-width: 760px) {
  .sp-row {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .sp-seg {
    width: 100%;
  }
  .sp-seg-btn {
    min-width: 0;
    flex: 1;
    padding: 0 10px;
  }
}
</style>
