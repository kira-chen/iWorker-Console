<script setup>
/**
 * 样例定时任务编辑表单（弹窗右栏 detail）。
 *
 * 抽取自 TaskEditor.vue 的 4 分区表单 + 校验 / 组装逻辑：
 *   基本信息（name + remark）/ 调度计划（SchedulePicker）/ 详细说明（MarkdownEditor sopDoc）/ 引用工具（ToolPicker）。
 * 剥离（交互规格 §3.3）：路由导航 / onBeforeRouteLeave / PageHeader / 「创建并启用·保存草稿」双按钮
 *   → 改单一「保存 / 创建样例」；去掉一切运行态（status / 上下次执行 / 立即执行）。
 *
 * 与用户端差异：
 * - 调度预览走 FDE 门 previewSampleSchedule（POST .../sample-tasks/preview-schedule），不用前台 /tasks/preview-schedule。
 * - 工具候选走 FDE 门 tool-picker（与岗位技能配工具同源），ToolPicker friendly=false（后台原样露 type/code）。
 * - 显式保存 + 脏检查（切换条目 / 关闭由父组件调 isDirty() 决定是否二次确认）。
 *
 * 保存时机：显式点按钮才提交（不逐字段即时保存，避免半成品样例落库）。
 * 子组件 SchedulePicker / ToolPicker / MarkdownEditor 复用。
 *
 * 2026-09-09 原型复刻批次 4B（#18 / #19 / #20 / #21 / #22）：
 * - #18 分区卡头改「3px 绿条 + 灰底头条」，卡体单独 18px 内边距、去阴影（原型 .pd2-task-section-head）；
 * - #19 调度计划走 SchedulePicker 三模式；
 * - #20 提示词卡加引导文案 + 脚部字数计数（编辑器本体保留 MarkdownEditor，未照搬原型 contenteditable 壳）；
 * - #21 引用工具卡改「搜索框 + 已引用工具平铺行（含健康度 tag）+ 卡底虚线『+ 添加工具』」，
 *      「+ 添加工具」开弹窗内复用 ToolPicker 勾选；
 * - #22 引用平台技能卡改「已选 chips + 搜索 + 卡底满宽虚线『+ 添加技能』」，候选列表默认收起、点按钮才展开。
 * - md §7.2「支持启用/停用单个任务」的启停开关从列表项移入「基本信息」卡头（负责人 0908 折中）。
 *
 * 2026-09-12 对齐 md §7（测试审计闭环批）：
 * - J5：退役 `embedded` 开关——本组件只在岗位「自动化任务」页签内联使用，无浮层态消费方，样式只留内联形态；
 * - K4：buildSchedule() 带 scheduleMode / periodicPreset / intervalCount / intervalUnit（§7.3）；
 * - J7 / K7 / K9：8000 字上限、引导文案与「已输入 N / 8000 字」计数（§7.4 / §7.7）；
 *   其中「提示词非必填」已被 2026-09-21 负责人拍板推翻——提示词现为必填（与任务名称 / 一句话指令同为保存必填）；
 * - K6 / K8 / J6：保存与创建 toast、搜索占位与空态、基本信息三处占位逐字照 md（§7.2 / §7.5 / §7.6 / §7.7）。
 *
 * 2026-09-23 负责人拍板：执行频率新增「闲时」模式（不设定点时间，只定执行次数 + 执行时段，由系统
 * 择机执行），删除原「空闲时段提前准备」勾选框（preKick 字段随之退役，§7.3）；同日新增「执行位置」
 * 只读展示（云端 / Web 端 / 本地，无法改变，由 scheduleMode 派生：闲时模式为云端 + Web 端，其余三个
 * 模式为全部三项），派生逻辑在 SchedulePicker（展示）与本文件 buildSchedule()（提交）各自实现一份。
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import {
  createSampleTask,
  updateSampleTask,
  previewSampleSchedule
} from '@/api/sampleTask'
import { listToolPicker, listPlatformSkillCandidates } from '@/api/position'
import { ApiError } from '@/api/request'
import { usePositionStore } from '@/stores/position'
import SchedulePicker from '@/components/task/SchedulePicker.vue'
import ToolPicker from '@/components/admin/ToolPicker.vue'
import MarkdownEditor from '@/components/admin/MarkdownEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import { categoryLabel, categoryTagType, hasCategory } from '@/utils/skillCategory'
import { inferPeriodicPreset } from '@/utils/periodicPreset'

const props = defineProps({
  positionId: { type: [Number, String], default: null },
  // null = 新建态；样例条目 = 编辑态（回填自该条目）
  sample: { type: Object, default: null },
  // 启停请求进行中（父组件 PositionSampleTaskStage 持有 setSampleTaskStatus 调用）
  statusBusy: { type: Boolean, default: false }
})
const emit = defineEmits(['saved', 'created', 'dirty-change', 'toggle-status'])

const store = usePositionStore()

const isEdit = computed(() => !!props.sample)

// 单任务启停（md §7.2）：状态与切换动作都在父组件，这里只呈现 + 上抛
const taskEnabled = computed(() => (props.sample?.status || 'ENABLED') === 'ENABLED')

// ---- 表单模型（对齐 TaskEditor.form） ----
function blankSchedule() {
  return {
    // 执行位置只读展示、由 scheduleMode 派生（md §7.3，2026-09-23 负责人拍板：执行位置无法改变），
    // 不存表单状态，见 buildSchedule() 的 execLocations 派生逻辑
    scheduleMode: 'PERIODIC',
    periodicPreset: 'DAILY',
    intervalCount: 1,
    intervalUnit: 'DAY',
    idleCount: 1,
    idleCountUnit: 'DAY',
    idleWindow: 'NIGHT',
    scheduleType: 'DAILY',
    daysOfWeek: [],
    daysOfMonth: [],
    times: ['09:00'],
    onceAt: '',
    startDate: '',
    endDate: ''
  }
}
// 执行动作默认值：技能（按引用平台技能执行）；新建态、存量无该字段、payload 兜底共用这一处
const EXEC_TYPE_DEFAULT = 'SKILL'

const form = reactive({
  name: '',
  // 一句话指令（后端 SampleTaskUpsertRequest.prompt，@Size(max=2000)）：
  // 到点让搭子做什么；发布态（ENABLED 样例）后端硬拦空 prompt（1003），前端同步给必填标记 + 发布前可感知提示。
  prompt: '',
  remark: '',
  schedule: blankSchedule(),
  sopDoc: '',
  toolRefs: [], // { type, code, requiresConfirmation }（ToolPicker selected 结构）
  skillRefs: [], // { platformSkillId, name }（引用平台技能）
  // 执行动作：触发时由谁来办（AGENT=整个交给某个 Agent；SKILL=按引用技能执行）
  execType: EXEC_TYPE_DEFAULT,
  execAgentId: null, // execType === 'AGENT' 时指定的 Agent（引用该岗位下 Agent 的 agentId）
  // 执行模型：空字符串 = 跟随平台默认模型
  execModel: ''
})

// 任务名称上限：一览表「名称类统一规则 64」（2026-09-12 负责人决策 1）。计数器与 maxlength 共用它。
const NAME_MAX = 64
// 与后端 @Size(max=2000) 对齐（字数提示 + maxlength 双保险）
const PROMPT_MAX = 2000
// 提示词上限：md §7.4「最多 8000 字符」（2026-09-12 审计 K7）
const SOP_MAX = 8000
// 说明（备注）上限：计数器与 maxlength 共用它（2026-09-18 待办 yuepu#5⑧，此前两处各写一遍字面量 500，
// 与 NAME_MAX/PROMPT_MAX 已经在用的「计数器与 maxlength 共用同一常量」模式看齐）
const REMARK_MAX = 500

const errors = reactive({ name: '', prompt: '', schedule: '', sopDoc: '', tools: '', skills: '' })
const saving = ref(false)

/* ---- 脏检查基线（对齐 PositionDataTableStage 快照法） ---- */
const dirty = ref(false)
function markDirty() {
  if (!dirty.value) {
    dirty.value = true
    emit('dirty-change', true)
  }
}
function clearDirty() {
  dirty.value = false
  emit('dirty-change', false)
}

