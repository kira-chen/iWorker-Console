<script setup>
/**
 * 服务提供系统编辑器（2026-09-01 对齐 PRD-20260828《03能力/连接器/API/prd-API.md》§二.5）。
 *
 * 居中弹窗形态（对齐截图「API-服务提供系统弹窗」）。纯分组容器：
 * 仅「系统名称（必填，≤64，平台内不可重复）+ 系统描述（必填，≤2000）」两字段，
 * 不设启用/停用状态，不承载 URL / 鉴权 / 任何共享配置。
 * 保存成功后关闭弹窗并刷新列表，不跳转页面。
 *
 * 字段级错误（ApiError.field，含 mock 的重名校验）→ 红框回显。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { createProviderSystem, updateProviderSystem, getProviderSystem } from '@/api/apiConnector'

const props = defineProps({
  visible: { type: Boolean, default: false },
  systemId: { type: [Number, String], default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const isEdit = computed(() => props.systemId != null)
const loading = ref(false)
const saving = ref(false)

const form = reactive({ name: '', description: '' })
const fieldErrors = reactive({})

function clearErrors() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
}
function resetForm() {
  form.name = ''
  form.description = ''
  clearErrors()
}

async function load() {
  clearErrors()
  if (!isEdit.value) {
    resetForm()
    return
  }
  loading.value = true
  try {
    const d = await getProviderSystem(props.systemId)
    form.name = d.name || ''
    form.description = d.description || ''
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.systemId],
  ([vis]) => {
    if (vis) load()
  }
)

function close() {
  emit('update:visible', false)
}

// 前端基本校验（PRD §二.5：名称必填≤64；描述必填≤2000；重名由数据层校验回 field 错误）
function validate() {
  clearErrors()
  const name = form.name.trim()
  if (!name) {
    fieldErrors.name = '系统名称必填'
  } else if (name.length > 64) {
    fieldErrors.name = '系统名称最多 64 字符'
  }
  if (!form.description.trim()) {
    fieldErrors.description = '系统描述必填'
  } else if (form.description.length > 2000) {
    fieldErrors.description = '系统描述最多 2000 字符'
  }
  return Object.keys(fieldErrors).length === 0
}

async function save() {
  if (!validate()) {
    ElMessage.warning('请先修正标红项')
    return
  }
  saving.value = true
  try {
    const payload = { name: form.name.trim(), description: form.description.trim() }
    const data = isEdit.value
      ? await updateProviderSystem(props.systemId, payload)
      : await createProviderSystem(payload)
    ElMessage.success('已保存')
    emit('saved', { id: isEdit.value ? props.systemId : data?.id })
    close()
  } catch (e) {
    if (e?.field) {
      fieldErrors[e.field] = e.message || '校验未通过'
      ElMessage.error(e.message || '校验未通过')
    } else {
      ElMessage.error(e?.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="isEdit ? '编辑服务提供系统' : '新建服务提供系统'"
    width="440px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form v-loading="loading" label-position="top">
      <el-form-item label="系统名称" :error="fieldErrors.name" required>
        <el-input
          v-model="form.name"
          maxlength="64"
          placeholder="如 财务服务系统"
          @input="delete fieldErrors.name"
        />
      </el-form-item>
      <el-form-item label="系统描述" :error="fieldErrors.description" required>
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          :autosize="{ minRows: 3, maxRows: 5 }"
          maxlength="2000"
          show-word-limit
          placeholder="如 聚合报销、付款与财务单据接口"
          @input="delete fieldErrors.description"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
