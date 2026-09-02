<script setup>
/**
 * 效果测试工作台（接真实链路）。
 *
 * FDE 配完技能 / 岗位后，就地「扮演终端用户」发一句话，只加载当前这个技能 / 岗位的数据，
 * 真跑标准办事链路（写工具被后端拦截、返回拟真成功，simulated:true 步骤角标提示）。
 * 走真实 SSE 端点 /api/fde/effect-test/stream | confirm（api/effectTest.js），不落会话、无 sessionId。
 *
 * 承载范式：复刻 PositionDataTableStage 的 .dt-editor（max-width min(96vw,1440px) 居中、--bg-elevated、
 * --radius-xl、--shadow-lg、dtsZoomIn 入场）；由宿主以 .focus-stage 浮层方式承载：列表页
 * （AdminSkills / AdminPositions）用 fixed inset:0 + --z-modal + var(--mask) 全屏浮层；白板工作台
 * （PositionWorkbench）用既有 position:absolute inset:0 + z-index:40、背后 .board blur 退场。
 *
 * 布局：左 300px 上下文栏「本次只加载的数据」 + 右弹性主区办事过程（复刻员工端 Chat 观感）。
 * 交互：多轮连续对话，过程区累积消息流；顶栏「重新测试」二次确认后清空回空态（左栏数据不变）。
 * 评估：每条 AI 结果末尾挂轻量评估区（通过 / 不通过 + 折叠备注），仅本地内存、不持久化、不调接口。
 */
