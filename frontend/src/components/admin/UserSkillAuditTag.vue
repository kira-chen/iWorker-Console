<script setup>
/**
 * 用户技能审核 · 彩色标签（2026-09-08 PRD-20260908 对齐）。
 *
 * 三类标签共用一个胶囊形态（原型 .tag：高 22 / 内距 0 8 / 圆角 11 / 12px），只换色档：
 *   kind="status"  审核状态：待审核 黄 / 已通过 绿 / 已驳回 红（md §4.1）
 *   kind="scale"   审核尺度：宽松 绿 / 通用 蓝 / 严格 红（md §4.1；原型 .tag.blue）
 *   kind="level"   检测结果：检测通过 绿 / 低风险 中性灰 / 中风险 橙黄 / 高风险 红 / 严重风险 深红（md §2.2；原型 .audit-level-*）
 * 全站 StatusTag 无蓝档、无深红档，且原型此处色值与 StatusTag 软色不同，故本模块自带一套。
 */
import { computed } from 'vue'
import { auditStatusLabel, auditStatusTone, auditScaleTone, riskLevelTone } from '@/utils/userSkillAuditMeta'

const props = defineProps({
  kind: { type: String, default: 'status', validator: (v) => ['status', 'scale', 'level'].includes(v) },
  value: { type: String, default: '' }
})

const text = computed(() => (props.kind === 'status' ? auditStatusLabel(props.value) : props.value || '—'))
const tone = computed(() => {
  if (props.kind === 'status') return auditStatusTone(props.value)
  if (props.kind === 'scale') return auditScaleTone(props.value)
  return riskLevelTone(props.value)
})
</script>

<template>
  <span class="usa-tag" :class="`usa-tag--${tone}`" :data-kind="kind">{{ text }}</span>
</template>

<style scoped>
.usa-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  border: 1px solid transparent;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}
/* 原型 .tag.green / .tag.red（Taste 层）、.tag.blue / .tag.yellow（L4416–4417）、.audit-level-*（L4436–4440） */
.usa-tag--green {
  background: #e3f8ef;
  color: #079966;
}
.usa-tag--red {
  background: #fdebea;
  color: #c9372c;
}
.usa-tag--blue {
  background: #e8f0fe;
  color: #1a56db;
  border-color: #c3d4fb;
}
.usa-tag--yellow {
  background: #fef3c7;
  color: #92400e;
  border-color: #fcd34d;
}
.usa-tag--pass {
  background: #e5f5eb;
  color: #1d7144;
  border-color: #b9dfca;
}
.usa-tag--low {
  background: #eef2f5;
  color: #52616a;
  border-color: #d4dce1;
}
.usa-tag--medium {
  background: #fff2cf;
  color: #936318;
  border-color: #ecd38f;
}
.usa-tag--high {
  background: #fde8e8;
  color: #b42318;
  border-color: #efb6b6;
}
.usa-tag--fatal {
  background: #2d0d0d;
  color: #fff;
  border-color: #b42318;
}
.usa-tag--grey {
  background: var(--bg-hover);
  color: var(--c-text-muted);
}
/* 暗色：浅底换半透明软色，字色提亮 */
:root[data-theme='dark'] .usa-tag--green,
:root[data-theme='dark'] .usa-tag--pass {
  background: var(--c-success-soft);
  color: var(--c-success);
  border-color: transparent;
}
:root[data-theme='dark'] .usa-tag--red,
:root[data-theme='dark'] .usa-tag--high {
  background: var(--c-danger-soft);
  color: var(--c-danger);
  border-color: transparent;
}
:root[data-theme='dark'] .usa-tag--yellow,
:root[data-theme='dark'] .usa-tag--medium {
  background: var(--c-warning-soft);
  color: var(--c-warning);
  border-color: transparent;
}
:root[data-theme='dark'] .usa-tag--blue {
  background: rgba(96, 165, 250, 0.18);
  color: #93c5fd;
  border-color: transparent;
}
:root[data-theme='dark'] .usa-tag--low {
  background: var(--bg-hover);
  color: var(--c-text-muted);
  border-color: transparent;
}
:root[data-theme='dark'] .usa-tag--fatal {
  background: #5a1414;
  color: #fff;
  border-color: #f06b6b;
}
</style>
