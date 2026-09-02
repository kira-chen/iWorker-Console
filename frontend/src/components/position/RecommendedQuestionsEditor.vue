<script setup>
/**
 * N4 岗位「推荐问题」编辑器（客户端会谈 R2）—— 固定 4 格、必填、不许增删。
 *
 * 界面上就是 4 个输入框（编号 1~4 + 必填红星），无"添加/删除"按钮（数量硬定为 4）。
 * 每格硬上限 30 字（maxlength 直接拦 + el-input 自带「16/30」计数）；顶部一句填写提示 +
 * 参考通用问题，缓解"为凑数硬填"。
 * 校验（4 格全填）在发布门统一处理；本组件负责录入 + 空格红框标识。
 *
 * 数据流：v-model（固定 4 长度数组）。父级把 store.basic.recommendedQuestions 传入，改动回吐 → 沿用父级
 * debounce 自动保存（仅当 4 格全填才会随保存下发，见 PositionWorkbench.buildBasicPayload）。
 */
import { computed } from 'vue'
import { normalizeRecommendedQuestions, RECOMMENDED_Q_MAX_LEN } from '@/utils/positionModel'

const props = defineProps({
  modelValue: { type: Array, default: () => ['', '', '', ''] },
  // 是否高亮未填格（发布校验失败后由父级置 true，逐格红框指出哪格没填）
  showErrors: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

// 恒 4 格视图（不足补空、超出截断），保证始终渲染 4 个输入框。
const questions = computed(() => normalizeRecommendedQuestions(props.modelValue))

// 参考通用问题（引导文案，不减少 4 个数量要求）
const REFERENCES = ['帮我查一下……', '帮我生成……', '最近有哪些……', '怎么处理……']

function onInput(idx, val) {
  const next = normalizeRecommendedQuestions(props.modelValue)
  next[idx] = val
  emit('update:modelValue', next)
}

function isEmpty(idx) {
  return String(questions.value[idx] || '').trim().length === 0
}
</script>

<template>
  <div class="rq">
    <!-- 单行简短提示（必填口径由逐格红星体现），显式行高避免换行时行间重叠 -->
    <p class="rq-guide">
      填终端用户最常问、最想让 AI 同事帮忙办的问题，可参考：<span class="rq-ref">{{ REFERENCES.join('、') }}</span>
    </p>

    <div class="rq-list">
      <div v-for="(q, idx) in questions" :key="idx" class="rq-item">
        <span class="rq-no"><i class="rq-req">*</i>{{ idx + 1 }}</span>
        <div class="rq-field">
          <el-input
            :model-value="q"
            :placeholder="`推荐问题 ${idx + 1}（必填）`"
            :maxlength="RECOMMENDED_Q_MAX_LEN"
            show-word-limit
            :class="{ 'rq-input-err': showErrors && isEmpty(idx) }"
            @update:model-value="onInput(idx, $event)"
          />
          <div v-if="showErrors && isEmpty(idx)" class="rq-foot">
            <span class="rq-err">此格必填</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rq {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
/* 显式行高 + 正常换行，修复提示语折行后两行文字重叠 */
.rq-guide {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1.7;
  white-space: normal;
  word-break: break-word;
}
.rq-ref {
  color: var(--c-text-faint);
}
.rq-list {
  /* 4 格对半分成两列（2026-08-28 岗位详情页紧凑布局）；窄屏回落单列 */
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}
.rq-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.rq-no {
  flex-shrink: 0;
  width: 30px;
  height: 32px;
  line-height: 32px;
  text-align: center;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-muted);
}
/* 必填红星（对齐 el-form required 视觉口径） */
.rq-req {
  color: var(--c-danger);
  font-style: normal;
  margin-right: 2px;
}
.rq-field {
  flex: 1;
  min-width: 0;
}
.rq-foot {
  margin-top: 4px;
  font-size: var(--fs-xs);
}
.rq-err {
  color: var(--c-danger);
}
:deep(.rq-input-err .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
@media (max-width: 900px) {
  .rq-list {
    grid-template-columns: 1fr;
  }
}
</style>
