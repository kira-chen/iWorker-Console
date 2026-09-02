<script setup>
import { ref, computed, onMounted } from 'vue'
import { useMemoryStore } from '@/stores/memory'

/**
 * 「已记住」回执卡：展示实时抽取成功的记忆摘要（summary），
 * 点开可看每条 item 的 content 列表，并提供「撤销」操作。
 *
 * 撤销逻辑由 store.undoMemory(target) 承担（逐条 DELETE /api/memory/items/{id}）；
 * 本组件只负责呈现 + 触发 + 三态（已记住 / 撤销中 / 已撤销）与错误提示。
 */
const props = defineProps({
  // { summary, items:[{id,content,memoryType}], state:'saved'|'undoing'|'undone', error }
  memory: { type: Object, required: true }
})
const emit = defineEmits(['undo'])

// 记忆类型 code→中文 label 与「个人记忆」页同源（避免向用户暴露 preference/fact 等生硬枚举）。
// 字典基本不变且 loadTypes 内部去重，挂载时触发一次即可；未加载时 typeLabel 回退原 code 不崩。
const memoryStore = useMemoryStore()
const expanded = ref(false)

onMounted(() => {
  memoryStore.loadTypes()
})

const items = computed(() => props.memory.items || [])
const state = computed(() => props.memory.state || 'saved')
const isUndone = computed(() => state.value === 'undone')
const isUndoing = computed(() => state.value === 'undoing')

function toggle() {
  if (items.value.length === 0) return
  expanded.value = !expanded.value
}

function onUndo() {
  if (isUndoing.value || isUndone.value) return
  emit('undo')
}
</script>

<template>
  <div class="mem-receipt" :class="{ 'is-undone': isUndone }">
    <div class="mem-receipt__head">
      <el-icon class="mem-receipt__icon">
        <component :is="isUndone ? 'CircleClose' : 'CircleCheck'" />
      </el-icon>

      <button
        type="button"
        class="mem-receipt__summary"
        :class="{ clickable: items.length > 0 }"
        :aria-expanded="expanded"
        @click="toggle"
      >
        <span class="mem-receipt__label">{{ isUndone ? '已撤销' : '已记住' }}</span>
        <span class="mem-receipt__text">{{ memory.summary }}</span>
        <el-icon v-if="items.length > 0" class="mem-receipt__caret" :class="{ open: expanded }">
          <ArrowDown />
        </el-icon>
      </button>

      <el-button
        v-if="!isUndone"
        class="mem-receipt__undo"
        link
        :loading="isUndoing"
        :disabled="isUndoing"
        @click="onUndo"
      >
        <el-icon v-if="!isUndoing"><RefreshLeft /></el-icon>
        {{ isUndoing ? '撤销中…' : '撤销' }}
      </el-button>
    </div>

    <!-- 展开：逐条 content 列表 -->
    <transition name="mem-expand">
      <ul v-if="expanded && items.length > 0" class="mem-receipt__items">
        <li v-for="(it, i) in items" :key="it.id ?? i" class="mem-receipt__item">
          <span class="dot" />
          <span class="content">{{ it.content }}</span>
          <span v-if="it.memoryType" class="type">{{ memoryStore.typeLabel(it.memoryType) }}</span>
        </li>
      </ul>
    </transition>

    <!-- 撤销失败提示（部分/全部失败时回填，可再次点击撤销重试） -->
    <div v-if="memory.error && !isUndone" class="mem-receipt__error">
      <el-icon><WarningFilled /></el-icon>
      <span>{{ memory.error }}</span>
    </div>
  </div>
</template>

<style scoped>
.mem-receipt {
  margin-top: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.mem-receipt.is-undone {
  background: var(--bg-sunken);
  border-color: var(--border-soft);
}

.mem-receipt__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.mem-receipt__icon {
  flex-shrink: 0;
  color: var(--c-success);
}
.is-undone .mem-receipt__icon {
  color: var(--c-text-faint);
}

.mem-receipt__summary {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 复用普通按钮重置，保持 Notion 克制感 */
  appearance: none;
  background: transparent;
  border: none;
  padding: 2px 4px;
  margin: 0 -4px;
  border-radius: var(--radius-sm);
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: default;
}
.mem-receipt__summary.clickable {
  cursor: pointer;
}
.mem-receipt__summary.clickable:hover {
  background: var(--bg-hover);
}
.mem-receipt__label {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.is-undone .mem-receipt__label {
  color: var(--c-text-muted);
}
.mem-receipt__text {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mem-receipt__caret {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  transition: transform var(--dur-fast) var(--ease-out);
}
.mem-receipt__caret.open {
  transform: rotate(180deg);
}

.mem-receipt__undo {
  flex-shrink: 0;
  color: var(--c-text-muted);
}
.mem-receipt__undo:hover {
  color: var(--c-accent);
}

.mem-receipt__items {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: var(--space-2) 0 0;
  border-top: 1px solid var(--border-soft);
}
.mem-receipt__item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 3px 0;
  font-size: var(--fs-sm);
  color: var(--c-text);
  line-height: var(--lh-base);
}
.mem-receipt__item .dot {
  flex-shrink: 0;
  width: 4px;
  height: 4px;
  margin-top: 7px;
  border-radius: var(--radius-pill);
  background: var(--c-text-faint);
}
.mem-receipt__item .content {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.mem-receipt__item .type {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  background: var(--bg-hover);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}

.mem-receipt__error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

.mem-expand-enter-active,
.mem-expand-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.mem-expand-enter-from,
.mem-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