/* ============================ 工具清单（FDE 门 tool-picker，与岗位技能配工具同源） ============================ */
const available = ref({ mock: [], mcp: [], api: [] })
const toolsLoading = ref(false)

async function loadTools() {
  toolsLoading.value = true
  try {
    // 与岗位技能配工具同源：FDE 门 tool-picker 按 type 分别取（MCP / API），friendly=false 原样露。
    // 数据表 / 业务系统类工具由岗位技能侧的 skill.md 引用维护，样例任务工具坞聚焦 MCP / API 两来源。
    const [mcp, api] = await Promise.all([
      listToolPicker({ type: 'MCP' }).catch(() => []),
      listToolPicker({ type: 'API' }).catch(() => [])
    ])
    available.value = {
      mock: [],
      mcp: normalizeTools(mcp, 'MCP'),
      api: normalizeTools(api, 'API')
    }
  } catch (e) {
    /* 工具非必填，不阻塞 */
  } finally {
    toolsLoading.value = false
  }
}

// tool-picker 项 { type, code, bizName, description, displayStatus } → ToolPicker available 项
function normalizeTools(list, fallbackType) {
  return (Array.isArray(list) ? list : list?.items || []).map((t) => ({
    type: t.type || fallbackType,
    code: t.code,
    bizName: t.bizName || t.code,
    description: t.description || '',
    // 健康度透传（#21 平铺行的「已验证」tag 取此值；ToolPicker 不消费，无副作用）
    checkStatus: t.checkStatus,
    displayStatus: t.displayStatus || t.checkStatus,
    requiresConfirmation: false
  }))
}

// (type,code) → bizName 映射，提交时补全 bizName
const bizNameMap = computed(() => {
  const m = new Map()
  for (const g of ['mock', 'mcp', 'api']) {
    for (const t of available.value?.[g] || []) {
      m.set(`${t.type}::${t.code}`, t.bizName || t.code)
    }
  }
  return m
})

/* ---------- #21 引用工具卡：搜索 + 已引用工具平铺行 + 「＋ 添加工具」弹窗 ---------- */
// (type,code) → 候选工具项映射，用于平铺行补名称 / 类型 / 健康度
const toolMetaMap = computed(() => {
  const m = new Map()
  for (const g of ['mock', 'mcp', 'api']) {
    for (const t of available.value?.[g] || []) m.set(`${t.type}::${t.code}`, t)
  }
  return m
})

// 已引用工具平铺行：名称 / 类型 / 健康度（HEALTHY → 「已验证」）；候选未命中时优雅降级用回填的 bizName
const toolRows = computed(() =>
  form.toolRefs.map((t) => {
    const meta = toolMetaMap.value.get(`${t.type}::${t.code}`) || {}
    return {
      type: t.type,
      code: t.code,
      bizName: meta.bizName || t.bizName || t.code,
      health: String(meta.displayStatus || meta.checkStatus || 'UNKNOWN').toUpperCase()
    }
  })
)

const toolKeyword = ref('')
const visibleToolRows = computed(() => {
  const q = toolKeyword.value.trim().toLowerCase()
  if (!q) return toolRows.value
  return toolRows.value.filter((r) =>
    [r.bizName, r.type, r.code].some((v) => String(v || '').toLowerCase().includes(q))
  )
})