import { ref, reactive, computed, nextTick, watch, onUnmounted, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ReActSteps from '@/components/ReActSteps.vue'
import RouteChip from '@/components/RouteChip.vue'
import ChatMarkdown from '@/components/ChatMarkdown.vue'
import IntakeFormFields from '@/components/intake/IntakeFormFields.vue'
import { buildIntakeModel, validateIntakeValues, normalizeIntakeValues, hasIntakeSchema } from '@/utils/intakeForm'
import { getPosition } from '@/api/position'
import { streamEffectTest, confirmEffectTest } from '@/api/effectTest'

const props = defineProps({
  // 'skill'：技能侧测试台；'position'：岗位侧测试台
  mode: { type: String, default: 'skill' },
  // Tab 内联模式（占位声明，避免未声明 prop 警告；效果测试链路由 EFFECT_TEST_ENABLED 控制）
  embedded: { type: Boolean, default: false },
  // 宿主已加载的技能对象（mode='skill'）；缺字段用兜底占位渲染左栏
  skill: { type: Object, default: () => ({}) },
  // 宿主已加载的岗位对象（mode='position'）；缺字段用兜底占位渲染左栏
  position: { type: Object, default: () => ({}) },
  // 真实链路必备 id（由宿主解析后传入）：positionId（两入口均必传）、skillId（技能入口传 baseSkillId）。
  positionId: { type: [Number, String], default: null },
  skillId: { type: [Number, String], default: null },
  // 技能入口为游离技能（未挂载岗位）时由宿主前置传入，禁用试跑并给友好提示。
  disabledReason: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const isSkill = computed(() => props.mode === 'skill')

// 真实链路：必须有 positionId 才能发起；技能入口游离技能（无宿主岗位）前置禁用。
const canRun = computed(() => props.positionId != null && !props.disabledReason)

/* ============================ 采集（intake）真实通路 ============================
 * 设计 §5.4：真链路按 JWT 注入 FDE 记忆，并需把宿主岗位采集字段值随每轮 stream 下传（intakeValues，键=key）。
 * schema 来源：props（岗位入口已带 intakeSchema）优先；技能入口走宿主岗位 GET /api/fde/positions/{id} 取 schema。
 * 仅复用解耦内核 IntakeFormFields（纯展示）+ intakeForm.js（纯函数），不碰 IntakeFormDialog（耦合领用 API）。
 */
// 宿主岗位真实采集 schema（区别于左栏展示用的 mock 占位；只有真实 schema 才参与收集/下传）。
const realIntakeSchema = ref(
  Array.isArray(props.position?.basic?.intakeSchema)
    ? props.position.basic.intakeSchema
    : Array.isArray(props.position?.intakeSchema)
      ? props.position.intakeSchema
      : []
)
const hasIntake = computed(() => hasIntakeSchema(realIntakeSchema.value))
// 已收集的采集值（键=field.key），每轮 stream 重发；confirm 续跑不带。
const intakeValues = ref(null)
const intakeCollected = ref(false)
// 采集表单弹窗态
const intakeFormVisible = ref(false)
const intakeModel = ref({})
const intakeErrors = ref({})

// 技能入口：props 通常不含岗位 intakeSchema → 按 positionId 拉宿主岗位详情补 schema（FDE 门可达）。
// 岗位入口 props 已带 schema 则不再拉。失败静默（无 schema = 不弹不传，行为不变）。
// 「已尝试拉取」标志位：拉过一次（无论结果空否）就不再每轮重复请求——避免真无采集字段的岗位每次 send 重复打 getPosition。
const intakeSchemaProbed = ref(false)
async function ensureIntakeSchema() {
  if (realIntakeSchema.value.length || intakeSchemaProbed.value) return
  if (props.positionId == null) return
  intakeSchemaProbed.value = true
  try {
    const detail = await getPosition(props.positionId)
    if (Array.isArray(detail?.intakeSchema)) realIntakeSchema.value = detail.intakeSchema
  } catch {
    /* 静默：拉不到 schema 视为无采集，不弹不传（已置 probed，不再重试） */
  }
}
onMounted(ensureIntakeSchema)

/* ============================ 左栏：本次只加载的数据（props 优先 + mock 兜底） ============================ */
// 工具健康态：normal / abnormal，渲染 ●正常 / ●异常
function normTools(raw, fallback) {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((t) => ({
      name: t.name || t.bizName || t.label || '未命名能力',
      health: t.health || (t.healthy === false ? 'abnormal' : 'normal')
    }))
  }
  return fallback
}

// 技能版左栏数据
const skillView = computed(() => {
  const s = props.skill || {}
  return {
    name: s.name || '提交请假申请',
    triggers: (Array.isArray(s.triggers) && s.triggers.length ? s.triggers : ['请假', '我要休假', '帮我提交年假']).slice(0, 8),
    tools: normTools(s.tools, [
      { name: '查假期余额', health: 'normal' },
      { name: '提交请假单', health: 'normal' },
      { name: '通知主管', health: 'abnormal' }
    ]),
    tables:
      Array.isArray(s.tables) && s.tables.length
        ? s.tables.map((t) => ({ name: t.label || t.name || '数据表', rows: t.recordCount ?? t.rows ?? 0 }))
        : [
            { name: '员工假期账户', rows: 128 },
            { name: '请假申请记录', rows: 642 }
          ]
  }
})

// 岗位版左栏数据
const positionView = computed(() => {
  const p = props.position || {}
  const basic = p.basic || p
  const agents = Array.isArray(p.agents) ? p.agents : null
  return {
    name: basic.name || '人力资源助理',
    persona: basic.persona || basic.intro || '亲和、严谨的 HR 同事，回答口吻温暖、专业，主动追问关键信息。',
    intakeCount: Array.isArray(basic.intakeSchema) ? basic.intakeSchema.length : (p.intakeCount ?? 2),
    intakeSchema:
      Array.isArray(basic.intakeSchema) && basic.intakeSchema.length
        ? basic.intakeSchema
        : [
            { key: 'empNo', label: '工号', required: true },
            { key: 'dept', label: '部门', required: false }
          ],
    agents:
      agents && agents.length
        ? agents.map((a) => ({
            name: a.name || 'Agent',
            skills: (a.skills || []).map((s) => s.name || '技能')
          }))
        : [
            { name: '考勤休假', skills: ['查假期余额', '提交请假申请', '查考勤记录'] },
            { name: '薪酬福利', skills: ['查工资条', '查公积金'] }
          ],
    tableCount: p.tableCount ?? (Array.isArray(p.tables) ? p.tables.length : 4),
    tools: normTools(p.tools, [
      { name: '查假期余额', health: 'normal' },
      { name: '提交请假单', health: 'normal' },
      { name: '查工资条', health: 'normal' },
      { name: '通知主管', health: 'abnormal' }
    ])
  }
})

const stageName = computed(() => (isSkill.value ? skillView.value.name : positionView.value.name))

// 左栏「采集字段」已填值展示：[{ label, text }]，未填显「未填」。仅真实 schema 才渲染收集态。
const intakeFilledList = computed(() => {
  if (!hasIntake.value) return []
  const vals = intakeValues.value || {}
  return realIntakeSchema.value.map((f) => {
    const v = vals[f.key]
    let text = ''
    if (Array.isArray(v)) text = v.join('、')
    else if (v !== null && v !== undefined && String(v).trim() !== '') text = String(v)
    return { key: f.key, label: f.label || f.key, required: !!f.required, text, filled: text !== '' }
  })
})

// 左栏底部「建议 query」候选（demo 写死合理文案）
const suggestQueries = computed(() => {
  if (isSkill.value) {
    return ['我下周二想请一天年假，帮我提交', '先帮我看下我还有几天年假', '帮我提交 6/30 的年假申请']
  }
  return ['我还有几天年假？', '帮我请一天年假，下周一', '帮我查一下这个月的考勤记录']
})

/* ============================ 右栏：办事过程消息流（多轮累积） ============================ */
let mid = 0
const nextId = () => `m-${++mid}`

// messages：与 Chat 同构的轻量结构
// user: { id, role:'user', content }
// assistant: { id, role:'assistant', route, steps[], content, streaming, interrupted,
//              attachments[], confirm:{summary,confirmToken}, eval:{verdict, note, noteOpen} }
const messages = ref([])
const input = ref('')
const running = ref(false)
const inputRef = ref()
const listRef = ref()

let abortCtrl = null // 当前 SSE 的 AbortController（停止 / 卸载时 abort 关闭 reader）

const empty = computed(() => messages.value.length === 0)

async function scrollToBottom() {
  await nextTick()
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}
watch(messages, scrollToBottom, { deep: true })

function currentAssistant() {
  // 取最后一条 assistant（正在跑的那条）
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'assistant') return messages.value[i]
  }
  return null
}

