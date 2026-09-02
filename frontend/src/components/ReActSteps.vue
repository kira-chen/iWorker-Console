<script setup>
/**
 * ReAct 思考过程卡（对话页 + 对话记录页复用）。
 * 默认折叠 → 一行摘要；展开 → 逐步轨迹时间线。
 *
 * 直接消费接口契约的 ReActStep（与 reasoning_trace.steps 同构）：
 *   { no, type, bizName, status:'running'|'success'|'failed',
 *     latencyMs, observationBrief, toolCode? }
 *   type ∈ PLAN/THOUGHT/TOOL_CALL/ASK_USER/CONFIRM/OBSERVATION/FINISH/ERROR
 *
 * 给普通用户看的红线（演示走查 CR）：
 *   1) 步骤类型一律中文人话，绝不显示英文 type；
 *   2) 工具名一律用 bizName（中文业务名），绝不显示 toolCode（如 hr_get_leave_balance）；
 *   3) observationBrief 若是机器数据（裸 JSON / 英文 key），不进主视图，仅作弱化折叠。
 * （PRD §3.3.2）
 */
import { ref, computed } from 'vue'

const props = defineProps({
  steps: { type: Array, default: () => [] },
  // 折叠态摘要：优先用 done 事件下发的 traceSummary
  traceSummary: { type: String, default: '' },
  streaming: { type: Boolean, default: false },
  defaultOpen: { type: Boolean, default: false }
})

const open = ref(props.defaultOpen)

// 步骤类型 → 业务化胶囊（图标 + 中文人话标签）。绝不向用户显示英文 type。
const typeMeta = {
  PLAN: { icon: 'Compass', label: '理解需求' },
  THOUGHT: { icon: 'MagicStick', label: '思考下一步' },
  TOOL_CALL: { icon: 'Operation', label: '调用能力' },
  OBSERVATION: { icon: 'View', label: '获取结果' },
  ASK_USER: { icon: 'ChatLineRound', label: '需要您补充' },
  CONFIRM: { icon: 'WarningFilled', label: '待您确认' },
  FINISH: { icon: 'CircleCheckFilled', label: '已完成' },
  ERROR: { icon: 'CircleCloseFilled', label: '出错了' }
}

// 未知 type 兜底：统一显示「办事中」，避免漏出英文 type 给用户
const FALLBACK_META = { icon: 'InfoFilled', label: '办事中' }
function metaOf(type) {
  return typeMeta[type] || FALLBACK_META
}

const statusLabel = { running: '进行中', success: '成功', failed: '失败', done: '已结束' }

// observationBrief 收口：识别机器数据（裸 JSON / 形如 key: 6.5 的英文键值），
// 这类内容不进主视图，只在「查看明细」里弱化展示；人话描述则正常呈现。
const MACHINE_DATA_RE = /[{}\[\]]|[A-Za-z_][A-Za-z0-9_]*\s*[:=]\s*['"]?[\w.-]/

function isMachineData(text) {
  if (!text) return false
  const t = String(text).trim()
  if (!t) return false
  // 含中文则视为人话描述，直接展示
  if (/[一-龥]/.test(t)) return false
  return MACHINE_DATA_RE.test(t)
}

const anyRunning = computed(() => props.streaming || props.steps.some((s) => s.status === 'running'))

// 折叠态标题（DeepSeek「已思考（用时 N 秒）」对标）：用真实步骤耗时之和，
// 无任何 latencyMs 数据时不编造秒数，只显示「已思考」。
const totalLatencyMs = computed(() =>
  props.steps.reduce((sum, s) => sum + (typeof s.latencyMs === 'number' ? s.latencyMs : 0), 0)
)
const thoughtTitle = computed(() => {
  if (totalLatencyMs.value > 0) {
    const sec = Math.max(1, Math.round(totalLatencyMs.value / 1000))
    return `已思考（用时 ${sec} 秒）`
  }
  return '已思考'
})

function durText(ms) {
  if (ms == null) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

// 机器数据明细的逐步展开状态（按 step.no/索引）
const openDetails = ref(new Set())
function toggleDetail(key) {
  const next = new Set(openDetails.value)
  next.has(key) ? next.delete(key) : next.add(key)
  openDetails.value = next
}
</script>

<template>
  <div v-if="steps.length || streaming" class="react-card" :class="{ active: anyRunning }">
    <button class="react-head" type="button" @click="open = !open">
      <span class="head-left">
        <el-icon class="spark" :class="{ pulse: anyRunning }"><MagicStick /></el-icon>
        <span class="head-text">{{ anyRunning ? '正在思考与办事…' : thoughtTitle }}</span>
      </span>
      <el-icon class="chevron" :class="{ open }"><ArrowDown /></el-icon>
    </button>

    <transition name="expand">
      <ul v-show="open" class="react-track">
        <li
          v-for="(s, i) in steps"
          :key="s.no ?? i"
          class="track-step"
          :class="'is-' + s.status"
        >
          <span class="step-rail">
            <span class="step-node"></span>
          </span>
          <div class="step-body">
            <div class="step-line">
              <span class="step-type">
                <el-icon><component :is="metaOf(s.type).icon" /></el-icon>
                {{ metaOf(s.type).label }}
              </span>
              <!-- 工具名一律 bizName 业务名，缺失才兜底；绝不显示 toolCode -->
              <span class="step-title">{{ s.bizName || metaOf(s.type).label }}</span>
              <span v-if="s.latencyMs != null" class="step-dur">{{ durText(s.latencyMs) }}</span>
              <span class="step-status" :class="'st-' + s.status">
                {{ statusLabel[s.status] || s.status }}
              </span>
              <!-- 效果测试拟真标记：写工具步在测试链路被拦截、返回拟真成功（simulated:true），
                   给「🧪 拟真·未真实执行」角标，simulatedTool 作 tooltip，让 FDE 一眼看出没真写业务系统。
                   员工端 Chat 真实链路无此字段 → 不渲染，零影响。 -->
              <span
                v-if="s.simulated"
                class="step-sim"
                :title="s.simulatedTool ? `拟真工具：${s.simulatedTool}（未真实执行）` : '该写操作为拟真，未真实执行'"
              >🧪 拟真·未真实执行</span>
            </div>
            <!-- 人话摘要：直接展示 -->
            <div v-if="s.observationBrief && !isMachineData(s.observationBrief)" class="step-desc">
              {{ s.observationBrief }}
            </div>
            <!-- 机器数据：默认收起，仅给好奇的用户一个弱化的「查看明细」 -->
            <div v-else-if="s.observationBrief" class="step-detail">
              <button class="detail-toggle" type="button" @click="toggleDetail(s.no ?? i)">
                <el-icon class="detail-chevron" :class="{ open: openDetails.has(s.no ?? i) }">
                  <ArrowRight />
                </el-icon>
                查看明细
              </button>
              <pre v-show="openDetails.has(s.no ?? i)" class="detail-raw">{{ s.observationBrief }}</pre>
            </div>
          </div>
        </li>
      </ul>
    </transition>
  </div>
</template>

<style scoped>
.react-card {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  overflow: hidden;
  margin: var(--space-1) 0 var(--space-2);
}
.react-card.active {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 1px var(--c-accent-soft);
}
.react-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--c-text);
  font-size: var(--fs-sm);
  font-family: inherit;
}
.head-left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.head-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spark {
  color: var(--c-accent);
}
.pulse {
  animation: pulse 1.2s var(--ease-in-out) infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}
