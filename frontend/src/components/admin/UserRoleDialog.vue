<script setup>
/**
 * 设置用户角色弹窗（ADMIN 专属，P5）：多选角色（全量替换）→ PUT /fde/users/{id}/roles。
 *
 * 护栏错误（如删最后一个 ADMIN）由后端返回并按 message 就地 toast（写接口 skipGlobalError）。
 */
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { setUserRoles } from '@/api/adminUser'

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

watch(
  () => props.visible,
  (v) => {
    if (v) selected.value = (props.user?.roleCodes || []).slice()
  }
)

const roleOptionList = computed(() =>
  (props.roleOptions || []).map((it) => ({
    code: typeof it === 'string' ? it : it?.code,
    name: typeof it === 'string' ? it : it?.name || it?.code
  }))
)

const userLabel = computed(
  () => props.user?.displayName || props.user?.username || ''
)

async function onSubmit() {
  if (!props.user?.id) return
  if (!selected.value.length) {
    ElMessage.warning('请至少选择一个角色')
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
  <el-dialog v-model="dialogVisible" title="设置角色" width="440px" append-to-body>
    <div class="urd-target">为「{{ userLabel }}」分配角色（全量替换当前角色）</div>
    <el-checkbox-group v-model="selected" class="urd-roles">
      <el-checkbox
        v-for="r in roleOptionList"
        :key="r.code"
        :value="r.code"
        :label="r.code"
        class="urd-role-item"
      >
        {{ r.name }}
      </el-checkbox>
    </el-checkbox-group>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.urd-target {
  margin-bottom: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.urd-roles {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}
.urd-role-item {
  margin-right: 0;
  height: auto;
}
</style>