// ---- 真实 SSE 事件 → 消息态映射 ----
// handlers 形如 { onSession, onRoute, onStep, onConfirm, onDelta, onDone, onError }，由 dispatchEvent 调用。
// 用工厂绑定到当前 assistant 消息 m，避免多轮串台。
function makeHandlers(m) {
  return {
    onSession() {
      /* {sessionId:null, positionId}——测试不落会话，无需处理 */
    },
    onRoute(data) {
      // 岗位入口本期后端钉 TASK；技能入口模板不渲染 RouteChip（见 isSkill 分支）。
      m.route = data?.route || ''
    },
    onStep(data) {
      // 步骤按 no 增量合并（OBSERVATION 写工具步带 simulated:true + simulatedTool）。
      const no = data?.no
      const idx = no != null ? m.steps.findIndex((s) => s.no === no) : -1
      if (idx >= 0) m.steps[idx] = { ...m.steps[idx], ...data }
      else m.steps.push({ ...data })
    },
    onConfirm(data) {
      // confirm_required{confirmToken, toolCode, summary}：弹二次确认卡，等用户决定后走 confirm 端点续跑。
      m.confirm = { summary: data?.summary || '请确认操作', confirmToken: data?.confirmToken, toolCode: data?.toolCode }
      m.streaming = true
    },
    onDelta(data) {
      // delta{text}（真实链路用 text 字段；兼容 content 兜底）
      m.content = (m.content || '') + (data?.text ?? data?.content ?? '')
    },
    onDone(data) {
      m.streaming = false
      m.traceSummary = data?.traceSummary || ''
      finishRun()
    },
    onError(data) {
      // 403/404/400/BUSINESS_ERROR/LLM error：友好错误呈现（复用 .ai-body.is-error 观感），不白屏不吞错。
      m.streaming = false
      m.confirm = null
      m.error = true
      m.content = data?.message || '效果测试出错了，请稍后重试'
      finishRun()
    }
  }
}

function finishRun() {
  running.value = false
  abortCtrl = null
}

function newAssistantMsg() {
  return reactive({
    id: nextId(),
    role: 'assistant',
    route: '',
    steps: [],
    content: '',
    streaming: true,
    interrupted: false,
    error: false,
    traceSummary: '',
    confirm: null,
    eval: { verdict: '', note: '', noteOpen: false }
  })
}

function startTurn(text) {
  const q = text.trim()
  if (!q || running.value) return
  if (!canRun.value) {
    ElMessageBox.alert(props.disabledReason || '缺少岗位上下文，暂不支持效果测试', '无法测试', {
      confirmButtonText: '知道了',
      type: 'warning'
    }).catch(() => {})
    return
  }
  messages.value.push({ id: nextId(), role: 'user', content: q })
  const m = newAssistantMsg()
  messages.value.push(m)
  running.value = true
  input.value = ''

  abortCtrl = new AbortController()
  // 技能入口传 skillId（baseSkillId）触发收窄 + route 钉 TASK；岗位入口不传 skillId。
  const payload = {
    // 方案B/B2：岗位 id 已字符串化（ps_*），不可 Number()（会变 NaN），原样透传字符串。
    positionId: props.positionId,
    message: q
  }
  // 方案B/B3：skillId 已字符串化（sk_*），原样透传字符串（不再 Number()）。
  if (isSkill.value && props.skillId != null) payload.skillId = props.skillId
  // 采集值每轮重发（后端无状态、每轮重装配视图）；无采集字段 → 不带该字段，行为不变。
  if (hasIntake.value && intakeValues.value && Object.keys(intakeValues.value).length) {
    payload.intakeValues = intakeValues.value
  }
  streamEffectTest(payload, makeHandlers(m), abortCtrl.signal)
}

/* ---- 采集表单：首轮发送前起一次（IntakeFormFields 渲染真字段，键=key），缓存后每轮重发 ---- */
// 打开表单：用已填值回填（改值场景）或 schema 默认值初始化。
function openIntakeForm() {
  intakeModel.value = buildIntakeModel(realIntakeSchema.value, intakeValues.value || null)
  intakeErrors.value = {}
  intakeFormVisible.value = true
}

