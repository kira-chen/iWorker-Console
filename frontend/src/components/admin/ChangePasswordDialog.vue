<script setup>
/**
 * 修改密码弹窗（全站复用）：旧密码 + 新密码（≥8 位，两次确认）→ POST /auth/change-password。
 *
 * 两种用法：
 *  1) 普通改密入口（用户菜单/账户区）：可关闭；成功后 emit('done') 并关闭。
 *  2) 强制首改（forced=true，由 ChangePassword.vue 承载）：不可点遮罩/ESC 关闭、不显关闭按钮、不显取消按钮，
 *     成功后清 store.mustChangePassword 标志并 emit('done') 供外层放行跳转。
 *
 * 成功后统一调 userStore.clearMustChangePassword()（普通改密对该标志无副作用，幂等安全）。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { changePassword } from '@/api/auth'
import { useUserStore } from '@/stores/user'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 强制首改：锁死关闭路径，隐藏取消/关闭
  forced: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'done'])

const userStore = useUserStore()

const formRef = ref()
const saving = ref(false)
const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

// 弹窗可见性双绑：强制态下 el-dialog 的 close 事件被拦（不允许关），仅程序内 emit false。
const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

function validateNew(_rule, value, callback) {
  if (!value) return callback(new Error('请输入新密码'))
  if (value.length < 8) return callback(new Error('新密码至少 8 位'))
  if (value === form.oldPassword) return callback(new Error('新密码不能与旧密码相同'))
  // 若已填确认密码，改新密码后同步触发确认项校验
  if (form.confirmPassword) formRef.value?.validateField('confirmPassword')
  callback()
}
function validateConfirm(_rule, value, callback) {
  if (!value) return callback(new Error('请再次输入新密码'))
  if (value !== form.newPassword) return callback(new Error('两次输入的新密码不一致'))
  callback()
}

const rules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [{ validator: validateNew, trigger: 'blur' }],
  confirmPassword: [{ validator: validateConfirm, trigger: 'blur' }]
}

function reset() {
  form.oldPassword = ''
  form.newPassword = ''
  form.confirmPassword = ''
  formRef.value?.clearValidate?.()
}

// 打开时清空表单，避免残留上次输入
watch(
  () => props.visible,
  (v) => {
    if (v) reset()
  }
)

async function onSubmit() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      await changePassword({
        oldPassword: form.oldPassword,
        newPassword: form.newPassword
      })
      // 清强制首改标志（普通改密对此幂等无害），放行守卫
      userStore.clearMustChangePassword()
      ElMessage.success('密码修改成功')
      dialogVisible.value = false
      emit('done')
    } catch (e) {
      // 写接口 skipGlobalError：旧密码错误等按后端 message 就地提示
      ElMessage.error(e?.message || '密码修改失败，请重试')
    } finally {
      saving.value = false
    }
  })
}

function onCancel() {
  if (props.forced) return
  dialogVisible.value = false
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="forced ? '首次登录 · 请修改密码' : '修改密码'"
    width="440px"
    :close-on-click-modal="!forced"
    :close-on-press-escape="false"
    :show-close="!forced"
    append-to-body
    class="cpw-dialog"
  >
    <p v-if="forced" class="cpw-tip">
      为保障账号安全，首次登录须修改初始密码后方可继续使用。
    </p>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      @keyup.enter="onSubmit"
    >
      <el-form-item label="旧密码" prop="oldPassword">
        <el-input
          v-model="form.oldPassword"
          type="password"
          placeholder="请输入当前密码"
          show-password
          autocomplete="current-password"
        />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input
          v-model="form.newPassword"
          type="password"
          placeholder="至少 8 位"
          show-password
          autocomplete="new-password"
        />
      </el-form-item>
      <el-form-item label="确认新密码" prop="confirmPassword">
        <el-input
          v-model="form.confirmPassword"
          type="password"
          placeholder="请再次输入新密码"
          show-password
          autocomplete="new-password"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button v-if="!forced" @click="onCancel">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">
        确认修改
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.cpw-tip {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  color: var(--c-warning);
  background: var(--c-warning-soft);
  border-radius: var(--radius-md);
}
</style>