// 「＋ 添加工具」弹窗（原型此按钮无实现；按 md §7.4「继续新增更多工具」补，弹窗内复用 ToolPicker）
const toolPickerOpen = ref(false)
const toolDraft = ref([])
function openToolPicker() {
  toolDraft.value = form.toolRefs.map((t) => ({ ...t }))
  toolPickerOpen.value = true
}
function confirmToolPicker() {
  form.toolRefs = toolDraft.value.map((t) => ({ ...t }))
  clearError('tools')
  markDirty()
  toolPickerOpen.value = false
}
function removeToolRef(row) {
  form.toolRefs = form.toolRefs.filter((t) => !(t.type === row.type && t.code === row.code))
  clearError('tools')
  markDirty()
}

/* ============================ 引用平台技能（origin=PLATFORM 已发布给 FDE；候选接口天然排除 FDE 技能） ============================ */
// 候选 VO（PlatformSkillCandidateVO）：{ id | skillId, code, name, description, category, updatedAt }。
// 候选接口只返回「系统配置员发布给 FDE」的平台技能，FDE 自建技能不在候选内。
const skillKeyword = ref('')
const skillCandidates = ref([])
const skillsLoading = ref(false)
let skillSearchTimer = null

// 兼容后端候选 id 字段命名（id / skillId），取到即为唯一键。
function candId(c) {
  return c?.id ?? c?.skillId
}

// 已选平台技能 id 集（去重 + 命中「已选」态）
const selectedSkillIdSet = computed(() => new Set(form.skillRefs.map((s) => s.platformSkillId)))

async function loadSkillCandidates() {
  skillsLoading.value = true
  try {
    const list = await listPlatformSkillCandidates(skillKeyword.value.trim() || undefined)
    skillCandidates.value = Array.isArray(list) ? list : []
  } catch (e) {
    /* 读接口全局已提示；平台技能非必填，不阻塞 */
  } finally {
    skillsLoading.value = false
  }
}

// 搜索防抖（对齐工具坞的克制交互，输入即搜）
function onSkillSearch() {
  if (skillSearchTimer) clearTimeout(skillSearchTimer)
  skillSearchTimer = setTimeout(loadSkillCandidates, 300)
}

function isSkillSelected(c) {
  return selectedSkillIdSet.value.has(candId(c))
}

// 候选行点击 → 切换选中（已选则移除，未选则加入）
function toggleSkill(c) {
  const id = candId(c)
  if (id == null) return
  clearError('skills')
  markDirty()
  if (selectedSkillIdSet.value.has(id)) {
    form.skillRefs = form.skillRefs.filter((s) => s.platformSkillId !== id)
  } else {
    form.skillRefs = [...form.skillRefs, { platformSkillId: id, name: c.name || '' }]
  }
}

// 从已选 chip 移除
function removeSkillRef(platformSkillId) {
  clearError('skills')
  markDirty()
  form.skillRefs = form.skillRefs.filter((s) => s.platformSkillId !== platformSkillId)
}

// #22：候选列表默认收起，点卡底「＋ 添加技能」才展开（原型把输入框文字直接变 chip 属缺陷，不搬）
const skillPickerOpen = ref(false)
function toggleSkillPicker() {
  skillPickerOpen.value = !skillPickerOpen.value
  if (skillPickerOpen.value && !skillCandidates.value.length) loadSkillCandidates()
}

/* ---------- 提示词：脚部字数计数「已输入 N / 8000 字」（md §7.4 L409；2026-09-12 审计 K7）
   计数口径 = 原文字符数，与 8000 上限同一把尺（原型「折叠空白后计长」随原型退场） ---------- */
const sopWordCount = computed(() => form.sopDoc.length)

/* ============================ 调度预览（FDE 门，防抖） ============================ */
const previewSummary = ref('')
const previewTimes = ref([])
const previewLoading = ref(false)
const previewError = ref('')
let previewTimer = null

function clearError(key) {
  errors[key] = ''
}

function onScheduleChange() {
  markDirty()
  clearError('schedule')
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(doPreview, 400)
}

function scheduleReady(sc) {
  const mode = sc.scheduleMode || 'PERIODIC'
  if (mode === 'ONCE' || sc.scheduleType === 'ONCE') return !!sc.onceAt
  if (mode === 'INTERVAL') return (sc.intervalCount || 0) > 0
  if (mode === 'IDLE') return (sc.idleCount || 0) > 0
  if (!sc.times || !sc.times.length || sc.times.some((t) => !t)) return false
  if (sc.scheduleType === 'WEEKLY') return (sc.daysOfWeek || []).length > 0
  if (sc.scheduleType === 'MONTHLY') return (sc.daysOfMonth || []).length > 0
  return true // DAILY / INTERVAL_*
}

async function doPreview() {
  if (!scheduleReady(form.schedule)) {
    previewSummary.value = ''
    previewTimes.value = []
    previewError.value = ''
    return
  }
  if (props.positionId == null) return
  previewLoading.value = true
  previewError.value = ''
  try {
    const data = await previewSampleSchedule(props.positionId, {
      schedule: buildSchedule(),
      count: 3
    })
    previewSummary.value = data?.summary || ''
    previewTimes.value = data?.nextRunTimes || []
  } catch (e) {
    previewSummary.value = ''
    previewTimes.value = []
    previewError.value = e instanceof ApiError ? e.message : '调度计划有误，请检查'
  } finally {
    previewLoading.value = false
  }
}

/* ---- 组装提交用 Schedule（md §7.3 三模式；2026-09-12 审计 K4：带 scheduleMode / periodicPreset /
   intervalCount / intervalUnit，否则 mock 回默认，「每 3 小时」会落成每 1 天、「单次」重开回「按周期」） ---- */