// 确认采集：归一为 intakeValues（键=key，剔空）。必填缺失只软提示、不强拦（FDE 要看“没填会怎样”）。
function confirmIntake() {
  const { ok, errors } = validateIntakeValues(realIntakeSchema.value, intakeModel.value)
  intakeErrors.value = errors
  intakeValues.value = normalizeIntakeValues(realIntakeSchema.value, intakeModel.value)
  intakeCollected.value = true
  intakeFormVisible.value = false
  if (!ok) ElMessage.warning('部分必填项未填，已按现状提交，办事结果可能不准')
}

function cancelIntake() {
  intakeFormVisible.value = false
}

async function send() {
  const text = input.value.trim()
  if (!text || running.value) return
  if (!canRun.value) {
    ElMessageBox.alert(props.disabledReason || '缺少岗位上下文，暂不支持效果测试', '无法测试', {
      confirmButtonText: '知道了',
      type: 'warning'
    }).catch(() => {})
    return
  }
  // 技能入口 schema 异步拉取可能未就绪：发送前确保已尝试解析，避免首轮漏收集。
  if (!realIntakeSchema.value.length) await ensureIntakeSchema()
  // 有采集字段且尚未收集过 → 首轮先弹真表单收集（确认后由用户再次发送）。
  if (hasIntake.value && !intakeCollected.value) {
    openIntakeForm()
    return
  }
  startTurn(text)
}

function onEnter(e) {
  if (e.shiftKey) return // Shift+Enter 换行
  e.preventDefault()
  send()
}

function stop() {
  // abort 关闭 fetch reader（真实 SSE 立即断流）
  if (abortCtrl) abortCtrl.abort()
  const m = currentAssistant()
  if (m && m.streaming) {
    m.streaming = false
    m.interrupted = true
    if (!m.content) m.content = ''
  }
  finishRun()
}

// 二次确认卡：确认 / 取消。备注作 userAnswer 透传给 confirm 端点（≤2000）。
// 确认续跑是一条独立 SSE，事件继续写回同一条 assistant 消息 m（追加 step/delta/done）。
const confirmNotes = reactive({})
function onConfirm(m, approved) {
  const confirmToken = m.confirm?.confirmToken
  m.confirm = null
  const userAnswer = (confirmNotes[m.id] || '').trim()
  delete confirmNotes[m.id]
  if (!confirmToken) {
    // 无 token（异常）：取消语义，标中断收尾
    m.streaming = false
    m.interrupted = true
    finishRun()
    return
  }
  m.streaming = true
  running.value = true
  abortCtrl = new AbortController()
  const payload = { confirmToken, approved }
  if (userAnswer) payload.userAnswer = userAnswer
  confirmEffectTest(payload, makeHandlers(m), abortCtrl.signal)
}

// 点建议 query / 空态 chip → 填入输入框
function pickSuggest(q) {
  input.value = q
  nextTick(() => inputRef.value?.focus())
}

// 评估区：通过 / 不通过（再次点击同值可取消）
function setVerdict(m, verdict) {
  m.eval.verdict = m.eval.verdict === verdict ? '' : verdict
}
function toggleNote(m) {
  m.eval.noteOpen = !m.eval.noteOpen
}

/* ============================ 顶栏：重新测试 / 关闭 ============================ */
async function resetTest() {
  if (messages.value.length === 0) return
  try {
    await ElMessageBox.confirm('将清空当前测试的对话过程，重新开始（左侧已加载的数据不变）。确认重新测试？', '重新测试', {
      type: 'warning',
      confirmButtonText: '重新测试',
      cancelButtonText: '继续'
    })
  } catch {
    return
  }
  if (abortCtrl) abortCtrl.abort()
  finishRun()
  messages.value = []
  input.value = ''
}

function requestClose() {
  if (abortCtrl) abortCtrl.abort()
  emit('close')
}

// 卸载兜底：宿主以 v-if 卸载浮层（AdminSkills closeTest / PositionWorkbench 路由复位）时不一定走 requestClose，
// 若不 abort，正在跑的 fetch reader 会在卸载后继续回调改 state、watch 还排 nextTick = 卸载后副作用 + 泄漏。
// requestClose/resetTest 里现有 abort 保留为快速路径，这里做最终兜底。
onUnmounted(() => {
  abortCtrl?.abort()
})
</script>

