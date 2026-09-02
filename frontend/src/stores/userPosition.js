import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listPositions, bindPosition as bindPositionApi } from '@/api/userPosition'
import { getRebindPreview, rebindPosition, getUnbindPreview, unbindPosition } from '@/api/rebind'
import router from '@/router'
import { useUserStore } from './user'
import { useChatStore } from './chat'

// 岗位：可选岗位列表 + 当前绑定岗位
export const useUserPositionStore = defineStore('userPosition', () => {
  const positions = ref([])
  const currentPosition = ref(null)
  const loading = ref(false)

  async function fetchPositions() {
    loading.value = true
    try {
      positions.value = (await listPositions()) || []
    } finally {
      loading.value = false
    }
  }

  async function bind(positionId) {
    await bindPositionApi(positionId)
    currentPosition.value = positions.value.find((e) => e.id === positionId) || null
    // 同步用户登录态中的绑定标记
    useUserStore().markBoundPosition(positionId)
  }

  // 领用（带采集值）成功后的本地态收口：与 bind 同口径同步当前岗位 + 登录态绑定标记。
  // claim 接口本身在调用方（领用弹窗）完成；此处仅做成功后的本地状态切换，保证零回归。
  function markClaimed(positionId) {
    currentPosition.value = positions.value.find((e) => e.id === positionId) || currentPosition.value
    useUserStore().markBoundPosition(positionId)
  }

  function setCurrentPosition(position) {
    currentPosition.value = position
  }

  // 从岗位列表里按 id 取一份岗位对象（列表为空时返回 null，由调用方兜底）
  function findPosition(id) {
    return positions.value.find((e) => e.id === id) || null
  }

  // 拉换绑影响预览（强确认弹窗用）。仅用于「已有当前岗位 → 更换」场景。
  function previewRebind(targetPositionId) {
    return getRebindPreview(targetPositionId)
  }

  // 拉解绑影响预览（解绑强确认弹窗用）。无入参，后端按 JWT 取当前岗位。
  function previewUnbind() {
    return getUnbindPreview()
  }

  /**
   * 执行解绑当前岗位。成功后清本地岗位/会话态 + 清登录态绑定标记 + 强制回选岗位页：
   *  1) unbind 接口（清当前岗位个性化覆盖层 + 解绑到 0 active；保留会话/记忆/定时任务，不可恢复）
   *  2) userStore.markBoundPosition(null)：登录态 boundPositionId 置空，使 guard「未绑定」判定生效
   *  3) positionStore.currentPosition=null：清主绑定岗位
   *  4) chatStore.reset()：清会话上下文（activePosition + 旧会话），防解绑后仍沿用旧岗位
   *  5) router.replace({name:'BindPosition'})：强制回选岗位页（0 绑定后 guard 也会锁住所有路由）
   *
   * 幂等：后端 changed=false（本就无绑定）也按「已解绑」处理——同样清态 + 跳 BindPosition，不报错。
   * 失败（含网络/超时）直接抛出，由调用方按 unbindErrorMessage 友好提示；失败不改任何本地状态。
   *
   * @returns {Promise<Object>} unbind 接口返回 data（含 changed / unboundPositionId 等）
   */
  async function unbind() {
    const result = await unbindPosition()

    // 无论 changed=true（成功解绑）还是 false（本就无绑定），都收口到「无绑定」态
    useUserStore().markBoundPosition(null)
    currentPosition.value = null
    useChatStore().reset()

    // 强制回选岗位页（防脏状态：0 绑定时 guard 也会把其他路由跳 BindPosition，此处主动跳）
    if (router.currentRoute.value?.name !== 'BindPosition') {
      router.replace({ name: 'BindPosition' })
    }

    return result
  }

  /**
   * 执行换绑（rebind），成功后串联刷新三个 store，保证不沿用旧岗位脏态：
   *  1) rebind 接口（单事务：软删旧绑定+旧覆盖层 + 新建空覆盖层绑定）
   *  2) userStore.markBoundPosition(newId)：登录态 boundPositionId 指向新岗位
   *  3) positionStore.setCurrentPosition(新岗位)：主绑定岗位切到新岗位
   *  4) chatStore：reset 清掉指向旧岗位的 activePosition + 旧会话，再把 activePosition
   *     置为新岗位，避免换绑后仍沿用旧岗位发消息（PRD §3.5 换绑成功后状态处置）
   *
   * 失败（含网络/超时）直接抛出，由调用方按 rebindErrorMessage 友好提示并回滚视图
   * （后端单事务，失败即整体不生效，旧岗位与个性化完好，前端保持旧视图即可）。
   *
   * @param {number} newPositionId 目标岗位 id
   * @param {Object} [targetPosition] preview 的目标岗位（后端 rebind-preview 响应里的 targetExpert，
   *        形如 { positionId, name, jobTag }，无 avatar）。列表里找不到新岗位时（用户没拉过列表 /
   *        从设置页换绑列表未含该岗位）用它兜底真实 name/jobTag，避免退化为占位名导致 Chat 头部显示占位。
   * @returns {Promise<Object>} rebind 接口返回 data（含 changed / oldPositionId / newPositionId）
   */
  async function rebind(newPositionId, targetPosition = null) {
    const result = await rebindPosition(newPositionId)
    // 幂等空操作（选回当前岗位）：后端 changed=false，不做任何本地刷新
    if (result && result.changed === false) {
      return result
    }

    const newId = result?.newPositionId ?? newPositionId

    // 取新岗位展示信息：优先列表 → preview 的 targetPosition（含真实 name/jobTag，无 avatar）
    //  → 最后才退化为占位（确实拿不到任何展示信息时）。
    let next = findPosition(newId)
    if (!next) {
      if (targetPosition && (targetPosition.name != null)) {
        next = {
          id: newId,
          name: targetPosition.name,
          jobTag: targetPosition.jobTag || '',
          avatar: targetPosition.avatar ?? null
        }
      } else {
        next = { id: newId, name: '我的搭子', jobTag: '', avatar: null }
      }
    }

    // 2) 登录态绑定标记
    useUserStore().markBoundPosition(newId)
    // 3) 主绑定岗位
    currentPosition.value = next
    // 4) 会话上下文：清旧 + 指向新岗位
    const chatStore = useChatStore()
    chatStore.reset()
    chatStore.setActivePosition({
      positionId: next.id,
      name: next.name,
      avatar: next.avatar,
      jobTag: next.jobTag
    })

    return result
  }

  // 登出时重置：清空列表、当前岗位与加载态
  function reset() {
    positions.value = []
    currentPosition.value = null
    loading.value = false
  }

  return {
    positions,
    currentPosition,
    loading,
    fetchPositions,
    bind,
    markClaimed,
    setCurrentPosition,
    findPosition,
    previewRebind,
    rebind,
    previewUnbind,
    unbind,
    reset
  }
})