function buildSchedule() {
  const sc = form.schedule
  const mode = sc.scheduleMode || 'PERIODIC'
  const out = {
    // 执行位置由模式派生、只读不可编辑（md §7.3，2026-09-23 负责人拍板），与 SchedulePicker 同一规则
    execLocations: mode === 'IDLE' ? ['CLOUD', 'WEB'] : ['CLOUD', 'WEB', 'LOCAL'],
    scheduleMode: mode,
    scheduleType: sc.scheduleType
  }
  if (mode === 'ONCE') {
    out.scheduleType = 'ONCE'
    out.onceAt = sc.onceAt
  } else if (mode === 'INTERVAL') {
    out.intervalCount = sc.intervalCount || 1
    out.intervalUnit = sc.intervalUnit || 'DAY'
    out.scheduleType = `INTERVAL_${out.intervalUnit}`
    // 每间隔模式：times[0] 为起始时刻（md §7.3 L396）
    out.times = dedupeTimes(sc.times).slice(0, 1)
  } else if (mode === 'IDLE') {
    // 闲时：不设定点时间，只带执行次数 + 执行时段（md §7.3 闲时模式专属字段）
    out.scheduleType = 'IDLE'
    out.idleCount = sc.idleCount || 1
    out.idleCountUnit = sc.idleCountUnit || 'DAY'
    out.idleWindow = sc.idleWindow || 'NIGHT'
  } else {
    if (sc.periodicPreset) out.periodicPreset = sc.periodicPreset // 旧数据（每月25日等）无对应预设，不再硬写 DAILY
    out.times = dedupeTimes(sc.times)
    if (sc.scheduleType === 'WEEKLY') out.daysOfWeek = sc.daysOfWeek
    if (sc.scheduleType === 'MONTHLY') out.daysOfMonth = sc.daysOfMonth
  }
  if (sc.startDate) out.startDate = sc.startDate
  // 单次模式仅设起始时间（md §7.3 L397）
  if (sc.endDate && mode !== 'ONCE') out.endDate = sc.endDate
  return out
}

function dedupeTimes(times) {
  return [...new Set((times || []).filter(Boolean))]
}

/* ---- 校验（对齐 TaskEditor.validate，定位到分区） ---- */
function validate() {
  let ok = true
  const name = form.name.trim()
  if (!name) {
    errors.name = '请填写任务名称'
    ok = false
  } else if (name.length > 64) {
    errors.name = '任务名称最多 64 个字符'
    ok = false
  }

  // 一句话指令：样例默认启用（后端缺省 ENABLED），后端对 ENABLED 样例硬拦空 prompt（1003）→ 前端同口径必填，
  // 别只靠后端报错。字数上限与后端 @Size(max=2000) 对齐。
  const prompt = form.prompt.trim()
  if (!prompt) {
    errors.prompt = '请填写一句话指令（启用样例必填）'
    ok = false
  } else if (form.prompt.length > PROMPT_MAX) {
    errors.prompt = `一句话指令最多 ${PROMPT_MAX} 个字符`
    ok = false
  }

  const sc = form.schedule
  const mode = sc.scheduleMode || 'PERIODIC'
  if (mode === 'ONCE' || sc.scheduleType === 'ONCE') {
    if (!sc.onceAt) {
      errors.schedule = '请选择执行时间'
      ok = false
    } else if (new Date(sc.onceAt).getTime() <= Date.now()) {
      errors.schedule = '这个时间已经过去了，请选个以后的时间'
      ok = false
    }
  } else if (mode === 'INTERVAL') {
    if (!(sc.intervalCount > 0)) {
      errors.schedule = '请填写间隔数量'
      ok = false
    }
  } else if (mode === 'IDLE') {
    if (!(sc.idleCount > 0)) {
      errors.schedule = '请填写执行次数'
      ok = false
    }
  } else {
    const times = dedupeTimes(sc.times)
    if (!times.length) {
      errors.schedule = '请至少添加一个定点时间'
      ok = false
    } else if (sc.scheduleType === 'WEEKLY' && !(sc.daysOfWeek || []).length) {
      errors.schedule = '请至少选择一个执行星期'
      ok = false
    } else if (sc.scheduleType === 'MONTHLY' && !(sc.daysOfMonth || []).length) {
      errors.schedule = '请至少选择一个执行日期'
      ok = false
    }
  }
  // 起止日期（md §7.3：起始不填=立即生效，结束不填=一直有效；单次模式仅设起始，endDate 已清空）：
  // 起始晚于结束这段区间为空，任务永不会触发（2026-09-18 待办 yuepu#13·岗位 P2）
  if (!errors.schedule && sc.startDate && sc.endDate && sc.startDate > sc.endDate) {
    errors.schedule = '结束日期不能早于开始日期'
    ok = false
  }

  // 提示词必填（2026-09-21 负责人拍板，推翻 2026-09-12 审计 J7 / K9「提示词非必填」）；
  // 另守 md §7.4「最多 8000 字符」上限（K7）。
  if (!form.sopDoc.trim()) {
    errors.sopDoc = '请填写提示词'
    ok = false
  } else if (form.sopDoc.length > SOP_MAX) {
    errors.sopDoc = `提示词最多 ${SOP_MAX} 个字符`
    ok = false
  }
  return ok
}

function buildToolRefs() {
  return form.toolRefs.map((t) => ({
    type: t.type,
    code: t.code,
    bizName: bizNameMap.value.get(`${t.type}::${t.code}`) || t.bizName || undefined
  }))
}

// 提交用平台技能引用（只留后端契约字段 { platformSkillId, name }）
function buildSkillRefs() {
  return form.skillRefs.map((s) => ({
    platformSkillId: s.platformSkillId,
    name: s.name || undefined
  }))
}

function resetErrors() {
  errors.name = ''
  errors.prompt = ''
  errors.schedule = ''
  errors.sopDoc = ''
  errors.tools = ''
  errors.skills = ''
}

