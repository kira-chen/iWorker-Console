<script setup>
import { ref, reactive, nextTick, onMounted, computed, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { useUserPositionStore } from '@/stores/userPosition'
import { useUserStore } from '@/stores/user'
import { useSessionStore } from '@/stores/session'
import { listAtPositions } from '@/api/chat'
import ReActSteps from '@/components/ReActSteps.vue'
import AttachmentCard from '@/components/AttachmentCard.vue'
import RouteChip from '@/components/RouteChip.vue'
import MemoryReceiptCard from '@/components/MemoryReceiptCard.vue'
import PositionAvatarStack from '@/components/PositionAvatarStack.vue'

// 懒加载：md-editor-v3 的只读预览器体积较大，异步加载避免增重对话首屏。
const ChatMarkdown = defineAsyncComponent(() => import('@/components/ChatMarkdown.vue'))

const route = useRoute()
const router = useRouter()
const chatStore = useChatStore()
const positionStore = useUserPositionStore()
const userStore = useUserStore()
const sessionStore = useSessionStore()

const { messages, sending, activePosition } = storeToRefs(chatStore)

// 新会话创建联动：首条消息由后端生成新 sessionId（从空 → 有值）时刷新侧栏会话列表，
// 使这条新会话立即出现在侧栏「今天」组。仅在「空 → 新 id」时刷新（载入历史会话是
// History→Chat 由 sessionStore.openInChat 主动设置 id，此处用 prev 判空避免重复刷新；
// 同一会话内后续轮次 id 不变，watch 不触发，无死循环风险）。
const { sessionId } = storeToRefs(chatStore)
watch(sessionId, (id, prev) => {
  if (id && !prev) sessionStore.refresh()
})

// 左上角当前会话主题：在已加载的会话列表里按 sessionId 找到对应会话取其 title。
// 响应式：sessionStore.refresh() 刷新列表后（首条消息生成 title）自动反映；
// 列表暂无该会话（刚创建/未刷新）时兜底「新对话」，不显示 undefined、不报错。
const sessionTitle = computed(() => {
  const id = sessionId.value
  if (!id) return '新对话'
  const sess = sessionStore.list.find((s) => s.sessionId === id)
  return sess?.title || '新对话'
})

// 本会话「被发起过 query 的岗位」头像堆叠：
// 数据派生自 messages 里每条自带的 positionId（user/assistant 均带；历史会话经 openInChat
// 装载后同样携带 positionId），按各自首次出现顺序取 distinct。此方案对「当前活跃会话」与
// 「打开的历史会话」均能正确还原堆叠（不依赖额外 store 数组）。
// 岗位详情按 id 从 positionStore.positions + currentPosition 解析（onMounted 已确保 fetchPositions）。
function resolvePosition(id) {
  if (id == null) return null
  const fromList = positionStore.positions.find((e) => e.id === id)
  if (fromList) return fromList
  const cur = positionStore.currentPosition
  if (cur && cur.id === id) return cur
  // 列表未命中（极端：列表未加载/被下架）→ 用消息自带的轻量身份兜底，至少展示头像与名
  const msg = messages.value.find((m) => m.positionId === id && (m.positionName || m.positionAvatar))
  if (msg) {
    return { id, name: msg.positionName || '', avatar: msg.positionAvatar || null, jobTag: msg.positionTag || '' }
  }
  return { id, name: '', avatar: null, jobTag: '' }
}

const sessionPositions = computed(() => {
  const seen = new Set()
  const ordered = []
  for (const m of messages.value) {
    const id = m?.positionId
    if (id == null || seen.has(id)) continue
    seen.add(id)
    ordered.push(resolvePosition(id))
  }
  return ordered.filter(Boolean)
})

const input = ref('')
const listRef = ref()
const inputRef = ref()

// 当前生效专家：store.activePosition（含 @ 切换）→ 主绑定专家回退（数据驱动）
const effectivePosition = computed(
  () => activePosition.value || positionStore.currentPosition || null
)
const positionId = computed(
  () => effectivePosition.value?.positionId ?? effectivePosition.value?.id ?? userStore.userInfo?.boundPositionId ?? null
)
const positionName = computed(() => effectivePosition.value?.name || '我的搭子')
const positionTag = computed(() => effectivePosition.value?.jobTag || '你的搭子')
const positionAvatar = computed(() => effectivePosition.value?.avatar || null)

// 已 @ 切换到的「非默认」搭子：仅当 activePosition 存在且不同于当前绑定的搭子时呈现（驱动输入框内标签）
const switchedPosition = computed(() => {
  const a = activePosition.value
  if (!a) return null
  const boundId = positionStore.currentPosition?.id ?? userStore.userInfo?.boundPositionId ?? null
  const aId = a.positionId ?? a.id ?? null
  if (boundId != null && aId != null && String(aId) === String(boundId)) return null
  return a
})

// 欢迎语降级（设计 §2.6，用户拍板）：开场白（welcome）已退役，聊天页欢迎语统一走通用兜底文案，
// 不再读 welcome（DB 列与 view.fields.welcome 仍保留留痕，仅前端不再消费）。
const welcome = computed(() => '你好，有什么可以帮你办的？直接一句话告诉我即可。')

function avatarChar(name) {
  return (name || '专')[0]
}

async function scrollToBottom() {
  await nextTick()
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}
watch(messages, scrollToBottom, { deep: true })

// ---------- @ 切换专家 ----------
const atVisible = ref(false)
const atKeyword = ref('')
const atList = ref([])
const atLoading = ref(false)
const atActiveIdx = ref(0)
let atSwitched = false // 标记下一条消息为切换后的首条

async function fetchAtList() {
  atLoading.value = true
  try {
    atList.value = (await listAtPositions(atKeyword.value)) || []
  } catch (e) {
    atList.value = []
  } finally {
    atLoading.value = false
    atActiveIdx.value = 0
  }
}

// 监听输入：检测末尾 @关键词 触发下拉
function onInput(val) {
  const m = /@([^@\s]*)$/.exec(val || '')
  if (m) {
    atKeyword.value = m[1]
    if (!atVisible.value) {
      atVisible.value = true
      fetchAtList()
    } else {
      fetchAtList()
    }
  } else {
    atVisible.value = false
  }
}

function pickAtPosition(exp) {
  // 去掉输入框尾部的 @关键词
  input.value = input.value.replace(/@([^@\s]*)$/, '')
  atVisible.value = false
  chatStore.setActivePosition({
    positionId: exp.positionId,
    name: exp.name,
    avatar: exp.avatar,
    jobTag: exp.jobTag,
    personalized: exp.personalized
  })
  atSwitched = true
  // 不再弹浮窗提示；切换结果由输入框内的常驻标签（switchedPosition）呈现
  nextTick(() => inputRef.value?.focus())
}

// 清除 @ 切换，回到默认绑定的搭子
function clearSwitchedPosition() {
  chatStore.setActivePosition(null)
  atSwitched = false
  nextTick(() => inputRef.value?.focus())
}

function onAtKeydown(e) {
  if (!atVisible.value || atList.value.length === 0) return false
  if (e.key === 'ArrowDown') {
    atActiveIdx.value = (atActiveIdx.value + 1) % atList.value.length
    e.preventDefault()
    return true
  }
  if (e.key === 'ArrowUp') {
    atActiveIdx.value = (atActiveIdx.value - 1 + atList.value.length) % atList.value.length
    e.preventDefault()
    return true
  }
  if (e.key === 'Enter') {
    pickAtPosition(atList.value[atActiveIdx.value])
    e.preventDefault()
    return true
  }
  if (e.key === 'Escape') {
    atVisible.value = false
    e.preventDefault()
    return true
  }
  return false
}

// ---------- 发送 ----------
function onEnter(e) {
  // @ 下拉打开时 Enter 用于选择专家
  if (onAtKeydown(e)) return
  handleSend()
}

async function handleSend() {
  const text = input.value.trim()
  if (!text || sending.value) return
  if (!positionId.value) {
    ElMessage.warning('尚未确定响应的搭子，请先绑定搭子')
    return
  }
  input.value = ''
  atVisible.value = false
  const switched = atSwitched
  atSwitched = false
  const exp = {
    positionId: positionId.value,
    name: positionName.value,
    avatar: positionAvatar.value,
    jobTag: positionTag.value
  }
  await chatStore.send(text, exp, { switched })
}

function stopGen() {
  chatStore.stop()
}

function retry(m) {
  chatStore.retry(m)
}

// ---------- 复制回复 / 用户消息 ----------
// DeepSeek 风格操作条：复制纯文本正文（m.content），给出轻量反馈。
// 优先用异步 Clipboard API；不可用（非安全上下文 / 旧浏览器）时回退 execCommand。
async function copyMessage(m) {
  const text = m?.content || ''
  if (!text) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success('已复制')
  } catch (e) {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

// ---------- 二次确认 ----------
// 每个确认卡的备注输入（按 assistant 气泡 id 隔离，避免多卡互串）
const confirmNotes = reactive({})

async function onConfirm(m, approved) {
  const note = confirmNotes[m.id] || ''
  // 提交前清掉本卡备注（confirm 会清 m.confirm 使卡消失，这里同步清理输入态）
  delete confirmNotes[m.id]
  await chatStore.confirm(m, approved, note)
}

// ---------- 记忆回执撤销 ----------
async function onUndoMemory(m) {
  await chatStore.undoMemory(m)
}

// ---------- 定时任务入口（Sprint1 占位） ----------
function openTaskPlaceholder() {
  ElMessageBox.alert(
    '定时任务可让搭子按周期自动帮你办事（如「每周一 9:00 汇总上周考勤」）。完整功能将于后续版本（S3）开放。',
    '创建定时任务',
    { confirmButtonText: '我知道了', type: 'info' }
  ).catch(() => {})
}

// 加载主绑定专家信息（头像/名称）
async function ensurePosition() {
  try {
    if (positionStore.positions.length === 0) await positionStore.fetchPositions()
    const bound = positionStore.positions.find((e) => e.id === userStore.userInfo?.boundPositionId)
    if (bound) {
      positionStore.setCurrentPosition(bound)
      if (!activePosition.value) {
        chatStore.setActivePosition({
          positionId: bound.id,
          name: bound.name,
          avatar: bound.avatar,
          jobTag: bound.jobTag
        })
      }
    }
  } catch (e) {
    /* 静默：不影响对话 */
  }
}

// 「搭子市场」入口：带 query { positionId, new:1 } 进入 → 每次都新开一个会话，
// 以该岗位为本会话提问对象。复用 chatStore.reset + setActivePosition（不另造发送链路）。
// 处理后清掉 query，避免组件复用 / 刷新时重复触发。
async function startNewSessionWithPosition(rawId) {
  // 岗位 id 已字符串化（ps_*），不可 Number()（字符串 id → NaN → isFinite 守卫直接 return，市场入口静默失效）。
  // 原样字符串透传（与本文件 60/160/222/297 行把 positionId 当字符串用一致）；仅做空值判断。
  const id = rawId
  if (id == null || id === '') return
  // 确保岗位列表已加载，以解析目标岗位展示信息
  if (positionStore.positions.length === 0) {
    try {
      await positionStore.fetchPositions()
    } catch (e) {
      /* 静默：解析失败下面走兜底身份 */
    }
  }
  const target =
    positionStore.positions.find((e) => e.id === id) ||
    (positionStore.currentPosition?.id === id ? positionStore.currentPosition : null)

  chatStore.reset()
  chatStore.setActivePosition({
    positionId: id,
    name: target?.name || '',
    avatar: target?.avatar || null,
    jobTag: target?.jobTag || ''
  })
}

function consumePositionQuery() {
  const { positionId: qPositionId, new: qNew } = route.query
  if (!qPositionId || qNew !== '1') return false
  startNewSessionWithPosition(qPositionId)
  // 清 query（保留路由 name），避免刷新/复用重复触发
  router.replace({ name: 'Chat' })
  return true
}

// 组件保持挂载时再次带 query 进入（OtherPositions → Chat）也要响应
watch(
  () => route.query,
  () => {
    if (route.name === 'Chat') consumePositionQuery()
  }
)

onMounted(async () => {
  await ensurePosition()
  // 优先处理「搭子市场」新会话 query；命中则跳过历史/兜底欢迎流程
  if (consumePositionQuery()) return
  if (messages.value.length > 0) scrollToBottom()
})
</script>

<template>
  <div class="chat-page">
    <!-- 顶栏（DeepSeek 风极简）：仅展示当前会话主题（岗位详情入口移至设置/个性化路由） -->
    <div class="chat-header">
      <div class="chat-header-inner chat-col">
        <div class="chat-title" :title="sessionTitle">{{ sessionTitle }}</div>
        <!-- 本会话被发起过 query 的岗位头像堆叠（按首次出现序）；hover 出信息卡，点击无切换 -->
        <PositionAvatarStack v-if="sessionPositions.length" :positions="sessionPositions" />
      </div>
    </div>

    <!-- 消息流 -->
    <div ref="listRef" class="chat-list">
      <div class="chat-col">
        <!-- 空态：欢迎语 -->
        <div v-if="messages.length === 0" class="welcome">
          <el-avatar :size="56" :src="positionAvatar" class="wel-avatar">
            {{ avatarChar(positionName) }}
          </el-avatar>
          <div class="wel-title">{{ welcome }}</div>
          <div class="wel-hint">一句话告诉我你要办的事，我来帮你完成。</div>
        </div>

        <template v-for="(m, i) in messages" :key="m.id || i">
          <!-- @ 切换分隔条 -->
          <div v-if="m.role === 'assistant' && m.switchedFrom" class="switch-divider">
            <span class="line"></span>
            <span class="switch-text">已切换至 {{ m.positionName || m.switchedFrom.name }}</span>
            <span class="line"></span>
          </div>

          <!-- 用户消息：靠右浅灰圆角气泡，无头像；hover 出现复制 -->
          <div v-if="m.role === 'user'" class="msg msg-user">
            <div class="user-block">
              <div class="user-bubble">{{ m.content }}</div>
              <div class="user-tools">
                <button class="act-btn" type="button" title="复制" @click="copyMessage(m)">
                  <el-icon><CopyDocument /></el-icon>
                </button>
              </div>
            </div>
          </div>

          <!-- AI 回复：无头像、无气泡，正文全栏宽直接渲染 -->
          <div v-else class="msg msg-assistant">
            <!-- 专家名标识（数据驱动溯源） + 分流弱提示标签 -->
            <div
              v-if="m.positionName || m.route"
              class="msg-speaker"
            >
              <span v-if="m.positionName">{{ m.positionName }}</span>
              <RouteChip v-if="m.route" :route="m.route" />
            </div>

            <!-- ReAct 思考过程（「已思考」折叠块，流式点亮，默认折叠） -->
            <ReActSteps
              :steps="m.steps"
              :trace-summary="m.traceSummary"
              :streaming="m.streaming"
            />

            <!-- 处理中骨架（尚无正文与步骤时） -->
            <div
              v-if="m.streaming && !m.content && (!m.steps || m.steps.length === 0)"
              class="thinking"
            >
              <el-icon class="loading-icon"><Loading /></el-icon> 正在处理中…
            </div>

            <!-- 中断/待确认轮的明确标识（历史回看）：避免被误读为「已办成」 -->
            <div
              v-if="m.interrupted"
              class="msg-status-tag is-interrupted"
            >
              <el-icon><WarningFilled /></el-icon>
              <span>未完成 · 待确认（该事项尚未办成）</span>
            </div>

            <!-- 中断轮且无正文：给占位说明而非空气泡 -->
            <div
              v-if="m.interrupted && !m.content"
              class="ai-note is-interrupted-empty"
            >
              这轮在等你确认时中断了，事项尚未办成。可在下方重新发起。
            </div>

            <!-- 正文：助手「回答正文」走 Markdown 全宽渲染；错误态保持轻量红框纯文本 -->
            <div
              v-else-if="m.content"
              class="ai-body"
              :class="{ 'is-error': m.error }"
            >
              <ChatMarkdown
                v-if="!m.error"
                :content="m.content"
              />
              <template v-else>{{ m.content }}</template>
              <span v-if="m.streaming" class="caret">▍</span>
            </div>

            <!-- 生成物卡片 -->
            <AttachmentCard
              v-for="(att, ai) in m.attachments || []"
              :key="ai"
              :attachment="att"
            />

            <!-- 「已记住」回执卡（实时记忆抽取成功后下发） -->
            <MemoryReceiptCard
              v-if="m.memory"
              :memory="m.memory"
              @undo="onUndoMemory(m)"
            />

            <!-- 二次确认卡片 -->
            <div v-if="m.confirm" class="confirm-card">
              <div class="confirm-head">
                <el-icon><WarningFilled /></el-icon> 请确认操作
              </div>
              <div class="confirm-body">{{ m.confirm.summary }}</div>
              <!-- 可选备注/改单意图（item3）：随确认/取消透传给后端 userAnswer -->
              <el-input
                v-model="confirmNotes[m.id]"
                class="confirm-note"
                type="textarea"
                :rows="2"
                :maxlength="2000"
                resize="none"
                placeholder="可补充说明，例如：金额改成5000再提交（可选）"
              />
              <div class="confirm-actions">
                <el-button @click="onConfirm(m, false)">取消</el-button>
                <el-button type="primary" @click="onConfirm(m, true)">确认提交</el-button>
              </div>
            </div>

            <!-- 失败重试（历史装载的失败气泡不显示，避免误删历史问答对） -->
            <div v-if="m.error && !m.streaming && !m.fromHistory" class="retry-row">
              <el-button link type="primary" @click="retry(m)">
                <el-icon><RefreshRight /></el-icon> 重试
              </el-button>
            </div>

            <!-- 操作条：回复完成（非流式 / 非错误）且有正文时，复制 / 重新生成 -->
            <div
              v-if="m.content && !m.streaming && !m.error"
              class="ai-actions"
            >
              <button class="act-btn" type="button" title="复制" @click="copyMessage(m)">
                <el-icon><CopyDocument /></el-icon>
              </button>
              <button
                v-if="!m.fromHistory"
                class="act-btn"
                type="button"
                title="重新生成"
                @click="retry(m)"
              >
                <el-icon><RefreshRight /></el-icon>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 输入区（DeepSeek 风：底部大圆角浮起容器） -->
    <div class="chat-input">
      <div class="chat-col">
        <div class="composer">
          <!-- @ 专家下拉（浮在输入容器上方） -->
          <transition name="at-pop">
            <div v-if="atVisible" class="at-dropdown">
              <div v-if="atLoading" class="at-loading">加载中…</div>
              <div v-else-if="atList.length === 0" class="at-empty">未找到匹配的搭子</div>
              <ul v-else class="at-list">
                <li
                  v-for="(exp, idx) in atList"
                  :key="exp.positionId"
                  class="at-item"
                  :class="{ active: idx === atActiveIdx }"
                  @mouseenter="atActiveIdx = idx"
                  @mousedown.prevent="pickAtPosition(exp)"
                >
                  <el-avatar :size="28" :src="exp.avatar">{{ avatarChar(exp.name) }}</el-avatar>
                  <div class="at-meta">
                    <span class="at-name">{{ exp.name }}</span>
                    <span v-if="exp.jobTag" class="at-tag">{{ exp.jobTag }}</span>
                  </div>
                  <span v-if="exp.personalized" class="at-flag">已个性化</span>
                </li>
              </ul>
            </div>
          </transition>

          <el-input
            ref="inputRef"
            v-model="input"
            class="composer-input"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 8 }"
            resize="none"
            maxlength="4000"
            placeholder="一句话告诉你的搭子要办的事；输入 @ 可切换搭子。Enter 发送，Shift+Enter 换行"
            @input="onInput"
            @keydown.enter.exact.prevent="onEnter"
            @keydown.up="onAtKeydown"
            @keydown.down="onAtKeydown"
            @keydown.esc="onAtKeydown"
          />

          <div class="composer-bar">
            <div class="bar-left">
              <!-- @ 切换后的常驻标签：提示本条消息将发给哪个搭子，点 × 回到默认搭子 -->
              <span v-if="switchedPosition" class="switch-chip" :title="`已切换至 ${switchedPosition.name || '该搭子'}`">
                <el-avatar :size="18" :src="switchedPosition.avatar" class="switch-chip-avatar">
                  {{ avatarChar(switchedPosition.name) }}
                </el-avatar>
                <span class="switch-chip-text">已切换至 {{ switchedPosition.name || '该搭子' }}</span>
                <button
                  class="switch-chip-close"
                  type="button"
                  title="取消切换，回到默认搭子"
                  @click="clearSwitchedPosition"
                >
                  <el-icon><Close /></el-icon>
                </button>
              </span>
              <button class="pill-btn" type="button" @click="openTaskPlaceholder">
                <el-icon><Timer /></el-icon>
                <span>创建定时任务</span>
              </button>
            </div>
            <div class="bar-right">
              <el-button
                v-if="sending"
                class="send-btn"
                circle
                title="停止生成"
                @click="stopGen"
              >
                <el-icon><VideoPause /></el-icon>
              </el-button>
              <el-button
                v-else
                class="send-btn"
                type="primary"
                circle
                :disabled="!input.trim()"
                title="发送"
                @click="handleSend"
              >
                <el-icon><Top /></el-icon>
              </el-button>
            </div>
          </div>
        </div>

        <!-- 免责声明 -->
        <div class="disclaimer">内容由 AI 生成，请仔细甄别</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* DeepSeek 风格对话页：干净留白、居中可读栏、AI 全宽正文、用户灰气泡、浮起输入框 */
.chat-page {
  display: flex;
  flex-direction: column;
  /* 侧栏布局取消了顶部 header，主区仅余 .main 的上下 padding（var(--space-5)*2=40px） */
  height: calc(100vh - 40px);
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

/* 居中可读栏：消息流与输入框共用同一栏宽，左右对齐 */
.chat-col {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

/* 顶栏（极简通栏，内层对齐居中栏）：仅当前会话主题 */
.chat-header {
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.chat-header-inner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
/* 左上角当前会话主题（对标 DeepSeek 顶栏标题） */
.chat-title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6) var(--space-5);
}

/* 空态欢迎 */
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-12) var(--space-5);
  gap: var(--space-3);
}
.wel-avatar {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}
.wel-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  max-width: 560px;
}
.wel-hint {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

/* 切换分隔条 */
.switch-divider {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-4) 0;
}
.switch-divider .line {
  flex: 1;
  height: 1px;
  background: var(--border-soft);
}
.switch-text {
  font-size: var(--fs-xs);
  color: var(--c-accent);
  background: var(--c-accent-soft);
  padding: 2px 12px;
  border-radius: var(--radius-pill);
}