<template>
  <div class="et-stage">
    <!-- 顶栏面包屑（复刻 .ed-crumb） -->
    <div class="ed-crumb">
      <span class="crumb-cur">🧪 {{ stageName }} · 效果测试</span>
      <span class="crumb-sp"></span>
      <span class="ed-close" @click="resetTest">↻ 重新测试</span>
      <button type="button" class="crumb-x" title="关闭" aria-label="关闭" @click="requestClose">✕</button>
    </div>

    <!-- 主体：左上下文栏 + 右办事过程 -->
    <div class="et-body">
      <!-- ① 左：本次只加载的数据 -->
      <aside class="et-ctx">
        <div class="ctx-head">
          <span class="ctx-head-icon">📦</span>
          <span class="ctx-head-text">本次只加载的数据</span>
        </div>

        <!-- 技能版 -->
        <template v-if="isSkill">
          <div class="ctx-sec">
            <div class="ctx-label">技能</div>
            <div class="ctx-strong">{{ skillView.name }}</div>
          </div>
          <div class="ctx-sec">
            <div class="ctx-label">触发词</div>
            <div class="chips">
              <span v-for="(t, i) in skillView.triggers" :key="i" class="chip">{{ t }}</span>
            </div>
          </div>
          <div class="ctx-sec">
            <div class="ctx-label">引用工具</div>
            <ul class="ctx-list">
              <li v-for="(t, i) in skillView.tools" :key="i" class="ctx-item">
                <span class="health-dot" :class="t.health === 'normal' ? 'is-ok' : 'is-bad'"></span>
                <span class="ctx-item-name">{{ t.name }}</span>
                <span class="ctx-item-meta">{{ t.health === 'normal' ? '正常' : '异常' }}</span>
              </li>
            </ul>
          </div>
          <div class="ctx-sec">
            <div class="ctx-label">关联数据表</div>
            <ul class="ctx-list">
              <li v-for="(t, i) in skillView.tables" :key="i" class="ctx-item">
                <span class="ctx-item-icon">🗂️</span>
                <span class="ctx-item-name">{{ t.name }}</span>
                <span class="ctx-item-meta">{{ t.rows }} 行</span>
              </li>
            </ul>
          </div>
          <!-- 采集字段区（技能入口同样支持，设计 §5.4.4）：schema 走宿主岗位（ensureIntakeSchema 处理），
               仅宿主岗位配了采集字段才显示。复用 mode 无关的 intakeFilledList / openIntakeForm。 -->
          <div v-if="hasIntake" class="ctx-sec">
            <div class="ctx-label">
              采集字段
              <button type="button" class="ctx-edit" @click="openIntakeForm">
                {{ intakeCollected ? '编辑' : '填写' }}
              </button>
            </div>
            <ul class="ctx-list">
              <li v-for="it in intakeFilledList" :key="it.key" class="ctx-item">
                <span class="ctx-item-name">
                  {{ it.label }}<span v-if="it.required" class="intake-req">*</span>
                </span>
                <span class="ctx-item-meta" :class="{ 'is-empty': !it.filled }">
                  {{ it.filled ? it.text : '未填' }}
                </span>
              </li>
            </ul>
          </div>
        </template>

        <!-- 岗位版 -->
        <template v-else>
          <div class="ctx-sec">
            <div class="ctx-label">岗位</div>
            <div class="ctx-strong">{{ positionView.name }}</div>
          </div>
          <div class="ctx-sec">
            <div class="ctx-label">人格摘要</div>
            <div class="ctx-desc">{{ positionView.persona }}</div>
          </div>
          <div class="ctx-sec">
            <div class="ctx-label">
              采集字段
              <button v-if="hasIntake" type="button" class="ctx-edit" @click="openIntakeForm">
                {{ intakeCollected ? '编辑' : '填写' }}
              </button>
            </div>
            <!-- 真实 schema：显示各字段已填值（每轮随请求重发，键=key）；未填给弱提示 -->
            <ul v-if="hasIntake" class="ctx-list">
              <li v-for="it in intakeFilledList" :key="it.key" class="ctx-item">
                <span class="ctx-item-name">
                  {{ it.label }}<span v-if="it.required" class="intake-req">*</span>
                </span>
                <span class="ctx-item-meta" :class="{ 'is-empty': !it.filled }">
                  {{ it.filled ? it.text : '未填' }}
                </span>
              </li>
            </ul>
            <!-- 无真实 schema：保持原占位展示（不弹不传） -->
            <div v-else class="ctx-desc">{{ positionView.intakeCount }} 项（{{ positionView.intakeSchema.map((f) => f.label || f.key).join('、') }}）</div>
          </div>
          <div class="ctx-sec">
            <div class="ctx-label">Agent → 技能</div>
            <div v-for="(a, i) in positionView.agents" :key="i" class="ctx-lane">
              <div class="lane-name">⚙️ {{ a.name }}</div>
              <div class="chips">
                <span v-for="(sk, j) in a.skills" :key="j" class="chip">{{ sk }}</span>
              </div>
            </div>
          </div>
          <div class="ctx-sec">
            <div class="ctx-label">数据底座</div>
            <div class="ctx-desc">{{ positionView.tableCount }} 张数据表</div>
          </div>
          <div class="ctx-sec">
            <div class="ctx-label">全部工具</div>
            <ul class="ctx-list">
              <li v-for="(t, i) in positionView.tools" :key="i" class="ctx-item">
                <span class="health-dot" :class="t.health === 'normal' ? 'is-ok' : 'is-bad'"></span>
                <span class="ctx-item-name">{{ t.name }}</span>
                <span class="ctx-item-meta">{{ t.health === 'normal' ? '正常' : '异常' }}</span>
              </li>
            </ul>
          </div>
        </template>

        <!-- 底部：建议 query -->
        <div class="ctx-suggest">
          <div class="ctx-label">💡 建议 query</div>
          <button
            v-for="(q, i) in suggestQueries"
            :key="i"
            type="button"
            class="suggest-item"
            @click="pickSuggest(q)"
          >{{ q }}</button>
        </div>

        <!-- 诚实性提示（弱色小字，不打扰）：真链路按登录者 JWT 注入 FDE 本人记忆，
             可能影响办事表现、削弱不同测试者间可复现性，让 FDE 心里有数。 -->
        <div class="ctx-memory-note">
          ℹ️ 已注入你本人的记忆，可能影响办事表现，不同测试者结果未必一致
        </div>
      </aside>

      <!-- ② 右：办事过程 -->
      <section class="et-main">
        <div ref="listRef" class="et-list">
          <!-- 空态 -->
          <div v-if="empty" class="et-empty">
            <div class="empty-icon">🧪</div>
            <div class="empty-title">构造一句用户可能问的话，试跑这个{{ isSkill ? '技能' : '岗位' }}</div>
            <div class="empty-sub">只加载左侧这一份数据，走一遍标准办事链路，逐步看每一步对不对</div>
            <div class="empty-chips">
              <button
                v-for="(q, i) in suggestQueries"
                :key="i"
                type="button"
                class="empty-chip"
                @click="pickSuggest(q)"
              >{{ q }}</button>
            </div>
          </div>

          <!-- 消息流 -->
          <template v-for="m in messages" :key="m.id">
            <!-- 用户气泡（靠右） -->
            <div v-if="m.role === 'user'" class="msg msg-user">
              <div class="user-bubble">{{ m.content }}</div>
            </div>

            <!-- AI 回合 -->
            <div v-else class="msg msg-assistant">
              <!-- 岗位版分流标 -->
              <div v-if="!isSkill && m.route" class="msg-speaker">
                <RouteChip :route="m.route" />
              </div>

              <!-- ReAct 步骤（测试台默认展开：FDE 要逐步看每步对不对；员工端 Chat 仍默认折叠，不动） -->
              <ReActSteps :steps="m.steps" :trace-summary="m.traceSummary" :streaming="m.streaming" :default-open="true" />

              <!-- 处理中骨架 -->
              <div v-if="m.streaming && !m.content && !m.confirm && (!m.steps || !m.steps.length)" class="thinking">
                <el-icon class="loading-icon"><Loading /></el-icon> 正在处理中…
              </div>

              <!-- 二次确认卡（复刻 Chat 告警卡） -->
              <div v-if="m.confirm" class="confirm-card">
                <div class="confirm-head"><el-icon><WarningFilled /></el-icon> 请确认操作</div>
                <div class="confirm-body">{{ m.confirm.summary }}</div>
                <el-input
                  v-model="confirmNotes[m.id]"
                  class="confirm-note"
                  type="textarea"
                  :rows="2"
                  resize="none"
                  placeholder="可补充说明 / 改单意图（可选）"
                />
                <div class="confirm-actions">
                  <el-button @click="onConfirm(m, false)">取消</el-button>
                  <el-button type="primary" @click="onConfirm(m, true)">确认提交</el-button>
                </div>
              </div>

              <!-- 正文 -->
              <div v-if="m.content" class="ai-body" :class="{ 'is-error': m.error }">
                <ChatMarkdown v-if="!m.error" :content="m.content" />
                <template v-else>{{ m.content }}</template>
                <span v-if="m.streaming" class="caret">▍</span>
              </div>

              <!-- 中断标识 -->
              <div v-if="m.interrupted && !m.streaming" class="interrupt-tag">
                <el-icon><WarningFilled /></el-icon> 未完成 · 该事项尚未办成
              </div>

              <!-- 轻量评估区（每条 AI 结果末尾，结束后才出） -->
              <div v-if="!m.streaming" class="eval-bar">
                <span class="eval-label">这步对吗：</span>
                <button
                  type="button"
                  class="eval-pill is-pass"
                  :class="{ on: m.eval.verdict === 'pass' }"
                  @click="setVerdict(m, 'pass')"
                >✓ 通过</button>
                <button
                  type="button"
                  class="eval-pill is-fail"
                  :class="{ on: m.eval.verdict === 'fail' }"
                  @click="setVerdict(m, 'fail')"
                >✕ 不通过</button>
                <button type="button" class="eval-note-toggle" @click="toggleNote(m)">
                  {{ m.eval.noteOpen ? '收起备注' : '问题备注' }}
                </button>
              </div>
              <el-input
                v-if="!m.streaming && m.eval.noteOpen"
                v-model="m.eval.note"
                class="eval-note"
                type="textarea"
                :rows="2"
                resize="none"
                placeholder="一句话记下问题（仅本地，不保存）"
              />
            </div>
          </template>
        </div>

        <!-- 游离技能（未挂载岗位）禁用提示：占位说明，输入条禁用 -->
        <div v-if="disabledReason" class="et-disabled-tip">
          <el-icon><WarningFilled /></el-icon>
          <span>{{ disabledReason }}</span>
        </div>

        <!-- 底部输入条（复刻 .composer，去掉 @ 切换搭子；真实链路 max 8000 与后端一致） -->
        <div class="et-composer-wrap">
          <div class="composer">
            <el-input
              ref="inputRef"
              v-model="input"
              class="composer-input"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 6 }"
              resize="none"
              maxlength="8000"
              :disabled="!canRun"
              placeholder="扮演终端用户，输入一句要办的事；Enter 试跑，Shift+Enter 换行"
              @keydown.enter="onEnter"
            />
            <div class="composer-bar">
              <span class="composer-hint">效果测试 · 真实链路（写操作为拟真，不会真写业务系统）</span>
              <el-button
                v-if="running"
                class="send-btn"
                circle
                title="停止"
                @click="stop"
              >
                <el-icon><VideoPause /></el-icon>
              </el-button>
              <el-button
                v-else
                class="send-btn"
                type="primary"
                circle
                :disabled="!input.trim() || !canRun"
                title="试跑"
                @click="send"
              >
                <el-icon><Top /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 采集表单弹窗（复用解耦内核 IntakeFormFields 纯渲染 + intakeForm.js 纯函数；不碰 IntakeFormDialog 领用耦合）。
         首轮发送前收集，键=field.key；确认后缓存、每轮 stream 重发。必填缺失软提示不强拦。 -->
    <el-dialog
      v-model="intakeFormVisible"
      title="补充办事信息"
      width="440px"
      append-to-body
      :close-on-click-modal="false"
    >
      <p class="intake-hint">这个岗位办事前会先采集以下信息（效果测试同样会带上，键按字段配置下传）。必填项不填也可继续，用于观察“缺信息会怎样”。</p>
      <IntakeFormFields
        :schema="realIntakeSchema"
        :model="intakeModel"
        :errors="intakeErrors"
        @update:model="intakeModel = $event"
      />
      <template #footer>
        <el-button @click="cancelIntake">取消</el-button>
        <el-button type="primary" @click="confirmIntake">保存并继续</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* ── 根：复刻 PositionDataTableStage .dt-editor（居中 + zoomIn 入场） ── */
