<script setup>
/**
 * MCP 定义编辑器（2026-09-01 对齐 PRD-20260828《03能力/连接器/MCP》§三 + 交互原型 v2 openDrawer）。
 *
 * 分区：首行元信息（编辑/查看态：创建/最近更新/最近发布，与 API 弹窗同款——拍板覆盖 PRD §三.9 底部位置）
 *   → 粘贴导入（仅登记/编辑态）→ 基本信息（名称|图标 同行 → 服务描述[必填,2000+字数]）
 *   → 连接与鉴权（传输方式首位 → 地址/命令+鉴权 → 连接元信息紧凑行 → 测试连接 → 超时[必填,默认10000]末位）
 *   → 工具清单（默认收起，展开/收起；工具卡=名称+描述，入参逐工具「查看入参」折叠）
 *   → 被技能引用。
 * PRD §三.3 拍板：MCP code 不展示不填写（系统生成）、无 server 自报 id、无启用/停用控件、
 * 编辑页不展示使用统计（§三.4）；工具卡不展示序号/读写性质/引用限定名（§三.6.1，writeClass 数据透传保留）。
 * stdio Env 保持 V110 声明式行（2026-08-31 拍板，新于 PRD md 文本，不回退——差异记 PRD-review）。
 * 工具清单唯一来源是「拉取工具」；允许保存无工具的 MCP（发布另有非空门禁）。
 */
import { ref, reactive, computed, watch, nextTick } from 'vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { ElMessage } from 'element-plus'
import IconPickerPopover from '@/components/position/IconPickerPopover.vue'
import {
  createMcp,
  updateMcp,
  getMcp,
  testMcpConn,
  fetchMcpTools,
  fetchMcpToolsDraft
} from '@/api/admin'
import { validateMcpForm, MCP_TRANSPORTS, MCP_AUTH_TYPES, MCP_COMMAND_OPTIONS } from '@/utils/defValidate'
import { parseMcpConfig } from '@/utils/mcpImport'
import { envRowsFromDetail, buildEnvSubmit, buildProbeEnv } from '@/utils/mcpEnv'
import ParamRowsEditor from '@/components/admin/ParamRowsEditor.vue'
import { MCP_AUTH_CONFIG_ENABLED } from '@/utils/featureFlags'
import { schemaToRows } from '@/utils/schema'
import { mergeFetchedTools, connMeta } from '@/utils/mcpMeta'
import { fmtTime } from '@/utils/docMeta'
import { iconIsUrl } from '@/utils/iconDisplay'

const props = defineProps({
  visible: { type: Boolean, default: false },
  mcpId: { type: [Number, String], default: null },
  /**
   * 只读查看（2026-08-21，与模型页 ModelConfigEditDialog 的 readonly 同口径）。
   *
   * <p>三个入口共用本组件：登记（mcpId=null）、编辑、只读查看。只读时表单整体禁用、
   * 底部只留「关闭」——审核中不允许改配置，但仍要能看清审的是什么。</p>
   */
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved', 'probed'])

const isEdit = computed(() => props.mcpId != null)
const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)

const form = reactive({
  name: '', // 必填 ≤64（PRD §三.3）
  description: '', // 服务描述（必填 ≤2000，PRD §三.3）
  icon: '', // 图标（必填，PRD §三.3）：emoji 字符 或 /api/public/icons/<文件名>
  timeoutMs: 10000, // 超时（必填，PRD §三.4）：默认 10000 ms，1000～120000
  transport: 'streamable-http',
  endpoint: '',
  // —— stdio 专用连接字段（设计 §6.1；http 不显示/不下发）——
  command: '', // 启动命令（不含参数）；V110 纯下拉（MCP_COMMAND_OPTIONS，存量非枚举值动态追加回显）
  argsText: '', // args 多行文本，每行一个 arg；提交时拆成数组
  status: 'active',
  authConfigMasked: false,
  // —— 鉴权录入（仅 streamable-http；MCP_AUTH_CONFIG_ENABLED 开放）——
  authType: 'none', // none | bearer | header（与后端 applyAuth 对齐，小写）
  authHeaderName: '', // 自定义 Header 名（仅 header）
  authValue: '' // 密钥明文（仅提交瞬间存在；永不回显，编辑态留空=保留原值）
})
// 鉴权录入区开关 + 类型枚举（构建期常量）
const authEnabled = MCP_AUTH_CONFIG_ENABLED
const authTypes = MCP_AUTH_TYPES
// 编辑态后端脱敏回显的鉴权信息（{ type, headerName, valueMasked }；未配置/none 为 null）
const authInfoLoaded = ref(null)
// 当前所选类型下是否已配置密钥（决定「留空=保留原值」是否可用；类型切换后旧密钥字段不同，不可保留）
const authConfigured = computed(
  () =>
    !!authInfoLoaded.value?.valueMasked &&
    authInfoLoaded.value.type === form.authType
)
// Env 声明式行（V110 弹窗改造 B 节）：[{ key, description, clientFill, value, configured }]。
// 行列表 = 完整期望集（提交后端按 KEY merge，缺 KEY=删除）；value 永不回显（留空=保留旧密文）。
// 行编辑交互收口在公共组件 ParamRowsEditor（API KEY 鉴权同款，B.3 抽象）。
const envRows = ref([])
// Command 纯下拉（拍板）：存量非枚举值（如绝对路径）动态追加为选项回显，不丢数据可正常保存。
const commandOptions = computed(() => {
  const c = (form.command || '').trim()
  return c && !MCP_COMMAND_OPTIONS.includes(c) ? [c, ...MCP_COMMAND_OPTIONS] : MCP_COMMAND_OPTIONS
})
// 工具清单（只读，来自拉取）：[{ name, description, writeClass, inputSchema, _flatRows }]。
// inputSchema 保留 server 原始对象（保存时原样透传，不经字段行往返、不丢约束细节）；
// _flatRows 为预计算的只读展示行（schema 拍平，随 load/拉取一次性生成）。
const tools = ref([])
// 工具清单折叠态（PRD §三.6）：默认收起；拉取成功自动展开。逐工具入参独立折叠（重进/重拉恢复折叠）。
const toolsOpen = ref(false)
const openSchemas = ref({})
function toggleSchema(name) {
  openSchemas.value = { ...openSchemas.value, [name]: !openSchemas.value[name] }
}
// 被引用列表（契约 §2.2，只读）：[{ skillId, skillName }]
const referencedBySkills = ref([])
// 时间信息（PRD §三.9，编辑/查看态底部弱化展示）
const times = reactive({ createdAt: null, updatedAt: null, publishedAt: null })
// 连接元信息（详情 §1.2，编辑态展示；探测后就地刷新）
const conn = reactive({
  connStatus: 'unknown',
  protocolVersion: '',
  serverVersion: '',
  lastCheckedAt: null,
  serverName: '' // server 自报 id（serverInfo.name），只读，与我方 code 区分
})
// 使用统计不再于编辑页展示（PRD §三.4：管理端编辑页不展示调用次数/平均执行时间等）
const fieldErrors = reactive({})

// —— 一键导入：粘贴整段 MCP 配置 JSON 自动解析回填（便捷录入，纯前端形态转换）——
const importOpen = ref(false)
const importText = ref('')

const transports = MCP_TRANSPORTS

// —— 真实运行时：测试连接 / 拉取工具（数秒外呼，loading + 防重复点击）——
const testing = ref(false)
const fetching = ref(false)
// 测试连接结果：{ ok, protocolVersion, serverVersion, latencyMs, failReason } | null
const testResult = ref(null)
// 连接态三态标签（契约 §1.3）
const connTag = computed(() => connMeta(conn.connStatus))

function clearErrors() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
}
/**
 * 图标是否为图片 URL（V97）。判别口径与岗位头像一致（契约 §2.3）：
 * 以 /api/public/icons/ 开头 = 上传的图片（<img> 直接 GET，免 token）；否则按 emoji 字符渲染。
 */
