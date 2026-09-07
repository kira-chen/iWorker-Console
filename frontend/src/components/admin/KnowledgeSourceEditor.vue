<script setup>
/**
 * 数据源配置抽屉（「数据源管理」子页的新建 / 编辑 / 查看），DrawerEditor 720px。
 * 2026-09-07 按 PRD-20260904《prd.知识库.md》§六（API）/ §七（MCP）/ §八（状态与异常）
 * + 交互原型 sourceFields / kmcpMarkup 最终覆写生效态重排（字段口径以 md 为准，骨架照原型）。
 *
 * 【公共字段】（md §四.3）名称（≤50 必填）/ 类型（上传·API·MCP，创建后不可修改）/ 状态（启用·停用）。
 * 【上传】（md §五）本轮冻结不动：文档类型 / 预处理 / 向量模型 / 检索方式 Top K。
 * 【API】（md §六）请求配置（地址 ≤500 http(s)、方法五枚举默认 POST、超时 1000~60000 默认 8000）
 *   → 鉴权配置（无鉴权 / API KEY 多参数表[ParamRowsEditor] / Bearer Token）
 *   → 请求参数映射 + 响应字段映射（SourceMappingEditor，预设行不可删）→ 测试连接。
 * 【MCP】（md §七）仅直接填写（「引用现有 MCP」模式已删除）：传输方式 streamable-http（Endpoint + 鉴权
 *   无鉴权/Bearer/API Key）或 stdio（Command 下拉 + Arguments 多行 + 环境变量表[ParamRowsEditor]）；
 *   检索工具多选复选框 ≥1（清单由连接测试成功返回，未测试前展示引导文案）；映射与 API 完全同构共用组件；
 *   超时必填默认 10000 范围 1000~120000 → 测试连接。
 *
 * 敏感信息遮罩：明文只在提交瞬间存在，回显一律 maskSecret 掩码；编辑态留空=保留原值（md §八.2）。
 * 修改请求地址 / 鉴权 / 工具 / 映射 → 验证状态重置为未验证（md §六.4 / §七.7，mock 保存时同口径）。
 */
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import ParamRowsEditor from '@/components/admin/ParamRowsEditor.vue'
import SourceMappingEditor from '@/components/admin/SourceMappingEditor.vue'
import {
  getKnowledgeSource,
  createKnowledgeSource,
  updateKnowledgeSource,
  testKnowledgeSource,
  listEmbeddingModelOptions
} from '@/api/knowledgeBase'
import {
  SOURCE_TYPES,
  SOURCE_LABELS,
  SOURCE_STATUS_META,
  DOC_KIND_OPTIONS,
  PREPROCESS_OPTIONS,
  RETRIEVAL_OPTIONS,
  UPLOAD_DEFAULTS,
  API_DEFAULTS,
  MCP_DEFAULTS,
  API_METHOD_OPTIONS,
  mkRequestMapRows,
  mkResponseMapRows,
  validateRequestMap,
  validateResponseMap
} from '@/utils/knowledgeBaseMeta'
import {
  API_AUTH_IN_OPTIONS,
  validateApiAuthParams,
  validateMcpEnv,
  MCP_TRANSPORTS,
  MCP_COMMAND_OPTIONS,
  MCP_AUTH_TYPES
} from '@/utils/defValidate'
import { fmtRelative } from '@/utils/docMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 编辑目标 id；null=新建 */
  sourceId: { type: String, default: null },
  /** 'edit'（默认）| 'view'：查看抽屉整表只读，底部仅「关闭」 */
  mode: { type: String, default: 'edit' }
})
const emit = defineEmits(['update:visible', 'saved', 'changed'])

const TYPE_DESC = {
  UPLOAD: '文档上传到平台内置 RAG 库，由平台切片与向量化',
  API: '调用第三方 RAG 平台的检索接口，按需取回切片',
  MCP: '通过 MCP 协议从第三方 RAG 平台取回切片'
}
const ARGS_PLACEHOLDER = '每行一个参数，如\n-y\n@modelcontextprotocol/server-foo'
/** 传输方式展示顺序照 md §七.2：streamable-http 或 stdio。 */
const TRANSPORT_OPTIONS = ['streamable-http', 'stdio']
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,128}$/