.et-stage {
  width: 100%;
  max-width: min(96vw, 1440px);
  margin: 0 auto;
  height: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: dtsZoomIn var(--dur-slow) var(--ease-out) both;
}
@keyframes dtsZoomIn {
  from { opacity: 0; transform: scale(0.94) translateY(14px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

/* ── 顶栏面包屑（复刻 .ed-crumb） ── */
.ed-crumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-sunken);
  flex-wrap: wrap;
}
.crumb-cur {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.crumb-sp {
  flex: 1;
}
.ed-close {
  cursor: pointer;
  color: var(--c-text-muted);
  padding: 4px 10px;
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  border: 1px solid var(--border-base);
  background: var(--bg-surface);
}
.ed-close:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.crumb-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
}
.crumb-x:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}

/* ── 主体两栏 ── */
.et-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
}

/* ① 左：上下文栏 */
.et-ctx {
  border-right: 1px solid var(--border-soft);
  background: var(--bg-surface);
  padding: var(--space-4);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.ctx-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.ctx-head-icon {
  font-size: var(--fs-md);
}
.ctx-sec {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ctx-label {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
/* 采集字段「填写/编辑」入口：弱色文字按钮 */
.ctx-edit {
  border: none;
  background: transparent;
  color: var(--c-accent);
  font-size: var(--fs-xs);
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.ctx-edit:hover {
  text-decoration: underline;
}
.intake-req {
  color: var(--c-danger);
  margin-left: 2px;
}
.ctx-item-meta.is-empty {
  color: var(--c-warning);
}
.ctx-strong {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.ctx-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.chip {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-hover);
  border: 1px solid var(--border-soft);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.ctx-lane {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-1);
}
.lane-name {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--c-text);
}
.ctx-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
}
.ctx-item-icon {
  flex-shrink: 0;
}
.ctx-item-name {
  flex: 1;
  min-width: 0;
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctx-item-meta {
  color: var(--c-text-faint);
  flex-shrink: 0;
}
.health-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.health-dot.is-ok {
  background: var(--c-success);
}
.health-dot.is-bad {
  background: var(--c-danger);
}
.ctx-suggest {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-soft);
}
.suggest-item {
  text-align: left;
  border: 1px solid var(--border-base);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-text);
  cursor: pointer;
  font-family: inherit;
  line-height: var(--lh-tight);
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.suggest-item:hover {
  background: var(--c-accent-soft);
  border-color: var(--c-accent);
  color: var(--c-accent);
}
/* 诚实性提示：弱色小字，不抢视觉重心 */
.ctx-memory-note {
  font-size: var(--fs-xs);
  line-height: var(--lh-tight);
  color: var(--c-text-faint);
}

/* ② 右：办事过程 */
.et-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg-surface);
}
.et-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-6) var(--space-6);
}