const iconIsUrlFlag = computed(() => iconIsUrl(form.icon))

/** IconPickerPopover 回吐 { icon, iconSource }；此处只取 icon（MCP 不需要来源标记）。 */
function onIconPick(payload) {
  if (payload && typeof payload.icon === 'string') {
    form.icon = payload.icon
  }
}

function resetForm() {
  form.name = ''
  form.description = ''
  form.icon = ''
  form.timeoutMs = 10000
  form.transport = 'streamable-http'
  form.endpoint = ''
  form.command = ''
  form.argsText = ''
  form.status = 'active'
  form.authConfigMasked = false
  form.authType = 'none'
  form.authHeaderName = ''
  form.authValue = ''
  authInfoLoaded.value = null
  envRows.value = []
  tools.value = []
  toolsOpen.value = false
  openSchemas.value = {}
  referencedBySkills.value = []
  times.createdAt = null
  times.updatedAt = null
  times.publishedAt = null
  testResult.value = null
  conn.connStatus = 'unknown'
  conn.protocolVersion = ''
  conn.serverVersion = ''
  conn.lastCheckedAt = null
  conn.serverName = ''
  importOpen.value = false
  importText.value = ''
  clearErrors()
}

// 一键导入：解析粘贴的 MCP 配置 → 回填表单字段。
// transport 先切换（触发 watch 清理对侧脏字段），nextTick 后再填目标字段；
// command/args/env（或 endpoint）按解析结果覆盖；name/code 仅在为空时补全（非破坏）。
async function doImport() {
  const r = parseMcpConfig(importText.value)
  if (!r.ok) {
    ElMessage.error(r.error)
    return
  }
  form.transport = r.transport
  await nextTick() // 等 transport watch 跑完清理，避免刚填的值被清空
  if (r.transport === 'stdio') {
    form.command = r.command
    form.argsText = r.args.join('\n')
    // 导入的 env 全部按「平台值」落行（导入配置里带的是明文值）；客户端填写勾选由 FDE 之后按需调整
    envRows.value = r.env.map((e) => ({
      key: e.key,
      description: '',
      clientFill: false,
      value: e.value,
      configured: false
    }))
    delete fieldErrors.command
    delete fieldErrors.args
    delete fieldErrors.env
  } else {
    form.endpoint = r.endpoint
    delete fieldErrors.endpoint
  }
  // 名称便捷预填（仅为空时，避免覆盖用户已填内容）；
  // server key 只用于解析，不作为可见/可编辑的 MCP code（PRD §三.2）
  if (r.key && !form.name.trim()) form.name = r.key
  importOpen.value = false
  importText.value = ''
  if (r.warnings.length) {
    ElMessage.warning({ message: `已填充，请注意：${r.warnings.join('；')}`, duration: 6000 })
  } else {
    ElMessage.success('已解析并填充到下方表单')
  }
}

