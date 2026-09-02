<script setup>
/**
 * 人格编辑弹窗（设计 §4.1 / §4.2 + 反馈 3）—— 替代原身份卡「人格」折叠块。
 *
 * 内含：领用页文案多条编辑器（ClaimDescEditor）+ 岗位人格（复用技能同款 Milkdown 编辑器，无工具引用）。
 * 图标选择已移至身份卡头像旁 popover（反馈 1），本弹窗不再含图标库。
 *
 * 数据流：弹窗内编辑 → patch(key,value) → emit('update:basic')（v-model:basic 不变，与就地编辑同源）；
 * 保存沿用父级 debounce 自动保存（弹窗仅做编辑容器，不持有保存职责）。
 *
 * el-dialog :close-on-click-modal="false"（防误点遮罩丢编辑态，对齐 IntakeFormDialog）。
 */
import { computed } from 'vue'
import ClaimDescEditor from './ClaimDescEditor.vue'
import SkillMilkdownEditor from './SkillMilkdownEditor.vue'
import RecommendedQuestionsEditor from './RecommendedQuestionsEditor.vue'
import { LIMITS, normalizeRecommendedQuestions } from '@/utils/positionModel'

const props = defineProps({
  visible: { type: Boolean, default: false },
  basic: { type: Object, required: true },
  // N4：推荐问题逐格红框开关（父级在发布门被拦时置 true，指出哪格空）。
  rqShowErrors: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'update:basic'])

function patch(key, value) {
  emit('update:basic', { ...props.basic, [key]: value })
}

/* ---------- 领用页文案多条（claimDesc 数组） ---------- */
const claimItems = computed({
  get: () => (Array.isArray(props.basic.claimDesc) ? props.basic.claimDesc : []),
  set: (v) => patch('claimDesc', v)
})

/* ---------- N4 推荐问题（固定 4 格） ---------- */
const recommendedQuestions = computed({
  get: () => normalizeRecommendedQuestions(props.basic.recommendedQuestions),
  set: (v) => patch('recommendedQuestions', v)
})

/* ---------- 软提示计数 ---------- */
const personaLen = computed(() => (props.basic.persona || '').length)
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="编辑人格"
    width="820px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="pe-body">
      <!-- 领用页文案（多条） -->
      <div class="pe-sec">
        <div class="pe-sec-title">
          领用页文案
          <span class="pe-sec-sub">员工领用时看到的卖点 · 可多条</span>
        </div>
        <ClaimDescEditor v-model="claimItems" />
      </div>

      <!-- N4 推荐问题（固定 4 个，都要填才会随岗位下发给客户端） -->
      <div class="pe-sec">
        <div class="pe-sec-title">
          推荐问题
          <span class="pe-sec-sub">客户端进入岗位后展示的 4 个引导问题 · 固定 4 个</span>
        </div>
        <RecommendedQuestionsEditor v-model="recommendedQuestions" :show-errors="rqShowErrors" />
      </div>

      <!-- 岗位人格：复用技能同款 Milkdown 所见即所得编辑器（无工具引用：不传 toolNames、不调 insertTool） -->
      <div class="pe-sec">
        <div class="pe-sec-title">
          岗位人格
          <span class="pe-sec-sub">用户端可个性化覆盖 · markdown</span>
          <span class="hint" :class="{ over: personaLen > LIMITS.PERSONA_SOFT }">
            {{ personaLen }} / {{ LIMITS.PERSONA_SOFT }}
          </span>
        </div>
        <div class="pe-persona-mde">
          <SkillMilkdownEditor
            :model-value="basic.persona"
            height="400px"
            placeholder="稳、细、主动、有分寸…"
            @update:model-value="patch('persona', $event)"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <el-button type="primary" @click="emit('update:visible', false)">完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pe-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  /* 给人格 Milkdown(400px)+领用文案留舒展空间；超出则整体滚动（双主题、滚动得当） */
  max-height: 72vh;
  overflow: auto;
}
.pe-sec {
  display: flex;
  flex-direction: column;
}
/* 区块标题：主标题加粗近黑 + 副说明弱化小字（对齐 dt-sec-title / md-sec-title 全站范式） */
.pe-sec-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin: 0 0 var(--space-2);
}
.pe-sec-sub {
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.pe-sec-title .hint {
  margin-left: auto;
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.pe-sec-title .hint.over {
  color: var(--c-warning);
}
/* 人格 Milkdown 编辑器外框：与站内表单输入一致的边框/圆角，内部编辑器自管滚动 */
.pe-persona-mde {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-surface);
}
</style>
