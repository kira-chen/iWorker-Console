<script setup>
/**
 * 业务系统登录态托管弹窗（员工侧，切片3b）。
 * 用于「连接 / 重新登录」：提交登录态凭据 → POST /api/my-positions/biz-credentials。
 *
 * 本期为「设计占位」交互：无头浏览器真实执行排后期。流程提示用户「打开登录页 → 登录后
 * 复制登录态（token/cookie）粘贴回托管」，由后端立即加密落库。
 *
 * 安全铁律：
 * - 凭据明文仅在本弹窗内存表单中临时存在，提交后立即清空；绝不持久化到本地 / 日志 / store。
 * - 凭据输入框用 password 类型遮挡；关闭 / 提交后即清空。
 * - 后端绝不回显凭据，故本弹窗不做任何凭据回显。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { hostBizCredential } from '@/api/myPosition'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 目标业务系统（重新登录时由列表传入；含 bizSystemId / bizSystemName / loginUrl 可空）
  target: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'hosted'])

const submitting = ref(false)
const form = reactive({
  credential: '',
  expiresAt: null
})
const fieldErrors = reactive({})

const sysName = computed(() => props.target?.bizSystemName || '业务系统')
const loginUrl = computed(() => props.target?.loginUrl || '')

function clearForm() {
  // 安全：清空凭据明文，不留痕
  form.credential = ''
  form.expiresAt = null
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
}

watch(
  () => props.visible,
  (v) => {
    if (v) clearForm()
    else clearForm() // 关闭也立即清空凭据
  }
)

function close() {
  emit('update:visible', false)
}

function openLoginPage() {
  if (loginUrl.value) window.open(loginUrl.value, '_blank', 'noopener')
}

async function submit() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
  const bizSystemId = props.target?.bizSystemId
  if (bizSystemId == null) {
    ElMessage.error('缺少目标业务系统')
    return
  }
  if (!form.credential.trim()) {
    fieldErrors.credential = '请粘贴登录态凭据'
    return
  }
  submitting.value = true
  try {
    // expiresAt 转 ISO（el-date-picker 给 Date）；空则不传
    const payload = {
      bizSystemId,
      credential: form.credential,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null
    }
    await hostBizCredential(payload)
    // 安全：提交成功立即清空内存中的凭据明文
    clearForm()
    ElMessage.success('已连接')
    emit('hosted', { bizSystemId })
    close()
  } catch (e) {
    if (e?.field === 'credential') {
      fieldErrors.credential = e.message || '凭据校验未通过'
    } else {
      ElMessage.error(e?.message || '连接失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`连接「${sysName}」`"
    width="520px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', $event)"
    @closed="clearForm"
  >
    <div class="bch-body">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="登录态托管说明（占位）"
      >
        <div class="bch-steps">
          <p>本期为设计占位交互，无头浏览器自动登录将于后期上线。临时托管步骤：</p>
          <ol>
            <li>打开该业务系统登录页并完成登录</li>
            <li>从浏览器复制登录态（token / cookie）</li>
            <li>粘贴到下方并提交，由系统加密托管</li>
          </ol>
        </div>
      </el-alert>

      <div v-if="loginUrl" class="bch-login-row">
        <span class="bch-url">{{ loginUrl }}</span>
        <el-button link type="primary" @click="openLoginPage">打开登录页</el-button>
      </div>

      <el-form label-position="top" class="bch-form">
        <el-form-item label="登录态凭据" :error="fieldErrors.credential" required>
          <el-input
            v-model="form.credential"
            type="password"
            show-password
            :rows="3"
            placeholder="粘贴登录态 token / cookie（仅用于加密托管，绝不展示）"
          />
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            placeholder="可选，到期后将提示重新登录"
            class="bch-w"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">提交托管</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.bch-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.bch-steps p {
  margin: 0 0 var(--space-1);
}
.bch-steps ol {
  margin: 0;
  padding-left: 18px;
}
.bch-steps li {
  line-height: 1.7;
}
.bch-login-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
}
.bch-url {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.bch-w {
  width: 100%;
}
</style>