async function load() {
  clearErrors()
  testResult.value = null
  if (!isEdit.value) {
    resetForm()
    return
  }
  loading.value = true
  loadError.value = false
  try {
    const d = await getMcp(props.mcpId)
    form.name = d.name || ''
    form.description = d.description || ''
    form.icon = d.icon || ''
    form.timeoutMs = d.timeoutMs ?? 10000
    form.transport = d.transport || 'streamable-http'
    form.endpoint = d.endpoint || ''
    form.status = d.status || 'active'
    form.authConfigMasked = !!d.authConfigMasked
    // 鉴权脱敏回填（authInfo = { type, headerName, valueMasked }；密钥永不回显，authValue 恒置空）
    authInfoLoaded.value = d.authInfo || null
    form.authType = d.authInfo?.type === 'bearer' || d.authInfo?.type === 'header' ? d.authInfo.type : 'none'
    form.authHeaderName = d.authInfo?.headerName || ''
    form.authValue = ''
    // stdio 连接字段回填（http 行后端置空，此处自然得空）。args 是字符串数组 → 多行文本（每行一项）。
    form.command = d.command || ''
    form.argsText = Array.isArray(d.args) ? d.args.join('\n') : ''
    // env 声明式回填（V110）：后端回 [{ key, valueMasked, description?, clientFill? }]，
    // 绝不回明文/密文；平台值行 value 恒空（留空=保留旧值，重填=覆盖）。
    envRows.value = envRowsFromDetail(d.env)
    tools.value = (d.tools || []).map((t) => ({
      name: t.name || '',
      description: t.description || '',
      // 读/写性质：唯一可标注字段（缺省兜底 READ；后端合并层恒回填，正常不触发）。
      writeClass: t.writeClass === 'WRITE' ? 'WRITE' : 'READ',
      // V97：判定来源 MANUAL/SERVER/HEURISTIC —— 启发式猜的不如 server 声明可靠，界面据此提示复核。
      writeClassSource: t.writeClassSource || 'HEURISTIC',
      // V97：server 声明的面向人的显示名（MCP 官方 Tool.title），可空。
      title: t.title || '',
      inputSchema: t.inputSchema ?? null,
      _flatRows: flattenRows(schemaToRows(t.inputSchema))
    }))
    // 工具入参恢复默认折叠（PRD §三.6.2：重新进入后全部折叠），清单整体亦收起
    toolsOpen.value = false
    openSchemas.value = {}
    referencedBySkills.value = d.referencedBySkills || []
    times.createdAt = d.createdAt || null
    times.updatedAt = d.updatedAt || null
    times.publishedAt = d.publishedAt || null
    conn.connStatus = d.connStatus || 'unknown'
    conn.protocolVersion = d.protocolVersion || ''
    conn.serverVersion = d.serverVersion || ''
    conn.lastCheckedAt = d.lastCheckedAt || null
    conn.serverName = d.serverName || ''
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.mcpId],
  ([vis]) => {
    if (vis) load()
  }
)

// 切换 transport 时清理「另一形态」字段值，避免提交脏数据（设计 §6 / 实现要点 5）。
// http→不再下发 command/args/env，清空；stdio→不再下发 endpoint，清空。
// 同步清掉对侧的字段级红框，避免切换后残留无关报错。
watch(
  () => form.transport,
  (t) => {
    if (t === 'streamable-http') {
      form.command = ''
      form.argsText = ''
      envRows.value = []
      delete fieldErrors.command
      delete fieldErrors.args
      delete fieldErrors.env
    } else if (t === 'stdio') {
      form.endpoint = ''
      delete fieldErrors.endpoint
      // stdio 鉴权走 Environment 注入，清掉 http 鉴权录入（后端 stdio 亦置空 auth_config）
      form.authType = 'none'
      form.authHeaderName = ''
      form.authValue = ''
      delete fieldErrors.authConfig
    }
  }
)

function close() {
  emit('update:visible', false)
}

// 工具清单只读化：不再提供手动添加/移除，工具全集以「拉取工具」结果为准。
// 读/写性质展示已按 PRD §三.6.1 移除（writeClass 数据仍随拉取结果透传保存，供运行时确认语义用）。

// 只读展示：多级字段行拍平（带缩进深度），模板免递归组件。
// 结果在 load()/adoptToolRows() 一次性预计算为 _flatRows（schema 只读不变，避免每次重渲染递归重算）。
function flattenRows(rows, depth = 0, prefix = '') {
  const out = []
  for (const r of rows || []) {
    const key = `${prefix}${r.name}`
    out.push({ ...r, depth, key })
    if (r.children && r.children.length) {
      out.push(...flattenRows(r.children, depth + 1, `${key}.`))
    }
  }
  return out
}