.chevron {
  color: var(--c-text-muted);
  transition: transform var(--dur-base) var(--ease-out);
}
.chevron.open {
  transform: rotate(180deg);
}

.react-track {
  list-style: none;
  margin: 0;
  padding: var(--space-2) var(--space-4) var(--space-4);
  border-top: 1px dashed var(--border-soft);
}
.track-step {
  display: flex;
  gap: var(--space-3);
}
.step-rail {
  position: relative;
  width: 14px;
  display: flex;
  justify-content: center;
}
.step-rail::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border-base);
}
.track-step:first-child .step-rail::before { top: 10px; }
.track-step:last-child .step-rail::before { bottom: calc(100% - 10px); }
.step-node {
  position: relative;
  z-index: 1;
  width: 9px;
  height: 9px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--c-text-faint);
}
.is-success .step-node { background: var(--c-success); }
.is-done .step-node { background: var(--c-text-muted); }
.is-failed .step-node { background: var(--c-danger); }
.is-running .step-node {
  background: var(--c-accent);
  animation: pulse 1.2s var(--ease-in-out) infinite;
}

.step-body {
  flex: 1;
  padding-bottom: var(--space-4);
  min-width: 0;
}
.step-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.step-type {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-hover);
  border: 1px solid var(--border-soft);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.step-title {
  color: var(--c-text-strong);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}
.is-failed .step-title { color: var(--c-danger); }
.step-dur {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  font-family: var(--font-mono);
}
.step-status {
  font-size: var(--fs-xs);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.st-running { color: var(--c-accent); background: var(--c-accent-soft); }
.st-success { color: var(--c-success); background: var(--c-success-soft); }
.st-done { color: var(--c-text-muted); background: var(--bg-hover); }
.st-failed { color: var(--c-danger); background: var(--c-danger-soft); }
/* 效果测试拟真角标：警示色弱胶囊，提示该写操作未真实执行 */
.step-sim {
  font-size: var(--fs-xs);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  color: var(--c-warning);
  background: var(--c-warning-soft);
  border: 1px solid var(--c-warning);
  cursor: help;
  white-space: nowrap;
}
.step-desc {
  margin-top: var(--space-1);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}

/* 机器数据明细：弱化、默认收起，避免裸 JSON/英文 key 出现在主视图 */
.step-detail {
  margin-top: var(--space-1);
}
.detail-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  transition: color var(--dur-base) var(--ease-out);
}
.detail-toggle:hover {
  color: var(--c-accent);
}
.detail-chevron {
  transition: transform var(--dur-base) var(--ease-out);
}
.detail-chevron.open {
  transform: rotate(90deg);
}
.detail-raw {
  margin: var(--space-1) 0 0;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-hover);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: var(--lh-base);
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
}

/* 展开动效 */
.expand-enter-active,
.expand-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    max-height var(--dur-base) var(--ease-out);
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 1200px;
}
</style>