/* 空态（复刻 .dt-placeholder 观感） */
.et-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  text-align: center;
  color: var(--c-text-muted);
  padding: var(--space-10);
}
.empty-icon {
  font-size: 44px;
  opacity: 0.7;
}
.empty-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--c-text);
  max-width: 420px;
}
.empty-sub {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  max-width: 420px;
}
.empty-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: center;
  margin-top: var(--space-2);
}
.empty-chip {
  border: 1px solid var(--border-base);
  background: var(--bg-surface);
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.empty-chip:hover {
  background: var(--c-accent-soft);
  border-color: var(--c-accent);
  color: var(--c-accent);
}

/* 消息 */
.msg {
  margin-bottom: var(--space-5);
}
.msg-user {
  display: flex;
  justify-content: flex-end;
}
.user-bubble {
  max-width: 80%;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xl);
  background: var(--bg-active);
  color: var(--c-text-strong);
  line-height: var(--lh-base);
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-assistant {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.msg-speaker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.msg-speaker :deep(.route-chip) {
  margin-bottom: 0;
}
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
.ai-body {
  color: var(--c-text);
  line-height: var(--lh-base);
  word-break: break-word;
}
.ai-body.is-error {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--c-danger-soft);
  border: 1px solid var(--c-danger);
  color: var(--c-danger);
  white-space: pre-wrap;
}
.caret {
  color: var(--c-accent);
  margin-left: 2px;
  animation: caret-pulse 1s steps(2) infinite;
}
@keyframes caret-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* 二次确认卡（复刻 Chat .confirm-card） */
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

/* 中断标识 */
.interrupt-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-2);
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  color: var(--c-warning);
  background: var(--c-warning-soft);
  border: 1px solid var(--c-warning);
  align-self: flex-start;
}

