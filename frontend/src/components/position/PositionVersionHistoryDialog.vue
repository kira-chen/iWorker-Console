<script setup>
/**
 * 岗位「版本历史 + 下线/恢复」对话框（管理侧 SYS_CONFIG/FDE，契约 §1.7 / 设计 §6.6 C/D）。
 *
 * 消费管理端点：
 *   GET  /fde/positions/{positionId}/publications            版本历史（ACTIVE/DELISTED 均列，version DESC）
 *   POST .../publications/{version}/delist                   下线（对象不删，已下载不受影响）
 *   POST .../publications/{version}/relist                   恢复
 *
 * 岗位单版本序（无 target）。每行展示 pin 技能数（血缘审计）。下线/恢复二次确认。
 * 只读列表复用 VersionHistoryList；loading/错误/空态齐全；令牌与双主题一致。
 */
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listPositionPublications,
  delistPositionPublication,
  relistPositionPublication
} from '@/api/position'
import VersionHistoryList from '@/components/admin/VersionHistoryList.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  positionId: { type: [String, Number], default: null },
  positionName: { type: String, default: '岗位' }
})
const emit = defineEmits(['update:modelValue'])

const rows = ref([])
const loading = ref(false)
const error = ref('')
const busyVersion = ref(null)

async function fetchList() {
  if (props.positionId == null) return
  loading.value = true
  error.value = ''
  try {
    const data = await listPositionPublications(props.positionId)
    rows.value = (Array.isArray(data) ? data : []).map((p) => ({
      ...p,
      // N5 展示版本号（vXXX）优先；存量历史无 version_label 时回落内部自增 v{version}。
      verLabel: p.versionLabel || `v${p.version}`,
      // N5 升级说明（存量历史可空 → 不渲染）。
      releaseNotes: p.releaseNotes || '',
      // 血缘审计：pin 的技能数（每行副标）
      extra: p.pinnedSkillsCount != null ? `pin ${p.pinnedSkillsCount} 技能` : ''
    }))
  } catch (e) {
    error.value = e?.message || '加载版本历史失败'
    rows.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) fetchList()
    else {
      rows.value = []
      error.value = ''
      busyVersion.value = null
    }
  }
)

async function onDelist(row) {
  if (busyVersion.value != null) return
  try {
    await ElMessageBox.confirm(
      `下线「${props.positionName}」v${row.version}？下线后客户端将无法再下载此版本，已下载不受影响。`,
      '下线版本',
      { type: 'warning', confirmButtonText: '确认下线', confirmButtonClass: 'el-button--warning' }
    )
  } catch {
    return
  }
  busyVersion.value = row.version
  try {
    const vo = await delistPositionPublication(props.positionId, row.version)
    applyUpdated(row.version, vo, 'DELISTED')
    ElMessage.success('已下线')
  } catch (e) {
    ElMessage.error(e?.message || '下线失败')
    fetchList()
  } finally {
    busyVersion.value = null
  }
}

async function onRelist(row) {
  if (busyVersion.value != null) return
  try {
    await ElMessageBox.confirm(
      `恢复「${props.positionName}」v${row.version}？恢复后客户端可再次下载此版本。`,
      '恢复版本',
      { type: 'warning', confirmButtonText: '确认恢复' }
    )
  } catch {
    return
  }
  busyVersion.value = row.version
  try {
    const vo = await relistPositionPublication(props.positionId, row.version)
    applyUpdated(row.version, vo, 'ACTIVE')
    ElMessage.success('已恢复')
  } catch (e) {
    ElMessage.error(e?.message || '恢复失败')
    fetchList()
  } finally {
    busyVersion.value = null
  }
}

function applyUpdated(version, vo, fallbackStatus) {
  rows.value = rows.value.map((r) =>
    r.version === version
      ? {
          ...r,
          ...(vo && typeof vo === 'object' ? vo : {}),
          status: vo?.status || fallbackStatus,
          extra: r.extra
        }
      : r
  )
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="版本历史"
    width="560px"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="pvh">
      <div class="pvh-head">
        <span class="pvh-name">{{ positionName }}</span>
      </div>
      <p class="pvh-hint">每次发布生成一版整包快照（pin 住当时各技能版本，供血缘追溯）；下线仅使客户端无法再下载，已下载不受影响。</p>
      <VersionHistoryList
        :rows="rows"
        :loading="loading"
        :error="error"
        :busy-version="busyVersion"
        @delist="onDelist"
        @relist="onRelist"
        @retry="fetchList"
      />
    </div>
    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pvh {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.pvh-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  font-size: var(--fs-base);
}
.pvh-hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
}
</style>