const formRef = ref(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const createdId = ref(null)
const detail = ref(null)

const targetId = computed(() => props.sourceId || createdId.value)
const isEdit = computed(() => !!targetId.value)
const viewMode = computed(() => props.mode === 'view' && isEdit.value)

const form = reactive({
  sourceType: 'UPLOAD',
  name: '',
  status: 'ENABLED',
  // 上传类 config 平铺（模板冻结区沿用旧绑定）
  ...UPLOAD_DEFAULTS,
  // API / MCP 标量各归各的命名空间（新口径下两类字段互不串写）
  api: { ...API_DEFAULTS },
  mcp: { ...MCP_DEFAULTS }
})
/* ---- API 行编辑状态 ---- */
const apiAuthRows = ref([]) // API KEY 多参数表（ParamRowsEditor 行结构）
const apiBearerToken = ref('') // Bearer 明文（仅提交瞬间；留空=保留）
const apiBearerMasked = ref('')
const loadedApiAuthType = ref('NONE')
const apiRequestRows = ref(mkRequestMapRows())
const apiResponseRows = ref(mkResponseMapRows())
/* ---- MCP 行编辑状态 ---- */
const mcpCredential = ref('') // bearer/header 访问凭证明文（仅提交瞬间；留空=保留）
const mcpCredentialMasked = ref('')
const loadedMcpAuthType = ref('none')
const mcpArgsText = ref('')
const mcpEnvRows = ref([])
const mcpToolsSelected = ref([])
const availableTools = ref([]) // 连接测试成功返回的工具清单（md §七.3）
const mcpRequestRows = ref(mkRequestMapRows())
const mcpResponseRows = ref(mkResponseMapRows())

const fieldErrors = reactive({})
const verify = ref(null)
const testing = ref(false)
const embeddingModels = ref([])
let muteVerifyReset = false

const rules = computed(() => ({
  name: [{ required: true, message: '请输入数据源名称', trigger: 'blur' }],
  'api.url':
    form.sourceType === 'API'
      ? [
          { required: true, message: '请填写请求地址', trigger: 'blur' },
          {
            validator: (r, v, cb) => (v && !/^https?:\/\//i.test(v.trim()) ? cb(new Error('需为合法 HTTP/HTTPS 地址')) : cb()),
            trigger: 'blur'
          }
        ]
      : [],
  'mcp.endpoint':
    form.sourceType === 'MCP' && form.mcp.transport === 'streamable-http'
      ? [
          { required: true, message: '请填写 MCP 服务地址', trigger: 'blur' },
          {
            validator: (r, v, cb) => (v && !/^https?:\/\//i.test(v.trim()) ? cb(new Error('需以 http:// 或 https:// 开头')) : cb()),
            trigger: 'blur'
          }
        ]
      : []
}))

/** 按文档类型动态展示预处理项（md §五.1：不展示对当前类型无效的配置）。 */
const preprocessVisible = computed(() => PREPROCESS_OPTIONS.filter((o) => o.kinds.includes(form.docKind)))
/** Bearer / 凭证「留空=保留原值」仅在已配置且鉴权类型未切换时成立（ApiEditor 同款语义）。 */
const keepApiBearer = computed(() => isEdit.value && !!apiBearerMasked.value && form.api.authType === 'BEARER' && loadedApiAuthType.value === 'BEARER')
const keepMcpCredential = computed(
  () => isEdit.value && !!mcpCredentialMasked.value && form.mcp.authType !== 'none' && form.mcp.authType === loadedMcpAuthType.value
)

function clearErrors() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
}
const emptyAuthRow = () => ({ in: 'HEADER', key: '', description: '', clientFill: false, value: '', configured: false })
// 切到 API KEY 且无行 → 预置一行（md §六.1.1：至少保留一行有效参数）
watch(
  () => form.api.authType,
  (t) => {
    if (t === 'API_KEY' && !apiAuthRows.value.length) apiAuthRows.value = [emptyAuthRow()]
  }
)

/* ---------- 表单重置 / 回填 ---------- */
const toParamRows = (list, withIn) =>
  (list || []).map((p) => ({
    ...(withIn ? { in: p.in || 'HEADER' } : {}),
    key: p.key || '',
    description: p.description || '',
    clientFill: !!p.clientFill,
    value: '',
    configured: !!p.valueMasked,
    valueMasked: p.valueMasked || ''
  }))
function normalizeRequestRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return mkRequestMapRows()
  const walk = (rs) =>
    rs.map((r) => ({
      name: r.name || '',
      type: r.type || 'string',
      required: !!r.required,
      clientField: r.clientField || '',
      defaultValue: r.defaultValue || '',
      preset: !!r.preset,
      children: walk(Array.isArray(r.children) ? r.children : [])
    }))
  const out = walk(rows)
  // 预设 query / topK 兜底补齐（固定行不可删，md §六.2）
  return out.filter((r) => r.preset).length >= 2 ? out : [...mkRequestMapRows(), ...out.filter((r) => !r.preset)]
}
function normalizeResponseRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return mkResponseMapRows()
  const out = rows.map((r) => ({ name: r.name || '', description: r.description || '', type: r.type || 'string', preset: !!r.preset }))
  return out.filter((r) => r.preset).length >= 3 ? out : [...mkResponseMapRows(), ...out.filter((r) => !r.preset)]
}
function resetForm() {
  Object.assign(form, { sourceType: 'UPLOAD', name: '', status: 'ENABLED', ...UPLOAD_DEFAULTS })
  form.api = { ...API_DEFAULTS }
  form.mcp = { ...MCP_DEFAULTS }
  apiAuthRows.value = []
  apiBearerToken.value = ''
  apiBearerMasked.value = ''
  loadedApiAuthType.value = 'NONE'
  apiRequestRows.value = mkRequestMapRows()
  apiResponseRows.value = mkResponseMapRows()
  mcpCredential.value = ''
  mcpCredentialMasked.value = ''
  loadedMcpAuthType.value = 'none'
  mcpArgsText.value = ''
  mcpEnvRows.value = []
  mcpToolsSelected.value = []
  availableTools.value = []
  mcpRequestRows.value = mkRequestMapRows()
  mcpResponseRows.value = mkResponseMapRows()
  verify.value = null
  clearErrors()
}
function hydrate(d) {
  detail.value = d
  const cfg = d.config || {}
  Object.assign(form, { sourceType: d.sourceType, name: d.name || '', status: d.status || 'ENABLED' })
  if (d.sourceType === 'UPLOAD') {
    Object.assign(form, { ...UPLOAD_DEFAULTS }, cfg)
  } else if (d.sourceType === 'API') {
    form.api = {
      url: cfg.url || '',
      method: API_METHOD_OPTIONS.includes(cfg.method) ? cfg.method : 'POST',
      authType: ['NONE', 'API_KEY', 'BEARER'].includes(cfg.authType) ? cfg.authType : 'NONE',
      timeoutMs: cfg.timeoutMs || 8000
    }
    loadedApiAuthType.value = form.api.authType
    apiBearerMasked.value = cfg.bearerMasked || ''
    apiAuthRows.value = toParamRows(cfg.authParams, true)
    if (form.api.authType === 'API_KEY' && !apiAuthRows.value.length) apiAuthRows.value = [emptyAuthRow()]
    apiRequestRows.value = normalizeRequestRows(cfg.requestMap)
    apiResponseRows.value = normalizeResponseRows(cfg.responseMap)
  } else {
    form.mcp = {
      transport: MCP_TRANSPORTS.includes(cfg.transport) ? cfg.transport : 'streamable-http',
      endpoint: cfg.endpoint || '',
      authType: ['none', 'bearer', 'header'].includes(cfg.authType) ? cfg.authType : 'none',
      authHeaderName: cfg.authHeaderName || '',
      command: cfg.command || 'npx',
      timeoutMs: cfg.timeoutMs || 10000
    }
    loadedMcpAuthType.value = form.mcp.authType
    mcpCredentialMasked.value = cfg.credentialMasked || ''
    mcpArgsText.value = (cfg.args || []).join('\n')
    mcpEnvRows.value = toParamRows(cfg.envVars, false)
    mcpToolsSelected.value = [...(cfg.tools || [])]
    // 已保存的选中工具先作为可选清单展示；重新测试后以测试返回清单为准（md §七.3）
    availableTools.value = [...(cfg.tools || [])]
    mcpRequestRows.value = normalizeRequestRows(cfg.requestMap)
    mcpResponseRows.value = normalizeResponseRows(cfg.responseMap)
  }
  verify.value = d.sourceType === 'UPLOAD' ? null : { verifyStatus: d.verifyStatus, verifiedAt: d.verifiedAt, verifyError: d.verifyError }
}
async function load() {
  loadError.value = ''
  loading.value = true
  try {
    embeddingModels.value = await listEmbeddingModelOptions().catch(() => [])
    if (targetId.value) hydrate(await getKnowledgeSource(targetId.value))
  } catch (e) {
    loadError.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}
watch(
  () => props.visible,
  (v) => {
    if (!v) return
    createdId.value = null
    detail.value = null
    resetForm()
    formRef.value?.clearValidate()
    load()
  }
)

// 修改请求地址 / 鉴权 / 工具 / 映射 → 验证状态回未验证（md §六.4 / §七.7；mock 保存时同口径重置）
const connSig = computed(() => {
  if (form.sourceType === 'API') {
    return JSON.stringify([
      form.api.url,
      form.api.authType,
      apiAuthRows.value.map((r) => [r.key, r.in, r.clientFill, r.value]),
      apiBearerToken.value,
      apiRequestRows.value,
      apiResponseRows.value
    ])
  }
  if (form.sourceType === 'MCP') {
    return JSON.stringify([
      form.mcp.transport,
      form.mcp.endpoint,
      form.mcp.authType,
      form.mcp.authHeaderName,
      mcpCredential.value,
      form.mcp.command,
      mcpArgsText.value,
      mcpEnvRows.value.map((r) => [r.key, r.clientFill, r.value]),
      mcpToolsSelected.value,
      mcpRequestRows.value,
      mcpResponseRows.value
    ])
  }
  return ''
})
watch(connSig, () => {
  if (loading.value || muteVerifyReset || viewMode.value || form.sourceType === 'UPLOAD') return
  if (verify.value && verify.value.verifyStatus !== 'UNVERIFIED') verify.value = { verifyStatus: 'UNVERIFIED' }
})

/* ---------- 测试连接（API / MCP，md §六.4 / §七.7） ---------- */
async function doTest() {
  testing.value = true
  try {
    const r = await testKnowledgeSource(form.sourceType, { sourceId: targetId.value, config: buildConfig(), authValue: authValueOut() })
    muteVerifyReset = true
    verify.value = r
    if (r.verifyStatus === 'SUCCESS') {
      if (form.sourceType === 'MCP' && Array.isArray(r.tools)) {
        // 测试成功获得工具清单；已选工具保留清单内的（md §七.3）
        availableTools.value = [...r.tools]
        mcpToolsSelected.value = mcpToolsSelected.value.filter((t) => r.tools.includes(t))
      }
      ElMessage.success('连接测试成功')
    } else {
      ElMessage.error(r.verifyError || '连接失败')
    }
    await nextTick()
  } catch (e) {
    ElMessage.error(e?.message || '测试失败')
  } finally {
    muteVerifyReset = false
    testing.value = false
  }
}
const verifyLine = computed(() => {
  const v = verify.value
  if (!v || !v.verifyStatus || v.verifyStatus === 'UNVERIFIED') return ''
  if (v.verifyStatus === 'SUCCESS') {
    const extra = form.sourceType === 'MCP' && v.toolCount ? ` · ${v.toolCount} 个工具` : v.latencyMs ? ` · ${v.latencyMs} ms` : ''
    return `连接正常${extra}${v.verifiedAt ? ` · ${fmtRelative(v.verifiedAt)}` : ''}`
  }
  return `连接失败：${v.verifyError || '未知原因'}`
})

/* ---------- 组装 config / 保存 ---------- */
const outParamRows = (rows, withIn) =>
  (rows || [])
    .filter((r) => (r.key || '').trim() || (r.description || '').trim() || (r.value || '').trim())
    .map((r) => {
      const o = { key: (r.key || '').trim(), description: (r.description || '').trim(), clientFill: !!r.clientFill }
      if (withIn) o.in = r.in || 'HEADER'
      if (!o.clientFill) {
        const v = (r.value || '').trim()
        if (v) o.value = v // 明文只在提交瞬间存在，mock 落库即掩码
        else if (r.valueMasked) o.valueMasked = r.valueMasked // 留空=保留原值
      }
      return o
    })
function cleanRequestRows(rows) {
  const out = []
  for (const r of rows || []) {
    const name = (r.name || '').trim()
    const nested = r.type === 'object' || r.type === 'array'
    const children = nested ? cleanRequestRows(r.children) : []
    if (!r.preset && !name && !(r.defaultValue || '').trim() && !children.length) continue // 空白自定义行丢弃
    out.push({
      name,
      type: r.type,
      required: !!r.required,
      clientField: r.clientField || '',
      defaultValue: (r.defaultValue || '').trim(),
      ...(r.preset ? { preset: true } : {}),
      children
    })
  }
  return out
}
const cleanResponseRows = (rows) =>
  (rows || [])
    .filter((r) => r.preset || (r.name || '').trim() || (r.description || '').trim())
    .map((r) => ({ name: (r.name || '').trim(), description: (r.description || '').trim(), type: r.type, ...(r.preset ? { preset: true } : {}) }))
function buildConfig() {
  if (form.sourceType === 'UPLOAD') {
    const cfg = {}
    for (const k of Object.keys(UPLOAD_DEFAULTS)) cfg[k] = form[k]
    return cfg
  }
  if (form.sourceType === 'API') {
    return {
      url: (form.api.url || '').trim(),
      method: form.api.method,
      authType: form.api.authType,
      authParams: form.api.authType === 'API_KEY' ? outParamRows(apiAuthRows.value, true) : [],
      requestMap: cleanRequestRows(apiRequestRows.value),
      responseMap: cleanResponseRows(apiResponseRows.value),
      timeoutMs: form.api.timeoutMs
    }
  }
  return {
    transport: form.mcp.transport,
    endpoint: (form.mcp.endpoint || '').trim(),
    authType: form.mcp.authType,
    authHeaderName: (form.mcp.authHeaderName || '').trim(),
    command: form.mcp.command,
    args: mcpArgsText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    envVars: form.mcp.transport === 'stdio' ? outParamRows(mcpEnvRows.value, false) : [],
    tools: [...mcpToolsSelected.value],
    requestMap: cleanRequestRows(mcpRequestRows.value),
    responseMap: cleanResponseRows(mcpResponseRows.value),
    timeoutMs: form.mcp.timeoutMs
  }
}
/** 保存 / 测试提交的明文密钥通道：API=Bearer Token；MCP=访问凭证（留空=保留原值）。 */
function authValueOut() {
  if (form.sourceType === 'API') return form.api.authType === 'BEARER' ? apiBearerToken.value.trim() || null : null
  if (form.sourceType === 'MCP') return form.mcp.authType !== 'none' ? mcpCredential.value.trim() || null : null
  return null
}
/** 类型化保存校验（md §六.1～§六.3 / §七.2～§七.6），一次性标红全部问题项。 */
function validateTyped() {
  clearErrors()
  const errors = {}
  if (form.sourceType === 'API') {
    if (form.api.authType === 'API_KEY') {
      const err = validateApiAuthParams(apiAuthRows.value)
      if (err) errors.apiAuth = err
    }
    if (form.api.authType === 'BEARER' && !apiBearerToken.value.trim() && !keepApiBearer.value) {
      errors.apiBearer = 'Bearer Token 必填'
    }
    const reqErr = validateRequestMap(cleanRequestRows(apiRequestRows.value))
    if (reqErr) errors.apiRequestMap = reqErr
    const respErr = validateResponseMap(cleanResponseRows(apiResponseRows.value))
    if (respErr) errors.apiResponseMap = respErr
  } else if (form.sourceType === 'MCP') {
    if (form.mcp.transport === 'streamable-http') {
      if (form.mcp.authType === 'header') {
        const hn = (form.mcp.authHeaderName || '').trim()
        if (!hn) errors.mcpHeaderName = 'Header 名必填'
        else if (!HEADER_NAME_RE.test(hn)) errors.mcpHeaderName = '仅允许字母、数字和连字符（不超过 128 字符）'
      }
      if (form.mcp.authType !== 'none' && !mcpCredential.value.trim() && !keepMcpCredential.value) {
        errors.mcpCredential = form.mcp.authType === 'bearer' ? 'Bearer Token 必填' : '访问凭证必填'
      }
    } else {
      if (!MCP_COMMAND_OPTIONS.includes(form.mcp.command)) errors.mcpCommand = '请选择 Command'
      const envErr = validateMcpEnv(mcpEnvRows.value)
      if (envErr) errors.mcpEnv = envErr
    }
    if (!mcpToolsSelected.value.length) errors.mcpTools = '至少选择一个检索工具'
    const reqErr = validateRequestMap(cleanRequestRows(mcpRequestRows.value))
    if (reqErr) errors.mcpRequestMap = reqErr
    const respErr = validateResponseMap(cleanResponseRows(mcpResponseRows.value))
    if (respErr) errors.mcpResponseMap = respErr
  }
  Object.assign(fieldErrors, errors)
  return Object.keys(errors).length === 0
}
async function save() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!validateTyped() || !valid) {
    ElMessage.warning('请先修正标红项')
    return
  }
  // 更换向量模型影响现有索引：保存前确认（md §五.1）
  if (
    form.sourceType === 'UPLOAD' &&
    isEdit.value &&
    detail.value?.config?.embeddingModelId &&
    form.embeddingModelId !== detail.value.config.embeddingModelId
  ) {
    try {
      await ElMessageBox.confirm('更换后需全量重建索引，已有文档将重新处理。确认更换向量模型？', '更换向量模型', {
        type: 'warning',
        confirmButtonText: '确认更换'
      })
    } catch (e) {
      return
    }
  }
  saving.value = true
  try {
    const payload = {
      sourceType: form.sourceType,
      name: form.name.trim(),
      status: form.status,
      config: buildConfig(),
      authValue: form.sourceType === 'UPLOAD' ? undefined : authValueOut()
    }
    let saved
    if (targetId.value) saved = await updateKnowledgeSource(targetId.value, payload)
    else {
      saved = await createKnowledgeSource(payload)
      createdId.value = saved?.id || null
    }
    if (saved) hydrate(saved)
    emit('saved')
    ElMessage.success(form.sourceType === 'UPLOAD' && !props.sourceId ? '已保存，文档在列表「文档管理」入口上传' : '已保存')
    close()
  } catch (e) {
    // 保存失败：保留表单内容、不关抽屉（md §八.2）
    if (e?.field) fieldErrors[e.field] = e.message || '校验未通过'
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
function close() {
  emit('update:visible', false)
}
</script>

<template>
  <DrawerEditor
    :visible="visible"
    entity="数据源"
    :is-edit="isEdit"
    :readonly="viewMode"
    :loading="loading"
    :error="loadError"
    :saving="saving"
    create-text="保存"
    @update:visible="close"
    @retry="load"
    @save="save"
  >
    <template #title-extra>
      <StatusTag v-if="detail" :type="(SOURCE_STATUS_META[detail.status] || SOURCE_STATUS_META.ENABLED).type">
        {{ (SOURCE_STATUS_META[detail.status] || SOURCE_STATUS_META.ENABLED).label }}
      </StatusTag>
    </template>

    <!-- rules 随类型 / 传输方式动态切换，关掉 validate-on-rule-change 防止切换瞬间对空表单标红 -->
    <el-form ref="formRef" :model="form" :rules="rules" :validate-on-rule-change="false" label-width="118px" label-position="right" :disabled="viewMode">
      <!-- 公共字段（md §四.3） -->
      <section class="ksrc-sec">
        <div class="ksrc-sec-title">基本信息</div>
        <el-form-item label="类型">
          <el-radio-group v-model="form.sourceType" :disabled="isEdit || viewMode">
            <el-radio v-for="t in SOURCE_TYPES" :key="t" :value="t">{{ SOURCE_LABELS[t] }}</el-radio>
          </el-radio-group>
          <span class="ksrc-hint">创建后不可修改</span>
        </el-form-item>
        <el-form-item label="数据源名称" prop="name">
          <el-input v-model="form.name" maxlength="50" show-word-limit :placeholder="form.sourceType === 'UPLOAD' ? '如 产品资料、案例集' : form.sourceType === 'API' ? '如 国标检索接口' : '如 法规库 MCP'" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">停用</el-radio>
          </el-radio-group>
          <span class="ksrc-hint">停用后跳过检索，但保留配置和引用</span>
        </el-form-item>
        <el-form-item label=" ">
          <span class="ksrc-desc">{{ TYPE_DESC[form.sourceType] }}</span>
        </el-form-item>
      </section>

      <!-- 上传类：内置 RAG 配置（md §五.1，本轮冻结不动） -->
      <section v-if="form.sourceType === 'UPLOAD'" class="ksrc-sec">
        <div class="ksrc-sec-title">内置 RAG 配置</div>
        <el-form-item label="文档类型">
          <el-radio-group v-model="form.docKind">
            <el-radio v-for="o in DOC_KIND_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
          </el-radio-group>
          <span class="ksrc-hint">拆分方式由系统内置方案自动处理</span>
        </el-form-item>
        <!-- 预处理项按文档类型动态展示（md §五.1） -->
        <el-form-item label="文本预处理">
          <div class="ksrc-pre">
            <div class="ksrc-pre-tip">系统已默认删除目录、页眉页脚、水印</div>
            <div v-for="o in preprocessVisible" :key="o.key" class="ksrc-pre-item">
              <el-checkbox v-model="form[o.key]">
                <span class="ksrc-pre-name">{{ o.label }}</span>
                <span class="ksrc-pre-desc">{{ o.desc }}</span>
              </el-checkbox>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="向量模型">
          <div class="ksrc-row">
            <el-select v-model="form.embeddingModelId" placeholder="选择 Embedding 模型" class="ksrc-half">
              <el-option v-for="m in embeddingModels" :key="m.id" :label="m.name" :value="m.id" />
            </el-select>
            <span class="ksrc-hint">更换后需全量重建索引</span>
          </div>
        </el-form-item>
        <el-form-item label="检索方式">
          <div class="ksrc-row">
            <el-select v-model="form.retrieval" class="ksrc-half">
              <el-option v-for="o in RETRIEVAL_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <div class="ksrc-inline">
              <span class="ksrc-unit">Top K</span>
              <el-input-number v-model="form.topK" :min="1" :max="20" controls-position="right" />
            </div>
          </div>
        </el-form-item>
        <el-form-item label=" ">
          <div class="ksrc-note">检索阈值不在管理端设置，由客户端每次发起检索时提供。</div>
        </el-form-item>
      </section>

      <!-- API 类（md §六；骨架照原型 sourceFields('API')：请求配置 → 鉴权配置 → 两张映射卡片） -->
      <template v-else-if="form.sourceType === 'API'">
        <section class="ksrc-sec">
          <div class="ksrc-sec-title">请求配置</div>
          <el-form-item label="请求方法" required>
            <el-select v-model="form.api.method" class="ksrc-half">
              <el-option v-for="m in API_METHOD_OPTIONS" :key="m" :label="m" :value="m" />
            </el-select>
          </el-form-item>
          <el-form-item label="请求地址" prop="api.url" required>
            <el-input v-model="form.api.url" maxlength="500" placeholder="如 https://rag.example.com/api/v1/search" />
          </el-form-item>
          <el-form-item label="超时时间" required>
            <div class="ksrc-inline">
              <el-input-number v-model="form.api.timeoutMs" :min="1000" :max="60000" :step="1000" controls-position="right" />
              <span class="ksrc-unit">单位毫秒，默认 8000，范围 1000～60000</span>
            </div>
          </el-form-item>
        </section>
        <section class="ksrc-sec">
          <div class="ksrc-sec-title">
            鉴权配置
            <span class="ksrc-sec-sub">凭证会静态附加到每次请求</span>
          </div>
          <el-form-item label="鉴权方式" required>
            <el-radio-group v-model="form.api.authType">
              <el-radio value="NONE">无鉴权</el-radio>
              <el-radio value="API_KEY">API KEY</el-radio>
              <el-radio value="BEARER">Bearer Token</el-radio>
            </el-radio-group>
          </el-form-item>
          <!-- API KEY 多参数表（md §六.1.1；ParamRowsEditor 与 API 连接器同款，全宽行区） -->
          <template v-if="form.api.authType === 'API_KEY'">
            <ParamRowsEditor
              :rows="apiAuthRows"
              :readonly="viewMode"
              show-in
              :in-options="API_AUTH_IN_OPTIONS"
              key-header="参数名"
              key-placeholder="如 X-Api-Key"
              value-header="参数值"
              desc-placeholder="选填：这个参数是做什么的"
              add-label="+ 添加参数"
              client-fill-hint="客户端填写参数由客户端收集，平台不存值"
              @update:rows="apiAuthRows = $event"
              @interact="delete fieldErrors.apiAuth"
            />
            <div v-if="fieldErrors.apiAuth" class="ksrc-err">{{ fieldErrors.apiAuth }}</div>
          </template>
          <el-form-item v-if="form.api.authType === 'BEARER'" label="Bearer Token" :error="fieldErrors.apiBearer" required>
            <el-input
              v-model="apiBearerToken"
              type="password"
              show-password
              autocomplete="new-password"
              class="ksrc-bearer"
              :placeholder="keepApiBearer ? '已配置（留空保持不变）' : '只填 Token 本体，不含 Bearer 前缀'"
              @input="delete fieldErrors.apiBearer"
            >
              <template #prepend>Authorization: Bearer</template>
            </el-input>
            <div v-if="keepApiBearer" class="ksrc-masked">当前：<code>{{ apiBearerMasked }}</code>（留空保持不变，重填覆盖）</div>
          </el-form-item>
        </section>
        <section class="ksrc-sec">
          <SourceMappingEditor
            protocol="API"
            :request-rows="apiRequestRows"
            :response-rows="apiResponseRows"
            :readonly="viewMode"
            :request-error="fieldErrors.apiRequestMap"
            :response-error="fieldErrors.apiResponseMap"
            @update:request-rows="apiRequestRows = $event"
            @update:response-rows="apiResponseRows = $event"
            @interact="delete fieldErrors.apiRequestMap; delete fieldErrors.apiResponseMap"
          />
        </section>
      </template>

      <!-- MCP 类（md §七；骨架照原型 kmcpMarkup 最终覆写态：连接与鉴权卡 → 检索工具卡 → 两张映射卡片） -->
      <template v-else>
        <section class="ksrc-sec">
          <div class="ksrc-sec-title">MCP 检索</div>
          <div class="ksrc-card">
            <div class="ksrc-card-title">
              <strong>连接与鉴权</strong>
              <span>直接配置 MCP 服务连接信息</span>
            </div>
            <el-form-item label="传输方式" required>
              <el-radio-group v-model="form.mcp.transport">
                <el-radio v-for="t in TRANSPORT_OPTIONS" :key="t" :value="t">{{ t }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <template v-if="form.mcp.transport === 'streamable-http'">
              <el-form-item label="MCP 服务地址" prop="mcp.endpoint" required>
                <el-input v-model="form.mcp.endpoint" maxlength="500" placeholder="Endpoint，如 https://example.com/mcp" />
              </el-form-item>
              <el-form-item label="鉴权方式" required>
                <el-select v-model="form.mcp.authType" class="ksrc-half">
                  <el-option v-for="o in MCP_AUTH_TYPES" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="form.mcp.authType === 'bearer'" label="Bearer Token" :error="fieldErrors.mcpCredential" required>
                <el-input
                  v-model="mcpCredential"
                  type="password"
                  show-password
                  autocomplete="new-password"
                  class="ksrc-bearer"
                  :placeholder="keepMcpCredential ? '已配置（留空保持不变）' : '只填 Token 本体，不含 Bearer 前缀'"
                  @input="delete fieldErrors.mcpCredential"
                >
                  <template #prepend>Authorization: Bearer</template>
                </el-input>
                <div v-if="keepMcpCredential" class="ksrc-masked">当前：<code>{{ mcpCredentialMasked }}</code>（留空保持不变，重填覆盖）</div>
              </el-form-item>
              <template v-if="form.mcp.authType === 'header'">
                <el-form-item label="Header 名" :error="fieldErrors.mcpHeaderName" required>
                  <el-input
                    v-model="form.mcp.authHeaderName"
                    maxlength="128"
                    class="ksrc-half"
                    placeholder="如 X-Api-Key"
                    @input="delete fieldErrors.mcpHeaderName"
                  />
                  <span class="ksrc-hint">仅允许字母、数字和连字符</span>
                </el-form-item>
                <el-form-item label="访问凭证" :error="fieldErrors.mcpCredential" required>
                  <el-input
                    v-model="mcpCredential"
                    type="password"
                    show-password
                    autocomplete="new-password"
                    class="ksrc-half"
                    :placeholder="keepMcpCredential ? '已配置（留空保持不变）' : '请输入访问凭证'"
                    @input="delete fieldErrors.mcpCredential"
                  />
                  <div v-if="keepMcpCredential" class="ksrc-masked">当前：<code>{{ mcpCredentialMasked }}</code>（留空保持不变，重填覆盖）</div>
                </el-form-item>
              </template>
            </template>
            <template v-else>
              <el-form-item label="Command" :error="fieldErrors.mcpCommand" required>
                <el-select v-model="form.mcp.command" class="ksrc-half" @change="delete fieldErrors.mcpCommand">
                  <el-option v-for="c in MCP_COMMAND_OPTIONS" :key="c" :label="c" :value="c" />
                </el-select>
              </el-form-item>
              <el-form-item label="Arguments">
                <el-input v-model="mcpArgsText" type="textarea" :rows="3" :placeholder="ARGS_PLACEHOLDER" />
                <span class="ksrc-hint-block">选填，每行一个参数</span>
              </el-form-item>
              <div class="ksrc-sub">
                环境变量
                <span class="ksrc-sub-hint">勾选「客户端填写」时，平台只声明变量名，不保存预设值</span>
              </div>
              <ParamRowsEditor
                :rows="mcpEnvRows"
                :readonly="viewMode"
                key-header="变量名"
                key-placeholder="API_KEY"
                value-header="平台值"
                desc-placeholder="选填：这个变量是做什么的"
                add-label="+ 添加变量"
                client-fill-hint="客户端填写变量由客户端收集，平台不存值"
                @update:rows="mcpEnvRows = $event"
                @interact="delete fieldErrors.mcpEnv"
              />
              <div v-if="fieldErrors.mcpEnv" class="ksrc-err">{{ fieldErrors.mcpEnv }}</div>
            </template>
            <el-form-item label="超时时间" required>
              <div class="ksrc-inline">
                <el-input-number v-model="form.mcp.timeoutMs" :min="1000" :max="120000" :step="1000" controls-position="right" />
                <span class="ksrc-unit">单位毫秒，默认 10000，范围 1000～120000</span>
              </div>
            </el-form-item>
          </div>

          <!-- 检索工具：多选复选框 ≥1；清单来自连接测试成功返回（md §七.3） -->
          <div class="ksrc-card">
            <div class="ksrc-card-title">
              <strong>检索工具</strong>
              <span>从该 MCP 服务暴露的全部工具中，选择用于知识检索的工具（可多选）</span>
            </div>
            <template v-if="availableTools.length">
              <el-checkbox-group v-model="mcpToolsSelected" @change="delete fieldErrors.mcpTools">
                <el-checkbox v-for="t in availableTools" :key="t" :value="t">{{ t }}</el-checkbox>
              </el-checkbox-group>
              <div class="ksrc-hint-block">至少选择一个检索工具</div>
            </template>
            <div v-else class="ksrc-note">请先完成连接测试以获取工具列表</div>
            <div v-if="fieldErrors.mcpTools" class="ksrc-err">{{ fieldErrors.mcpTools }}</div>
          </div>

          <SourceMappingEditor
            protocol="MCP"
            :request-rows="mcpRequestRows"
            :response-rows="mcpResponseRows"
            :readonly="viewMode"
            :request-error="fieldErrors.mcpRequestMap"
            :response-error="fieldErrors.mcpResponseMap"
            @update:request-rows="mcpRequestRows = $event"
            @update:response-rows="mcpResponseRows = $event"
            @interact="delete fieldErrors.mcpRequestMap; delete fieldErrors.mcpResponseMap"
          />
          <div class="ksrc-note ksrc-test-note">保存前可使用下方“测试连接”验证连接、工具调用及字段映射。</div>
        </section>
      </template>

      <!-- 测试连接（API / MCP 共用，md §六.4 / §七.7） -->
      <section v-if="form.sourceType !== 'UPLOAD'" class="ksrc-sec">
        <div class="ksrc-row ksrc-inline">
          <el-button size="small" :loading="testing" @click="doTest">测试连接</el-button>
          <span v-if="verifyLine" class="ksrc-verify" :class="verify?.verifyStatus === 'SUCCESS' ? 'ok' : 'bad'">● {{ verifyLine }}</span>
          <span v-else-if="!viewMode" class="ksrc-hint">修改连接配置后需要重新测试</span>
        </div>
      </section>
    </el-form>
  </DrawerEditor>
</template>

<style scoped>
.ksrc-sec {
  display: flex;
  flex-direction: column;
}
.ksrc-sec + .ksrc-sec {
  margin-top: var(--space-5);
}
.ksrc-sec-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-3);
}
.ksrc-sec-sub {
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-2);
}
.ksrc-sec :deep(.el-form-item) {
  margin-bottom: var(--space-4);
}
.ksrc-sec :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}
/* 卡片骨架照原型 kmcp-card：细边框圆角卡 + 「标题 + 弱色副注」行 */
.ksrc-card {
  border: 1px solid var(--c-border, #e0e6e3);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
.ksrc-card + .ksrc-card {
  margin-top: var(--space-3);
}
.ksrc-card-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.ksrc-card-title strong {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.ksrc-card-title span {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ksrc-card :deep(.el-checkbox-group) {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.ksrc-row {
  display: flex;
  gap: 10px;
  width: 100%;
  align-items: center;
  flex-wrap: wrap;
}
.ksrc-half {
  width: calc(50% - 5px);
}
.ksrc-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ksrc-inline :deep(.el-input-number) {
  width: 120px;
}
.ksrc-unit,
.ksrc-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
}
.ksrc-hint {
  margin-left: var(--space-2);
}
.ksrc-hint-block {
  width: 100%;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-top: var(--space-1);
}
.ksrc-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ksrc-note {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--c-bg-subtle, var(--c-fill-soft, rgba(0, 0, 0, 0.03)));
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1.55;
}
.ksrc-test-note {
  margin-top: var(--space-3);
}
.ksrc-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  font-weight: var(--fw-medium);
  margin: 0 0 var(--space-2);
}
.ksrc-sub-hint {
  font-weight: var(--fw-regular);
  color: var(--c-text-faint);
  margin-left: var(--space-1);
}
/* Bearer 前置段（完整请求头格式展示）：等宽弱色（ApiEditor 同款） */
.ksrc-bearer :deep(.el-input-group__prepend) {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ksrc-masked {
  width: 100%;
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ksrc-masked code {
  font-family: var(--font-mono);
}
.ksrc-err {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.ksrc-pre {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ksrc-pre-tip {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-bottom: var(--space-1);
}
.ksrc-pre-item :deep(.el-checkbox) {
  height: auto;
  align-items: flex-start;
  white-space: normal;
}
.ksrc-pre-item :deep(.el-checkbox__label) {
  line-height: 1.5;
}
.ksrc-pre-name {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  white-space: nowrap;
  margin-right: var(--space-2);
}
.ksrc-pre-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ksrc-verify {
  font-size: var(--fs-xs);
}
.ksrc-verify.ok {
  color: var(--c-success);
}
.ksrc-verify.bad {
  color: var(--c-danger);
}
</style>
