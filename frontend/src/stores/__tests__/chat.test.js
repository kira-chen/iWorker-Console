import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// chat store 顶层 import：element-plus(ElMessage) / @/api/chat / @/api/memory。
// 单测只验证 SSE handler 写入逻辑与 undoMemory 三态，故 mock 掉副作用依赖，
// 并捕获 streamChat 注入的 handlers，直接喂事件做断言。

const elSuccess = vi.fn()
const elWarning = vi.fn()
vi.mock('element-plus', () => ({
  ElMessage: { success: elSuccess, warning: elWarning, error: vi.fn() }
}))

// 捕获最近一次 streamChat 的 handlers，便于手动触发各 SSE 事件
let lastHandlers = null
const streamChat = vi.fn((payload, handlers) => {
  lastHandlers = handlers
  // 不自动 resolve，让用例自行驱动 done/error（send 内部 await 一个 Promise，
  // 这里立即调用 onDone 以释放 send 的 await，便于 await send(...) 返回）
})
const confirmChat = vi.fn((payload, handlers) => {
  lastHandlers = handlers
})
vi.mock('@/api/chat', () => ({
  streamChat: (...a) => streamChat(...a),
  confirmChat: (...a) => confirmChat(...a)
}))

const deleteMemoryItem = vi.fn()
vi.mock('@/api/memory', () => ({
  deleteMemoryItem: (...a) => deleteMemoryItem(...a)
}))

// session store：chat 在新会话首轮 onDone 后调 useSessionStore().refresh() 补刷标题。
// mock 掉以捕获 refresh 调用次数，并切断 @/api/session→request→router 的 node 环境导入链。
const sessionRefresh = vi.fn()
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({ refresh: sessionRefresh })
}))

const { useChatStore } = await import('@/stores/chat')

// 发起一条消息但不等待（让 streamChat 处于 pending），返回当前 assistant 气泡
function startSend(store) {
  store.send('记住我喜欢喝美式', { positionId: 1, name: '小助' })
  return store.messages[store.messages.length - 1]
}

describe('chat store · route 事件', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
  })

  it('合法 route 写入 assistant.route', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onRoute({ route: 'knowledge' })
    expect(a.route).toBe('knowledge')
  })

  it('三种取值均可写入', () => {
    const s = useChatStore()
    for (const r of ['simple', 'knowledge', 'task']) {
      s.reset()
      const a = startSend(s)
      lastHandlers.onRoute({ route: r })
      expect(a.route).toBe(r)
    }
  })

  it('未知/空 route 不写入（兜底不崩）', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onRoute({ route: 'unknown' })
    expect(a.route).toBeNull()
    lastHandlers.onRoute({})
    expect(a.route).toBeNull()
  })
})

describe('chat store · memory_saved 事件', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
  })

  it('写入 summary 与 items，state=saved', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onMemorySaved({
      summary: '记住了你的咖啡偏好',
      items: [{ id: 'm1', content: '喜欢美式', memoryType: 'PREFERENCE' }]
    })
    expect(a.memory.summary).toBe('记住了你的咖啡偏好')
    expect(a.memory.items).toHaveLength(1)
    expect(a.memory.state).toBe('saved')
  })

  it('空 summary 且无 items 时忽略，不产生回执', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onMemorySaved({ items: [] })
    expect(a.memory).toBeNull()
  })

  it('summary 缺省时给兜底文案', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onMemorySaved({ items: [{ id: 'm1', content: 'x' }] })
    expect(a.memory.summary).toBe('已记住')
  })
})

describe('chat store · attachment 事件（生成物卡片）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
  })

  it('send 创建的 assistant 气泡初始化 attachments:[]', () => {
    const s = useChatStore()
    const a = startSend(s)
    expect(a.attachments).toEqual([])
  })

  it('attachment 事件 push 进当前 assistant.attachments（done 前即时显示）', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onAttachment({ name: '拜访记录.csv', type: 'text/csv', size: 128, url: '/api/artifacts/sales/a.csv' })
    lastHandlers.onAttachment({ name: '方案.csv', type: 'text/csv', size: 64, url: '/api/artifacts/sales/b.csv' })
    expect(a.attachments).toHaveLength(2)
    expect(a.attachments[0].name).toBe('拜访记录.csv')
    expect(a.attachments[1].url).toBe('/api/artifacts/sales/b.csv')
  })

  it('无效/无 name 载荷忽略，不产生空卡', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onAttachment(null)
    lastHandlers.onAttachment({ url: '/x' })
    lastHandlers.onAttachment('bad')
    expect(a.attachments).toEqual([])
  })
})

