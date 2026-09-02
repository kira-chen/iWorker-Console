<script setup>
/**
 * HealthTag —— 工具检活四态徽标（切片3a，契约 §4.1 / §5.1）。
 *
 * 统一渲染 displayStatus 四态，中文映射 + 四态色值（语义令牌，双主题适配）：
 *   HEALTHY   正常   绿（实色软底）
 *   UNHEALTHY 异常   红（实色软底，带红点）
 *   UNKNOWN   未检测 灰（弱化软底）
 *   DISABLED  已停用 灰边框（描边，区别于「未检测」的实底）
 *
 * 四态文案/类名口径与 positionModel.healthLabel/healthClass 完全一致（全站单一真相）。
 *
 * 用法：<HealthTag :status="row.displayStatus" />
 */
import { computed } from 'vue'
import { healthLabel, healthClass } from '@/utils/positionModel'

const props = defineProps({
  // displayStatus / checkStatus ∈ HEALTHY|UNHEALTHY|UNKNOWN|DISABLED
  status: { type: String, default: 'UNKNOWN' }
})

const label = computed(() => healthLabel(props.status))
const cls = computed(() => `ht--${healthClass(props.status)}`)
</script>

<template>
  <span class="health-tag" :class="cls">
    <span class="ht-dot"></span>{{ label }}
  </span>
</template>

<style scoped>
.health-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  line-height: 1.4;
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  white-space: nowrap;
}
.ht-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
/* 正常 —— 绿 */
.ht--ok {
  color: var(--c-success);
  background: var(--c-success-soft);
}
.ht--ok .ht-dot {
  background: var(--c-success);
}
/* 异常 —— 红 */
.ht--bad {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.ht--bad .ht-dot {
  background: var(--c-danger);
}
/* 未检测 —— 灰（实底弱化） */
.ht--unknown {
  color: var(--c-text-muted);
  background: var(--bg-active);
}
.ht--unknown .ht-dot {
  background: var(--c-text-faint);
}
/* 已停用 —— 灰边框（描边，与未检测区分） */
.ht--off {
  color: var(--c-text-faint);
  background: transparent;
  box-shadow: 0 0 0 1px var(--border-base) inset;
}
.ht--off .ht-dot {
  background: var(--c-text-faint);
}
</style>