/* 轻量评估区 */
.eval-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  flex-wrap: wrap;
}
.eval-label {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.eval-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  border: 1px solid var(--border-base);
  background: var(--bg-surface);
  color: var(--c-text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--dur-fast) var(--ease-out);
}
.eval-pill.is-pass.on {
  color: var(--c-success);
  background: var(--c-success-soft);
  border-color: var(--c-success);
}
.eval-pill.is-fail.on {
  color: var(--c-danger);
  background: var(--c-danger-soft);
  border-color: var(--c-danger);
}
.eval-pill:hover {
  border-color: var(--border-strong);
}
.eval-note-toggle {
  border: none;
  background: transparent;
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
  cursor: pointer;
  font-family: inherit;
  padding: 0 var(--space-1);
}
.eval-note-toggle:hover {
  color: var(--c-accent);
}
.eval-note {
  margin-top: var(--space-2);
}

/* 采集表单弹窗顶部说明 */
.intake-hint {
  margin: 0 0 var(--space-4);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}

/* 底部输入条（复刻 .composer） */
.et-disabled-tip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-6);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--c-warning);
  background: var(--c-warning-soft);
  color: var(--c-warning);
  border-radius: var(--radius-md);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
}
.et-composer-wrap {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-6) var(--space-4);
  border-top: 1px solid var(--border-soft);
  background: var(--bg-surface);
}
.composer {
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-xl);
  padding: var(--space-2) var(--space-3);
  box-shadow: var(--shadow-md);
  transition: border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
}
.composer:focus-within {
  border-color: var(--c-accent);
  box-shadow: var(--shadow-md), 0 0 0 3px var(--c-accent-soft);
}
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
.composer-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.send-btn {
  width: 34px;
  height: 34px;
  font-size: var(--fs-md);
  flex-shrink: 0;
}

/* 窄屏降级：转单列，左栏收高 */
@media (max-width: 900px) {
  .et-body {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .et-ctx {
    border-right: none;
    border-bottom: 1px solid var(--border-soft);
    max-height: 240px;
  }
}
</style>