/* ---------- 消息通用 ---------- */
.msg {
  margin-bottom: var(--space-6);
  animation: rise-in var(--dur-base) var(--ease-out) both;
}

/* ---------- 用户消息：靠右浅灰圆角气泡，无头像 ---------- */
.msg-user {
  display: flex;
  justify-content: flex-end;
}
.user-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: 80%;
  min-width: 0;
}
.user-bubble {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xl);
  background: var(--bg-active);
  color: var(--c-text-strong);
  line-height: var(--lh-base);
  white-space: pre-wrap;
  word-break: break-word;
}
.user-tools {
  display: flex;
  gap: var(--space-1);
  margin-top: var(--space-1);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.user-block:hover .user-tools {
  opacity: 1;
}

/* ---------- AI 回复：无头像、无气泡，正文全栏宽 ---------- */
.msg-assistant {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.msg-speaker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
}
/* RouteChip 自带 margin-bottom 供独立使用；置于 speaker 行内时抵消，保持基线对齐 */
.msg-speaker :deep(.route-chip) {
  margin-bottom: 0;
}

/* AI 正文：直接渲染在背景上，左对齐全宽 */
.ai-body {
  color: var(--c-text);
  line-height: var(--lh-base);
  word-break: break-word;
}
.ai-body .caret {
  margin-left: 2px;
}
/* 错误态：轻量红框纯文本（区别于成功正文） */
.ai-body.is-error {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--c-danger-soft);
  border: 1px solid var(--c-danger);
  color: var(--c-danger);
  white-space: pre-wrap;
}

