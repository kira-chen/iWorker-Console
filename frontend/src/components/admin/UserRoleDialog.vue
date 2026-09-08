<script setup>
/**
 * 设置用户角色弹窗（ADMIN 专属，P5）：多选角色（全量替换）→ PUT /fde/users/{id}/roles。
 *
 * 2026-09-08 原型复刻批次 2A（G#8，原型 openRoleDialog L252）：居中窗 520px（admin-dialog 壳）；
 * 首段「为 <strong>显示名</strong>（用户名）设置角色。保存后将全量替换当前角色。」（md §二.2.3 同口径，显示名空时用用户名）；
 * 角色为两列 check-card 卡片复选（RoleCheckCards，与新建用户窗共用）；未选时**内联**「请至少选择一个角色」并保持窗口开启。
 *
 * 护栏错误（如删最后一个 ADMIN）由后端返回并按 message 就地 toast（写接口 skipGlobalError）。
 */
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { setUserRoles } from '@/api/adminUser'
import RoleCheckCards from '@/components/admin/RoleCheckCards.vue'
import '@/assets/admin-dialog.css'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 目标用户：{ id, displayName, username, roleCodes:[] }
  user: { type: Object, default: null },
  // 角色选项：[{ code, name }]
  roleOptions: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:visible', 'saved'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

const saving = ref(false)
const selected = ref([])
const roleError = ref('')

watch(
  () => props.visible,
  (v) => {
    if (v) {
      selected.value = (props.user?.roleCodes || []).slice()
      roleError.value = ''
    }
  }
)
watch(selected, (v) => {
  if (v.length) roleError.value = ''
})

const roleOptionList = computed(() =>
  (props.roleOptions || []).map((it) => ({
    code: typeof it === 'string' ? it : it?.code,
    name: typeof it === 'string' ? it : it?.name || it?.code
  }))
)

// 显示名为空时展示用户名（md §二.2.3）
const userLabel = computed(() => props.user?.displayName || props.user?.username || '')
const userName = computed(() => props.user?.username || '')

async function onSubmit() {
  if (!props.user?.id) return
  if (!selected.value.length) {
    roleError.value = '请至少选择一个角色'
    return
  }
  saving.value = true
  try {
    await setUserRoles(props.user.id, selected.value)
    ElMessage.success('角色已更新')
    dialogVisible.value = false
    emit('saved')
  } catch (e) {
    // 护栏错误（如移除最后一个 ADMIN）按后端 message 提示
    ElMessage.error(e?.message || '设置角色失败，请重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="dialogVisible" title="设置角色" width="520px" class="admin-dialog" append-to-body>
    <p class="urd-target">
      为 <strong>{{ userLabel }}</strong><template v-if="userName">（{{ userName }}）</template>设置角色。保存后将全量替换当前角色。
    </p>
    <RoleCheckCards v-model="selected" :options="roleOptionList" :error="roleError" />

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.urd-target {
  margin: 0 0 14px;
  font-size: var(--fs-base);
  line-height: 1.65;
  color: var(--c-text-muted);
}
.urd-target strong {
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
}
</style>
