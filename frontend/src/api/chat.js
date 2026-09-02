import request from './request'
import { useUserStore } from '@/stores/user'
import { handlePositionNotBound } from '@/utils/positionNotBound'

// 发送一条消息给专家（非流式回退接口）
// 契约：POST /api/chat -> ResultVO<ChatResponse>
export function sendChat(payload) {
  return request.post('/chat', payload)
}

// @ 可用专家下拉列表（可搜索）
// 契约：GET /api/chat/positions/available?keyword= -> ResultVO<List<AtPositionVO>>
export function listAtPositions(keyword) {
  return request.get('/chat/positions/available', { params: { keyword: keyword || undefined } })
}

/**
 * SSE 流式对话（主接口）。
 * axios 不便处理 text/event-stream，这里用 fetch + ReadableStream 解析。
 *
 * 契约：POST /api/chat/stream，事件序列：
 *   session / route / step / confirm_required / delta / memory_saved / attachment / done / error
 *   （attachment 生成物卡片，每件一个，均在 done 之前下发）
 *
 * @param {Object} payload  ChatStreamRequest { sessionId?, positionId?, message, confirmToken? }
 * @param {Object} handlers { onSession, onRoute, onStep, onConfirm, onDelta, onMemorySaved, onAttachment, onDone, onError }
 * @param {AbortSignal} signal  可选，用于「停止生成」
 */
export function streamChat(payload, handlers, signal) {
  return openSse('/api/chat/stream', payload, handlers, signal)
}

/**
 * 二次确认续跑（提交类动作）。返回与 streamChat 同构的 SSE 事件流。
 * 契约：POST /api/chat/confirm { sessionId, confirmToken, approved }
 */
export function confirmChat(payload, handlers, signal) {
  return openSse('/api/chat/confirm', payload, handlers, signal)
}

/**
 * 认证下载生成物（任务 A 重点）。
 * 下载端点（/api/artifacts/**）走 anyRequest().authenticated()，无 token → 401，
 * 故不能用 window.open（新标签页 GET 不带 Authorization）。这里用 fetch 带 JWT 取 blob，
 * 再生成临时 objectURL 经隐藏 <a download> 触发，最后释放 URL。
 *
 * 不走统一 axios 实例：避免 baseURL='/api' 对已是 /api 开头的绝对 url 造成 /api/api 双前缀，
 * 也避免响应拦截器按 JSON 解包破坏二进制 blob。
 *
 * @param {string} url   形如 /api/artifacts/sales/<编码相对路径>
 * @param {string} name  下载文件名（attachment.name）
 * @throws 出错时抛出，调用方负责 UI 失败态
 */
export async function downloadArtifact(url, name) {
  const userStore = useUserStore()
  const headers = {}
  if (userStore.token) headers.Authorization = `Bearer ${userStore.token}`

  const resp = await fetch(url, { method: 'GET', headers })
  if (resp.status === 401) {
    userStore.logout()
    throw new Error('登录已失效，请重新登录')
  }
  if (!resp.ok) {
    throw new Error('下载失败，请稍后重试')
  }

  const blob = await resp.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = name || ''
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // 释放临时 URL（点击触发下载后即可回收）
    URL.revokeObjectURL(objectUrl)
  }
}

// ---- 内部：通用 SSE 解析 ----
async function openSse(url, body, rawHandlers = {}, signal) {
  const userStore = useUserStore()
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (userStore.token) headers.Authorization = `Bearer ${userStore.token}`

  // SSE 不经 axios 响应拦截器，故在此对未绑定专家（code=1001 EXPERT_NOT_BOUND）做同口径收口：
  // 包一层 onError——任何错误路径（error 事件 / 非 ok / 连接中断）携带 code=1001 时，
  // 复用 handlePositionNotBound（清无绑定态 + 跳 BindPosition，幂等防循环），再照常下发给业务 onError。
  const handlers = {
    ...rawHandlers,
    onError(data) {
      if (data?.code === 1001) handlePositionNotBound()
      rawHandlers.onError?.(data)
    }
  }

  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })
  } catch (e) {
    if (e?.name === 'AbortError') return
    handlers.onError?.({ message: '网络异常，请稍后重试' })
    return
  }

  // 401 统一登出处理（与 axios 拦截器一致）
  if (resp.status === 401) {
    userStore.logout()
    handlers.onError?.({ code: 401, message: '登录已失效，请重新登录' })
    return
  }
  if (!resp.ok || !resp.body) {
    handlers.onError?.({ message: '服务暂时不可用，请稍后重试' })
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

      // SSE 以空行分隔事件块
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

// 导出供效果测试 SSE（api/effectTest.js）复用同一套事件解析（事件同构：session/route/step/
// confirm_required/delta/...）。注：效果测试不走 chat 的 1001 EXPERT_NOT_BOUND 跳转收口，
// 故仅复用纯解析 dispatchEvent，自管 fetch+reader 循环，不复用 openSse 的业务收口。
export function dispatchEvent(raw, handlers) {
  let event = 'message'
  const dataLines = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return
  let data
  try {
    data = JSON.parse(dataLines.join('\n'))
  } catch (e) {
    data = dataLines.join('\n')
  }
  switch (event) {
    case 'session':
      handlers.onSession?.(data)
      break
    case 'route':
      handlers.onRoute?.(data)
      break
    case 'step':
      handlers.onStep?.(data)
      break
    case 'confirm_required':
      handlers.onConfirm?.(data)
      break
    case 'delta':
      handlers.onDelta?.(data)
      break
    case 'memory_saved':
      handlers.onMemorySaved?.(data)
      break
    case 'attachment':
      // 生成物卡片：{name, type(mime), size(bytes), url}，每件一个、均在 done 之前
      handlers.onAttachment?.(data)
      break
    case 'done':
      handlers.onDone?.(data)
      break
    case 'error':
      handlers.onError?.(data)
      break
    default:
      break
  }
}
