import request from './request'
import { useUserStore } from '@/stores/user'
import * as mock from './feedbackMock'

/**
 * 用户反馈数据层（V80，仅 ADMIN；2026-09-01 PRD 对齐改造：对齐交互原型 v2 renderFeedback）。
 *
 * 【demo mock】项目已降级为纯前端 demo（2026-09-01），默认走内存 mock
 * （`VITE_GOV_MOCK=0` 可关闭走真实接口路径，仅供未来接回后端时切换；开关与
 *  审核中心 / 我的申请共用）。mock 下附图为内置生成的 SVG 占位图 blob，
 * 与真实后端「鉴权 fetch 取 blob」链路同形（页面零分支）。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'

// 列表：返回 { list, total }；params: { page, size, terminal, keyword, sortDir }
export function listFeedbacks(params = {}) {
  if (USE_MOCK) return mock.listFeedbacks(params)
  return request.get('/fde/feedbacks', { params })
}

/**
 * 鉴权附图取 blob。附图端点走 /api/fde/**（authenticated + 角色门），<img src> 直连不带
 * Authorization 会 401，故 fetch 带 JWT 取 blob（chat.js downloadArtifact 同款范式）；
 * 不走统一 axios 实例：避免响应拦截器按 JSON 解包破坏二进制，也避免 baseURL 双前缀。
 *
 * @param {string} url 后端返回的相对地址（形如 /api/fde/feedbacks/fb_x/images/1?variant=thumb）；
 *                     mock 下为 mock-fb:// 协议地址，由 feedbackMock 生成占位图。
 * @returns {Promise<Blob>}
 */
export async function fetchFeedbackImageBlob(url) {
  if (USE_MOCK) return mock.fetchFeedbackImageBlob(url)
  const userStore = useUserStore()
  const headers = {}
  if (userStore.token) headers.Authorization = `Bearer ${userStore.token}`
  const resp = await fetch(url, { method: 'GET', headers })
  if (resp.status === 401) {
    userStore.logout()
    throw new Error('登录已失效，请重新登录')
  }
  if (!resp.ok) {
    throw new Error('图片加载失败')
  }
  return await resp.blob()
}
