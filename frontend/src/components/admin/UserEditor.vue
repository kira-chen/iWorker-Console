<script setup>
/**
 * 用户编辑器（ADMIN 专属，P5）。
 *
 * 两态：
 *  - 新建：username / displayName / email / 初始角色（roleCodes[]，卡片复选）。
 *    提示「初始密码为 wemate123，用户首次登录后可修改。」；建号自动设默认密码 + 强制首改。
 *  - 编辑：displayName / email / status（启停，2026-09-01 对齐原型改为下拉）；username 只读、
 *    角色在「设置角色」单独弹窗管理；补只读 最近登录时间（从未登录显「从未登录」）+ 创建时间 / 最近更新时间。
 *
 * 2026-09-08 原型复刻批次 2A（G#5/#6/#7，原型 openUserDialog L250 + .modal.wide / .dialog-grid L110）：
 *  - 居中窗 520px、标题栏 / 动作条带分隔线（admin-dialog 壳）；
 *  - 两列网格：用户名 / 显示名 / 邮箱 跨两列；编辑态「状态」下拉与「最近登录时间」只读框并排各占一列，
 *    末行 .page-time 横排「创建时间：… 最近更新时间：…」带顶边线；
 *  - 新建态「初始角色」为两列 check-card 卡片复选（RoleCheckCards，与设置角色窗共用），未选错误内联在区块下；
 *    打开时默认勾中「普通用户」（md §三.2）；
 *  - 确认键：新建态「新建」/ 编辑态「保存」（md §三.1）；toast「用户已新建」/「用户信息已保存」（md §三.6）；
 *  - 占位 / 校验文案照 md §三.2–3：「3–32 个字符」「用于展示的姓名」「name@example.com」「请输入 3–32 个字符」「请输入有效邮箱」；
 *  - 2026-09-12 对齐 md §三.2 L149（审计 K14）：新建态「初始角色」区补提示文字「选择一个或多个角色」。
 *
 * 写接口 skipGlobalError：护栏错误（用户名重复等）按 message 就地 toast。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { createUser, updateUser } from '@/api/adminUser'
import { fmtTime } from '@/utils/docMeta'
import RoleCheckCards from '@/components/admin/RoleCheckCards.vue'
import '@/assets/admin-dialog.css'

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
// 角色区就地错误（提交时才亮，勾选后即消；原型 [data-user-field="roles"].invalid → .error-text）
const roleError = ref('')

const roleOptionList = computed(() =>
  (props.roleOptions || []).map((it) => ({
    code: typeof it === 'string' ? it : it?.code,
    name: typeof it === 'string' ? it : it?.name || it?.code
  }))
)

// 新建态默认角色：md §三.2「打开窗口时默认选中『普通用户』」（原型 L250 roles:['普通用户']）；选项里没有该角色则不预选
const DEFAULT_ROLE_NAME = '普通用户'
function defaultRoleCodes() {
  const hit = roleOptionList.value.find((r) => r.name === DEFAULT_ROLE_NAME || r.code === DEFAULT_ROLE_NAME)
  return hit ? [hit.code] : []
}

function reset() {
  form.username = props.user?.username || ''
  form.displayName = props.user?.displayName || ''
  form.email = props.user?.email || ''
  form.roleCodes = isEdit.value ? (props.user?.roleCodes || []).slice() : defaultRoleCodes()
  form.status = props.user?.status || 'active'
  roleError.value = ''
  formRef.value?.clearValidate?.()
}

watch(
  () => props.visible,
  (v) => {
    if (v) reset()
  }
)
watch(
  () => form.roleCodes,
  (v) => {
    if (v.length) roleError.value = ''
  }
)

const rules = computed(() => {
  const r = {
    displayName: [{ required: true, message: '请输入显示名', trigger: 'blur' }],
    email: [{ type: 'email', message: '请输入有效邮箱', trigger: 'blur' }]
  }
  if (!isEdit.value) {
    // transform 先 trim 再校验，与 adminUserMock.createUser 的 trim 后判长同口径（2026-09-20 待办 yuepu#8）
    const trim = (v) => String(v ?? '').trim()
    r.username = [
      { required: true, transform: trim, message: '请输入 3–32 个字符', trigger: 'blur' },
      { min: 3, max: 32, transform: trim, message: '请输入 3–32 个字符', trigger: 'blur' }
    ]
  }
  return r
})

const lastLoginText = computed(() => (props.user?.lastLogin ? fmtTime(props.user.lastLogin) : '从未登录'))
const createdText = computed(() => (props.user?.createdAt ? fmtTime(props.user.createdAt) : '—'))
const updatedText = computed(() => (props.user?.updatedAt ? fmtTime(props.user.updatedAt) : '—'))

async function onSubmit() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    // 角色必选校验独立于 el-form（卡片复选非表单项）：与表单校验并行亮起，任一不过即不提交
    if (!isEdit.value && !form.roleCodes.length) roleError.value = '请至少选择一个角色'
    if (!valid || roleError.value) return
    saving.value = true
    try {
      if (!isEdit.value) {
        await createUser({
          username: String(form.username ?? '').trim(),
          displayName: form.displayName,
          email: form.email,
          roleCodes: form.roleCodes
        })
        ElMessage.success('用户已新建')
      } else {
        // 编辑仅 displayName/email/status（启停）；username 与角色不在此改
        await updateUser(props.user.id, {
          displayName: form.displayName,
          email: form.email,
          status: form.status
        })
        ElMessage.success('用户信息已保存')
      }
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
  <el-dialog v-model="dialogVisible" :title="title" width="520px" class="admin-dialog ue-dialog" append-to-body>
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="ue-grid">
      <el-form-item label="用户名" prop="username" class="ue-full">
        <!-- username 创建后只读 -->
        <el-input v-model="form.username" placeholder="3–32 个字符" :disabled="isEdit" />
      </el-form-item>
      <el-form-item label="显示名" prop="displayName" class="ue-full">
        <el-input v-model="form.displayName" placeholder="用于展示的姓名" />
      </el-form-item>
      <el-form-item label="邮箱（选填）" prop="email" class="ue-full">
        <el-input v-model="form.email" placeholder="name@example.com" clearable />
      </el-form-item>

      <!-- 新建：初始角色卡片复选 + 初始密码提示 -->
      <template v-if="!isEdit">
        <el-form-item label="初始角色" required class="ue-full ue-roles" :class="{ 'is-error': roleError }">
          <!-- 2026-09-12 对齐 md 用户 §三.2 L149（审计 K14；Q439 裁按 md）：初始角色提示文字「选择一个或多个角色」，只在新建态出现 -->
          <div class="ue-role-hint">选择一个或多个角色</div>
          <RoleCheckCards v-model="form.roleCodes" :options="roleOptionList" :error="roleError" />
          <div class="ue-tip">初始密码为 wemate123，用户首次登录后可修改。</div>
        </el-form-item>
      </template>

      <!-- 编辑：状态下拉（左）+ 最近登录时间只读框（右）并排；末行 page-time 横排创建 / 最近更新时间 -->
      <template v-else>
        <el-form-item label="状态" class="ue-half">
          <el-select v-model="form.status" class="ue-status-select">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="最近登录时间" class="ue-half">
          <div class="ue-readonly">{{ lastLoginText }}</div>
        </el-form-item>
        <div class="ue-full page-time ue-page-time">
          <span>创建时间：{{ createdText }}</span>
          <span>最近更新时间：{{ updatedText }}</span>
        </div>
      </template>
    </el-form>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">{{ isEdit ? '保存' : '新建' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 两列网格（原型 .dialog-grid{1fr 1fr;gap 17px 18px}）：el-form-item 自带下边距归零由 gap 承担 */
.ue-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 17px 18px;
}
.ue-grid :deep(.el-form-item) {
  margin-bottom: 0;
}
.ue-full {
  grid-column: 1 / -1;
}
.ue-half {
  min-width: 0;
}
.ue-status-select {
  width: 100%;
}
/* 只读值框（原型 .readonly-value：min-height 38、padding 9 12、圆角 8、灰底） */
.ue-readonly {
  width: 100%;
  min-height: 38px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  line-height: 1.4;
}
.ue-tip {
  width: 100%;
  margin-top: 5px;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--c-text-faint);
}
/* 初始角色提示（md §三.2 L149，K14）：与占位文字同档弱色，置于卡片区上方 */
.ue-role-hint {
  width: 100%;
  margin-bottom: 6px;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--c-text-faint);
}
/* 末行时间（原型 .page-time：顶边线、12px 灰字、横排 gap 8 20；admin-shell 的 .page-time 已给基础样式，此处只补网格跨列） */
.ue-page-time {
  margin-top: 0;
}
@media (max-width: 620px) {
  .ue-grid {
    grid-template-columns: 1fr;
  }
  .ue-full {
    grid-column: auto;
  }
}
</style>