/* ---- 保存（显式，单按钮；对齐 TaskEditor.submit 但去启用/草稿双态） ---- */
async function save() {
  resetErrors()
  if (!validate()) {
    ElMessage.warning('请检查表单中标红的项')
    return
  }
  // 未选任何工具时给明确提醒（复用 TaskEditor 口径，确认才继续）
  if (!form.toolRefs.length) {
    try {
      await ElMessageBox.confirm(
        '你还没有选择任何工具，任务可能无法办成，确定继续吗？',
        '提示',
        { type: 'warning', confirmButtonText: '继续', cancelButtonText: '去选工具' }
      )
    } catch (e) {
      return
    }
  }
  const payload = {
    name: form.name.trim(),
    // 一句话指令：保留原文（含换行/[SILENT] 等语义），仅去首尾空白判空由 validate 兜住。
    prompt: form.prompt.trim(),
    remark: form.remark.trim() || undefined,
    schedule: buildSchedule(),
    sopDoc: form.sopDoc,
    toolRefs: buildToolRefs(),
    skillRefs: buildSkillRefs(),
    execType: form.execType || EXEC_TYPE_DEFAULT,
    execAgentId: form.execType === 'AGENT' ? (form.execAgentId ?? undefined) : undefined,
    execModel: form.execModel || undefined
    // 无 enable / status：样例默认启用（后端缺省 ENABLED），列表不呈现运行态。
  }
  saving.value = true
  try {
    // toast 文案逐字照 md §7.7 L431-432（2026-09-12 审计 K6）
    if (isEdit.value) {
      const vo = await updateSampleTask(props.positionId, props.sample.id, payload)
      ElMessage.success('样例任务已保存')
      clearDirty()
      emit('saved', vo)
    } else {
      const vo = await createSampleTask(props.positionId, payload)
      ElMessage.success('样例任务已创建')
      clearDirty()
      emit('created', vo)
    }
  } catch (e) {
    handleSubmitError(e)
  } finally {
    saving.value = false
  }
}

// 后端字段级错误回显（field 命中分区，对齐 TaskEditor.handleSubmitError）
function handleSubmitError(e) {
  if (e instanceof ApiError) {
    const field = e.field
    if (field === 'name') errors.name = e.message
    else if (field === 'prompt') errors.prompt = e.message
    else if (field === 'schedule') errors.schedule = e.message
    else if (field === 'sopDoc') errors.sopDoc = e.message
    else if (field === 'tools' || field === 'toolRefs') errors.tools = e.message
    else if (field === 'skills' || field === 'skillRefs') errors.skills = e.message
    else ElMessage.error(e.message || '保存失败，请检查后重试')
  } else {
    ElMessage.error('保存失败，请稍后重试')
  }
}

/* ============================ 回填 / 重置 ============================ */
function fillFrom(sample) {
  resetErrors()
  if (!sample) {
    form.name = ''
    form.prompt = ''
    form.remark = ''
    form.schedule = blankSchedule()
    form.sopDoc = ''
    form.toolRefs = []
    form.skillRefs = []
    form.execType = EXEC_TYPE_DEFAULT
    form.execAgentId = null
    form.execModel = ''
  } else {
    form.name = sample.name || ''
    // 详情回填 SampleTaskVO.prompt（后端出参）
    form.prompt = sample.prompt || ''
    form.remark = sample.remark || ''
    form.schedule = {
      scheduleMode: sample.schedule?.scheduleMode || 'PERIODIC',
      periodicPreset: inferPeriodicPreset(sample.schedule || {}),
      intervalCount: sample.schedule?.intervalCount || 1,
      intervalUnit: sample.schedule?.intervalUnit || 'DAY',
      idleCount: sample.schedule?.idleCount || 1,
      idleCountUnit: sample.schedule?.idleCountUnit || 'DAY',
      idleWindow: sample.schedule?.idleWindow || 'NIGHT',
      scheduleType: sample.schedule?.scheduleType || 'DAILY',
      daysOfWeek: sample.schedule?.daysOfWeek || [],
      daysOfMonth: sample.schedule?.daysOfMonth || [],
      times: sample.schedule?.times?.length ? sample.schedule.times : ['09:00'],
      onceAt: sample.schedule?.onceAt || '',
      startDate: sample.schedule?.startDate || '',
      endDate: sample.schedule?.endDate || ''
    }
    form.sopDoc = sample.sopDoc || ''
    form.toolRefs = (sample.toolRefs || []).map((t) => ({
      type: t.type,
      code: t.code,
      bizName: t.bizName,
      requiresConfirmation: false
    }))
    // 平台技能引用回填（后端 SampleTaskVO.skillRefs: [{ platformSkillId, name }]）
    form.skillRefs = (sample.skillRefs || [])
      .map((s) => ({
        platformSkillId: s.platformSkillId ?? s.id ?? s.skillId,
        name: s.name || ''
      }))
      .filter((s) => s.platformSkillId != null)
    form.execType = sample.execType || EXEC_TYPE_DEFAULT
    form.execAgentId = sample.execAgentId ?? null
    form.execModel = sample.execModel || ''
  }
  clearDirty()
  previewSummary.value = ''
  previewTimes.value = []
  previewError.value = ''
  doPreview()
}

// 切换条目（父组件已做脏检查）→ 重新回填
watch(
  () => props.sample,
  (s) => fillFrom(s)
)

onMounted(async () => {
  await Promise.all([loadTools(), loadSkillCandidates()])
  fillFrom(props.sample)
})
</script>

