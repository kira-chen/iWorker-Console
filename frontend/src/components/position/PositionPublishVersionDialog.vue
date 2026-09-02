<script setup>
/**
 * N5 岗位发布版本弹窗（客户端会谈 R2）—— 展示版本号 + 升级说明。
 *
 * 用于「岗位列表」快捷发布入口（PositionWorkbench 走 PublishCheckDialog 内联版本区，二者共用同一 N5 校验规则）。
 * 打开时自动带出建议的下一个版本号（GET .../next-version-label，语义化 vX.Y.Z）：无历史→v1.0.0，上版 patch+1；无法建议（返 null）→禁用+人话提示。
 * 版本号格式硬拦（报错给样例）；升级说明必填；建议递增软提示不阻断。确认后 emit('confirm', { versionLabel, releaseNotes })。
 */
import { computed, watch } from 'vue'
import { getNextVersionLabel } from '@/api/position'
import { VERSION_LABEL_SAMPLE } from '@/utils/positionModel'
import { useVersionPublish } from '@/composables/useVersionPublish'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  positionId: { type: [String, Number], default: null },
  positionName: { type: String, default: '岗位' },
  publishing: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'confirm'])

// 版本发布编排收敛到 useVersionPublish（拉建议号 + 推 prevMaxLabel + 组合可提交态；行为不变）。
const { versionLabel, releaseNotes, prevMaxLabel, atMax, nextLoading, versionErr, incrementHint, notesErr, canSubmit, load } =
  useVersionPublish({ fetchNextLabel: (id) => getNextVersionLabel(id) })

watch(
  () => props.modelValue,
  (open) => {
    if (open) load(props.positionId) // load 内部清空 releaseNotes + 拉建议号 + 推 prevMaxLabel
  },
  { immediate: true } // 挂载时若已打开（v-model 初值 true）也带出建议号
)

// 发布按钮禁用原因（tooltip 复述，别让用户对着灰按钮猜）。无法自动建议优先，其次格式/升级说明。
const submitDisabledReason = computed(() => {
  if (atMax.value) return '无法自动生成建议版本号，请联系管理员处理版本策略'
  if (versionErr.value) return versionErr.value
  if (notesErr.value) return notesErr.value
  return ''
})

function submit() {
  if (!canSubmit.value) return
  emit('confirm', {
    versionLabel: versionLabel.value.trim(),
    releaseNotes: releaseNotes.value.trim()
  })
}
function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="发布岗位"
    width="460px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="pv">
      <p class="pv-name">{{ positionName }}</p>

      <div v-if="atMax" class="pv-max">
        无法自动生成建议版本号；如需继续发布请联系管理员处理版本策略。
      </div>
      <template v-else>
        <div class="pv-field">
          <label class="pv-label">版本号 <em>*</em></label>
          <el-input
            v-model="versionLabel"
            placeholder="例如 v013"
            maxlength="8"
            :disabled="nextLoading"
            class="pv-ver-input"
          />
          <div class="pv-tip">
            <span v-if="versionErr" class="pv-err">{{ versionErr }}</span>
            <span v-else-if="incrementHint" class="pv-warn">{{ incrementHint }}</span>
            <span v-else class="pv-dim">{{ VERSION_LABEL_SAMPLE }}</span>
          </div>
        </div>
        <div class="pv-field">
          <label class="pv-label">升级说明 <em>*</em></label>
          <el-input
            v-model="releaseNotes"
            type="textarea"
            :rows="3"
            maxlength="2000"
            show-word-limit
            placeholder="简述本次更新了什么，方便记录与追溯"
          />
          <div class="pv-tip">
            <span v-if="notesErr" class="pv-err">{{ notesErr }}</span>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <!-- 禁用且有原因时用 tooltip 复述（如无法自动建议版本号）；禁用态按钮不响应 hover，用 span 承接触发。 -->
      <el-tooltip
        v-if="submitDisabledReason && !canSubmit"
        :content="submitDisabledReason"
        placement="top"
      >
        <span class="pv-submit-wrap">
          <el-button type="primary" :disabled="!canSubmit" :loading="publishing" @click="submit">
            发布
          </el-button>
        </span>
      </el-tooltip>
      <el-button
        v-else
        type="primary"
        :disabled="!canSubmit"
        :loading="publishing"
        @click="submit"
      >
        发布
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pv {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.pv-name {
  margin: 0;
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  font-size: var(--fs-base);
}
/* 无法自动建议是「告知非错误」（非填写出错）→ 用 warning 语义色，不用 danger 红底。 */
.pv-max {
  color: var(--c-warning);
  background: var(--c-warning-soft);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.pv-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pv-label {
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.pv-label em {
  color: var(--c-danger);
  font-style: normal;
}
.pv-ver-input {
  max-width: 180px;
}
.pv-tip {
  min-height: 16px;
  font-size: var(--fs-xs);
}
.pv-err {
  color: var(--c-danger);
}
.pv-warn {
  color: var(--c-warning);
}
.pv-dim {
  color: var(--c-text-faint);
}
/* tooltip 承接 span：内联包裹禁用发布按钮，不影响 footer 布局 */
.pv-submit-wrap {
  display: inline-flex;
}
</style>
