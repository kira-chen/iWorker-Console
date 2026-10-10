<script setup>
/**
 * AuditMetricGrid —— 工具调用审计三个页签共用的顶部统计区：可点击的统计卡片 +
 * 卡片下方的【统计口径】说明入口（默认收起，PRD §二）。
 *
 * 只负责展示与上报点击；点某张卡片"筛选条件怎么变"由各页签自己决定（PRD 各页签统计卡片表）。
 * 卡片数不固定为 4——技能调用页签 2026-10-09 改版后只剩 3 张（去掉"进行中"），网格列数按
 * metrics.length 动态给，不强行留一个空位。
 *
 * @prop {Array<{key:string,label:string,value:number,sub:string,danger?:boolean,warn?:boolean}>} metrics
 * @prop {string} activeKey 当前与筛选条件吻合的卡片 key，高亮显示；无则不高亮
 * @prop {string[]} help 统计口径说明，一项一段
 * @emits choose(key) 点击卡片
 */
import { computed, ref } from 'vue'

const props = defineProps({
  metrics: { type: Array, required: true },
  activeKey: { type: String, default: '' },
  help: { type: Array, default: () => [] }
})
defineEmits(['choose'])

const gridStyle = computed(() => ({ gridTemplateColumns: `repeat(${props.metrics.length}, minmax(0, 1fr))` }))

const helpOpen = ref(false)
</script>

<template>
  <div class="audit-stats">
    <div class="metric-grid" :style="gridStyle">
      <button
        v-for="m in metrics"
        :key="m.key"
        type="button"
        class="metric-card"
        :class="{ 'is-danger': m.danger, 'is-warn': m.warn, 'is-active': m.key === activeKey }"
        @click="$emit('choose', m.key)"
      >
        <span class="metric-label">{{ m.label }}</span>
        <strong class="metric-value">{{ m.value }}</strong>
        <span class="metric-sub">{{ m.sub }}</span>
      </button>
    </div>

    <div v-if="help.length" class="help-entry">
      <el-button link type="primary" @click="helpOpen = !helpOpen">统计口径</el-button>
    </div>
    <div v-if="helpOpen" class="help-body">
      <p v-for="(text, i) in help" :key="i">{{ text }}</p>
    </div>
  </div>
</template>

<style scoped>
.audit-stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.metric-grid {
  display: grid;
  gap: 12px;
}
.metric-card {
  position: relative;
  text-align: left;
  padding: 14px 16px;
  background: var(--bg-base);
  border: 1px solid var(--border-soft);
  border-top: 3px solid var(--c-success);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.metric-card.is-danger { border-top-color: var(--c-danger); }
.metric-card.is-warn { border-top-color: var(--c-warning); }
.metric-card.is-active { border-color: var(--c-accent); box-shadow: 0 0 0 1px var(--c-accent) inset; }
.metric-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.metric-value {
  font-size: 26px;
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.metric-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.help-body {
  padding: 14px 16px;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.help-body p {
  margin: 4px 0;
}
</style>