<template>
  <div class="ste-body">
    <div class="ste-scroll">
      <div class="ste-inner">
      <!-- 分区 1：基本信息 -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 基本信息
          <!-- 单任务启停（md §7.2）：从列表项移入卡头（负责人 0908 折中） -->
          <span v-if="isEdit" class="te-card-actions">
            <el-switch
              :model-value="taskEnabled"
              :loading="statusBusy"
              size="small"
              @change="emit('toggle-status')"
            />
            <span class="te-card-action-label">
              {{ taskEnabled ? '已启用' : '已停用' }}
            </span>
          </span>
        </div>
        <div class="te-card-body">
        <div class="te-field">
          <!-- 2026-09-10 岗位详情原型对齐（L1）：字数计数照原型移到标签行右侧，不再用输入框内 word-limit -->
          <label class="te-label">任务名称 <span class="req">*</span><span class="te-count">{{ (form.name || '').length }} / {{ NAME_MAX }}</span></label>
          <!-- 占位逐字照 md §7.2 L385；上限 64 = 一览表名称类统一规则（2026-09-12 负责人决策 1 裁定，J6 已闭环）。
               计数器与 maxlength 共用 NAME_MAX，避免两处分别维护再次写歪（2026-09-14 实测曾出现计数 /60、实拦 64） -->
          <el-input
            v-model="form.name"
            :maxlength="NAME_MAX"
            placeholder="如：每日经营分析报告"
            :class="{ 'is-err': errors.name }"
            @input="markDirty(); clearError('name')"
          />
          <p v-if="errors.name" class="te-err">{{ errors.name }}</p>
        </div>
        <div class="te-field">
          <label class="te-label">一句话指令 <span class="req">*</span><span class="te-count">{{ (form.prompt || '').length }} / {{ PROMPT_MAX }}</span></label>
          <el-input
            v-model="form.prompt"
            type="textarea"
            :rows="4"
            :maxlength="PROMPT_MAX"
            placeholder="描述任务目标，如：分析昨日核心指标并生成周报"
            :class="{ 'is-err': errors.prompt }"
            @input="markDirty(); clearError('prompt')"
          />
          <p class="te-field-hint">启用样例必填：这句话就是到点触发搭子办事的指令。</p>
          <p v-if="errors.prompt" class="te-err">{{ errors.prompt }}</p>
        </div>
        <div class="te-field">
          <label class="te-label">说明（备注）<span class="te-count">{{ (form.remark || '').length }} / {{ REMARK_MAX }}</span></label>
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="4"
            :maxlength="REMARK_MAX"
            placeholder="补充任务背景或注意事项"
            @input="markDirty"
          />
        </div>
        </div>
      </section>

      <!-- 分区 2：调度计划 -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 调度计划
        </div>
        <div class="te-card-body">
          <SchedulePicker
            v-model:schedule="form.schedule"
            :error="errors.schedule"
            :preview-summary="previewSummary"
            :preview-times="previewTimes"
            :preview-loading="previewLoading"
            :preview-error="previewError"
            @preview="onScheduleChange"
          />
        </div>
      </section>

      <!-- 分区 3：提示词（md §7.4：必填、最多 8000 字符；2026-09-21 负责人拍板改必填，原 2026-09-12 审计 J7 / K7 / K9 为非必填） -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 提示词 <span class="req">*</span>
        </div>
        <div class="te-card-body">
          <!-- 引导文案逐字照 md §7.4 L407 -->
          <p class="te-card-guide">
            使用自然语言描述任务目标、产出格式和推送方式。定时触发时，Agent 读取该内容作为任务指令执行业务。
          </p>
          <MarkdownEditor
            v-model="form.sopDoc"
            :error="errors.sopDoc"
            height="320px"
            placeholder="例如：每天上班前，用「工单查询工具」拉取昨日工单，汇总成今日待办清单。"
            @update:model-value="markDirty(); clearError('sopDoc')"
          />
          <!-- 脚部字数计数逐字照 md §7.4 L409「已输入 N / 8000 字」 -->
          <div class="te-editor-foot">
            <span class="te-editor-counter" :class="{ 'is-over': sopWordCount > SOP_MAX }">已输入 {{ sopWordCount }} / {{ SOP_MAX }} 字</span>
          </div>
        </div>
      </section>

      <!-- 分区 4：引用工具（#21：搜索 + 平铺行 + 卡底「＋ 添加工具」） -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 引用工具
        </div>
        <div class="te-card-body">
          <!-- 占位逐字照 md §7.5 L413（2026-09-12 审计 K8） -->
          <el-input
            v-model="toolKeyword"
            placeholder="搜索工具名称或类型"
            clearable
            class="tl-search"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>

          <div v-if="visibleToolRows.length" class="tl-list">
            <div v-for="r in visibleToolRows" :key="r.type + '::' + r.code" class="tl-row">
              <strong class="tl-name">{{ r.bizName }}</strong>
              <small class="tl-type">{{ r.type }}</small>
              <StatusTag :type="r.health === 'HEALTHY' ? 'success' : 'info'" class="tl-tag">
                {{ r.health === 'HEALTHY' ? '已验证' : '未验证' }}
              </StatusTag>
              <button
                type="button"
                class="tl-remove"
                title="移除该工具"
                aria-label="移除该工具"
                @click="removeToolRef(r)"
              >✕</button>
            </div>
          </div>
          <div v-else class="tl-empty">
            <template v-if="toolKeyword.trim() && toolRows.length">
              没有匹配「{{ toolKeyword.trim() }}」的已引用工具。
            </template>
            <!-- 空态逐字照 md §7.5 L416（2026-09-12 审计 K8） -->
            <template v-else>暂无引用工具，点击下方添加</template>
          </div>

          <button type="button" class="te-dash-add" @click="openToolPicker">+ 添加工具</button>
          <p v-if="errors.tools" class="te-err">{{ errors.tools }}</p>
        </div>
      </section>

      <!-- 分区 5：执行动作（触发时由谁来办：整个交给某个 Agent，或按下面指定的技能执行） -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 执行动作
        </div>
        <div class="te-card-body">
          <p class="te-card-guide">
            触发时由谁来办：整个交给某个 <b>Agent</b>，或按下面指定的<b>技能</b>执行。
          </p>
          <el-radio-group v-model="form.execType" class="te-exec-type-group" @change="markDirty">
            <el-radio value="SKILL">技能</el-radio>
            <el-radio value="AGENT">Agent</el-radio>
          </el-radio-group>
          <div v-if="form.execType === 'AGENT'" class="te-field te-exec-agent">
            <el-select
              v-model="form.execAgentId"
              placeholder="选择要执行的 Agent"
              clearable
              class="te-exec-agent-select"
              @change="markDirty"
            >
              <el-option
                v-for="a in store.agents"
                :key="a.agentId"
                :label="a.name"
                :value="a.agentId"
              />
            </el-select>
            <p class="te-card-guide te-exec-agent-hint">下发时会自动带上该 Agent 名下的已发布技能。</p>
          </div>
        </div>
      </section>

      <!-- 分区 6：执行模型（紧跟执行动作：先定谁来办，再定用哪个模型跑） -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 执行模型
        </div>
        <div class="te-card-body">
          <p class="te-card-guide">
            这条任务用哪个模型跑。<b>不选 = 跟随平台默认模型</b>；领用者后续可自行调整，不影响下次下发。
          </p>
          <el-select
            v-model="form.execModel"
            placeholder="跟随平台默认模型"
            clearable
            class="te-exec-model-select"
            @change="markDirty"
          >
            <el-option label="GLM5.3" value="xopglm53" />
            <el-option label="DeepSeek-V4-Flash（平台默认）" value="xopdeepseekv4flash" />
            <el-option label="GLM-5.2" value="xopglm52" />
            <el-option label="PaddleOCR-VL-1.6" value="xoppaddleocrv16" />
            <el-option label="DeepSeek-v4-pro" value="xopdeepseekv4pro" />
            <el-option label="Qwen3.6-35B-A3B（平台默认）" value="xopqwen36v35b" />
          </el-select>
        </div>
      </section>

      <!-- 分区 7：引用平台技能（#22：chips + 搜索 + 卡底「＋ 添加技能」） -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 引用平台技能
        </div>
        <div class="te-card-body">
          <p class="te-card-guide">
            引用<b>平台技能</b>（由系统配置员发布），让这条样例复用现成能力；你自建的 FDE 技能不在此列。
          </p>

          <!-- 无已选技能空态逐字照 md §7.6 L425（2026-09-12 审计 K8） -->
          <div v-if="!form.skillRefs.length" class="sk-none">暂无引用技能，点击下方添加</div>
          <!-- 已选平台技能 chips（名称 + 可移除） -->
          <div v-else class="sk-chips">
            <span v-for="s in form.skillRefs" :key="s.platformSkillId" class="sk-chip">
              <span class="sk-chip-name">{{ s.name || `技能 #${s.platformSkillId}` }}</span>
              <button
                type="button"
                class="sk-chip-x"
                title="移除"
                aria-label="移除"
                @click="removeSkillRef(s.platformSkillId)"
              >✕</button>
            </span>
          </div>

          <!-- 占位逐字照 md §7.6 L422（2026-09-12 审计 K8） -->
          <el-input
            v-model="skillKeyword"
            placeholder="搜索平台技能名称或描述"
            clearable
            class="sk-search"
            @input="onSkillSearch"
            @keyup.enter="loadSkillCandidates"
            @clear="loadSkillCandidates"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>

          <!-- 候选列表默认收起，点卡底「＋ 添加技能」才展开 -->
          <div v-if="skillPickerOpen" v-loading="skillsLoading" class="sk-list">
            <div v-if="!skillsLoading && !skillCandidates.length" class="sk-empty">
              <template v-if="skillKeyword.trim()">
                没有匹配「{{ skillKeyword.trim() }}」的平台技能。
              </template>
              <template v-else>
                没有可引用的平台技能（仅展示系统配置员发布给 FDE 的平台技能）。
              </template>
            </div>
            <div
              v-for="c in skillCandidates"
              :key="candId(c)"
              class="sk-row"
              :class="{ on: isSkillSelected(c) }"
              @click="toggleSkill(c)"
            >
              <el-checkbox
                :model-value="isSkillSelected(c)"
                class="sk-check"
                @click.stop="toggleSkill(c)"
              />
              <div class="sk-main">
                <div class="sk-name-line">
                  <span class="sk-name">{{ c.name }}</span>
                  <el-tooltip
                    v-if="hasCategory(c.category)"
                    :content="categoryLabel(c.category)"
                    placement="top"
                  >
                    <StatusTag :type="categoryTagType(c.category)" class="sk-cat">
                      {{ categoryLabel(c.category) }}
                    </StatusTag>
                  </el-tooltip>
                  <code v-if="c.code" class="sk-code">{{ c.code }}</code>
                </div>
                <div v-if="c.description" class="sk-desc" :title="c.description">{{ c.description }}</div>
              </div>
            </div>
          </div>

          <button type="button" class="te-dash-add" @click="toggleSkillPicker">
            {{ skillPickerOpen ? '收起技能候选' : '+ 添加技能' }}
          </button>
          <p v-if="errors.skills" class="te-err">{{ errors.skills }}</p>
        </div>
      </section>
      </div>
    </div>

    <!-- #21「＋ 添加工具」弹窗：复用 ToolPicker 勾选（原型该按钮无实现，行为按 md §7.4 补） -->
    <el-dialog
      v-model="toolPickerOpen"
      title="添加工具"
      width="640px"
      append-to-body
    >
      <ToolPicker
        v-model:selected="toolDraft"
        :available="available"
        :loading="toolsLoading"
        :show-confirm="false"
      />
      <template #footer>
        <el-button @click="toolPickerOpen = false">取消</el-button>
        <el-button type="primary" @click="confirmToolPicker">确定</el-button>
      </template>
    </el-dialog>

    <!-- 底部 sticky 操作条（复刻数据底座 .meta-actions；单一保存，无启用/草稿双态） -->
    <div class="meta-actions">
      <el-button type="primary" :loading="saving" @click="save">
        {{ isEdit ? '保存' : '创建样例' }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
/* 2026-09-12 审计 J5：退役 embedded 开关后只留页签内联形态——
   撑满外层 .st-col-edit（height: calc(100vh-166px)），内部 .ste-scroll 负责滚动；
   右栏 padding 已由 .st-col-edit（22px 28px 80px）承担，此处不再叠加。 */
.ste-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.ste-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
/* 右栏内容限宽 860 居中（原型 .pd2-task-detail-inner），卡间距 20px */
.ste-inner {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 860px;
  margin: 0 auto;
}

/* 分区卡（#18：卡头带 3px 绿条 + 灰底头条，卡体单独 18px 内边距，去阴影） */
.te-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  /* 原型 .pd2-task-section 实测 9px */
  border-radius: 9px;
  overflow: hidden;
}
.te-card-title {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 46px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-sunken);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
/* 左侧 3px 绿条（原型 .pd2-task-section-head:before） */
.te-card-title::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--c-accent);
}
/* 原 .te-card-dot 圆点由卡头绿条取代，保留元素但不占位（模板未删，避免影响其他复用点） */
.te-card-dot {
  display: none;
}
.te-card-body {
  padding: 18px;
}
/* 卡头右侧动作区（启停开关） */
.te-card-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.te-card-action-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-regular);
  color: var(--c-text-muted);
}
.te-card-hint {
  margin: calc(-1 * var(--space-2)) 0 var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
/* 卡体内的引导文案（原型 .pd2-task-editor-guide / .pd2-task-field-hint） */
.te-card-guide {
  margin: 0 0 12px;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: 1.6;
}
.te-card-guide b {
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
}

/* ── 提示词脚部：只留字数计数「已输入 N / 8000 字」（md §7.4） ── */
.te-editor-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 6px;
}
.te-editor-counter {
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}
.te-editor-counter.is-over {
  color: var(--c-danger);
}

