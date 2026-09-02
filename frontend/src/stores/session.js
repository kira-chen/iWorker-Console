import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  listSessions,
  getSessionDetail,
  continueSession,
  deleteSession
} from '@/api/session'
import { parseAttachments } from '@/utils/attachments'
import { useChatStore } from './chat'
import { useUserPositionStore } from './userPosition'

/**
 * 会话列表 store —— 驱动「侧栏即会话列表」交互。
 *
 * 复用后端 4 个会话接口（listSessions / getSessionDetail / continueSession / deleteSession），
 * 不新增、不改后端契约。列表分页拉取并按 lastMessageAt 分组（今天/昨天/7天内/更早）展示；
 * 检索为前端对已加载会话标题的过滤（后端 listSessions 无关键词参数，见 grouped 注释）。
 *
 * 会话项形状（来自 SessionVO，数据驱动，不硬编码任何字段含义）：
 *   { sessionId, title, summary, lastMessageAt, positionId, positionName, positionAvatar, ... }
 */
const PAGE_SIZE = 20

export const useSessionStore = defineStore('session', () => {
  const list = ref([]) // 已加载的会话（按 lastMessageAt 倒序，后端返回序）
  const total = ref(0)
  const page = ref(0) // 已加载到的页码（0 = 还没拉过）
  const size = ref(PAGE_SIZE)
  const loading = ref(false) // 首屏加载态
  const error = ref(false) // 首屏加载失败
  const loadingMore = ref(false) // 滚动加载下一页态
  const keyword = ref('') // 检索关键词（前端过滤已加载列表）

  // 还有更多可加载：已加载条数 < 总数
  const hasMore = computed(() => list.value.length < total.value)

  /**
   * 按 lastMessageAt 分组：今天 / 昨天 / 7 天内 / 更早，并按 keyword 过滤标题。
   *
   * 限制：keyword 过滤的范围仅限「已加载到 list 的会话」。后端 listSessions 无关键词参数，
   * 故未匹配到的命中可能在尚未翻到的后续页里——当前实现仅过滤已加载列表（用户可继续向下
   * 滚动 loadMore 扩大命中范围），getter 本身保持纯计算、无副作用、不主动翻页。
   *
   * @returns {Array<{key,label,items}>} 仅返回非空分组，按时间从近到远排列
   */
  const grouped = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    const matched = kw
      ? list.value.filter((s) => (s.title || '').toLowerCase().includes(kw))
      : list.value

    const buckets = {
      today: { key: 'today', label: '今天', items: [] },
      yesterday: { key: 'yesterday', label: '昨天', items: [] },
      week: { key: 'week', label: '7 天内', items: [] },
      earlier: { key: 'earlier', label: '更早', items: [] }
    }

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000 // 今天起往前 7 天窗口

    for (const s of matched) {
      const t = s.lastMessageAt ? new Date(s.lastMessageAt).getTime() : NaN
      if (Number.isNaN(t)) {
        buckets.earlier.items.push(s) // 无有效时间 → 归「更早」兜底，不丢
      } else if (t >= startOfToday) {
        buckets.today.items.push(s)
      } else if (t >= startOfYesterday) {
        buckets.yesterday.items.push(s)
      } else if (t >= startOfWeek) {
        buckets.week.items.push(s)
      } else {
        buckets.earlier.items.push(s)
      }
    }

    return [buckets.today, buckets.yesterday, buckets.week, buckets.earlier].filter(
      (g) => g.items.length > 0
    )
  })

  // 合并下一页：按 sessionId 去重后追加（后端理论倒序稳定，仍兜一层去重防分页错位重复）
  function mergeAppend(items) {
    const seen = new Set(list.value.map((s) => s.sessionId))
    for (const it of items) {
      if (!seen.has(it.sessionId)) {
        list.value.push(it)
        seen.add(it.sessionId)
      }
    }
  }

  // 首屏拉第一页（含 loading / error 四态）
  async function fetchFirst() {
    loading.value = true
    error.value = false
    try {
      const data = await listSessions(1, size.value)
      list.value = data?.items || []
      total.value = data?.total || 0
      page.value = 1
    } catch (e) {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  // 滚动加载下一页（去重合并，维护 hasMore；并发与无更多时早退）
  async function loadMore() {
    if (loadingMore.value || loading.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const next = page.value + 1
      const data = await listSessions(next, size.value)
      mergeAppend(data?.items || [])
      total.value = data?.total ?? total.value
      page.value = next
    } catch (e) {
      // 加载更多失败静默：不破坏已展示列表，用户可继续滚动重试
    } finally {
      loadingMore.value = false
    }
  }

  /**
   * 重拉第一页（新会话创建后刷新侧栏，使新会话立即出现）。
   * 简单实现：重置回第一页（放弃已加载更多的部分）——后端按 lastMessageAt 倒序，
   * 新会话必在首页，刷新后用户当前会话仍高亮，体验可接受。
   */
  async function refresh() {
    try {
      const data = await listSessions(1, size.value)
      list.value = data?.items || []
      total.value = data?.total || 0
      page.value = 1
      error.value = false
    } catch (e) {
      // 刷新失败静默：保留已加载列表，不打断对话
    }
  }

  /**
   * 删除会话：调 deleteSession → 从 list 移除 + total-1。
   * 失败由 request 拦截器统一提示，此处不改本地状态。
   */
  async function remove(sessionId) {
    await deleteSession(sessionId)
    list.value = list.value.filter((s) => s.sessionId !== sessionId)
    total.value = Math.max(0, total.value - 1)
  }

  // 按消息自带 positionId 溯源岗位名/头像（@切换后每条由不同岗位回复）：
  // 1) 优先全局岗位列表命中（数据驱动）；2) 回退到 session 主岗位（同一岗位时正好对上）。
  function nameOfPosition(positionId, sess) {
    if (positionId != null) {
      const e = useUserPositionStore().positions.find((x) => x.id === positionId)
      if (e?.name) return e.name
    }
    return sess?.positionName || ''
  }
  function avatarOfPosition(positionId, sess) {
    if (positionId != null) {
      const e = useUserPositionStore().positions.find((x) => x.id === positionId)
      if (e?.avatar != null) return e.avatar
    }
    return sess?.positionAvatar || null
  }

  /**
   * 在主对话区打开一条历史会话（抽取自原 History.onContinue）。
   * 流程：best-effort continueSession（上下文定位，失败不阻塞）→ getSessionDetail
   *   → 把 messages 映射成 chat 消息形状（含 fromHistory:true / interrupted 等，与原 History 一致）
   *   → chatStore.loadSession({id,msgs,position})。
   * 岗位名/头像按每条 positionId 用 userPositionStore 溯源，回退 session 主岗位。
   *
   * 导航（router.push）交由调用方处理，本 action 只负责载入 chatStore（单一职责）。
   * @returns {Promise<boolean>} 是否载入成功（详情拉取失败返回 false，调用方可不导航）
   */
  async function openInChat(sessionId) {
    const sess = list.value.find((s) => s.sessionId === sessionId) || { sessionId }

    // 溯源需要全局岗位列表，确保已拉
    const positionStore = useUserPositionStore()
    if (positionStore.positions.length === 0) {
      try {
        await positionStore.fetchPositions()
      } catch (e) {
        /* 静默：溯源失败回退 session 主岗位 */
      }
    }

    // best-effort 上下文定位，失败不阻塞续接
    try {
      await continueSession(sessionId)
    } catch (e) {
      /* 定位失败仍可带 sessionId 续接 */
    }

    let detail
    try {
      detail = await getSessionDetail(sessionId)
    } catch (e) {
      ElMessage.error('会话加载失败，请重试')
      return false
    }

    const msgs = (detail?.messages || []).map((m) => ({
      id: `h_${m.messageId}`,
      role: m.role,
      content: m.content || '',
      positionId: m.positionId,
      positionName: nameOfPosition(m.positionId, sess),
      positionAvatar: avatarOfPosition(m.positionId, sess),
      steps: m.reasoningTrace?.steps || [],
      traceSummary: m.reasoningTrace?.summary || '',
      attachments: parseAttachments(m.attachments),
      streaming: false,
      error: m.status === 'failed',
      // 中断/待确认轮：回看时给明确「未完成」标识，不可被误读为已办成
      interrupted: m.status === 'interrupted',
      // 历史装载的失败/中断气泡禁重试（避免 splice 误删历史问答对）
      fromHistory: true
    }))

    useChatStore().loadSession({
      id: sessionId,
      msgs,
      position: {
        positionId: detail?.primaryPositionId ?? sess.positionId,
        name: sess.positionName,
        avatar: sess.positionAvatar
      }
    })
    return true
  }

  // 登出清空
  function reset() {
    list.value = []
    total.value = 0
    page.value = 0
    size.value = PAGE_SIZE
    loading.value = false
    error.value = false
    loadingMore.value = false
    keyword.value = ''
  }

  return {
    list,
    total,
    page,
    size,
    loading,
    error,
    loadingMore,
    keyword,
    hasMore,
    grouped,
    fetchFirst,
    loadMore,
    refresh,
    remove,
    openInChat,
    reset
  }
})
