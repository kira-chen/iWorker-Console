import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// session store 单测：切断真实 4 个会话 API 与兄弟 store（chat/position），
// 只验证本 store 的分组逻辑、loadMore 去重、remove、openInChat 的消息映射编排。

const listSessions = vi.fn()
const getSessionDetail = vi.fn()
const continueSession = vi.fn()
const deleteSession = vi.fn()
vi.mock('@/api/session', () => ({
  listSessions: (...a) => listSessions(...a),
  getSessionDetail: (...a) => getSessionDetail(...a),
  continueSession: (...a) => continueSession(...a),
  deleteSession: (...a) => deleteSession(...a)
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))

// chat store：捕获 loadSession 入参
const loadSession = vi.fn()
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({ loadSession })
}))

// position store：可控的 positions 列表 + fetchPositions
const positionState = { positions: [], fetchPositions: vi.fn() }
vi.mock('@/stores/userPosition', () => ({
  useUserPositionStore: () => positionState
}))

const { useSessionStore } = await import('@/stores/session')

// 相对当前时刻偏移构造 ISO 时间
function isoOffset(ms) {
  return new Date(Date.now() - ms).toISOString()
}
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  setActivePinia(createPinia())
  listSessions.mockReset()
  getSessionDetail.mockReset()
  continueSession.mockReset()
  deleteSession.mockReset()
  loadSession.mockReset()
  positionState.positions = []
  positionState.fetchPositions.mockReset()
  positionState.fetchPositions.mockResolvedValue()
})

describe('session store · fetchFirst 四态', () => {
  it('成功：写入 list/total/page，清 loading/error', async () => {
    listSessions.mockResolvedValue({ items: [{ sessionId: 1 }], total: 1 })
    const s = useSessionStore()
    await s.fetchFirst()
    expect(listSessions).toHaveBeenCalledWith(1, 20)
    expect(s.list).toEqual([{ sessionId: 1 }])
    expect(s.total).toBe(1)
    expect(s.page).toBe(1)
    expect(s.loading).toBe(false)
    expect(s.error).toBe(false)
  })

  it('失败：置 error，list 保持空', async () => {
    listSessions.mockRejectedValue(new Error('boom'))
    const s = useSessionStore()
    await s.fetchFirst()
    expect(s.error).toBe(true)
    expect(s.list).toEqual([])
    expect(s.loading).toBe(false)
  })
})

describe('session store · grouped 分组与检索过滤', () => {
  // 锚定固定中午时间，避免午夜边界导致 isoOffset 相对偏移跨日历日致 flaky（治本）
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('按 lastMessageAt 分今天/昨天/7天内/更早，仅返回非空组', () => {
    const s = useSessionStore()
    s.list = [
      { sessionId: 1, title: '今天的会话', lastMessageAt: isoOffset(0) },
      { sessionId: 2, title: '昨天的会话', lastMessageAt: isoOffset(1.2 * DAY) },
      { sessionId: 3, title: '三天前', lastMessageAt: isoOffset(3 * DAY) },
      { sessionId: 4, title: '很久以前', lastMessageAt: isoOffset(30 * DAY) }
    ]
    const g = s.grouped
    const byKey = Object.fromEntries(g.map((x) => [x.key, x.items.map((i) => i.sessionId)]))
    expect(byKey.today).toEqual([1])
    expect(byKey.yesterday).toEqual([2])
    expect(byKey.week).toEqual([3])
    expect(byKey.earlier).toEqual([4])
    // 四组都非空 → 四组都在，顺序从近到远
    expect(g.map((x) => x.key)).toEqual(['today', 'yesterday', 'week', 'earlier'])
  })

  it('空组不出现；无有效时间归「更早」兜底', () => {
    const s = useSessionStore()
    s.list = [
      { sessionId: 1, title: 'a', lastMessageAt: isoOffset(0) },
      { sessionId: 2, title: 'b', lastMessageAt: null }
    ]
    const g = s.grouped
    expect(g.map((x) => x.key)).toEqual(['today', 'earlier'])
    expect(g.find((x) => x.key === 'earlier').items[0].sessionId).toBe(2)
  })

  it('keyword 对标题大小写不敏感过滤已加载列表', () => {
    const s = useSessionStore()
    s.list = [
      { sessionId: 1, title: '考勤汇总', lastMessageAt: isoOffset(0) },
      { sessionId: 2, title: '报销审批', lastMessageAt: isoOffset(0) }
    ]
    s.keyword = '考勤'
    expect(s.grouped[0].items.map((i) => i.sessionId)).toEqual([1])
    s.keyword = '审批'
    expect(s.grouped[0].items.map((i) => i.sessionId)).toEqual([2])
    s.keyword = '不存在'
    expect(s.grouped).toEqual([])
  })

  it('grouped 为 getter 无副作用：不触发翻页', () => {
    const s = useSessionStore()
    s.list = [{ sessionId: 1, title: 'x', lastMessageAt: isoOffset(0) }]
    s.keyword = 'x'
    void s.grouped
    expect(listSessions).not.toHaveBeenCalled()
  })
})