// argsText 多行 → 字符串数组（每行一个 arg，空行/纯空白行忽略）。后端 args 为 jsonb 字符串数组。
function parseArgs() {
  return form.argsText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

// 组装 stdio 连接字段（command/args/env，保存用）。transport=http 时不调用（http 不下发这三者，设计 §1.2）。
// env 下发「完整期望集」（后端把列表当全量）：行列表即全量——平台行留空值=保留旧密文、
// 填值=覆盖、行被删=后端丢弃该 KEY；clientFill 行只带声明不带值。组装口径见 buildEnvSubmit。
function buildStdioFields() {
  const command = form.command.trim() || null
  const args = parseArgs()
  const env = buildEnvSubmit(envRows.value)
  return { command, args, env }
}

// 保存用鉴权配置（仅 streamable-http 且录入区开放；密钥明文仅提交瞬间存在，后端加密落库）。
// 密钥留空 → 不带 token/value 键（后端「留空=保留旧值」）；type=none → 显式清空。
// 录入区未开放 → 返回 null（不携带，后端整体保留既有配置，含存量别名引用）。
function buildAuthConfig() {
  if (!authEnabled || form.transport !== 'streamable-http') return null
  if (form.authType === 'bearer') {
    const cfg = { type: 'bearer' }
    const v = form.authValue.trim()
    if (v) cfg.token = v
    return cfg
  }
  if (form.authType === 'header') {
    const cfg = { type: 'header', headerName: form.authHeaderName.trim() }
    const v = form.authValue.trim()
    if (v) cfg.value = v
    return cfg
  }
  return { type: 'none' }
}

// 探测用鉴权配置（test-connection / draft fetch-tools）：
// - 本次重填了密钥 → 携明文试连（探测暂态，不落库，与 stdio 草稿 env 同口径）；
// - 选「无鉴权」→ 显式 {type:'none'}（已存对象也按无鉴权试连）；
// - 留空未填 → 不携带（undefined），已存对象由后端回退库内密文，草稿视为无鉴权。
function buildProbeAuthConfig() {
  if (!authEnabled || form.transport !== 'streamable-http') return undefined
  if (form.authType === 'none') return { type: 'none' }
  const v = form.authValue.trim()
  if (!v) return undefined
  return form.authType === 'bearer'
    ? { type: 'bearer', token: v }
    : { type: 'header', headerName: form.authHeaderName.trim(), value: v }
}

// 草稿/连接探测请求体（test-connection / draft fetch-tools 共用；已存场景由后端回退库值）
function buildProbePayload() {
  const payload = {
    transport: form.transport
  }
  if (form.transport === 'stdio') {
    payload.command = form.command.trim() || null
    payload.args = parseArgs()
    // 探测 env（仅 {key,value}）：平台行下发（重填明文/留空回退库值）；
    // clientFill 行无值不下发——管理端探测代表不了客户端环境，该服务必需此变量时探测可能失败（预期）
    payload.env = buildProbeEnv(envRows.value)
  } else {
    payload.endpoint = form.endpoint.trim() || null
    // 鉴权：本次重填的明文仅探测暂态下发；留空由后端回退库内密文（已存对象）
    const probeAuth = buildProbeAuthConfig()
    if (probeAuth !== undefined) payload.authConfig = probeAuth
  }
  if (isEdit.value) payload.id = props.mcpId
  return payload
}

// 统一处理外呼失败：W(skipGlobalError) 抛 ApiError，message 已脱敏可直接展示；
// 有 field 做字段级红框，否则 toast。
function handleProbeError(e) {
  if (e?.field) {
    fieldErrors[e.field] = e.message || '校验未通过'
    ElMessage.error(e.message || '校验未通过')
  } else {
    ElMessage.error(e?.message || '操作失败，请稍后重试')
  }
}

// 测试连接：仅握手，回显 ok/版本/延迟 或脱敏 failReason（不返回工具数）
async function testConn() {
  if (testing.value || fetching.value) return
  clearErrors()
  testResult.value = null
  testing.value = true
  try {
    const data = await testMcpConn(buildProbePayload())
    testResult.value = data || { ok: false, failReason: '探测无结果' }
  } catch (e) {
    handleProbeError(e)
  } finally {
    testing.value = false
  }
}

// inputSchema → 展示区形态适配（合并后落地到 tools.value）：保留 server 原始 schema + 预计算只读展示行。
function adoptToolRows(merged) {
  return {
    name: merged.name || '',
    description: merged.description || '',
    writeClass: merged.writeClass === 'WRITE' ? 'WRITE' : 'READ',
    inputSchema: merged.inputSchema ?? null,
    _flatRows: flattenRows(schemaToRows(merged.inputSchema))
  }
}

// 拉取工具：已存用 fetchMcpTools(id)（后端已回填，用返回 tools 刷新）；
// 草稿用 fetchMcpToolsDraft(payload)（writeClass 由后端启发式回填）。server 返回即工具全集（只读权威），
// 仅 writeClass 按 name 保留界面上的标注（含未保存改动）。
async function fetchTools() {
  if (testing.value || fetching.value) return
  clearErrors()
  fetching.value = true
  try {
    const data = isEdit.value
      ? await fetchMcpTools(props.mcpId)
      : await fetchMcpToolsDraft(buildProbePayload())
    const fetched = data?.tools || []
    const current = tools.value.map((t) => ({ name: t.name, writeClass: t.writeClass }))
    tools.value = mergeFetchedTools(current, fetched).map(adoptToolRows)
    // 拉取成功后自动展开清单（PRD §三.6），逐工具入参恢复默认折叠（§三.6.2）
    toolsOpen.value = true
    openSchemas.value = {}
    // 就地刷新本编辑器内连接元信息
    if (data?.connStatus) conn.connStatus = data.connStatus
    if (data?.protocolVersion) conn.protocolVersion = data.protocolVersion
    if (data?.serverVersion) conn.serverVersion = data.serverVersion
    conn.lastCheckedAt = data?.lastCheckedAt || new Date().toISOString()
    // 拉取成功联动连接态：通知父组件就地刷新该行标签（已存场景后端已写库）
    emit('probed', {
      id: isEdit.value ? props.mcpId : null,
      connStatus: data?.connStatus,
      protocolVersion: data?.protocolVersion,
      serverVersion: data?.serverVersion
    })
    ElMessage.success(`已拉取 ${fetched.length} 个工具`)
  } catch (e) {
    // 契约 §3：失败时 data 仍附带最新连接状态，供父组件就地更新行标签（免重拉 detail）
    if (e?.data && (e.data.connStatus || e.data.lastCheckedAt)) {
      if (e.data.connStatus) conn.connStatus = e.data.connStatus
      if (e.data.lastCheckedAt) conn.lastCheckedAt = e.data.lastCheckedAt
      emit('probed', {
        id: isEdit.value ? props.mcpId : null,
        connStatus: e.data.connStatus,
        lastCheckedAt: e.data.lastCheckedAt
      })
    }
    handleProbeError(e)
  } finally {
    fetching.value = false
  }
}

function buildPayload() {
  const payload = {
    name: form.name.trim(),
    description: form.description.trim() || null, // 空串归 null，与后端 blank→null 一致
    icon: form.icon || null, // V97：空串归 null（未配置）
    timeoutMs: form.timeoutMs ?? null, // V97：null=跟随全局默认
    transport: form.transport,
    tools: tools.value.map((t) => ({
      // 只读权威字段原样回传（拉取结果骨架）；writeClass 是唯一可标注字段，
      // 后端按 name merge 局部更新到 tools_cache（bizName/requiresConfirmation 已退役为派生值）。
      name: t.name,
      description: t.description,
      writeClass: t.writeClass === 'WRITE' ? 'WRITE' : 'READ',
      inputSchema: t.inputSchema ?? null
    })),
    // 鉴权：{type, headerName?, token?/value?}（密钥留空=保留旧值；none=清空；录入区未开放为 null=整体保留）
    authConfig: buildAuthConfig(),
    status: form.status
  }
  // 连接字段按 transport 分流下发（设计 §1.2）：http 只传 endpoint；stdio 只传 command/args/env。
  if (form.transport === 'stdio') {
    const { command, args, env } = buildStdioFields()
    payload.command = command
    payload.args = args
    payload.env = env // 留空项不下发明文，后端按「留空=保留旧值」merge
  } else {
    payload.endpoint = form.endpoint.trim() || null
  }
  // code 不再由前端提交（PRD §三.3：系统生成，不展示不填写；mock 保存时自动生成）
  return payload
}

async function save() {
  clearErrors()
  // 校验视图：argsText 解析成数组、env 用声明式行原样喂给校验器（互斥/必值规则在 validateMcpEnv）。
  const validateView = {
    ...form,
    args: parseArgs(),
    env: envRows.value,
    // 鉴权校验视图：录入区未开放时不校验（authType 置空跳过）；同类型已配置可留空=保留原值
    authType: authEnabled ? form.authType : '',
    authConfigured: authConfigured.value
  }
  const { ok, errors } = validateMcpForm(validateView)
  if (!ok) {
    Object.assign(fieldErrors, errors)
    ElMessage.warning('请先修正标红项')
    return
  }
  saving.value = true
  try {
    const payload = buildPayload()
    const data = isEdit.value
      ? await updateMcp(props.mcpId, payload)
      : await createMcp(payload)
    ElMessage.success(isEdit.value ? '已保存' : '已登记')
    emit('saved', { id: isEdit.value ? props.mcpId : data?.id })
    close()
  } catch (e) {
    if (e?.field) {
      fieldErrors[e.field] = e.message || '校验未通过'
      ElMessage.error(e.message || '校验未通过')
    } else {
      ElMessage.error(e?.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <DrawerEditor
    :visible="visible"
    entity="MCP"
    :is-edit="isEdit"
    :readonly="props.readonly"
    :loading="loading"
    :error="loadError"
    :saving="saving"
    create-text="登记"
    @update:visible="emit('update:visible', $event)"
    @retry="load"
    @save="save"
  >
      <!-- 首行元信息（2026-09-01 拍板：与 API 弹窗同款，时间行上移首行；覆盖 PRD §三.9 底部位置） -->
      <div v-if="isEdit" class="md-times">
        <span>创建时间：{{ times.createdAt ? fmtTime(times.createdAt) : '—' }}</span>
        <span>最近更新：{{ times.updatedAt ? fmtTime(times.updatedAt) : '—' }}</span>
        <span>最近发布：{{ times.publishedAt ? fmtTime(times.publishedAt) : '—' }}</span>
      </div>

      <!-- 一键导入：粘贴整段 MCP 配置 JSON，自动解析回填下方字段（仅登记/编辑态，PRD §三.2） -->
      <section v-if="!props.readonly" class="md-sec md-import">
        <div class="md-import-head">
          <div>
            <span class="md-sec-title" style="margin: 0">从配置粘贴导入</span>
            <span class="md-sec-sub">粘贴一段 MCP 服务配置 JSON，自动解析填充下方字段</span>
          </div>
          <el-button link type="primary" @click="importOpen = !importOpen">
            {{ importOpen ? '收起' : '粘贴配置导入' }}
          </el-button>
        </div>
        <div v-if="importOpen" class="md-import-body">
          <el-input
            v-model="importText"
            type="textarea"
            :rows="6"
            :autosize="{ minRows: 6, maxRows: 16 }"
            spellcheck="false"
            placeholder='粘贴形如：
{
  "mcpServers": {
    "amap-maps": {
      "command": "npx",
      "args": ["-y", "@amap/amap-maps-mcp-server"],
      "env": { "AMAP_MAPS_API_KEY": "" }
    }
  }
}'
          />
          <div class="md-import-actions">
            <el-button type="primary" :disabled="!importText.trim()" @click="doImport">
              解析并填充
            </el-button>
            <el-button :disabled="!importText" @click="importText = ''">清空</el-button>
            <span class="md-import-hint">
              支持 stdio（command/args/env）与 http（url）；env 值留空的需手动补全后再保存
            </span>
          </div>
        </div>
      </section>

      <section class="md-sec">
        <div class="md-sec-title">基本信息</div>
        <el-form label-position="top" :disabled="props.readonly">
          <!-- 第一行：名称 | 图标 同行（PRD §三.1/原型 basic-info-grid）；code/server 自报 id/状态控件均不展示（§三.3） -->
          <div class="md-row2">
            <el-form-item label="名称" :error="fieldErrors.name" required class="md-name-item">
              <el-input v-model="form.name" maxlength="64" placeholder="如 报销系统 MCP" />
            </el-form-item>
            <el-form-item label="图标" :error="fieldErrors.icon" required class="md-icon-item">
              <div class="md-icon-row">
                <span class="md-icon-preview" :class="{ 'is-empty': !form.icon }">
                  <img v-if="iconIsUrlFlag" :src="form.icon" alt="" class="md-icon-img" />
                  <span v-else-if="form.icon">{{ form.icon }}</span>
                  <span v-else class="md-icon-ph">—</span>
                </span>
                <IconPickerPopover
                  v-if="!props.readonly"
                  :icon="form.icon"
                  :position-name="form.name"
                  @pick="onIconPick"
                />
              </div>
            </el-form-item>
          </div>
          <el-form-item label="服务描述" :error="fieldErrors.description" required>
            <el-input
              v-model="form.description"
              type="textarea"
              :rows="2"
              :autosize="{ minRows: 2, maxRows: 4 }"
              maxlength="2000"
              show-word-limit
              placeholder="一句话说明这个 MCP 服务是做什么的（如：对接报销系统，提供报销单查询与提交）"
            />
          </el-form-item>
        </el-form>
      </section>

      <!-- 连接与鉴权（PRD §三.4：传输方式首位 → 主要配置 → 元信息紧凑行 → 测试连接 → 超时末位） -->
      <section class="md-sec">
        <div class="md-sec-title">
          连接与鉴权
          <span class="md-sec-sub">「测试连接」仅做握手探测连通性，不返回工具列表（拉工具见下方）</span>
        </div>
        <el-form label-position="top" :disabled="props.readonly">
          <el-form-item label="传输方式" :error="fieldErrors.transport" required>
            <el-select v-model="form.transport" class="md-w">
              <el-option v-for="t in transports" :key="t" :value="t" :label="t" />
            </el-select>
          </el-form-item>
          <!-- streamable-http：Endpoint/URL（必填） -->
          <el-form-item
            v-if="form.transport === 'streamable-http'"
            :error="fieldErrors.endpoint"
            required
          >
            <template #label><span>MCP 服务地址（Endpoint）</span></template>
            <el-input v-model="form.endpoint" placeholder="如 https://example.com/mcp（内网）" />
          </el-form-item>

          <!-- stdio：Command + args + Env（仅 stdio 显示/下发；env 仅 stdio 存储；V110 弹窗改造 B 节） -->
          <template v-else-if="form.transport === 'stdio'">
            <el-form-item :error="fieldErrors.command">
              <template #label>
                <span>Command <em class="req">*</em></span>
                <span class="lbl-hint">（仅命令本身，参数填下方 args）</span>
              </template>
              <!-- 纯下拉（拍板）：枚举常见命令；存量非枚举值（如绝对路径）动态追加为选项回显 -->
              <el-select v-model="form.command" class="md-w" placeholder="选择启动命令">
                <el-option v-for="c in commandOptions" :key="c" :value="c" :label="c" />
              </el-select>
            </el-form-item>
            <el-form-item :error="fieldErrors.args">
              <template #label>
                <span>args</span>
                <span class="lbl-hint">（每行一个参数；密钥不要写进 args，最多用 ${变量名} 引用下方 Env）</span>
              </template>
              <el-input
                v-model="form.argsText"
                type="textarea"
                :rows="2"
                :autosize="{ minRows: 2, maxRows: 6 }"
                placeholder="-y&#10;@modelcontextprotocol/server-foo"
              />
            </el-form-item>
            <el-form-item :error="fieldErrors.env">
              <template #label>
                <span>Env</span>
                <span class="lbl-hint">
                  （环境变量声明；平台值加密存储、不回显，编辑留空=保留原值；勾选客户端填写则值由客户端收集）
                </span>
              </template>
              <ParamRowsEditor
                :rows="envRows"
                :readonly="props.readonly"
                client-fill-hint="含客户端填写变量：值由客户端收集后才可启用该服务，管理端「测试连接」可能因缺变量失败（属预期）"
                @update:rows="envRows = $event"
                @interact="delete fieldErrors.env"
              />
            </el-form-item>
          </template>

          <!-- 鉴权配置：仅 streamable-http（HTTP 头）。stdio 鉴权走 Environment 注入，无 HTTP 头。 -->
          <template v-if="form.transport === 'streamable-http'">
            <!-- 录入区未开放（MCP_AUTH_CONFIG_ENABLED=false）：只读占位，保存不携带 authConfig（后端保留既有配置） -->
            <el-form-item v-if="!authEnabled" label="鉴权配置">
              <el-input disabled :placeholder="form.authConfigMasked ? '已配置（脱敏，不回显明文）' : '暂未开放录入'" />
            </el-form-item>
            <template v-else>
              <el-form-item label="鉴权方式">
                <el-select v-model="form.authType" class="md-w">
                  <el-option v-for="t in authTypes" :key="t.value" :value="t.value" :label="t.label" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="form.authType === 'header'">
                <template #label>
                  <span>Header 名 <em class="req">*</em></span>
                  <span class="lbl-hint">（字母 / 数字 / 连字符）</span>
                </template>
                <el-input v-model="form.authHeaderName" maxlength="128" placeholder="如 X-Api-Key" />
              </el-form-item>
              <el-form-item v-if="form.authType !== 'none'" :error="fieldErrors.authConfig">
                <template #label>
                  <span>{{ form.authType === 'bearer' ? 'Bearer Token' : '访问凭证' }} <em v-if="!authConfigured" class="req">*</em></span>
                  <span class="lbl-hint">（密钥不回显{{ authConfigured ? '，留空保留原值、重填覆盖' : '' }}）</span>
                </template>
                <!-- 已配置掩码提示（全站密钥掩码口径，模型页同款形态）：明文不回显，掩码供核对 -->
                <div v-if="authConfigured" class="md-auth-masked">
                  当前：<code>{{
                    typeof authInfoLoaded?.valueMasked === 'string' ? authInfoLoaded.valueMasked : '已配置'
                  }}</code>（留空保留原值，重填覆盖）
                </div>
                <!-- Bearer 前置完整请求头格式（与 API 页 Bearer 同款），避免误把前缀粘进 Token -->
                <el-input
                  v-model="form.authValue"
                  type="password"
                  show-password
                  autocomplete="new-password"
                  :class="{ 'md-bearer-input': form.authType === 'bearer' }"
                  :placeholder="form.authType === 'bearer' ? '粘贴 Bearer Token（不含 Bearer 前缀）' : '粘贴 API Key'"
                >
                  <template v-if="form.authType === 'bearer'" #prepend>Authorization: Bearer</template>
                </el-input>
              </el-form-item>
            </template>
          </template>
        </el-form>
        <!-- 连接元信息紧凑行（PRD §三.4：编辑/查看已有 MCP 时展示，无内容显示 —，不拆统计卡片） -->
        <div v-if="isEdit" class="md-conn-meta">
          <span class="md-conn-meta-item">
            连接状态：
            <el-tag :type="connTag.tag" size="small">{{ connTag.label }}</el-tag>
          </span>
          <span class="md-conn-meta-item">协议版本：{{ conn.protocolVersion || '—' }}</span>
          <span class="md-conn-meta-item">Server 版本：{{ conn.serverVersion || '—' }}</span>
          <span class="md-conn-meta-item">
            最近探测：{{ conn.lastCheckedAt ? fmtTime(conn.lastCheckedAt) : '—' }}
          </span>
        </div>
        <div class="md-conn-actions">
          <el-button
            :loading="testing"
            :disabled="testing || fetching || props.readonly"
            @click="testConn"
          >
            <el-icon><Connection /></el-icon> 测试连接
          </el-button>
          <span class="md-conn-hint">仅验证「连得上、能握手」，数秒内返回</span>
        </div>
        <!-- 测试连接结果回显 -->
        <div v-if="testResult" class="md-conn-result">
          <el-alert
            v-if="testResult.ok"
            type="success"
            :closable="false"
            title="握手成功"
          >
            <template #default>
              <div class="md-conn-kv">
                <span v-if="testResult.protocolVersion">协议版本：{{ testResult.protocolVersion }}</span>
                <span v-if="testResult.serverVersion">Server 版本：{{ testResult.serverVersion }}</span>
                <span v-if="testResult.latencyMs != null">延迟：{{ testResult.latencyMs }} ms</span>
              </div>
            </template>
          </el-alert>
          <el-alert
            v-else
            type="error"
            :closable="false"
            :title="testResult.failReason || '连接失败'"
          >
            <template #default>
              <span class="md-conn-kv">握手未通过，请检查接入方式 / 地址 / 鉴权配置后重试</span>
            </template>
          </el-alert>
        </div>
        <!-- 超时（PRD §三.4：本区块最后一项，必填，默认 10000，1000～120000 步长 1000） -->
        <el-form label-position="top" :disabled="props.readonly" class="md-timeout-form">
          <el-form-item label="超时时间" :error="fieldErrors.timeoutMs" required>
            <div class="md-timeout-row">
              <el-input-number
                v-model="form.timeoutMs"
                :min="1000"
                :max="120000"
                :step="1000"
                controls-position="right"
              />
              <span class="lbl-hint">毫秒</span>
            </div>
            <div class="lbl-hint md-timeout-hint">默认 10000 毫秒，仅在服务响应较慢时调整</div>
          </el-form-item>
        </el-form>
      </section>

      <!-- 工具清单（PRD §三.6：默认收起；工具卡只留名称+描述；入参逐工具「查看入参」折叠） -->
      <section class="md-sec">
        <div class="md-sec-title md-tools-head">
          <span>工具清单
            <span class="md-sec-sub">由「拉取工具」从 MCP server 同步（只读）；无工具可保存，但不可发布</span>
          </span>
          <div class="md-tools-actions">
            <el-button link class="md-tools-toggle" @click="toolsOpen = !toolsOpen">
              <span class="md-caret" :class="{ 'is-open': toolsOpen }">▶</span>
              {{ toolsOpen ? '收起工具清单' : '展开工具清单' }}
            </el-button>
            <el-button
              link
              type="primary"
              :loading="fetching"
              :disabled="testing || fetching || props.readonly"
              @click="fetchTools"
            >
              <el-icon><Download /></el-icon> 拉取工具
            </el-button>
          </div>
        </div>
        <div v-if="fieldErrors.tools" class="md-err-text">{{ fieldErrors.tools }}</div>
        <template v-if="toolsOpen">
          <el-empty
            v-if="!tools.length"
            description="暂无工具，点击「拉取工具」从 MCP server 同步"
            :image-size="56"
          />
          <div v-for="t in tools" :key="t.name" class="md-tool">
            <!-- 工具卡（PRD §三.6.1）：仅名称+描述——有展示名称时主显名称、辅显工具标识 -->
            <div class="md-tool-head">
              <template v-if="t.title">
                <span class="md-tool-title">{{ t.title }}</span>
                <code class="md-tool-name md-tool-name--sub">{{ t.name }}</code>
              </template>
              <code v-else class="md-tool-name">{{ t.name }}</code>
            </div>
            <div class="md-tool-desc-ro">{{ t.description || '（server 未提供描述）' }}</div>
            <!-- 入参（PRD §三.6.2）：默认折叠，逐工具独立展开；无入参不展示入口 -->
            <template v-if="t._flatRows.length">
              <el-button link class="md-tools-toggle md-schema-toggle" @click="toggleSchema(t.name)">
                <span class="md-caret" :class="{ 'is-open': openSchemas[t.name] }">▶</span>
                {{ openSchemas[t.name] ? '收起入参' : '查看入参' }}
              </el-button>
              <div v-if="openSchemas[t.name]" class="md-schema-ro">
                <div
                  v-for="r in t._flatRows"
                  :key="r.key"
                  class="md-schema-row"
                  :style="{ paddingLeft: `${r.depth * 16}px` }"
                >
                  <code class="md-schema-name">{{ r.name }}</code>
                  <span class="md-schema-type">{{ r.type }}</span>
                  <span v-if="r.required" class="md-schema-req">必填</span>
                  <span v-if="r.description" class="md-schema-desc">{{ r.description }}</span>
                </div>
              </div>
            </template>
          </div>
        </template>
      </section>

      <!-- 被技能引用（PRD §三.7：普通信息区、只读，副注按软引用口径） -->
      <section v-if="isEdit" class="md-sec">
        <div class="md-sec-title">
          被技能引用
          <span class="md-sec-sub">引用此 MCP 的 Skill（只读；停用或删除后技能仍可执行，运行效果可能受限或出现报错）</span>
        </div>
        <div v-if="referencedBySkills.length" class="md-refs">
          <el-tag
            v-for="s in referencedBySkills"
            :key="s.skillId"
            type="info"
            size="small"
          >
            {{ s.skillName }}
          </el-tag>
        </div>
        <div v-else class="md-refs-empty">暂无技能引用</div>
      </section>

  </DrawerEditor>
</template>

<style scoped>
.md-sec-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-2);
}
/* 一键导入面板（表单顶部；粘贴配置 → 解析回填） */
.md-import {
  border: 1px dashed var(--border-base);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  background: var(--bg-sunken);
}
.md-import-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.md-import-body {
  margin-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.md-import-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}
.md-import-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.md-sec-sub {
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-2);
}
.req {
  color: var(--c-danger);
  font-style: normal;
}
.lbl-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-1);
}
.md-w {
  width: 100%;
}
.md-tools-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.md-tools-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.md-conn-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  margin-bottom: var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.md-conn-meta-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
/* 名称|图标 同行（原型 basic-info-grid 同款） */
.md-row2 {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.md-name-item {
  flex: 1;
  min-width: 0;
}
.md-icon-item {
  flex: none;
}
/* 展开/收起入口（工具清单整体 + 逐工具入参共用）：caret 旋转表达开合 */
.md-tools-toggle {
  font-weight: var(--fw-regular);
}
.md-caret {
  display: inline-block;
  margin-right: 4px;
  font-size: 10px;
  transition: transform var(--dur-fast) var(--ease-out);
}
.md-caret.is-open {
  transform: rotate(90deg);
}
.md-schema-toggle {
  align-self: flex-start;
  padding: 0;
}
/* 超时（区块末位，PRD §三.4） */
.md-timeout-form {
  margin-top: var(--space-3);
}
.md-timeout-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
/* 底部时间行（PRD §三.9：弱化小字，不用独立卡片） */
.md-times {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* Bearer 前置段（完整请求头格式，与 ApiEditor 同款）：等宽字体弱色 */
.md-bearer-input :deep(.el-input-group__prepend) {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 鉴权已配置脱敏占位（http 编辑态；仅提示已配置，不回显明文/密文，与 env 同口径） */
.md-auth-masked {
  width: 100%;
  margin-bottom: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.md-auth-masked code {
  font-family: var(--font-mono);
}
/* Env 声明式行编辑器已抽公共组件 ParamRowsEditor（B.3），行样式随组件走 */
.md-conn-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-1);
}
.md-conn-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.md-conn-result {
  margin-top: var(--space-3);
}
.md-conn-kv {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-size: var(--fs-xs);
}
.md-err-text {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  margin-bottom: var(--space-2);
}
.md-tool {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  margin-bottom: var(--space-3);
  background: var(--bg-sunken);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
/* 标题行：原为 space-between（两个子元素时是「工具N ←→ 技术ID」两端对齐）。
   V97 加入 title 后变三个子元素，space-between 会把标题与技术 ID 甩到两端、中间拉开
   一大段空白，读起来像两条不相干的信息。改为左起紧排 + gap，技术 ID 用 margin-left:auto
   仍推到右端，保持原来的两端节奏，同时让 title 紧跟「工具N」。 */
.md-tool-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.md-tool-head .md-tool-name--sub,
.md-tool-head > code:last-child {
  margin-left: auto;
}
/* 工具技术名（只读，server 权威） */
.md-tool-name {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--c-accent);
}
/* server 声明的显示名（V97）：主体，正文色 + 中等字重，比技术 ID 先入眼 */
.md-tool-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
/* 有 title 时技术 ID 降为副信息：弱色、去强调色，避免与显示名争视线 */
.md-tool-name--sub {
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
}
/* 工具描述（只读展示） */
.md-tool-desc-ro {
  font-size: var(--fs-sm);
  color: var(--c-text);
  white-space: pre-wrap;
}
/* 入参 schema 只读展示（多级缩进行） */
.md-schema-ro {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  background: var(--bg-base);
}
.md-schema-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--fs-xs);
}
.md-schema-name {
  font-family: var(--font-mono);
  color: var(--c-text-strong);
}
.md-schema-type {
  color: var(--c-text-muted);
}
.md-schema-req {
  color: var(--c-danger);
}
.md-schema-desc {
  color: var(--c-text-muted);
}
.md-refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.md-refs-empty {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

/* ===== 图标 / 超时（V97） ===== */
.md-icon-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
/* 预览格：定宽定高，emoji 与图片共用同一视觉框，避免选不同形态时行高跳动 */
.md-icon-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  font-size: 20px;
  line-height: 1;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--c-bg-subtle);
  overflow: hidden;
}
.md-icon-preview.is-empty {
  border-style: dashed;
}
.md-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.md-icon-ph {
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}
.md-timeout-hint {
  margin-top: var(--space-1);
  margin-left: 0;
}
</style>