/* AI 轻量说明块（中断占位等） */
.ai-note {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  line-height: var(--lh-base);
}
.ai-note.is-interrupted-empty {
  background: var(--c-warning-soft);
  border: 1px solid var(--c-warning);
  color: var(--c-text-muted);
  font-style: italic;
}

/* 中断/待确认轮：告警色标识，区别于成功回复 */
.msg-status-tag.is-interrupted {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--c-warning);
  background: var(--c-warning-soft);
  border: 1px solid var(--c-warning);
  align-self: flex-start;
}
.caret {
  color: var(--c-accent);
  animation: pulse 1s steps(2) infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* 处理中骨架 */
.thinking {
  color: var(--c-text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.loading-icon {
  animation: rotate 1s linear infinite;
  color: var(--c-accent);
}
@keyframes rotate {
  to { transform: rotate(360deg); }
}

/* 操作条：复制 / 重新生成（DeepSeek 风小图标按钮） */
.ai-actions {
  display: flex;
  gap: var(--space-1);
  margin-top: var(--space-2);
}
.act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--c-text-faint);
  cursor: pointer;
  font-size: var(--fs-base);
  transition: background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.act-btn:hover {
  background: var(--bg-hover);
  color: var(--c-text-strong);
}

/* 二次确认卡 */
.confirm-card {
  margin-top: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--c-warning);
  border-radius: var(--radius-md);
  background: var(--c-warning-soft);
}
.confirm-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--c-warning);
  font-weight: var(--fw-semibold);
  font-size: var(--fs-sm);
  margin-bottom: var(--space-2);
}
.confirm-body {
  color: var(--c-text-strong);
  line-height: var(--lh-base);
  margin-bottom: var(--space-3);
}
.confirm-note {
  margin-bottom: var(--space-3);
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.retry-row {
  margin-top: var(--space-1);
}

/* ---------- 输入区：底部大圆角浮起容器 ---------- */
.chat-input {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-5) var(--space-4);
  background: var(--bg-surface);
}
.composer {
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-xl);
  padding: var(--space-2) var(--space-3) var(--space-2);
  box-shadow: var(--shadow-md);
  transition: border-color var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}
