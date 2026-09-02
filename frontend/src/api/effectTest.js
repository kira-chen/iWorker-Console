import { useUserStore } from '@/stores/user'
import { dispatchEvent } from './chat'

/**
 * 效果测试工作台真实链路 SSE 对接（设计 §3：FDE 就地「扮演终端用户」试跑，写工具被拦截返回拟真成功）。
 *
 * 复用 api/chat.js 的事件解析器 dispatchEvent（事件同构），自管 fetch + ReadableStream 读取循环。
 * 不复用 chat.js 的 openSse（其内置 1001 EXPERT_NOT_BOUND → 跳 BindPosition 收口，仅适用于员工端绑定语境；
 * 效果测试是 FDE 后台行为，不应触发绑定跳转）。JWT 必带。
 *
 * 事件序列（后端契约）：
 *   session{sessionId:null, positionId} / route{route:"task"} /
 *   step（写工具 OBSERVATION 步带 simulated:true + simulatedTool）/
 *   confirm_required{confirmToken, toolCode, summary} / delta{text} /
 *   done{messageId:null, sessionId:null, traceSummary} / error{code, message}
 *   （无 memory_saved、不发 attachment）
 */

const STREAM_URL = '/api/fde/effect-test/stream'
const CONFIRM_URL = '/api/fde/effect-test/confirm'

/**
 * 发起效果测试流。
 * @param {Object} payload { positionId(必), skillId?(技能入口传 baseSkillId), message(必,≤8000),
 *                           intakeValues?(Map，键=采集字段 key、值=用户填的值，可选；无采集字段不传。
 *                           后端无状态、每轮重装配视图 → 每轮 stream 都需重发，confirm 续跑不带), confirmToken? }
 * @param {Object} handlers { onSession, onRoute, onStep, onConfirm, onDelta, onDone, onError }
 * @param {AbortSignal} signal 「停止」/卸载时 abort
 */
export function streamEffectTest(payload, handlers, signal) {
  return openEffectTestSse(STREAM_URL, payload, handlers, signal)
}

/**
 * 二次确认续跑（提交类动作）。返回与 stream 同构的事件流。无 sessionId。
 * @param {Object} payload { confirmToken(必), approved(必), userAnswer?(≤2000) }
 */
export function confirmEffectTest(payload, handlers, signal) {
  return openEffectTestSse(CONFIRM_URL, payload, handlers, signal)
}

// ---- 内部：通用 SSE 读取循环（fetch + reader，复用 dispatchEvent 解析）----
async function openEffectTestSse(url, body, handlers = {}, signal) {
  const userStore = useUserStore()
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (userStore.token) headers.Authorization = `Bearer ${userStore.token}`

  let resp
  try {
    resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (e) {
    if (e?.name === 'AbortError') return
    handlers.onError?.({ message: '网络异常，请稍后重试' })
    return
  }

  // 401 统一登出（与 axios 拦截器 / chat openSse 一致）
  if (resp.status === 401) {
    userStore.logout()
    handlers.onError?.({ code: 401, message: '登录已失效，请重新登录' })
    return
  }
  // 非 2xx（403 无权限 / 404 岗位不存在 / 400 参数 / 业务失败）：尝试解析 JSON body 拿后端 message/code，
  // 失败再兜底文案。交给业务 onError 呈现友好错误（不白屏、不吞错）。
  if (!resp.ok || !resp.body) {
    let data = null
    try {
      data = await resp.json()
    } catch {
      /* 非 JSON：走兜底 */
    }
    handlers.onError?.({
      code: data?.code ?? resp.status,
      message: data?.message || friendlyHttpError(resp.status)
    })
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        dispatchEvent(raw, handlers)
      }
    }
  } catch (e) {
    if (e?.name !== 'AbortError') {
      handlers.onError?.({ message: '连接中断，请重试' })
    }
  }
}

function friendlyHttpError(status) {
  if (status === 403) return '没有权限进行效果测试（需 FDE / 系统配置 / 管理员角色）'
  if (status === 404) return '所选岗位不存在或已被删除'
  if (status === 400) return '请求参数有误，请检查后重试'
  return '服务暂时不可用，请稍后重试'
}
