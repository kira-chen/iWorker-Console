import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useUserStore } from '@/stores/user'
import { handlePositionNotBound } from '@/utils/positionNotBound'

// 统一 axios 实例：baseURL 走 /api，由 Vite dev proxy 转发到后端
const service = axios.create({
  baseURL: '/api',
  timeout: 60000
})

// 请求拦截器：注入 JWT
service.interceptors.request.use(
  (config) => {
    const userStore = useUserStore()
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器：统一解包后端 ResultVO + 统一错误处理
// 约定后端响应体：{ code: number, message: string, data: any }，code === 0 为成功
// 业务错误对象：admin API 层据此做字段级红框回显（携带 code/message/field）。
export class ApiError extends Error {
  constructor({ code, message, field, data }) {
    super(message || 'Error')
    this.code = code
    this.field = field || null // 出错字段 key（契约 §0.3.1），供编辑器红框定位
    this.data = data || null // 完整 data，含 toolCode 等附加定位信息
  }
}

// 登录失效统一处理：清登录态 + 跳登录页（401 即便 admin 写接口 skip 也统一收口）
// 注：后端鉴权失败返回 HTTP200 + ResultVO.code=401（见 Sprint2 契约 §0.3），故此处按 code 分流，
// 不能只依赖 HTTP status；HTTP 层 401 的分支保留作兜底。
function handleUnauthorized() {
  const userStore = useUserStore()
  userStore.logout()
  ElMessage.error('登录已失效，请重新登录')
  router.replace({ name: 'Login' })
}

// 未绑定专家统一处理（后端 code=1001 EXPERT_NOT_BOUND）已抽到 @/utils/positionNotBound，
// 供 axios 拦截器与 SSE（api/chat.js）两处共用同口径处理（清无绑定态 + 跳 BindPosition，幂等防循环）。

service.interceptors.response.use(
  (response) => {
    const res = response.data
    const skip = response.config?.skipGlobalError
    // 非标准结构（如二进制流）直接返回
    if (res === null || typeof res !== 'object' || !('code' in res)) {
      return res
    }
    if (res.code === 0) {
      return res.data
    }
    // 后端鉴权失败为 HTTP200 + code=401（契约 §0.3）：按 code 分流统一登出，避免静默失败
    if (res.code === 401) {
      handleUnauthorized()
      return Promise.reject(
        new ApiError({ code: 401, message: res.message, field: null, data: res.data })
      )
    }
    // 未绑定专家（HTTP200 + code=1001 EXPERT_NOT_BOUND）：清无绑定态 + 导到强制选专家页，
    // 不走默认红错 toast（handlePositionNotBound 内已克制提示一句），按 code 收口统一处理。
    // 注（R-EC1）：1001 现为「未绑定专家」唯一语义。岗位内唯一性冲突已让位到 1005，
    // 不再走此跳转分支——会落到下方 skipGlobalError 分支带 field 抛 ApiError 供红框回显。
    if (res.code === 1001) {
      handlePositionNotBound()
      return Promise.reject(
        new ApiError({ code: 1001, message: res.message, field: null, data: res.data })
      )
    }
    // skipGlobalError：admin 写接口自处理——不弹全局 toast，抛 ApiError 带 field 供红框回显
    if (skip) {
      return Promise.reject(
        new ApiError({
          code: res.code,
          message: res.message,
          field: res.data?.field,
          data: res.data
        })
      )
    }
    ElMessage.error(res.message || '请求失败')
    return Promise.reject(new Error(res.message || 'Error'))
  },
  (error) => {
    // 主动取消（AbortController）的请求：不弹 toast，原样抛出供调用方按 isCancel 忽略
    if (axios.isCancel(error)) {
      return Promise.reject(error)
    }
    const status = error.response?.status
    const skip = error.config?.skipGlobalError
    if (status === 401) {
      // 兜底：HTTP 层 401（理论上后端走 HTTP200+code，但网关/代理可能产出真 401）
      handleUnauthorized()
    } else if (skip) {
      // admin 写接口：把 HTTP 层错误也转成 ApiError，交由调用方处理，不弹全局 toast
      const body = error.response?.data
      return Promise.reject(
        new ApiError({
          code: body?.code ?? status ?? -1,
          message: body?.message || error.message || '网络异常，请稍后重试',
          field: body?.data?.field,
          data: body?.data
        })
      )
    } else {
      const msg =
        error.response?.data?.message || error.message || '网络异常，请稍后重试'
      ElMessage.error(msg)
    }
    return Promise.reject(error)
  }
)

export default service
