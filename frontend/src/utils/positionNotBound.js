import { ElMessage } from 'element-plus'
import router from '@/router'
import { useUserStore } from '@/stores/user'

/**
 * 未绑定专家统一收口（后端 code=1001 EXPERT_NOT_BOUND）。
 *
 * 首次登录未绑定专家、或在使用中被解绑/绑定失效的用户调对话/业务接口时，
 * 后端兜底拦截返回 1001。前端据此把用户导到强制选专家页（与 router guard 同口径，
 * belt-and-suspenders 防边缘竞态/直连）。
 *
 * 两处共用（避免逻辑重复、口径分叉）：
 *  - axios 响应拦截器（api/request.js）：普通 REST 接口返 1001
 *  - SSE 错误事件（api/chat.js）：对话流式接口走 fetch 不经 axios 拦截器，error 事件携带 code=1001
 *
 * 行为：
 *  - 置空本地 boundPositionId → 使 userStore.hasBoundPosition 为 false，guard 强制留绑定页
 *  - 跳转 BindPosition 页
 * 幂等防循环：当前已在 BindPosition 页则不重复 replace、不重复弹提示，避免循环跳转与提示轰炸。
 */
export function handlePositionNotBound() {
  const userStore = useUserStore()
  // 标记无绑定态：置空 boundPositionId，使 hasBoundPosition 计算属性为 false，guard 强制留绑定页
  if (userStore.userInfo?.boundPositionId) {
    userStore.setUserInfo({ ...userStore.userInfo, boundPositionId: null })
  }
  if (router.currentRoute.value?.name === 'BindPosition') return
  ElMessage.warning('请先选择并绑定搭子后再使用')
  router.replace({ name: 'BindPosition' })
}