/* ── #21 引用工具：搜索 + 已引用工具平铺行 ── */
.tl-search {
  width: 100%;
  margin-bottom: 10px;
}
.tl-list {
  display: grid;
  gap: 8px;
}
.tl-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.tl-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-type {
  flex-shrink: 0;
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.tl-tag {
  margin-left: auto;
  flex-shrink: 0;
}
.tl-remove {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--c-text-faint);
  cursor: pointer;
  font-size: var(--fs-sm);
  line-height: 1;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
}
.tl-remove:hover {
  color: var(--c-danger);
  background: var(--bg-hover);
}
.tl-empty {
  padding: var(--space-5);
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

/* 卡底满宽虚线添加按钮（原型 .pd2-task-tool-add / .pd2-task-skill-bottom-add） */
.te-dash-add {
  width: 100%;
  margin-top: 10px;
  padding: 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
  text-align: center;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.te-dash-add:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
}
.te-field {
  margin-bottom: var(--space-4);
}
.te-field:last-child {
  margin-bottom: 0;
}
.te-label {
  display: flex;
  align-items: center;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
}
/* 字数计数（原型态：标签行右端灰字，如「6 / 60」） */
.te-count {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.req {
  color: var(--c-danger);
}
.te-err {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
/* 字段内联提示（一句话指令的发布必填说明），沿用 .te-card-hint 视觉、muted 中性色 */
.te-field-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.is-err :deep(.el-input__wrapper),
.is-err :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}

.te-card-hint b {
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
}

/* ── 引用平台技能：无已选技能空态（md §7.6 L425），视觉同工具空态 .tl-empty ── */
.sk-none {
  padding: var(--space-5);
  margin-bottom: var(--space-3);
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

/* ── 引用平台技能：已选 chips ── */
.sk-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.sk-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-1) 2px var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--c-accent-soft);
  color: var(--c-accent);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  max-width: 100%;
}
.sk-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sk-chip-x {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--c-accent);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
}
.sk-chip-x:hover {
  background: var(--c-accent);
  color: var(--bg-surface);
}

