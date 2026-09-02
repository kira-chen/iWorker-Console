<script setup>
/**
 * 单次执行结果卡片（PRD §6.2，时间轴节点内容）。
 *
 * 折叠态：开始时间 / 触发方式 / 状态徽标 / 耗时 / 结果摘要 / 失败原因 + 重试次数。
 * 展开「执行过程」：复用 ReActSteps 渲染 trace（trace 从单条执行详情接口取，由父级注入）。
 *
 * trace 大小写约定（契约 §4.1）：trace.steps[].status 为小写 running/success/failed，
 * 直接喂给 ReActSteps；execution.status 为大写，用 execStatusMeta 渲染徽标，勿混用。
 */
import { ref, computed, watch } from 'vue'
import ReActSteps from '@/components/ReActSteps.vue'
import StatusTag from '@/components/StatusTag.vue'
import { execStatusMeta, isExecActive, fmtDateTime, fmtDuration } from '@/utils/taskStatus'

// el-tag type → StatusTag type 映射（沿用 taskStatus 既有语义色）
const STATUS_TAG_TYPE = { success: 'success', warning: 'warning', danger: 'danger', info: 'info', primary: 'accent', '': 'info' }
function tagType(t) {
  return STATUS_TAG_TYPE[t] || 'info'
}

const props = defineProps({
  exec: { type: Object, required: true },
  // 是否默认展开执行过程（最新一条传 true）
  defaultOpen: { type: Boolean, default: false }
})
// 请求加载该执行的 trace（父级据此调 §4.2 拉 trace 后回填 exec.trace）
const emit = defineEmits(['load-trace'])

const open = ref(props.defaultOpen)

const meta = computed(() => execStatusMeta(props.exec.status))
const active = computed(() => isExecActive(props.exec.status))
const triggerLabel = computed(() =>
  props.exec.triggerType === 'MANUAL' ? '手动触发' : '定时触发'
)
const hasTrace = computed(() => !!props.exec.trace?.steps?.length)

function toggle() {
  open.value = !open.value
  // 展开且尚无 trace（列表项不含 trace）→ 请父级拉单条详情
  if (open.value && !hasTrace.value && !active.value) {
    emit('load-trace', props.exec)
  }
}

// 默认展开的最新一条：若进来就没有 trace（终态），主动请求一次
watch(
  () => props.defaultOpen,
  (v) => {
    if (v && !hasTrace.value && !active.value) emit('load-trace', props.exec)
  },
  { immediate: true }
)
</script>

<template>
  <div class="ec" :class="{ 'is-active': active }">
    <!-- 头部：状态 + 摘要（始终可见） -->
    <button class="ec-head" type="button" @click="toggle">
      <div class="ec-head-main">
        <div class="ec-line">
          <StatusTag :type="tagType(meta.type)">{{ meta.label }}</StatusTag>
          <span class="ec-trigger">{{ triggerLabel }}</span>
          <span class="ec-time">{{ fmtDateTime(exec.startedAt) }}</span>
          <span v-if="exec.durationMs != null" class="ec-dur">耗时 {{ fmtDuration(exec.durationMs) }}</span>
          <span v-else-if="active" class="ec-dur is-running">进行中…</span>
        </div>
        <div v-if="exec.resultSummary" class="ec-summary">{{ exec.resultSummary }}</div>
        <div v-else-if="active" class="ec-summary is-faint">
          正在办事，结果稍后呈现…结果出来会自动更新，无需刷新。
        </div>
      </div>
      <el-icon class="ec-chevron" :class="{ open }"><ArrowDown /></el-icon>
    </button>

    <!-- 跳过说明（上一次还在执行时，本次自动跳过） -->
    <div v-if="exec.status === 'SKIPPED'" class="ec-skip">
      <el-icon><InfoFilled /></el-icon>
      <span>{{ exec.failureReason || '上一次还在执行，这次先跳过了' }}</span>
    </div>

    <!-- 失败原因 + 重试次数（终态非成功时显著提示） -->
    <div v-else-if="exec.failureReason" class="ec-fail">
      <el-icon><WarningFilled /></el-icon>
      <span>{{ exec.failureReason }}</span>
      <span v-if="exec.retryCount > 0" class="ec-retry">已自动重试 {{ exec.retryCount }} 次</span>
    </div>
    <div v-else-if="exec.retryCount > 0" class="ec-retry-only">
      已自动重试 {{ exec.retryCount }} 次
    </div>

    <!-- 展开：执行过程（复用 ReActSteps） -->
    <transition name="ec-expand">
      <div v-show="open" class="ec-body">
        <ReActSteps
          v-if="hasTrace"
          :steps="exec.trace.steps"
          :trace-summary="exec.trace.summary"
          :streaming="active"
          :default-open="true"
        />
        <div v-else-if="exec.traceLoading" class="ec-trace-state">
          <el-skeleton :rows="3" animated />
        </div>
        <div v-else-if="active" class="ec-trace-state ec-trace-hint">执行过程将在办事时实时呈现…</div>
        <div v-else class="ec-trace-state ec-trace-hint">本次执行暂无可展示的过程明细。</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.ec {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  overflow: hidden;
  transition: border-color var(--dur-base) var(--ease-out);
}
.ec.is-active {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 1px var(--c-accent-soft);
}
.ec-head {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.ec-head-main {
  flex: 1;
  min-width: 0;
}
.ec-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.ec-trigger {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-hover);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.ec-time {
  font-size: var(--fs-sm);
  color: var(--c-text);
  font-family: var(--font-mono);
}
.ec-dur {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ec-dur.is-running {
  color: var(--c-accent);
}
.ec-summary {
  margin-top: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
  white-space: pre-wrap;
  word-break: break-word;
}
.ec-summary.is-faint {
  color: var(--c-text-faint);
  font-style: italic;
}
.ec-chevron {
  color: var(--c-text-muted);
  transition: transform var(--dur-base) var(--ease-out);
  margin-top: 2px;
}
.ec-chevron.open {
  transform: rotate(180deg);
}

.ec-fail {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0 var(--space-4) var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-danger);
  background: var(--c-danger-soft);
  border-radius: var(--radius-sm);
}
.ec-retry {
  font-size: var(--fs-xs);
  color: var(--c-warning);
}
.ec-retry-only {
  margin: 0 var(--space-4) var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-warning);
}
.ec-skip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-4) var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
}

.ec-body {
  padding: 0 var(--space-4) var(--space-3);
}
.ec-trace-state {
  padding: var(--space-3) 0;
}
.ec-trace-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.ec-expand-enter-active,
.ec-expand-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), max-height var(--dur-base) var(--ease-out);
  overflow: hidden;
}
.ec-expand-enter-from,
.ec-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.ec-expand-enter-to,
.ec-expand-leave-from {
  opacity: 1;
  max-height: 1600px;
}
</style>
