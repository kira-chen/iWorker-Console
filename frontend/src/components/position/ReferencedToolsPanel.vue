<script setup>
/**
 * 「本技能已引用」分区（§12.7 工具区融合；布局调整 2026-07-08 #5 移至 ToolDock「选择工具」下方）。
 *
 * 单一职责：渲染当前技能正文已引用工具白名单（健康点 + bizName/code + 写类⚠ + 未知? + 定位 + 移除）。
 *
 * 关键约束（§12.7）：定位（scrollToTool）/移除（removeToolRefs）须操作 Milkdown 实例 + skillMd，
 * 本组件与 ToolDock 均不持有这些 → 仅 emit('locate', ref) / emit('remove-ref', ref)，由父级
 * SkillFocusEditor 执行；referencedView 由父级用 mergeReferencedView 合并好作 prop 传入
 * （parsedRefs/refStatusMap/localInsertNames 仍在父级算，不搬进来，避免插入链路割裂）。
 */
import { Close } from '@element-plus/icons-vue'
import { healthClass } from '@/utils/positionModel'
import {
  REF_BADGE_BROKEN,
  REF_BADGE_DEGRADED,
  REF_ALERT_BROKEN,
  REF_ALERT_DISABLED,
  REF_ALERT_UNHEALTHY
} from '@/utils/skillTerms'

defineProps({
  // 父级合并好的已引用视图：[{ code, count, checkStatus, requiresConfirmation, bizName, known }]
  referencedView: { type: Array, default: () => [] },
  // 只读态（平台技能 Tab 只读详情）：移除「移除引用」X（写入口）；空态/提示文案改为只读口径。
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['locate', 'remove-ref'])

/* 组④：断链/失效工具醒目提示口径——按严重度给角标 + 说明（大白话，集中在 skillTerms）。
 * - known=false（正文 @tool[x] 但运行时取不到/不在 picker）：最严重 → 红「用不了」+ 说明；
 * - DISABLED（已停用）/ UNHEALTHY（异常）：黄「会跳过」+ 说明（语气一致：可能影响办事结果）；
 * - 其余（HEALTHY / UNKNOWN 未检测）：无额外警示。
 * 返回 { level:'error'|'warn'|'', badge, text } ；level 用于行高亮。 */
function refAlert(r) {
  if (!r.known) {
    return { level: 'error', badge: REF_BADGE_BROKEN, text: REF_ALERT_BROKEN }
  }
  const s = String(r.checkStatus || '').toUpperCase()
  if (s === 'DISABLED') return { level: 'warn', badge: REF_BADGE_DEGRADED, text: REF_ALERT_DISABLED }
  if (s === 'UNHEALTHY') return { level: 'warn', badge: REF_BADGE_DEGRADED, text: REF_ALERT_UNHEALTHY }
  return { level: '', badge: '', text: '' }
}
</script>

<template>
  <div class="ref-panel">
    <div class="ref-panel-head">本技能已引用</div>
    <div v-if="!referencedView.length" class="ref-empty">
      {{ readonly ? '该技能正文未引用任何工具' : '正文还没引用工具，从上方「选择工具」点「＋ 插入」' }}
    </div>
    <template v-for="r in referencedView" :key="r.code">
      <div
        class="ref-row"
        :class="{ 'ref-row--error': refAlert(r).level === 'error', 'ref-row--warn': refAlert(r).level === 'warn' }"
        title="点击定位到正文引用处；引用多处时每次点击跳到下一处，循环回绕"
        @click="emit('locate', r)"
      >
        <span class="dot" :class="`dot-${healthClass(r.checkStatus)}`"></span>
        <span
          class="ref-code"
          :class="{ 'ref-code--name': r.bizName }"
          :title="r.bizName ? `${r.bizName}（${r.code}）` : r.code"
        >{{ r.bizName || r.code }}</span>
        <span v-if="r.count > 1" class="ref-count" :title="`正文引用 ${r.count} 处`">×{{ r.count }}</span>
        <span v-if="r.requiresConfirmation" class="ref-conf" title="写类操作，运行时需二次确认">⚠</span>
        <!-- 组④：断链/失效角标（红=用不了；黄=会跳过），符号化提示——具体说明鼠标悬浮展开
             （2026-07-08 反馈：不再占独立一行）。大白话文案集中在 skillTerms。 -->
        <el-tooltip
          v-if="refAlert(r).level"
          :content="refAlert(r).text"
          placement="top"
          effect="dark"
        >
          <span
            class="ref-badge"
            :class="`ref-badge--${refAlert(r).level}`"
          >{{ refAlert(r).badge }}</span>
        </el-tooltip>
        <!-- 只读态：不渲染「移除引用」X（写入口 v-if 不渲染） -->
        <el-icon v-if="!readonly" class="ref-x" title="移除引用" @click.stop="emit('remove-ref', r)"><Close /></el-icon>
      </div>
    </template>
    <!-- 布局调整 #5：底部说明文案已移除 -->
  </div>
</template>

<style scoped>
.ref-panel {
  flex-shrink: 0;
}
.ref-panel-head {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
}
.ref-empty {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  padding: var(--space-2) 0;
}
.ref-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  margin: 0 -4px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.ref-row:hover {
  background: var(--bg-hover);
}
.ref-row:last-of-type {
  border-bottom: none;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-ok {
  background: var(--c-success);
}
.dot-bad {
  background: var(--c-danger);
}
.dot-unknown {
  background: var(--c-text-faint);
}
.dot-off {
  background: var(--c-text-faint);
}
.ref-code {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-accent);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-code--name {
  font-family: inherit;
  color: var(--c-text);
}
.ref-count {
  font-size: 11px;
  color: var(--c-text-faint);
}
.ref-conf {
  font-size: 11px;
  color: var(--c-warning);
}
/* 组④：行级断链/降级强调（左竖条 + 弱底，不抢但醒目） */
.ref-row--error {
  background: var(--c-danger-soft);
  box-shadow: inset 2px 0 0 var(--c-danger);
}
.ref-row--warn {
  background: var(--c-warning-soft);
  box-shadow: inset 2px 0 0 var(--c-warning);
}
.ref-row--error:hover {
  background: var(--c-danger-soft);
}
.ref-row--warn:hover {
  background: var(--c-warning-soft);
}
/* 角标 pill：断链=红、降级=黄 */
.ref-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  font-size: 10px;
  border-radius: var(--radius-pill);
}
.ref-badge--error {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.ref-badge--warn {
  color: var(--c-warning);
  background: var(--c-warning-soft);
}
/* 断链/失效独立说明行（.ref-alert）已收敛为角标悬浮提示（2026-07-08 反馈） */
.ref-x {
  cursor: pointer;
  color: var(--c-text-faint);
  font-size: 12px;
}
.ref-x:hover {
  color: var(--c-danger);
}
</style>
