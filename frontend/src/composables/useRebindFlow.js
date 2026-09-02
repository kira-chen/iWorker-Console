import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserPositionStore } from '@/stores/userPosition'
import { useUserStore } from '@/stores/user'
import { rebindErrorMessage } from '@/api/rebind'
import { isCurrentBoundPosition } from '@/utils/positionBinding'

/**
 * 更换专家强确认流程（三入口共用一套：个性化页 / 设置页 / 专家列表）。
 *
 * 用法：
 *   const flow = useRebindFlow({ onSuccess })
 *   flow.start(targetPositionId)   // 发起：拉 preview → 弹强确认
 *   // 模板绑定：v-model:visible / :preview / :loading / :error / :submitting
 *   //          @confirm="flow.confirm" @retry="flow.retry"
 *
 * 边界（PRD-06）：
 *  - 首绑 vs 换绑：本流程仅用于「已有当前绑定专家」的换绑；调用方需保证有 boundPositionId
 *    （无绑定时走 BindPosition 的 bind，不进本流程）。start() 内再兜一层防御。
 *  - 选回当前专家：本地先拦（targetId === boundPositionId），提示「已是当前专家」，不调接口。
 *  - 强确认：由 RebindConfirmDialog 的勾选门槛保证；本流程只负责数据与提交。
 *  - 错误：自处理（skipGlobalError），按 rebindErrorMessage 友好中文提示；
 *    失败不改任何本地状态（后端单事务，旧专家与个性化完好）。
 *  - 重复提交：submitting 期间 confirm() 直接 return；弹窗按钮也禁用。
 */
export function useRebindFlow(options = {}) {
  const { onSuccess } = options
  const positionStore = useUserPositionStore()
  const userStore = useUserStore()

  const visible = ref(false)
  const preview = ref(null)
  const loading = ref(false)
  const error = ref(false)
  const submitting = ref(false)
  const targetId = ref(null)

  // 本地判定：目标是否即当前绑定岗位（选回当前 → 不触发换绑）
  function isCurrentBound(id) {
    return isCurrentBoundPosition(id, userStore.userInfo?.boundPositionId)
  }

  async function fetchPreview() {
    loading.value = true
    error.value = false
    preview.value = null
    try {
      preview.value = await positionStore.previewRebind(targetId.value)
    } catch (e) {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  // 发起更换：先本地拦「选回当前」与「无当前绑定」，再开弹窗拉 preview
  async function start(id) {
    if (id == null) return
    // 无当前绑定专家：不应进入换绑流程（应走首绑），兜底提示
    if (!userStore.userInfo?.boundPositionId) {
      ElMessage.warning('请先在绑定页选择你的搭子')
      return
    }
    // 选回当前专家：识别为无变化，不触发强确认、不清任何个性化
    if (isCurrentBound(id)) {
      ElMessage.info('这已是你当前的搭子')
      return
    }
    // 岗位（专家）id 已字符串化（ps_*），不可 Number()（字符串 id → NaN，previewRebind/rebind 收到 NaN/null 换绑坏）。
    // 原样字符串透传（与 positionBinding.js / PositionPickerDialog.vue / FrontLayout.vue / Personalize.vue 同款约定）。
    targetId.value = id
    visible.value = true
    submitting.value = false
    await fetchPreview()
  }

  // error 态重试：重新拉 preview
  function retry() {
    if (targetId.value != null) fetchPreview()
  }

  // 用户在弹窗勾选后点「确认更换」
  async function confirm() {
    if (submitting.value || targetId.value == null) return
    submitting.value = true
    try {
      // 把 preview 的目标岗位（响应 JSON key 仍为 targetExpert）透传给 store 兜底：
      // 列表缺新岗位时用真实 name/jobTag 展示，而非退化为占位名（CR 严重 1）。
      const result = await positionStore.rebind(targetId.value, preview.value?.targetExpert)
      visible.value = false
      const newName = preview.value?.targetExpert?.name || '新搭子'
      ElMessage.success(`已更换为${newName}`)
      onSuccess?.(result)
    } catch (e) {
      // 自处理错误：友好中文，不暴露技术细节；失败不改本地状态（旧专家完好）
      const msg = rebindErrorMessage(e)
      if (msg) ElMessage.error(msg)
      // 404（专家已不可用）：关闭流程让用户重新选择
      if (e?.code === 404) visible.value = false
    } finally {
      submitting.value = false
    }
  }

  return {
    visible,
    preview,
    loading,
    error,
    submitting,
    isCurrentBound,
    start,
    retry,
    confirm
  }
}
