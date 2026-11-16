<script setup>
/**
 * 机器人页签【消息设置】弹窗（PRD 渠道 第三章 6；2026-11-16 由「配额与限流」页迁来）。
 *
 * 只有一项「消息合并等待时长」，对全部机器人生效：
 *  - 打开时读取当前已保存的值；读取失败只展示「配置读取失败」与【重试】，不出输入框（不知道当前值就不让覆盖）；
 *  - 点【保存】时才校验，不自动取整、不自动拉回范围；与已保存值数值相同时【保存】置灰（含「05」这类写法）；
 *  - 保存成功提示「已保存，对全部 IM 机器人生效」并关闭；失败提示原因，弹窗不关、保留填写的值；
 *  - 值有变化时由 mock 写访问审计「渠道 / 修改配置」（PRD 第十章）。
 */
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getMessageSettings, saveMessageSettings } from '@/api/channel'
import { MERGE_WAIT_LABEL, mergeWaitInputError } from '@/utils/channelMeta'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
/** 当前已保存的值（秒） */
const savedSec = ref(null)
/** 输入框里的原始文本：保留管理员填的样子，点保存时再校验 */
const input = ref('')
const fieldError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await getMessageSettings()
    savedSec.value = data.mergeWaitSec
    input.value = String(data.mergeWaitSec)
    fieldError.value = ''
  } catch (e) {
    loadError.value = e?.message || '配置读取失败'
  } finally {
    loading.value = false
  }
}
watch(
  () => props.modelValue,
  (v) => {
    if (v) load()
  },
  { immediate: true }
)

const unchanged = computed(() => {
  const text = String(input.value ?? '').trim()
  return text !== '' && /^\d+$/.test(text) && Number(text) === savedSec.value
})
const saveDisabled = computed(() => loading.value || !!loadError.value || unchanged.value)

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

async function save() {
  if (saveDisabled.value) return
  const message = mergeWaitInputError(input.value)
  if (message) {
    fieldError.value = message
    return
  }
  saving.value = true
  try {
    const data = await saveMessageSettings(Number(String(input.value).trim()))
    savedSec.value = data.mergeWaitSec
    ElMessage.success('已保存，对全部 IM 机器人生效')
    emit('update:modelValue', false)
  } catch (e) {
    if (e?.field === 'mergeWaitSec') fieldError.value = e.message
    else ElMessage.error(e?.message || '保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="消息设置"
    width="520px"
    append-to-body
    :close-on-click-modal="false"
    :before-close="(done) => !saving && done()"
    class="ms-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-loading="loading" class="ms-body">
      <el-empty v-if="loadError" :image-size="80" description="配置读取失败">
        <p class="ms-error-reason">{{ loadError }}</p>
        <el-button @click="load">重试</el-button>
      </el-empty>
      <div v-else-if="!loading" class="ms-field">
        <label class="ms-label" for="ms-merge-wait"><span class="ms-required">*</span>{{ MERGE_WAIT_LABEL }}</label>
        <el-input
          id="ms-merge-wait"
          v-model="input"
          class="ms-input"
          :class="{ 'is-error': fieldError }"
          data-testid="merge-wait-input"
          @input="fieldError = ''"
          @keyup.enter="save"
        >
          <template #suffix>秒</template>
        </el-input>
        <p v-if="fieldError" class="ms-error" data-testid="merge-wait-error">{{ fieldError }}</p>
        <p class="ms-hint">
          员工在 IM 里连着发的几条消息，从最后一条算起等这么久，期间发来的合成一件事处理。时长越长，员工收到「收到」越晚。
        </p>
        <p class="ms-scope">对全部机器人生效，不按平台、机器人、群、员工单独设置。</p>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="saveDisabled" data-testid="merge-wait-save" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ms-body {
  min-height: 96px;
}
.ms-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ms-label {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.ms-required {
  margin-right: 2px;
  color: var(--c-danger);
}
.ms-input {
  width: 160px;
}
.ms-input.is-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.ms-error {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.ms-hint,
.ms-scope {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--c-text-muted);
}
.ms-scope {
  color: var(--c-text-faint);
}
.ms-error-reason {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
</style>
