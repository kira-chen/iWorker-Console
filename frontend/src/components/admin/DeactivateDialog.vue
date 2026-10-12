<script setup>
/**
 * 停用确认弹窗（技能 / 专家 / MCP / API / 业务系统共用）——「强制回收」并入停用的勾选项。
 *
 * 对应 PRD 各模块「强制回收（停用时勾选）」小节：
 * - 默认是普通停用：展示各页自己的提示正文（plainMessage），确认按钮文案由 confirmText 传入；
 * - 勾选「强制回收」后弹窗换成危险样式：标题「强制回收{typeLabel}」、影响范围、红色警示、必填回收原因（≤500 字）、
 *   红色【提交强制回收审核】；取消勾选恢复普通样式并清空已填原因；
 * - 强制回收与普通停用同走审核，**不再有二次确认**；
 * - 技能被引用时普通停用被拦截：调用方传 blockedMessage，未勾选时展示并禁用确认，勾选强制回收后放行。
 *
 * 确认经 confirm 事件上抛 { forceRevoke, reason }（普通停用 reason 为空串）；请求成败由调用方处理，成功后调用方自行关闭。
 */
import { ref, computed, watch } from 'vue'
import { FORCE_REVOKE_REASON_MAX, validateRevokeReason } from '@/utils/forceRevoke'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 对象类型名，如「技能」「专家」「MCP 服务」「API」「业务系统」 */
  typeLabel: { type: String, required: true },
  /** 普通停用的弹窗标题；缺省按「停用{typeLabel}」拼（个别模块 PRD 标题带空格，如「停用 MCP 服务」，由调用方覆盖） */
  plainTitle: { type: String, default: '' },
  /** 强制回收红色警示里“谁将失去它”的措辞，各模块 PRD 不同：连接器「已绑定该连接器的员工」、技能「已获得该技能的员工」、专家「已召唤该专家的员工」 */
  holderText: { type: String, default: '已获得它的员工' },
  /** 对象名称 */
  name: { type: String, default: '' },
  /** 普通停用弹窗的提示正文（各模块 PRD 文案不同，由调用方给） */
  plainMessage: { type: String, default: '' },
  /** 普通停用的确认按钮文案：【继续停用】或【提交停用审核】 */
  confirmText: { type: String, default: '继续停用' },
  /** 影响范围：被引用个数与引用方描述（如「岗位 / 技能」）；refCount 为 0 不展示这句 */
  refCount: { type: Number, default: 0 },
  refText: { type: String, default: '岗位 / 技能' },
  /** 普通停用被拦截的原因（技能被引用）；非空时未勾选强制回收不可提交 */
  blockedMessage: { type: String, default: '' },
  /** 提交中：确认按钮转圈防重复提交 */
  submitting: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const forceRevoke = ref(false)
const reason = ref('')
const error = ref('')
const inputRef = ref(null)

// 每次打开都回到默认的普通停用
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      forceRevoke.value = false
      reason.value = ''
      error.value = ''
    }
  }
)
// 取消勾选：清空已填的回收原因
watch(forceRevoke, (v) => {
  if (!v) {
    reason.value = ''
    error.value = ''
  }
})

const title = computed(() =>
  forceRevoke.value ? `强制回收${props.typeLabel}` : props.plainTitle || `停用${props.typeLabel}`
)
const blocked = computed(() => !forceRevoke.value && !!props.blockedMessage)

function onConfirm() {
  if (blocked.value) return
  if (!forceRevoke.value) {
    emit('confirm', { forceRevoke: false, reason: '' })
    return
  }
  const msg = validateRevokeReason(reason.value)
  if (msg) {
    error.value = msg
    inputRef.value?.focus?.()
    return
  }
  emit('confirm', { forceRevoke: true, reason: reason.value.trim() })
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="480px" append-to-body>
    <template v-if="!forceRevoke">
      <p v-if="blockedMessage" class="dd-blocked" data-test="dd-blocked">{{ blockedMessage }}</p>
      <p v-else class="dd-text" data-test="dd-plain">{{ plainMessage }}</p>
    </template>
    <template v-else>
      <p class="dd-text">
        即将强制回收 <strong>「{{ name }}」</strong
        ><template v-if="refCount > 0">，当前已被 {{ refCount }} 个{{ refText }}引用（引用关系保留，标记为「已回收」）。</template
        ><template v-else>。</template>
      </p>
      <p class="dd-danger" data-test="dd-danger">
        强制回收经审核通过后生效，生效后不可撤销：{{ holderText }}将失去它，引用它的自动化将被挂起。审核通过前仍可正常使用。
      </p>
      <div class="dd-label"><b class="dd-required">*</b> 回收原因</div>
      <el-input
        ref="inputRef"
        v-model="reason"
        type="textarea"
        :rows="4"
        :maxlength="FORCE_REVOKE_REASON_MAX"
        show-word-limit
        placeholder="请输入回收原因，将展示给受影响的员工"
        @input="error = ''"
      />
      <div v-if="error" class="dd-error" data-test="dd-error">{{ error }}</div>
    </template>
    <el-checkbox v-model="forceRevoke" class="dd-check" data-test="dd-force-check">
      强制回收（审核通过后员工将失去该{{ typeLabel }}，不可撤销）
    </el-checkbox>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        :type="forceRevoke ? 'danger' : 'primary'"
        :disabled="blocked"
        :loading="submitting"
        data-test="dd-confirm"
        @click="onConfirm"
      >{{ forceRevoke ? '提交强制回收审核' : confirmText }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dd-text {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.dd-blocked,
.dd-danger {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.dd-label {
  margin-bottom: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.dd-required {
  color: var(--c-danger);
  margin-right: 2px;
}
.dd-error {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.dd-check {
  display: flex;
  margin-top: var(--space-3);
  height: auto;
  white-space: normal;
}
</style>