describe('chat store · confirm 透传 userAnswer（item3 备注/改单意图）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
    confirmChat.mockClear()
  })

  function withConfirm(s) {
    const a = startSend(s)
    lastHandlers.onSession({ sessionId: 'sx' })
    lastHandlers.onConfirm({ confirmToken: 'tk', summary: '请确认' })
    return a
  }

  it('带非空备注 → payload 透传 userAnswer（裁剪首尾空白）', () => {
    const s = useChatStore()
    const a = withConfirm(s)
    s.confirm(a, false, '  金额改成5000再提交  ')
    const payload = confirmChat.mock.calls[0][0]
    expect(payload.approved).toBe(false)
    expect(payload.userAnswer).toBe('金额改成5000再提交')
  })

  it('空/全空白备注 → 不带 userAnswer 字段（后端缺省 null，行为不变）', () => {
    const s = useChatStore()
    const a = withConfirm(s)
    s.confirm(a, true, '   ')
    const payload = confirmChat.mock.calls[0][0]
    expect(payload.approved).toBe(true)
    expect('userAnswer' in payload).toBe(false)
  })

  it('不传备注参数 → 不带 userAnswer 字段', () => {
    const s = useChatStore()
    const a = withConfirm(s)
    s.confirm(a, true)
    const payload = confirmChat.mock.calls[0][0]
    expect('userAnswer' in payload).toBe(false)
  })
})

describe('chat store · undoMemory 三态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
    deleteMemoryItem.mockReset()
    elSuccess.mockClear()
    elWarning.mockClear()
  })

  function withMemory(s, items) {
    const a = startSend(s)
    lastHandlers.onMemorySaved({ summary: 's', items })
    return a
  }

  it('全部成功 → state=undone 并提示成功', async () => {
    deleteMemoryItem.mockResolvedValue(undefined)
    const s = useChatStore()
    const a = withMemory(s, [{ id: 'm1' }, { id: 'm2' }])
    await s.undoMemory(a)
    expect(deleteMemoryItem).toHaveBeenCalledTimes(2)
    expect(a.memory.state).toBe('undone')
    expect(a.memory.error).toBe('')
    expect(elSuccess).toHaveBeenCalledOnce()
  })

  it('部分失败 → 回到 saved 并带部分失败提示', async () => {
    deleteMemoryItem
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
    const s = useChatStore()
    const a = withMemory(s, [{ id: 'm1' }, { id: 'm2' }])
    await s.undoMemory(a)
    expect(a.memory.state).toBe('saved')
    expect(a.memory.error).toContain('部分撤销失败')
    expect(elWarning).toHaveBeenCalledOnce()
  })

  it('全部失败 → 回到 saved 并带全失败提示', async () => {
    deleteMemoryItem.mockRejectedValue(new Error('boom'))
    const s = useChatStore()
    const a = withMemory(s, [{ id: 'm1' }])
    await s.undoMemory(a)
    expect(a.memory.state).toBe('saved')
    expect(a.memory.error).toBe('撤销失败，请稍后重试')
  })

  it('已撤销/撤销中再次调用直接返回（幂等防重入）', async () => {
    deleteMemoryItem.mockResolvedValue(undefined)
    const s = useChatStore()
    const a = withMemory(s, [{ id: 'm1' }])
    a.memory.state = 'undone'
    await s.undoMemory(a)
    expect(deleteMemoryItem).not.toHaveBeenCalled()
  })

  it('无 items 的回执撤销：直接置 undone，不发请求', async () => {
    const s = useChatStore()
    const a = startSend(s)
    a.memory = { summary: 's', items: [], state: 'saved', error: '' }
    await s.undoMemory(a)
    expect(deleteMemoryItem).not.toHaveBeenCalled()
    expect(a.memory.state).toBe('undone')
  })
})

describe('chat store · 中断后 await 正常 settle（防悬挂）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
    confirmChat.mockClear()
  })

  it('stop() 中断 send：openSse 静默 return 也能让 await send() 结束', async () => {
    const s = useChatStore()
    // streamChat 不回调任何 handler（模拟 abort 分支 openSse 直接 return）
    const p = s.send('你好', { positionId: 1, name: '小助' })
    s.stop()
    await expect(p).resolves.toBeUndefined()
    expect(s.sending).toBe(false)
  })

  it('reset() 中断 send：await 同样 settle，不悬挂', async () => {
    const s = useChatStore()
    const p = s.send('你好', { positionId: 1, name: '小助' })
    s.reset()
    await expect(p).resolves.toBeUndefined()
  })

  it('confirm 被中断时 await 也能 settle', async () => {
    const s = useChatStore()
    // 先发一条并触发 confirm_required，得到带 confirm 的气泡
    const a = startSend(s)
    lastHandlers.onSession({ sessionId: 'sx' })
    lastHandlers.onConfirm({ confirmToken: 'tk', summary: '请确认' })
    const p = s.confirm(a, true)
    s.stop()
    await expect(p).resolves.toBeUndefined()
  })
})