/* ── 引用平台技能：搜索 + 候选列表（对齐 PlatformSkillRefPicker 视觉） ── */
.sk-search {
  width: 100%;
  margin-bottom: var(--space-2);
}
.sk-list {
  min-height: 120px;
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
.sk-empty {
  padding: var(--space-6);
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
}
.sk-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.sk-row:last-child {
  border-bottom: none;
}
.sk-row:hover {
  background: var(--bg-hover);
}
.sk-row.on {
  background: var(--bg-selected);
}
.sk-check {
  flex-shrink: 0;
  pointer-events: none;
}
.sk-main {
  flex: 1;
  min-width: 0;
}
.sk-name-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.sk-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sk-cat {
  flex-shrink: 0;
  cursor: default;
}
.sk-code {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-accent);
}
.sk-desc {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 执行动作：「技能 / Agent」两个单选横排 */
.te-exec-type-group {
  display: flex;
  margin-bottom: 12px;
}
.te-exec-agent {
  margin-top: 4px;
}
.te-exec-agent-select {
  width: 100%;
}
.te-exec-agent-hint {
  margin-top: 4px;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

/* 执行模型 */
.te-exec-model-select {
  width: 100%;
}

/* 底部操作条：右栏已卡片化并自带滚动（padding-bottom 80px 给按钮留位），随内容流、不 sticky
   （2026-09-10 逐像素对齐；2026-09-12 审计 J5 随 embedded 开关退役并入基础样式） */
.meta-actions {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) 0 0;
}
</style>
