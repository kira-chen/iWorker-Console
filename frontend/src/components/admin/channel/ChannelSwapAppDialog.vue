<script setup>
/**
 * 编辑机器人 ·【更换应用】窗口（PRD 渠道 第四章 3.1）。
 *
 * 填新应用标识和密钥（均必填）→【验证新应用】→ 通过后【更换应用】可点 → 再次确认 → 状态变为「待平台发布」。
 * 新应用标识与当前相同提示「和当前应用相同，无需更换」；新应用必须与原组织一致（mock 按密钥演示约定判断）。
 * 修改任一输入后验证结果清空，需重新验证。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/composables/useConfirm'
import { verifySwapApp, swapApp } from '@/api/channel'
import { PLATFORMS, appKeyError, secretError } from '@/utils/channelMeta'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 当前机器人：{ id, ch, name, appKey, groupCount } */
  bot: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'swapped'])

const form = reactive({ appKey: '', secret: '' })
const errors = reactive({ appKey: '', secret: '' })
const verify = reactive({ state: 'idle', msg: '' })
const submitting = ref(false)

const p = computed(() => (props.bot ? PLATFORMS[props.bot.ch] : null))

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    form.appKey = ''
    form.secret = ''
    errors.appKey = ''
    errors.secret = ''
    verify.state = 'idle'
    verify.msg = ''
  }
)

function onInput(field) {
  errors[field] = ''
  if (verify.state !== 'checking') {
    verify.state = 'idle'
    verify.msg = ''
  }
}

function localCheck() {
  const ch = props.bot.ch
  const key = form.appKey.trim()
  errors.appKey = appKeyError(ch, key) || (key === props.bot.appKey ? '和当前应用相同，无需更换' : '')
  errors.secret = secretError(ch, form.secret)
  return !errors.appKey && !errors.secret
}

async function doVerify() {
  if (!localCheck()) return
  verify.state = 'checking'
  try {
    await verifySwapApp(props.bot.id, { appKey: form.appKey.trim(), secret: form.secret })
    verify.state = 'ok'
  } catch (e) {
    if (e?.field === 'appKey') {
      errors.appKey = e.message
      verify.state = 'idle'
    } else {
      verify.state = 'fail'
      verify.msg = e?.message || '验证失败'
    }
  }
}

async function confirmSwap() {
  if (verify.state !== 'ok' || submitting.value) return
  const ok = await confirmDialog(
    `更换后「${props.bot.name}」立即改用新应用，员工需要重新找到机器人，已加入的 ${props.bot.groupCount} 个群需要重新拉入。确认更换？`,
    '确认更换应用？',
    { confirmText: '更换应用', danger: true }
  )
  if (!ok) return
  submitting.value = true
  try {
    const row = await swapApp(props.bot.id, { appKey: form.appKey.trim(), secret: form.secret })
    ElMessage.success(`已更换应用，请在${p.value.console}发布新应用版本`)
    emit('update:modelValue', false)
    emit('swapped', row)
  } catch (e) {
    if (e?.field) errors[e.field] = e.message
    else ElMessage.error(e?.message || '更换失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="bot ? `更换应用 · ${bot.name}` : '更换应用'"
    width="600px"
    append-to-body
    :close-on-click-modal="false"
    class="sw-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="bot">
      <div class="sw-warn" data-testid="swap-impact">
        <b>更换后：</b>员工在{{ p.name }}里看到的是新的机器人会话；员工的 open_id 会变化，系统按身份匹配字段自动重新识别；已加入的
        {{ bot.groupCount }} 个群需要重新拉入新机器人；新应用需要重新设置可用范围并发布版本。
      </div>
      <el-form label-position="top" @submit.prevent>
        <el-form-item :label="`新应用 ${p.key.label}`" required :class="{ 'is-error': errors.appKey }">
          <el-input v-model="form.appKey" class="mono" :placeholder="p.key.placeholder" data-testid="swap-key" @input="onInput('appKey')" />
          <div v-if="errors.appKey" class="sw-err">{{ errors.appKey }}</div>
        </el-form-item>
        <el-form-item :label="`新应用 ${p.secret.label}`" required :class="{ 'is-error': errors.secret }">
          <el-input v-model="form.secret" class="mono" type="password" data-testid="swap-secret" @input="onInput('secret')" />
          <div v-if="errors.secret" class="sw-err">{{ errors.secret }}</div>
        </el-form-item>
      </el-form>
      <div class="sw-verify">
        <el-button size="small" :loading="verify.state === 'checking'" data-testid="swap-verify" @click="doVerify">验证新应用</el-button>
        <span v-if="verify.state === 'checking'" class="sw-muted">验证中…</span>
        <span v-else-if="verify.state === 'ok'" class="sw-ok">✓ 验证通过，新应用与原组织一致</span>
        <span v-else-if="verify.state === 'fail'" class="sw-fail">✕ {{ verify.msg }}</span>
      </div>
    </template>
    <template #footer>
      <el-button :disabled="submitting" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="danger" :disabled="verify.state !== 'ok'" :loading="submitting" data-testid="swap-ok" @click="confirmSwap">更换应用</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.sw-warn {
  margin-bottom: var(--space-4);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text);
  background: var(--c-warning-soft);
  border-left: 3px solid var(--c-warning);
  border-radius: var(--radius-sm);
}
.mono :deep(input) {
  font-family: var(--font-mono);
}
.sw-err {
  width: 100%;
  margin-top: 4px;
  font-size: var(--fs-xs);
  line-height: 1.4;
  color: var(--c-danger);
}
.sw-verify {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.sw-muted {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.sw-ok {
  font-size: var(--fs-xs);
  color: var(--c-success);
}
.sw-fail {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