describe('chat store · 新会话首轮 done 后补刷会话列表（拉 LLM 标题）', () => {
  // onDone 新会话首轮分支会排一次「延迟补刷」（setTimeout ~3500ms）作为兜底，
  // 故用 fake timers：①断言「立即补刷」时不推进定时器；②断言「延迟补刷」时 runAllTimers。
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    lastHandlers = null
    streamChat.mockClear()
    confirmChat.mockClear()
    sessionRefresh.mockClear()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('新会话首轮：onDone 后立即补刷一次（sessionId 发送前为空）', () => {
    const s = useChatStore()
    expect(s.sessionId).toBeNull()
    const a = startSend(s)
    lastHandlers.onSession({ sessionId: 'new1' })
    lastHandlers.onDone({ messageId: 1 })
    // 未推进定时器 ⇒ 仅「立即补刷」生效
    expect(sessionRefresh).toHaveBeenCalledTimes(1)
    expect(a.streaming).toBe(false)
  })

  it('新会话首轮：延迟补刷在 ~3500ms 后再触发一次（立即 + 延迟共两次）', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onSession({ sessionId: 'new1b' })
    lastHandlers.onDone({ messageId: 1 })
    expect(sessionRefresh).toHaveBeenCalledTimes(1) // 立即
    vi.advanceTimersByTime(3500)
    expect(sessionRefresh).toHaveBeenCalledTimes(2) // + 延迟
    expect(a.streaming).toBe(false)
  })

  it('非首轮：已有 sessionId 时 onDone 不补刷（含延迟补刷，省请求）', () => {
    const s = useChatStore()
    // 模拟会话已存在（如续接历史/同会话第二轮）
    s.loadSession({ id: 'exist', msgs: [], position: { positionId: 1, name: '小助' } })
    startSend(s)
    lastHandlers.onDone({ messageId: 2 })
    vi.advanceTimersByTime(3500)
    expect(sessionRefresh).not.toHaveBeenCalled()
  })

  it('同一新会话的第二轮不再补刷（仅首轮：立即 + 延迟）', () => {
    const s = useChatStore()
    // 首轮：立即 1 次 + 延迟 1 次 = 2 次
    startSend(s)
    lastHandlers.onSession({ sessionId: 'new2' })
    lastHandlers.onDone({})
    vi.advanceTimersByTime(3500)
    expect(sessionRefresh).toHaveBeenCalledTimes(2)
    // 第二轮：此时 sessionId 已有值 ⇒ 非首轮，立即与延迟均不补刷
    startSend(s)
    lastHandlers.onDone({})
    vi.advanceTimersByTime(3500)
    expect(sessionRefresh).toHaveBeenCalledTimes(2)
  })

  it('失败轮（onError）不补刷（含延迟补刷）', () => {
    const s = useChatStore()
    startSend(s)
    lastHandlers.onSession({ sessionId: 'new3' })
    lastHandlers.onError({ code: 9999 })
    vi.advanceTimersByTime(3500)
    expect(sessionRefresh).not.toHaveBeenCalled()
  })

  it('立即补刷抛错被吞掉，不影响 onDone 收尾（已 resolve）', () => {
    sessionRefresh.mockImplementationOnce(() => {
      throw new Error('network boom')
    })
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onSession({ sessionId: 'new4' })
    expect(() => lastHandlers.onDone({})).not.toThrow()
    expect(a.streaming).toBe(false)
    expect(s.sending).toBe(false)
  })

  it('延迟补刷抛错被吞掉，不影响对话（静默）', () => {
    // 第一次（立即）正常，第二次（延迟）抛错
    sessionRefresh
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('delayed boom')
      })
    const s = useChatStore()
    startSend(s)
    lastHandlers.onSession({ sessionId: 'new4b' })
    lastHandlers.onDone({})
    expect(() => vi.advanceTimersByTime(3500)).not.toThrow()
    expect(sessionRefresh).toHaveBeenCalledTimes(2)
  })

  it('确认续跑（confirm）的 onDone 不补刷（恒在已有会话内）', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onSession({ sessionId: 'new5' })
    lastHandlers.onConfirm({ confirmToken: 'tk', summary: '请确认' })
    sessionRefresh.mockClear() // 清掉首轮可能的影响，聚焦续跑
    s.confirm(a, true)
    lastHandlers.onDone({})
    vi.advanceTimersByTime(3500)
    expect(sessionRefresh).not.toHaveBeenCalled()
  })
})