describe('session store · loadMore 去重合并 / hasMore', () => {
  it('hasMore：已加载 < total 为 true', async () => {
    listSessions.mockResolvedValue({ items: [{ sessionId: 1 }], total: 3 })
    const s = useSessionStore()
    await s.fetchFirst()
    expect(s.hasMore).toBe(true)
  })

  it('loadMore 追加下一页并按 sessionId 去重', async () => {
    const s = useSessionStore()
    listSessions.mockResolvedValueOnce({ items: [{ sessionId: 1 }, { sessionId: 2 }], total: 4 })
    await s.fetchFirst()
    // 第二页含与第一页重叠的 sessionId:2（分页错位），应去重
    listSessions.mockResolvedValueOnce({ items: [{ sessionId: 2 }, { sessionId: 3 }], total: 4 })
    await s.loadMore()
    expect(listSessions).toHaveBeenLastCalledWith(2, 20)
    expect(s.list.map((x) => x.sessionId)).toEqual([1, 2, 3])
    expect(s.page).toBe(2)
  })

  it('无更多时 loadMore 早退不发请求', async () => {
    listSessions.mockResolvedValue({ items: [{ sessionId: 1 }], total: 1 })
    const s = useSessionStore()
    await s.fetchFirst()
    listSessions.mockClear()
    await s.loadMore()
    expect(s.hasMore).toBe(false)
    expect(listSessions).not.toHaveBeenCalled()
  })
})

describe('session store · remove', () => {
  it('删除成功：调 deleteSession + 从 list 去除 + total-1', async () => {
    deleteSession.mockResolvedValue()
    const s = useSessionStore()
    s.list = [{ sessionId: 1 }, { sessionId: 2 }]
    s.total = 2
    await s.remove(1)
    expect(deleteSession).toHaveBeenCalledWith(1)
    expect(s.list.map((x) => x.sessionId)).toEqual([2])
    expect(s.total).toBe(1)
  })

  it('删除失败：抛出且不改本地状态', async () => {
    deleteSession.mockRejectedValue(new Error('x'))
    const s = useSessionStore()
    s.list = [{ sessionId: 1 }]
    s.total = 1
    await expect(s.remove(1)).rejects.toBeTruthy()
    expect(s.list.map((x) => x.sessionId)).toEqual([1])
    expect(s.total).toBe(1)
  })
})