.composer:focus-within {
  border-color: var(--c-accent);
  box-shadow: var(--shadow-md), 0 0 0 3px var(--c-accent-soft);
}
/* textarea 无边框，融入浮起容器 */
.composer-input :deep(.el-textarea__inner) {
  box-shadow: none !important;
  background: transparent;
  padding: var(--space-2) var(--space-2) 0;
  font-size: var(--fs-md);
  line-height: var(--lh-base);
}
.composer-input :deep(.el-textarea__inner):hover,
.composer-input :deep(.el-textarea__inner):focus {
  box-shadow: none !important;
}

.composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-1);
}
.bar-left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
/* 左下角 pill 功能按钮 */
.pill-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.pill-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
  color: var(--c-text-strong);
}
/* @ 切换后的常驻标签 */
.switch-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 240px;
  padding: 2px var(--space-1) 2px 2px;
  border: 1px solid var(--c-accent);
  border-radius: var(--radius-pill);
  background: var(--c-accent-soft);
  color: var(--c-accent);
  font-size: var(--fs-sm);
  line-height: 1;
}
.switch-chip-avatar {
  flex: 0 0 auto;
}
.switch-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.switch-chip-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}
.switch-chip-close:hover {
  opacity: 1;
  background: var(--c-accent-soft);
}
.bar-right {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}
/* 圆形发送/停止键 */
.send-btn {
  width: 34px;
  height: 34px;
  font-size: var(--fs-md);
}

/* 免责声明 */
.disclaimer {
  margin-top: var(--space-2);
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* @ 下拉（浮在输入容器上方） */
.at-dropdown {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + var(--space-2));
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  max-height: 260px;
  overflow-y: auto;
  z-index: var(--z-overlay);
}
.at-loading,
.at-empty {
  padding: var(--space-4);
  text-align: center;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.at-list {
  list-style: none;
  margin: 0;
  padding: var(--space-2);
}
.at-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.at-item.active {
  background: var(--bg-hover);
}
.at-item :deep(.el-avatar) {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  flex-shrink: 0;
}
.at-meta {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.at-name {
  color: var(--c-text-strong);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}
.at-tag {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-hover);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.at-flag {
  font-size: var(--fs-xs);
  color: var(--c-accent);
}
.at-pop-enter-active,
.at-pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.at-pop-enter-from,
.at-pop-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
