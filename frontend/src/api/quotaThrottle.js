import request from './request'
import * as mock from './quotaThrottleMock'

/**
 * 配额与限流 API 层（04运行 › 配额与限流）。
 * 纯前端 demo 默认走 quotaThrottleMock；保留真实接口分支作为研发接入示例。
 * 写接口 skipGlobalError：校验错误由页面按 message 就地提示在输入框下方。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_RUN_MOCK !== '0'

export function getQuotaThrottleSettings() {
  if (USE_MOCK) return mock.getQuotaThrottleSettings()
  return request.get('/fde/quota-throttle/settings')
}

/** 保存 IM 消息合并等待时长（秒）；对全部员工的 IM 机器人生效，客户端与网页端都读这个值 */
export function saveMergeWait(mergeWaitSec) {
  if (USE_MOCK) return mock.saveMergeWait(mergeWaitSec)
  return request.put('/fde/quota-throttle/settings/merge-wait', { mergeWaitSec }, { skipGlobalError: true })
}