describe('session store · openInChat 消息映射', () => {
  it('happy：continue+detail → 映射 messages → chat.loadSession（含 fromHistory/interrupted/专家溯源）', async () => {
    positionState.positions = [{ id: 7, name: '小算', avatar: 'av7' }]
    continueSession.mockResolvedValue({})
    getSessionDetail.mockResolvedValue({
      primaryPositionId: 7,
      messages: [
        { messageId: 11, role: 'user', content: '帮我报销', positionId: 7 },
        {
          messageId: 12,
          role: 'assistant',
          content: '已提交',
          positionId: 7,
          status: 'success',
          reasoningTrace: { steps: [{ no: 1 }], summary: 's' },
          attachments: '[{"name":"r.pdf"}]'
        },
        { messageId: 13, role: 'assistant', content: '', positionId: 7, status: 'interrupted' },
        { messageId: 14, role: 'assistant', content: 'x', positionId: 7, status: 'failed' }
      ]
    })
    const s = useSessionStore()
    s.list = [{ sessionId: 99, positionName: '小算', positionAvatar: 'sav', positionId: 7 }]

    const ok = await s.openInChat(99)

    expect(ok).toBe(true)
    expect(continueSession).toHaveBeenCalledWith(99)
    expect(getSessionDetail).toHaveBeenCalledWith(99)
    expect(loadSession).toHaveBeenCalledOnce()
    const arg = loadSession.mock.calls[0][0]
    expect(arg.id).toBe(99)
    expect(arg.position).toEqual({ positionId: 7, name: '小算', avatar: 'sav' })
    expect(arg.msgs).toHaveLength(4)
    // 全部 fromHistory，禁重试
    expect(arg.msgs.every((m) => m.fromHistory === true)).toBe(true)
    // 专家按 positionId 溯源到全局列表
    expect(arg.msgs[0].positionName).toBe('小算')
    expect(arg.msgs[0].positionAvatar).toBe('av7')
    // attachments 字符串被 parse 成数组
    expect(arg.msgs[1].attachments).toEqual([{ name: 'r.pdf' }])
    expect(arg.msgs[1].steps).toEqual([{ no: 1 }])
    // interrupted / failed 状态映射
    expect(arg.msgs[2].interrupted).toBe(true)
    expect(arg.msgs[3].error).toBe(true)
  })

  it('empty：detail 无 messages → loadSession 收到空 msgs，仍返回 true', async () => {
    continueSession.mockResolvedValue({})
    getSessionDetail.mockResolvedValue({ primaryPositionId: 1, messages: [] })
    const s = useSessionStore()
    s.list = [{ sessionId: 5, positionName: 'A', positionAvatar: null, positionId: 1 }]
    const ok = await s.openInChat(5)
    expect(ok).toBe(true)
    expect(loadSession.mock.calls[0][0].msgs).toEqual([])
  })

  it('continueSession 失败不阻塞：仍拉 detail 并 loadSession', async () => {
    continueSession.mockRejectedValue(new Error('locate fail'))
    getSessionDetail.mockResolvedValue({ messages: [] })
    const s = useSessionStore()
    s.list = [{ sessionId: 5 }]
    const ok = await s.openInChat(5)
    expect(ok).toBe(true)
    expect(loadSession).toHaveBeenCalledOnce()
  })

  it('getSessionDetail 失败：返回 false，不调 loadSession', async () => {
    continueSession.mockResolvedValue({})
    getSessionDetail.mockRejectedValue(new Error('boom'))
    const s = useSessionStore()
    s.list = [{ sessionId: 5 }]
    const ok = await s.openInChat(5)
    expect(ok).toBe(false)
    expect(loadSession).not.toHaveBeenCalled()
  })

  it('岗位列表为空时先 fetchPositions 再溯源', async () => {
    positionState.positions = []
    continueSession.mockResolvedValue({})
    getSessionDetail.mockResolvedValue({ messages: [] })
    const s = useSessionStore()
    s.list = [{ sessionId: 5 }]
    await s.openInChat(5)
    expect(positionState.fetchPositions).toHaveBeenCalledOnce()
  })
})

describe('session store · refresh / reset', () => {
  it('refresh 重拉第一页', async () => {
    listSessions.mockResolvedValue({ items: [{ sessionId: 9 }], total: 1 })
    const s = useSessionStore()
    await s.refresh()
    expect(listSessions).toHaveBeenCalledWith(1, 20)
    expect(s.list).toEqual([{ sessionId: 9 }])
    expect(s.page).toBe(1)
  })

  it('reset 清空全部状态', () => {
    const s = useSessionStore()
    s.list = [{ sessionId: 1 }]
    s.total = 1
    s.page = 2
    s.keyword = 'x'
    s.error = true
    s.reset()
    expect(s.list).toEqual([])
    expect(s.total).toBe(0)
    expect(s.page).toBe(0)
    expect(s.keyword).toBe('')
    expect(s.error).toBe(false)
  })
})

afterEach(() => {
  vi.clearAllMocks()
})
