/**
 * 配额与限流开发期 mock（04运行 › 配额与限流，对齐 docs/PRD/数字员工管理端PRD/04运行/配额与限流/prd.配额与限流.md）。
 *
 * 本期只有一项平台运行参数：IM 消息合并等待时长（秒）。员工在飞书 / 钉钉 / 微信里连着发的几条消息，
 * 从最后一条算起等这么久，期间发来的合成一件事处理；客户端、网页端都读这个值（员工端《PRD-IM对接》§4.2 第 5 条）。
 *
 * 保存且值有变化时写访问审计「管理端操作」：模块「配额与限流」、动作「修改配置」、
 * 对象为配置项名称、变更内容「原值 → 新值」（PRD 访问审计 §6.2.1 第 21 条）。值没变不写。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { appendOpsRecord } from './accessAuditMock'
import { currentDemoUsername } from '@/utils/demoIdentity'
import { MERGE_WAIT_DEFAULT_SEC, MERGE_WAIT_LABEL, mergeWaitInputError, mergeWaitChangeText } from '@/utils/quotaThrottle'

const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))

let mergeWaitSec = MERGE_WAIT_DEFAULT_SEC

// v1（2026-11-15）：首次接入持久化，只存消息合并等待时长。
const persist = attachPersist('quotaThrottle', {
  version: 1,
  snapshot: () => ({ mergeWaitSec }),
  restore: (data) => {
    if (!data || !Number.isInteger(data.mergeWaitSec)) throw new Error('quotaThrottle 快照形状不合法')
    mergeWaitSec = data.mergeWaitSec
  }
})

/** 读取当前配置 */
export async function getQuotaThrottleSettings() {
  await delay(60)
  return { mergeWaitSec }
}

/**
 * 保存消息合并等待时长。非法值抛 ApiError（field = mergeWaitSec），页面就地提示。
 * @param {number|string} value
 */
export async function saveMergeWait(value) {
  await delay()
  const message = mergeWaitInputError(value)
  if (message) throw new ApiError({ code: 40000, message, field: 'mergeWaitSec' })
  const next = Number(String(value).trim())
  const prev = mergeWaitSec
  if (next !== prev) {
    mergeWaitSec = next
    appendOpsRecord({
      operator: currentDemoUsername(),
      module: '配额与限流',
      action: '修改配置',
      target: MERGE_WAIT_LABEL,
      detail: mergeWaitChangeText(prev, next)
    })
    persist()
  }
  return { mergeWaitSec }
}

/** 测试专用：回到出厂值 */
export function __resetQuotaThrottleMock() {
  mergeWaitSec = MERGE_WAIT_DEFAULT_SEC
  persist()
}
