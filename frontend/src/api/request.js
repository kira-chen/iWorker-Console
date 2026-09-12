import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

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

// 2026-09-12 负责人决策 3（审计 J2）：登录页与「未绑定专家」引导页（BindPosition）随员工端
// 整体退役，故原先两条会话级收口分支一并删除——
//  - code/HTTP 401「登录失效 → 清登录态 + 跳 Login」：demo 无登录、身份由 utils/demoIdentity
//    每次导航前兜底注入，跳转目标已不存在；401 现按普通业务错误走下方通用分支（toast / ApiError）。
//  - code 1001「未绑定专家 → 跳 BindPosition」：同理，配套的 utils/positionNotBound.js 已删。
// 注（R-EC1）：1001 曾是「未绑定专家」唯一语义，岗位内唯一性冲突已让位到 1005，
// 走 skipGlobalError 分支带 field 抛 ApiError 供红框回显，不受本次改动影响。

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
    // 2026-09-12 负责人决策 3（审计 J2）：原「HTTP 401 → 登出跳 Login」兜底分支随登录退役删除，
    // HTTP 401 现与其它 HTTP 错误同路（skip 转 ApiError 用 status 兜底 code，否则弹 toast）。
    if (skip) {
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
