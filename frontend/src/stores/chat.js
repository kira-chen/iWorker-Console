import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { streamChat, confirmChat } from '@/api/chat'
import { deleteMemoryItem } from '@/api/memory'
import { useSessionStore } from './session'

/**
 * 会话消息与流式 ReAct 状态管理。
 *
 * message 结构（数据驱动，不对任何具体专家硬编码）：
 *  - user:      { id, role:'user', content, positionId }
 *  - assistant: { id, role:'assistant', positionId, positionName, positionAvatar,
 *                 content, steps:[ReActStep], traceSummary,
 *                 attachments:[{name,type,size,url}](生成物卡片，SSE attachment 事件即时 push/history parse 装载),
 *                 streaming, error,
 *                 confirm:{confirmToken,summary}|null, switchedFrom:positionId|null,
 *                 route:'simple'|'knowledge'|'task'|null(分类分流弱提示标签),
 *                 memory:{summary, items:[{id,content,memoryType}],
 *                         state:'saved'|'undoing'|'undone', error:''}|null(实时记住回执),
 *                 interrupted:boolean(历史装载的「未完成/待确认」轮，仅回看标识用),
 *                 fromHistory:boolean }
 *
 * ReActStep（来自 SSE step 事件，按 no 去重更新）：
 *  { no, type, bizName, status:'running|success|failed', latencyMs, observationBrief }
 */
