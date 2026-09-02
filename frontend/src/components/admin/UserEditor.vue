<script setup>
/**
 * 用户编辑器（ADMIN 专属，P5）。
 *
 * 两态：
 *  - 新建：username / displayName / email / 多选角色（roleCodes[]）。
 *    提示「初始密码为 wemate123，用户首次登录后可修改密码。」；建号自动设默认密码 + 强制首改。
 *  - 编辑：displayName / email / status（启停，2026-09-01 对齐原型改为下拉）；username 只读、
 *    角色在「设置角色」单独弹窗管理；补只读 创建时间/最近更新时间/最近登录时间（从未登录显「从未登录」）。
 *
 * 写接口 skipGlobalError：护栏错误（用户名重复等）按 message 就地 toast。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { createUser, updateUser } from '@/api/adminUser'
import { fmtTime } from '@/utils/docMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 待编辑用户（null=新建）：{ id, username, displayName, email, status, roleCodes:[] }
  user: { type: Object, default: null },
  // 角色选项：[{ code, name }]（供新建时多选）
  roleOptions: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:visible', 'saved'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

const isEdit = computed(() => !!props.user?.id)
const title = computed(() => (isEdit.value ? '编辑用户' : '新建用户'))

const formRef = ref()
const saving = ref(false)
const form = reactive({
  username: '',
  displayName: '',
  email: '',
  roleCodes: [],
  status: 'active'
})

function reset() {
  form.username = props.user?.username || ''
  form.displayName = props.user?.displayName || ''
  form.email = props.user?.email || ''
  form.roleCodes = (props.user?.roleCodes || []).slice()
  form.status = props.user?.status || 'active'
  formRef.value?.clearValidate?.()
}

watch(
  () => props.visible,
  (v) => {
    if (v) reset()
  }
)

const rules = computed(() => {
  const r = {
    displayName: [{ required: true, message: '请输入显示名', trigger: 'blur' }],
    email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }]
  }
  if (!isEdit.value) {
    r.username = [
      { required: true, message: '请输入用户名', trigger: 'blur' },
      { min: 3, max: 32, message: '用户名 3–32 位', trigger: 'blur' }
    ]
    r.roleCodes = [
      {
        type: 'array',
        required: true,
        message: '请至少选择一个角色',
        trigger: 'change'
      }
    ]
  }
  return r
})

const roleOptionList = computed(() =>
  (props.roleOptions || []).map((it) => ({
    code: typeof it === 'string' ? it : it?.code,
    name: typeof it === 'string' ? it : it?.name || it?.code
  }))
)

async function onSubmit() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      if (!isEdit.value) {
        await createUser({
          username: form.username,
          displayName: form.displayName,
          email: form.email,
          roleCodes: form.roleCodes
        })
      } else {
        // 编辑仅 displayName/email/status（启停）；username 与角色不在此改
        await updateUser(props.user.id, {
          displayName: form.displayName,
          email: form.email,
          status: form.status
        })
      }
      ElMessage.success('已保存')
      dialogVisible.value = false
      emit('saved')
    } catch (e) {
      ElMessage.error(e?.message || '保存失败，请重试')
    } finally {
      saving.value = false
    }
  })
}
</script>

<template>
  <el-dialog v-model="dialogVisible" :title="title" width="480px" append-to-body>
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="用户名" prop="username">
        <!-- username 创建后只读 -->
        <el-input v-model="form.username" placeholder="登录用户名" :disabled="isEdit" />
      </el-form-item>
      <el-form-item label="显示名" prop="displayName">
        <el-input v-model="form.displayName" placeholder="用于展示的姓名" />
      </el-form-item>
      <el-form-item label="邮箱" prop="email">
        <el-input v-model="form.email" placeholder="选填" clearable />
      </el-form-item>

      <!-- 新建：多选角色 + 初始密码提示 -->
      <template v-if="!isEdit">
        <el-form-item label="角色" prop="roleCodes">
          <el-select
            v-model="form.roleCodes"
            multiple
            placeholder="选择一个或多个角色"
            class="ue-role-select"
          >
            <el-option
              v-for="r in roleOptionList"
              :key="r.code"
              :label="r.name"
              :value="r.code"
            />
          </el-select>
        </el-form-item>
        <div class="ue-tip">
          初始密码为 <b>wemate123</b>，用户首次登录后可修改密码。
        </div>
      </template>

      <!-- 编辑：启停（2026-09-01 对齐原型 openUserDialog：下拉形态）+ 只读时间信息 -->
      <template v-else>
        <el-form-item label="状态">
          <el-select v-model="form.status" class="ue-status-select">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
        <div class="ue-meta">
          <div class="ue-meta-row">
            <span class="ue-meta-label">最近登录时间</span>
            <span class="ue-meta-value">{{ props.user?.lastLogin ? fmtTime(props.user.lastLogin) : '从未登录' }}</span>
          </div>
          <div class="ue-meta-row">
            <span class="ue-meta-label">创建时间</span>
            <span class="ue-meta-value">{{ props.user?.createdAt ? fmtTime(props.user.createdAt) : '—' }}</span>
          </div>
          <div class="ue-meta-row">
            <span class="ue-meta-label">最近更新时间</span>
            <span class="ue-meta-value">{{ props.user?.updatedAt ? fmtTime(props.user.updatedAt) : '—' }}</span>
          </div>
        </div>
      </template>
    </el-form>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ue-role-select {
  width: 100%;
}
.ue-tip {
  margin-top: var(--space-1);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--c-text-muted);
  background: var(--bg-hover);
  border-radius: var(--radius-md);
}
.ue-tip b {
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
}
.ue-status-select {
  width: 160px;
}
/* 编辑态只读时间信息（原型 page-time：创建/最近更新/最近登录） */
.ue-meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-soft);
  font-size: var(--fs-xs);
}
.ue-meta-row {
  display: flex;
  gap: var(--space-2);
}
.ue-meta-label {
  flex: none;
  width: 96px;
  color: var(--c-text-faint);
}
.ue-meta-value {
  color: var(--c-text-muted);
}
</style>