describe('chat store · friendlyError 错误中文化', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
  })

  it('code=1001（未绑定专家）→ 克制文案', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onError({ code: 1001, message: 'EXPERT_NOT_BOUND' })
    expect(a.content).toBe('请先选择并绑定搭子后再使用。')
    expect(a.error).toBe(true)
  })

  it('code=401 → 登录失效文案', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onError({ code: 401 })
    expect(a.content).toBe('登录已失效，请重新登录。')
  })

  it('未知错误 → 通用兜底文案', () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onError({ code: 9999 })
    expect(a.content).toBe('抱歉，处理时出现问题，请稍后重试。')
  })

  it('已有 content 时不被 friendlyError 覆盖', () => {
    const s = useChatStore()
    const a = startSend(s)
    a.content = '部分已输出'
    lastHandlers.onError({ code: 1001 })
    expect(a.content).toBe('部分已输出')
  })
})

describe('chat store · 守卫早退（retry fromHistory / confirm 无会话 / send 空文本与并发）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
    confirmChat.mockClear()
    elWarning.mockClear()
  })

  it('retry：历史装载气泡（fromHistory=true）早退——不 splice 消息、不重发', async () => {
    const s = useChatStore()
    const a = startSend(s)
    lastHandlers.onError({ message: 'boom' }) // 失败收尾，释放 sending
    a.fromHistory = true // 模拟 loadSession 装载的历史失败气泡
    const before = s.messages.length
    streamChat.mockClear()
    await s.retry(a)
    // 早退：问答对完好（splice 会误删历史问答对，CR5 兜底），不再发起请求
    expect(s.messages.length).toBe(before)
    expect(s.messages).toContain(a)
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('confirm：sessionId=null → warning「会话未就绪」，不调 confirmChat，confirm 载荷保留', async () => {
    const s = useChatStore()
    const a = startSend(s)
    // 只发 confirm_required，不发 session 事件 ⇒ sessionId 仍为 null
    lastHandlers.onConfirm({ confirmToken: 'tk', summary: '请确认' })
    await s.confirm(a, true)
    expect(elWarning).toHaveBeenCalledWith('会话未就绪，请重试')
    expect(confirmChat).not.toHaveBeenCalled()
    // 未清 confirm（早退在置空之前），用户可待会话就绪后重试
    expect(a.confirm).toBeTruthy()
  })

  it('send：空/全空白文本早退——不推消息、不调 streamChat', async () => {
    const s = useChatStore()
    await s.send('   ', { positionId: 1, name: '小助' })
    await s.send('', { positionId: 1, name: '小助' })
    expect(s.messages).toHaveLength(0)
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('send：sending=true（上一条流未收口）早退——不重复推消息、不并发发起', () => {
    const s = useChatStore()
    startSend(s) // 第一条挂起（streamChat mock 不回调），sending=true
    expect(s.sending).toBe(true)
    const before = s.messages.length
    s.send('第二条', { positionId: 1, name: '小助' })
    expect(s.messages.length).toBe(before)
    expect(streamChat).toHaveBeenCalledTimes(1)
  })
})

describe('chat store · retry 保留 jobTag', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    lastHandlers = null
    streamChat.mockClear()
  })

  it('send 在 assistant 上记录 positionTag，retry 重发时透传 jobTag', async () => {
    const s = useChatStore()
    s.send('帮我办事', { positionId: 7, name: '法务', jobTag: '法务专员' })
    const assistant = s.messages[s.messages.length - 1]
    // send 应把 jobTag 落到 assistant.positionTag，供 retry 读取
    expect(assistant.positionTag).toBe('法务专员')

    // 首条失败收尾（释放 sending 与 await，便于重试再次发起）
    lastHandlers.onError({ message: 'boom' })

    streamChat.mockClear()
    // 不 await 整个 retry：其内部 send 的 await 由 streamChat mock 挂起，
    // 但 send 的同步部分（推入消息 + 调 streamChat）已先于 await 执行，足够断言
    s.retry(assistant)
    await Promise.resolve()
    // retry 内部用 origPosition 重发，jobTag 应不丢
    const payload = streamChat.mock.calls[0][0]
    expect(payload.positionId).toBe(7)
    const newAssistant = s.messages[s.messages.length - 1]
    expect(newAssistant.positionTag).toBe('法务专员')
  })
})