export const useChatStore = defineStore('chat', () => {
  const sessionId = ref(null)
  const messages = ref([])
  const sending = ref(false)

  // 当前生效岗位（@ 切换后变化），用于发送 positionId 与气泡身份标识
  const activePosition = ref(null) // { positionId, name, avatar, jobTag }

  let seq = 0
  let aborter = null

  function reset() {
    sessionId.value = null
    messages.value = []
    sending.value = false
    activePosition.value = null
    if (aborter) {
      aborter.abort()
      aborter = null
    }
  }

  // 装载一个已有会话（对话记录页「继续对话」用）
  function loadSession({ id, msgs = [], position = null }) {
    sessionId.value = id
    messages.value = msgs
    activePosition.value = position
    seq = msgs.length
  }

  function setActivePosition(position) {
    activePosition.value = position
  }

  function nextId() {
    return `m_${Date.now()}_${seq++}`
  }

  // 当前回复气泡（流式写入目标）
  function currentAssistant() {
    return messages.value[messages.value.length - 1]
  }

  // 追加/更新一条 ReAct 步骤（按 no 去重 running→success/failed）
  function applyStep(target, step) {
    const idx = target.steps.findIndex((s) => s.no === step.no)
    if (idx === -1) target.steps.push({ ...step })
    else target.steps[idx] = { ...target.steps[idx], ...step }
  }

  // 组装 SSE handlers，复用给首发与确认续跑。
  // isNewSessionTurn：本轮是否为「新会话首轮」（发送前 sessionId 为空）。
  //   仅首轮在 done 后补刷一次会话列表，把 LLM 异步生成的标题反映到顶栏与侧栏；
  //   非首轮不补刷（标题已定，省一次请求）。确认续跑恒为 false（必发生在已有会话内）。
  function buildHandlers(assistant, resolve, isNewSessionTurn = false) {
    return {
      onSession(data) {
        if (data?.sessionId) sessionId.value = data.sessionId
        if (data?.positionId != null) assistant.positionId = data.positionId
      },
      onRoute(data) {
        // 分类三路分流弱提示：simple/knowledge/task，未知值不写入（UI 兜底不显示）
        const r = data?.route
        if (r === 'simple' || r === 'knowledge' || r === 'task') {
          assistant.route = r
        }
      },
      onStep(step) {
        applyStep(assistant, step)
      },
      onMemorySaved(data) {
        // 实时记住回执：summary + items（带 id 供逐条撤销）
        const items = Array.isArray(data?.items) ? data.items : []
        if (!data?.summary && items.length === 0) return
        assistant.memory = {
          summary: data?.summary || '已记住',
          items,
          state: 'saved',
          error: ''
        }
      },
      onAttachment(data) {
        // 生成物卡片（done 之前逐件下发）：push 进当前 assistant 气泡的 attachments，即时显示。
        // 兜底：无效/无 name 的载荷忽略，避免渲染空卡。
        if (!data || typeof data !== 'object' || !data.name) return
        if (!Array.isArray(assistant.attachments)) assistant.attachments = []
        assistant.attachments.push(data)
      },
      onConfirm(data) {
        // 弹二次确认卡片，暂停等待用户
        assistant.confirm = { confirmToken: data.confirmToken, summary: data.summary }
        assistant.streaming = false
        sending.value = false
        resolve?.()
      },
      onDelta(data) {
        const text = typeof data === 'string' ? data : data?.text || ''
        assistant.content += text
      },
      onDone(data) {
        if (data?.messageId != null) assistant.messageId = data.messageId
        if (data?.traceSummary) assistant.traceSummary = data.traceSummary
        if (data?.sessionId) sessionId.value = data.sessionId
        // 收尾：仍 running 的步骤不臆断成功；若整轮无 error 则收为中性「已结束」态，
        // 否则保持原状（由 onError 负责标 failed），避免把未确认结果的步骤误标 success
        const hasError = assistant.error || assistant.steps.some((s) => s.status === 'failed')
        assistant.steps.forEach((s) => {
          if (s.status === 'running') s.status = hasError ? s.status : 'done'
        })
        assistant.streaming = false
        sending.value = false
        resolve?.()
        // 新会话首轮收尾后补刷会话列表：LLM 异步改写的标题通常慢于 onSession 那次 refresh，
        // 此处再拉一次让新标题响应式反映到顶栏 + 侧栏历史。失败静默，不影响对话（已 resolve）。
        // 兜底：极快回答场景下这次「立即补刷」可能早于 LLM 标题落库（后端异步改写有 ~3s 超时），
        // 故再排一次「延迟补刷」（单次 setTimeout，无堆积），确保异步标题刷到顶栏与侧栏。
        if (isNewSessionTurn) {
          try {
            useSessionStore().refresh()
          } catch (e) {
            /* 补刷失败静默：标题保持旧值，不打断对话 */
          }
          setTimeout(() => {
            try {
              useSessionStore().refresh()
            } catch (e) {
              /* 延迟补刷失败静默：不影响对话 */
            }
          }, 3500)
        }
      },
      onError(data) {
        assistant.error = true
        assistant.streaming = false
        // 错误中文化：只展示可理解说明，不暴露 code/堆栈
        if (!assistant.content) {
          assistant.content = friendlyError(data)
        }
        assistant.steps.forEach((s) => {
          if (s.status === 'running') s.status = 'failed'
        })
        sending.value = false
        resolve?.()
      }
    }
  }

  /**
   * 发送一条消息（流式）。
   * @param {string} text
   * @param {Object} position 当前生效岗位 { positionId, name, avatar }，可空则用主绑定
   * @param {Object} opt { switched:boolean } 是否为 @ 切换后的首条（用于切换分隔标识）
   */
  async function send(text, position, opt = {}) {
    const content = (text || '').trim()
    if (!content || sending.value) return

    if (position) activePosition.value = position
    const eff = activePosition.value || {}

    messages.value.push({
      id: nextId(),
      role: 'user',
      content,
      positionId: eff.positionId ?? null
    })

    const assistant = {
      id: nextId(),
      role: 'assistant',
      positionId: eff.positionId ?? null,
      positionName: eff.name || '',
      positionAvatar: eff.avatar || null,
      positionTag: eff.jobTag || null,
      content: '',
      steps: [],
      traceSummary: '',
      attachments: [],
      streaming: true,
      error: false,
      confirm: null,
      route: null,
      memory: null,
      messageId: null,
      switchedFrom: opt.switched ? eff : null
    }
    messages.value.push(assistant)
    sending.value = true

    // 新会话首轮判定：发送前 sessionId 为空 ⇒ 本轮由后端创建新会话。
    // 据此在 onDone 决定是否补刷会话列表，拉取 LLM 异步生成的会话标题。
    const isNewSessionTurn = sessionId.value == null

    aborter = new AbortController()
    const signal = aborter.signal
    await new Promise((resolve) => {
      // 中断兜底：stop/reset 触发 abort 时 openSse 静默 return，不回调任何 handler，
      // 故把 resolve 也挂到 abort 信号上，确保 await 能 settle（Promise 只 settle 一次，
      // 与 onDone/onError 竞争安全）
      signal.addEventListener('abort', resolve, { once: true })
      streamChat(
        {
          sessionId: sessionId.value,
          positionId: eff.positionId ?? null,
          message: content,
          confirmToken: null
        },
        buildHandlers(assistant, resolve, isNewSessionTurn),
        signal
      )
    })
  }

  /**
   * 二次确认续跑。target 为携带 confirm 的 assistant 气泡。
   * approved=true 续跑提交；false 让专家据 SOP 调整后继续。
   * @param {string} [userAnswer] 可选备注/改单意图（item3）：透传后端 confirm，缺省=不传（行为不变）。
   *   取消时尤其有用（如「金额改成5000再提交」，模型据此续接）。
   */
  async function confirm(target, approved, userAnswer) {
    if (!target?.confirm) return
    // sessionId 兜底：续跑必须绑定有效会话，为 null 时不静默发出，提示重试
    if (sessionId.value == null) {
      ElMessage.warning('会话未就绪，请重试')
      return
    }
    const token = target.confirm.confirmToken
    target.confirm = null
    target.streaming = true
    target.error = false
    sending.value = true

    // 备注空白则不传（后端缺省 = null，行为不变）；非空裁剪后透传
    const trimmed = typeof userAnswer === 'string' ? userAnswer.trim() : ''
    const payload = { sessionId: sessionId.value, confirmToken: token, approved }
    if (trimmed) payload.userAnswer = trimmed

    aborter = new AbortController()
    const signal = aborter.signal
    await new Promise((resolve) => {
      // 同 send：中断路径让 resolve 也挂到 abort 信号，避免 await 永久 pending
      signal.addEventListener('abort', resolve, { once: true })
      confirmChat(payload, buildHandlers(target, resolve), signal)
    })
  }

  /**
   * 撤销「已记住」回执：对每个 items[].id 逐个调用用户态 DELETE /api/memory/items/{id}。
   * 全部成功 → state='undone'；部分/全部失败 → 保持 'saved' 并回填 error 提示重试。
   * 撤销本身是恢复性操作，无需二次确认；成功/失败均给反馈。
   * @param {Object} target 携带 memory 的 assistant 气泡
   */
  async function undoMemory(target) {
    const mem = target?.memory
    if (!mem || mem.state === 'undone' || mem.state === 'undoing') return
    const items = mem.items || []
    if (items.length === 0) {
      mem.state = 'undone'
      return
    }
    mem.state = 'undoing'
    mem.error = ''

    const results = await Promise.allSettled(
      items.map((it) => deleteMemoryItem(it.id))
    )
    const failed = results.filter((r) => r.status === 'rejected').length

    if (failed === 0) {
      mem.state = 'undone'
      ElMessage.success('已撤销')
    } else {
      // 部分/全部失败：回到可重试态，提示失败条数（撤销是幂等的，可再次点击重试）
      mem.state = 'saved'
      mem.error =
        failed === items.length
          ? '撤销失败，请稍后重试'
          : `部分撤销失败（${failed}/${items.length}），请重试`
      ElMessage.warning(mem.error)
    }
  }

  // 停止生成
  function stop() {
    if (aborter) {
      aborter.abort()
      aborter = null
    }
    const a = currentAssistant()
    if (a && a.streaming) {
      a.streaming = false
      a.steps.forEach((s) => {
        if (s.status === 'running') s.status = 'failed'
      })
      if (!a.content) a.content = '已停止生成。'
    }
    sending.value = false
  }

  // 重试：移除失败的回复气泡 + 其对应的用户消息，用「原专家」重发
  async function retry(target) {
    // 历史装载的失败气泡禁止重试：splice 会误删历史问答对（CR5 由 UI 隐藏入口，此处再兜一层）
    if (target?.fromHistory) return
    const idx = messages.value.indexOf(target)
    if (idx <= 0) return
    const userMsg = messages.value[idx - 1]
    const text = userMsg?.role === 'user' ? userMsg.content : ''
    // 用失败气泡的原岗位重发（用户可能已 @ 切换，不能用当前 activePosition）
    const origPosition =
      target.positionId != null
        ? {
            positionId: target.positionId,
            name: target.positionName,
            avatar: target.positionAvatar,
            jobTag: target.positionTag
          }
        : activePosition.value
    // 移除失败 assistant 与触发它的 user 消息
    messages.value.splice(idx - 1, 2)
    if (text) await send(text, origPosition)
  }

  return {
    sessionId,
    messages,
    sending,
    activePosition,
    reset,
    loadSession,
    setActivePosition,
    send,
    confirm,
    undoMemory,
    stop,
    retry
  }
})

// 错误友好中文化：屏蔽工具名/入参/错误码/堆栈
function friendlyError(data) {
  const code = data?.code
  if (code === 401) return '登录已失效，请重新登录。'
  // 未绑定专家（EXPERT_NOT_BOUND）：已由 SSE 错误路径收口跳 BindPosition，此处给一句克制文案
  if (code === 1001) return '请先选择并绑定搭子后再使用。'
  if (code === 1000 && /确认|token/i.test(data?.message || '')) {
    return '该确认已失效，请重新发起。'
  }
  if (code === 2000) return '智能服务暂时繁忙，请稍后重试。'
  return '抱歉，处理时出现问题，请稍后重试。'
}
