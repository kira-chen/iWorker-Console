import { describe, it, expect, beforeEach, vi } from 'vitest'

// chat.js 顶层 import：@/api/request（含 element-plus/router/userStore 副作用）、@/stores/user、
// @/utils/positionNotBound。本测聚焦 SSE（openSse/streamChat）的 1001 收口与正常事件分发，
// 故 mock 掉 request（避免拉起 axios）、userStore（token）、handlePositionNotBound（断言被调），
// 并以 mock fetch + ReadableStream 喂 SSE 字节流。

vi.mock('@/api/request', () => ({ default: { post: vi.fn(), get: vi.fn() } }))

const userStore = { token: 'tk' }
vi.mock('@/stores/user', () => ({ useUserStore: () => userStore }))

const handlePositionNotBound = vi.fn()
vi.mock('@/utils/positionNotBound', () => ({
  handlePositionNotBound: (...a) => handlePositionNotBound(...a)
}))

const { streamChat } = await import('@/api/chat')

// 把若干 SSE 文本块组成一个可读流（模拟 fetch().body）
function sseStream(chunks) {
  const encoder = new TextEncoder()
  let i = 0
  return {
    getReader() {
      return {
        read() {
          if (i < chunks.length) {
            return Promise.resolve({ value: encoder.encode(chunks[i++]), done: false })
          }
          return Promise.resolve({ value: undefined, done: true })
        }
      }
    }
  }
}

function mockFetchOk(chunks) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, body: sseStream(chunks) })
  )
}

// 等待 openSse 内部异步读流跑完
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('chat SSE · openSse 事件分发与错误收口（1001/401/正常流/attachment）', () => {
  beforeEach(() => {
    handlePositionNotBound.mockClear()
    userStore.token = 'tk'
  })

  it('error 事件携带 code=1001 → 调 handlePositionNotBound 并照常下发 onError', async () => {
    mockFetchOk(['event: error\ndata: {"code":1001,"message":"EXPERT_NOT_BOUND"}\n\n'])
    const onError = vi.fn()
    await streamChat({ message: 'hi' }, { onError })
    await flush()
    expect(handlePositionNotBound).toHaveBeenCalledOnce()
    // 业务 onError 仍被调用（store 据此中文化展示）
    expect(onError).toHaveBeenCalledWith({ code: 1001, message: 'EXPERT_NOT_BOUND' })
  })

  it('普通 error 事件（非 1001）→ 不触发 handlePositionNotBound', async () => {
    mockFetchOk(['event: error\ndata: {"code":2000,"message":"busy"}\n\n'])
    const onError = vi.fn()
    await streamChat({ message: 'hi' }, { onError })
    await flush()
    expect(handlePositionNotBound).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith({ code: 2000, message: 'busy' })
  })

  it('正常 delta/done 流不受影响、不误触发收口', async () => {
    mockFetchOk([
      'event: delta\ndata: {"text":"你好"}\n\n',
      'event: done\ndata: {"messageId":42}\n\n'
    ])
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await streamChat({ message: 'hi' }, { onDelta, onDone, onError })
    await flush()
    expect(onDelta).toHaveBeenCalledWith({ text: '你好' })
    expect(onDone).toHaveBeenCalledWith({ messageId: 42 })
    expect(onError).not.toHaveBeenCalled()
    expect(handlePositionNotBound).not.toHaveBeenCalled()
  })

  it('attachment 事件 → 分发到 onAttachment（done 之前到达）', async () => {
    mockFetchOk([
      'event: attachment\ndata: {"name":"拜访记录.csv","type":"text/csv","size":128,"url":"/api/artifacts/sales/a.csv"}\n\n',
      'event: done\ndata: {"messageId":7}\n\n'
    ])
    const onAttachment = vi.fn()
    const onDone = vi.fn()
    await streamChat({ message: 'hi' }, { onAttachment, onDone })
    await flush()
    expect(onAttachment).toHaveBeenCalledWith({
      name: '拜访记录.csv', type: 'text/csv', size: 128, url: '/api/artifacts/sales/a.csv'
    })
    expect(onDone).toHaveBeenCalledWith({ messageId: 7 })
  })

  it('HTTP 401 → 不走 1001 收口（userStore.logout 登出链路 + onError 401）', async () => {
    userStore.logout = vi.fn()
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401, body: null }))
    const onError = vi.fn()
    await streamChat({ message: 'hi' }, { onError })
    await flush()
    expect(handlePositionNotBound).not.toHaveBeenCalled()
    expect(userStore.logout).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith({ code: 401, message: '登录已失效，请重新登录' })
  })

  it('fetch 抛 AbortError（用户停止生成）→ 静默返回，不调 onError', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    global.fetch = vi.fn(() => Promise.reject(abortErr))
    const onError = vi.fn()
    await streamChat({ message: 'hi' }, { onError })
    await flush()
    expect(onError).not.toHaveBeenCalled()
    expect(handlePositionNotBound).not.toHaveBeenCalled()
  })

  it('fetch 抛普通异常（断网等）→ onError 兜底「网络异常，请稍后重试」', async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    const onError = vi.fn()
    await streamChat({ message: 'hi' }, { onError })
    await flush()
    expect(onError).toHaveBeenCalledWith({ message: '网络异常，请稍后重试' })
  })

  it('非 401 的 !resp.ok（如 503）→ onError「服务暂时不可用，请稍后重试」，不登出', async () => {
    userStore.logout = vi.fn()
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, body: null }))
    const onError = vi.fn()
    await streamChat({ message: 'hi' }, { onError })
    await flush()
    expect(userStore.logout).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith({ message: '服务暂时不可用，请稍后重试' })
  })
})
