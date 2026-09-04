<script setup>
/**
 * 修改用户绑定岗位弹窗（岗位分配页，提案 20260721-2）。
 *
 * 单岗独占：选一个已发布岗位 → 首绑/换绑；选「未绑定（清除）」→ 解绑。保存即时生效（PUT /fde/position-assignments/{userId}）。
 * 写接口 skipGlobalError → 失败按 message 就地 toast。弹窗 Esc 已全局禁用（disableDialogEsc）。
 */
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { setUserPosition } from '@/api/positionAssignment'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 目标行：{ userId, username, displayName, positionId, positionName }
  row: { type: Object, default: null },
  // 已发布岗位选项：[{ positionId, name }]
  positionOptions: { type: Array, default: () => [] },
  /**
   * 选项未变化时也照常保存并上抛 saved（默认 false=未变化直接关窗不打扰）。
   * 岗位申请审批「重新绑定」场景传 true（2026-09-04 PRD-20260903 §4.3.3）：
   * 点【保存】即视为处理完成，须触发 saved 才能把申请标记「已重新绑定」。
   */
  forceSave: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

const saving = ref(false)
// '' 代表未绑定（清除）
const selected = ref('')

watch(
  () => props.visible,
  (v) => {
    if (v) selected.value = props.row?.positionId || ''
  },
  { immediate: true } // 覆盖「初始即 visible=true」场景（生产上弹窗挂载时 visible=false，首触走 else 无副作用）
)

const userLabel = computed(
  () => props.row?.displayName || props.row?.username || ''
)

const changed = computed(() => (selected.value || '') !== (props.row?.positionId || ''))

async function onSubmit() {
  if (!props.row?.userId) return
  if (!changed.value && !props.forceSave) {
    dialogVisible.value = false
    return
  }
  saving.value = true
  try {
    await setUserPosition(props.row.userId, selected.value || null)
    // 保存成功提示统一（2026-09-01 PRD 对齐，原型 notify 文案，首绑/换绑/解绑同一句）
    ElMessage.success('岗位绑定已更新')
    dialogVisible.value = false
    emit('saved')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="dialogVisible" title="修改绑定岗位" width="440px" append-to-body>
    <!-- 顶部提示与下拉首项文案照原型 openAssignment（2026-09-01 PRD 对齐） -->
    <div class="upe-target">为 <b>{{ userLabel }}</b> 选择绑定岗位，保存后即时生效。</div>
    <el-select v-model="selected" placeholder="选择岗位" class="upe-select">
      <el-option :value="''" label="未绑定" />
      <el-option
        v-for="p in positionOptions"
        :key="p.positionId"
        :value="p.positionId"
        :label="p.name"
      />
    </el-select>
    <div class="upe-hint">
      换绑会清除该用户在原岗位上的个性化（岗位人格 / 搭子名称）；会话、记忆、定时任务保留不变。
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.upe-target {
  margin-bottom: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.upe-target b {
  color: var(--c-text-strong);
}
.upe-select {
  width: 100%;
}
.upe-hint {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: var(--lh-normal);
}
</style>
