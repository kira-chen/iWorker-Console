<script setup>
/**
 * API 定义编辑器（2026-09-01 对齐 PRD-20260828《03能力/连接器/API/prd-API.md》§三）。
 *
 * 抽屉式，新建 / 编辑 / 查看三态（查看全只读，底部仅【关闭】；点遮罩不直接关闭防误丢内容）。
 * 信息结构（2026-09-01 拍板对齐交互原型 v2 的 API 弹窗，renderApiEditor；原顶部提示行删除）：
 *   首行元信息（编辑/查看态：创建 / 最近更新 / 最近发布时间，弱色提示展示）
 *   → 基本信息（原型最终态：名称|图标 → 所属服务提供系统 → 描述[必填,通栏] → 状态[启用/停用]|操作性质；
 *     图标 2026-09-02 B-5 拍板加回——原型后置补丁层 addConnectorIconField 实为 API 抽屉注入图标，
 *     推翻 2026-09-01 N4-① 旧结论；启用/停用状态单选按原型加回仅作示意；
 *     API ID 行：2026-09-12 起编辑 / 查看态只读展示（md §三.2 L120 · K36 / Q113），新建态不展示）
 *   抽屉顶部提示行「1 个 API 对应 1 个可被技能引用的工具，发布前必须通过连通性验证。」三态常显
 *   （2026-09-12 md §三.1 L102 · K35 / Q114，推翻 2026-09-01「原顶部提示行删除」）
 *   → 请求配置（请求方式|API 地址 同行，方式下拉收窄；健康检查路径已删——连通性验证保留，
 *     探测语义为 API 地址可达性）
 *   → 鉴权配置（不鉴权 / API_KEY 多参数行[ParamRowsEditor] / Bearer Token；提示文案从简，
 *     密钥类值均按敏感信息处理：密码态输入、不回显明文）
 *   → 请求参数 / 响应字段（SchemaFieldEditor，对象/数组可套子字段，任意层级）
 *   → 被技能引用（只读）
 *   → 示例问题（2026-09-06 负责人拍板 Q1：需要填写——结束「透传不展示」冻结态；
 *     固定 3 条必填 + AI 生成走统一 useAiLiveGenerate + connectorQuestionSet，源=API 描述；
 *     真实生成 prompt 待产品经理浦月提供，demo 先用本地模板生成器）。
 *
 * 校验（PRD §三.7）在本组件收口：名称/图标/所属系统/描述/示例问题必填、URL 合法、
 * API_KEY 鉴权参数行走 validateApiAuthParams（去重/互斥/必值，编辑态已配置行留空=保留原值）、
 * BEARER Token 必填（编辑态已配置留空=保留）、schema 字段名非空且同层唯一。
 * 鉴权密钥脱敏：编辑态已配置只显「已配置」，绝不回显明文，也不进 console。
 *
 * 2026-09-09 原型复刻批次 3A（S1 / S3 / A3 / A4 / A5）：
 * - S1 各分区换 `.section-card`（样式在 assets/admin-shell.css）；「被技能引用」保持非卡片
 *   `.reference-section`，时间行走 `.page-time`；
 * - S3 图标行换 IconField（预览块 + 并排【从图标库选择】【上传图标】）；
 * - A3 基本信息卡照原型最终态：名称 ｜ 所属服务提供系统 同行 → 描述通栏 → 操作性质单格；
 *   删原型/md 均无的「状态」启用/停用 radio。图标与示例问题按 md 保留（Q101/Q102 负责人已确认
 *   以 md 为准——原型最终层的删除属原型缺陷，不搬）；
 * - A4 鉴权配置卡内细节照原型 authMasterContent L3645：「客户端填写参数由客户端收集，平台不存值」
 *   常显（不再随勾选出现）、参数值密码态、Bearer placeholder「粘贴Bearer Token（不含Bearer前缀）」、
 *   无行时「暂无鉴权参数」空态；
 * - A5 请求参数 / 响应字段嵌套改扁平缩进行（详见 SchemaFieldEditor）。
 */
import { ref, reactive, computed, watch } from 'vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { ElMessage } from 'element-plus'
import { createApi, updateApi, getApi, listProviderSystems } from '@/api/apiConnector'
import {
  API_METHODS,
  API_AUTH_TYPES,
  API_AUTH_IN_OPTIONS,
  API_BODY_METHODS,
  validateApiAuthParams
} from '@/utils/defValidate'
import { rowsToSchema, schemaToRows, validateRows } from '@/utils/schema'
import { fmtTime } from '@/utils/docMeta'
import SchemaFieldEditor from './SchemaFieldEditor.vue'
import ParamRowsEditor from './ParamRowsEditor.vue'
import IconField from '@/components/common/IconField.vue'
import { useAiLiveGenerate, connectorQuestionSet } from '@/utils/aiLiveGenerate'

const props = defineProps({
  visible: { type: Boolean, default: false },
  apiId: { type: [Number, String], default: null },
  // 新建时预选的所属服务提供系统 id（从分组内「＋ 在本系统下新建 API」带入）
  defaultProviderSystemId: { type: [Number, String], default: null },
  // 只读查看：各表单区整体禁用、底部隐藏保存仅留「关闭」。审核锁定期与日常复核走查看，避免误改。
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved'])

const isEdit = computed(() => props.apiId != null)
const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)

const form = reactive({
  code: '', // 系统生成；编辑/查看态只读展示（如 api_1101），新建为空
  name: '',
  description: '',
  providerSystemId: null,
  url: '',
  method: 'GET',
  // 启用/停用：md §三.4 L152「必填，默认启用；停用后技能不再可引用该 API」。
  // 2026-09-09 PRD 复核轮 · A16/Q338 恢复录入控件（曾于批次 3A · A3 按「md 亦无」删除，本版 md 已列出）。
  enabled: true,
  // 读/写：write → 客户端实际执行前必须经用户确认；read 直接执行（PRD §三.2）
  readWrite: 'read',
  // 图标：2026-09-02 B-5 拍板加回弹窗（原型后置补丁层实有此字段，推翻 N4-①）
  icon: '',
  // 示例问题：2026-09-06 Q1 拍板需要填写（固定 3 条必填 + AI 生成），结束透传冻结态
  exampleQuestions: ['', '', '']
})
// 示例问题每条上限（与 MCP/业务系统连接器同口径 60 字；AI 生成器同上限截断）
const QUESTION_MAX = 60
// 名称上限 64（2026-09-12 对齐《各模块必填选填字段一览表》§6.2「最多 64 字符」· 审计 K36；原 128）
const API_NAME_MAX = 64
/** 示例问题 AI 生成（统一 AI 实况生成机制）：源=API 描述（空则按钮禁用 + title 引导），
 * 生成器 connectorQuestionSet 一次 3 条；真实 prompt 待浦月提供，demo 用本地模板。 */
const {
  disabled: aiDisabled,
  title: aiTitle,
  label: aiLabel,
  run: generateQuestions
} = useAiLiveGenerate({
  getSourceText: () => form.description,
  sourceLabel: 'API 描述',
  // 2026-09-09 PRD-20260908 复核批次 0 · Q366：补传 API 名称（《AI生成按钮Prompt规范.md》§6
  // 变量来源表 name=apiRows[i].name）。禁用判定仍只看 API 描述，口径不变。
  getSourceContext: () => ({ name: form.name, description: form.description }),
  generate: connectorQuestionSet,
  apply: (questions) => {
    form.exampleQuestions = [0, 1, 2].map((i) => String(questions[i] || '').slice(0, QUESTION_MAX))
    delete fieldErrors.exampleQuestions
  },
  isReadonly: () => props.readonly
})
/** IconField 回吐 { icon, iconSource }；此处只取 icon。 */
function onIconPick(payload) {
  if (payload && typeof payload.icon === 'string') {
    form.icon = payload.icon
    delete fieldErrors.icon
  }
}
// 服务提供系统下拉选项：[{ id, name }]，必选其一
const providerSystems = ref([])
const psLoading = ref(false)
async function loadProviderSystems() {
  psLoading.value = true
  try {
    const data = await listProviderSystems({})
    providerSystems.value = data?.list || []
  } catch (e) {
    providerSystems.value = []
  } finally {
    psLoading.value = false
  }
}

// 鉴权（提案 20260831-2 · B 节）：authType=NONE|API_KEY|BEARER。
// API_KEY 多参数行（ParamRowsEditor，列序拍板：参数名/描述/客户端填写/位置/参数值）：
//   行 { in, key, description, clientFill, value, configured, valueMasked }；clientFill=客户端收集不存值。
// 密钥展示全站统一首尾掩码（2026-09-01 拍板，规则见 utils/secretMask）：明文永不回显，
//   已配置行/Token 以掩码供核对，编辑留空=保留原值、重填=覆盖。
// BEARER 单 Token（bearerToken + bearerMasked 掩码提示行）。
// authConfigured=true 表示加载时已配置过密钥（任一行/Token）。
// loadedAuthType 记录详情加载时的鉴权类型：「留空=保留原密钥」仅在类型未切换时成立。
const authType = ref('NONE')
const authRows = ref([])
const bearerToken = ref('')
// Bearer 已配置 Token 的首尾掩码串（全站密钥掩码口径，输入框下方只读提示供核对）
const bearerMasked = ref('')
const authConfigured = ref(false)
const loadedAuthType = ref('NONE')

const requestRows = ref([])
const responseRows = ref([])
// 被引用列表（只读）：[{ skillId, skillName }]
const referencedBySkills = ref([])
// 时间信息（只读，PRD §三.6）
const times = reactive({ createdAt: null, updatedAt: null, publishedAt: null })
const fieldErrors = reactive({})

const methods = API_METHODS
const authTypes = API_AUTH_TYPES
const authInOptions = API_AUTH_IN_OPTIONS

const isApiKey = computed(() => authType.value === 'API_KEY')
const isBearer = computed(() => authType.value === 'BEARER')
// BEARER 编辑态「留空=保留原 Token」仅在鉴权类型未变时成立（API_KEY↔BEARER 互切后旧密钥语义失效）；
// API_KEY 的保留语义逐行走 row.configured，类型互切时行集重建（configured=false）自然要求填新值。
const keepOldSecret = computed(
  () => isEdit.value && authConfigured.value && authType.value === loadedAuthType.value
)

// 空参数行（选中 API_KEY 时预置一行，B 节口径）
const emptyAuthRow = () => ({
  in: 'HEADER',
  key: '',
  description: '',
  clientFill: false,
  value: '',
  configured: false
})
// 切到 API_KEY 且无行 → 预置一行；类型互切后旧类型行集不共享
watch(authType, (t) => {
  if (t === 'API_KEY' && authRows.value.length === 0) authRows.value = [emptyAuthRow()]
})

/**
 * 鉴权参数行级提示（BODY×GET/DELETE 于 2026-09-01 拍板全放开：不硬拦，仅软提示告知风险）。
 * QUERY 泄漏警示已删（2026-09-01 拍板：QUERY 位常用，常驻警示反成噪音）。
 */
function authRowNotice(row) {
  if (row.in === 'BODY' && !API_BODY_METHODS.includes(form.method)) {
    return { type: 'hint', text: `${form.method} 通常无请求体，BODY 位是否生效取决于服务实现` }
  }
  if (row.in === 'PATH') {
    return { type: 'hint', text: '替换 API 地址中的同名 {占位符}' }
  }
  return null
}
// 编辑态由 API KEY 切回不鉴权且原本已配置过密钥 → 就地弱色提示（保存当下可见）
const willClearSecret = computed(
  () => isEdit.value && authType.value === 'NONE' && authConfigured.value
)

function clearErrors() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
}
function resetForm() {
  form.code = ''
  form.name = ''
  form.icon = ''
  form.description = ''
  form.providerSystemId = props.defaultProviderSystemId != null ? props.defaultProviderSystemId : null
  form.url = ''
  form.method = 'GET'
  form.enabled = true
  form.readWrite = 'read'
  form.exampleQuestions = ['', '', '']
  authType.value = 'NONE'
  loadedAuthType.value = 'NONE'
  authRows.value = []
  bearerToken.value = ''
  bearerMasked.value = ''
  authConfigured.value = false
  requestRows.value = []
  responseRows.value = []
  referencedBySkills.value = []
  times.createdAt = null
  times.updatedAt = null
  times.publishedAt = null
  clearErrors()
}

async function load() {
  clearErrors()
  if (!isEdit.value) {
    resetForm()
    return
  }
  loading.value = true
  loadError.value = false
  try {
    const d = await getApi(props.apiId)
    form.code = d.code || ''
    form.name = d.name || ''
    form.icon = d.icon || ''
    form.description = d.description || ''
    form.url = d.url || ''
    form.method = d.method || 'GET'
    form.enabled = d.enabled !== false
    form.readWrite = d.readWrite === 'write' ? 'write' : 'read'
    form.exampleQuestions = [0, 1, 2].map((i) => d.exampleQuestions?.[i] || '')
    // 鉴权回填（脱敏形态，绝不回显明文/密文）
    authType.value = d.authType === 'API_KEY' || d.authType === 'BEARER' ? d.authType : 'NONE'
    loadedAuthType.value = authType.value
    bearerToken.value = ''
    if (authType.value === 'API_KEY') {
      // 详情 authConfig.params：[{ in, name, description, clientFill, valueMasked }] → 行。
      // 全站密钥掩码口径（2026-09-01）：valueMasked 为首尾掩码串，行内占位展示供核对；
      // value 恒空、留空=保留原值（明文永不回显）。
      authRows.value = (d.authConfig?.params || []).map((p) => ({
        in: p.in || 'HEADER',
        key: p.name || '',
        description: p.description || '',
        clientFill: !!p.clientFill,
        value: '',
        configured: !!p.valueMasked,
        valueMasked: p.valueMasked || ''
      }))
      if (!authRows.value.length) authRows.value = [emptyAuthRow()]
      authConfigured.value = authRows.value.some((r) => r.configured)
    } else {
      authRows.value = []
      authConfigured.value = !!d.authConfig?.valueMasked
      bearerMasked.value = typeof d.authConfig?.valueMasked === 'string' ? d.authConfig.valueMasked : ''
    }
    requestRows.value = schemaToRows(d.requestSchema)
    responseRows.value = schemaToRows(d.responseSchema)
    referencedBySkills.value = d.referencedBySkills || []
    form.providerSystemId = d.providerSystemId != null ? d.providerSystemId : null
    times.createdAt = d.createdAt || null
    times.updatedAt = d.updatedAt || null
    times.publishedAt = d.publishedAt || null
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// immediate 必需：治理侧 GovObjectDetail 是「按 kind 条件挂载 + 同一 tick 置 visible」，
// 组件创建时 visible 已是 true，没有 false→true 跃迁，不加 immediate 抽屉会恒为空
// （2026-09-09 收口回归 P1）。常驻挂载场景初值为 false，直接 return，无副作用。
watch(
  () => [props.visible, props.apiId],
  ([vis]) => {
    if (vis) {
      loadProviderSystems()
      load()
    }
  },
  { immediate: true }
)

function close() {
  emit('update:visible', false)
}

/**
 * 保存校验（PRD §三.7），一次性标红所有问题项。
 */
function validate() {
  clearErrors()
  const errors = {}
  if (!form.name.trim()) errors.name = '名称不能为空'
  // 名称上限 64（2026-09-12 对齐《各模块必填选填字段一览表》§6.2 · 审计 K36）
  else if (form.name.trim().length > API_NAME_MAX) errors.name = `名称最多 ${API_NAME_MAX} 个字符`
  if (!form.icon) errors.icon = '请选择或上传图标'
  if (form.providerSystemId == null) errors.providerSystemId = '必须选择所属服务提供系统'
  if (!form.description.trim()) errors.description = 'API 描述必填'
  // 示例问题（2026-09-06 Q1 拍板：需要填写，固定 3 条均非空）
  if (form.exampleQuestions.some((q) => !(q || '').trim())) {
    errors.exampleQuestions = '示例问题必填，请填满 3 条（可点【AI 生成】）'
  }
  if (!/^https?:\/\/.+/i.test(form.url.trim())) {
    errors.url = 'API 地址必须为合法的 HTTP 或 HTTPS URL'
  }
  if (!methods.includes(form.method)) errors.method = '请选择请求方式'
  if (isApiKey.value) {
    // 多参数行整体校验（去重/互斥/必值；已配置行留空=保留原值由 row.configured 承接）
    const authErr = validateApiAuthParams(authRows.value)
    if (authErr) errors.authConfig = authErr
  }
  if (isBearer.value && !bearerToken.value.trim() && !keepOldSecret.value) {
    errors.authValue = 'Token 不能为空'
  }
  const reqErr = validateRows(requestRows.value)
  if (reqErr) errors.requestSchema = reqErr
  const respErr = validateRows(responseRows.value)
  if (respErr) errors.responseSchema = respErr
  Object.assign(fieldErrors, errors)
  return Object.keys(errors).length === 0
}

function buildPayload() {
  const payload = {
    name: form.name.trim(),
    icon: form.icon,
    description: form.description.trim(),
    providerSystemId: form.providerSystemId,
    url: form.url.trim(),
    method: form.method,
    enabled: form.enabled,
    readWrite: form.readWrite,
    exampleQuestions: form.exampleQuestions.map((q) => (q || '').trim()),
    requestSchema: rowsToSchema(requestRows.value),
    responseSchema: rowsToSchema(responseRows.value),
    authType: authType.value
  }
  if (isApiKey.value) {
    // 参数行 → params 数组；完全空白行丢弃（与校验同口径）。
    // 参数值明文直存直取（拍板）；clientFill 行不带值。
    payload.authConfig = {
      params: authRows.value
        .filter((r) => (r.key || '').trim() || (r.description || '').trim() || (r.value || '').trim())
        .map((r) => {
          const p = {
            in: r.in || 'HEADER',
            name: (r.key || '').trim(),
            description: (r.description || '').trim(),
            clientFill: !!r.clientFill
          }
          const secret = (r.value || '').trim()
          if (secret && !r.clientFill) p.value = secret
          return p
        })
    }
  } else if (isBearer.value) {
    // BEARER 无参数名/位置，仅 Token；留空=不改（保留原密文）
    const token = bearerToken.value.trim()
    payload.authConfig = token ? { value: token } : {}
  } else {
    payload.authConfig = null // NONE → 清空旧密钥
  }
  return payload
}

async function save() {
  if (!validate()) {
    ElMessage.warning('请先修正标红项')
    return
  }
  if (willClearSecret.value) {
    ElMessage.info('已切换为不鉴权，保存后将清除已配置的密钥')
  }
  saving.value = true
  try {
    const payload = buildPayload()
    const data = isEdit.value
      ? await updateApi(props.apiId, payload)
      : await createApi(payload)
    // 保存成功后关闭抽屉并刷新当前列表，不跳转页面（PRD §三.7）
    ElMessage.success(isEdit.value ? 'API 已保存' : 'API 已创建')
    emit('saved', { id: isEdit.value ? props.apiId : data?.id })
    close()
  } catch (e) {
    // 保存失败时保留输入内容，提示具体原因（PRD §三.7）
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
    entity="API"
    :is-edit="isEdit"
    :readonly="readonly"
    :loading="loading"
    :error="loadError"
    :saving="saving"
    create-text="保存"
    @update:visible="emit('update:visible', $event)"
    @retry="load"
    @save="save"
  >
      <!-- 抽屉顶部提示（2026-09-12 对齐 md §三.1 L102 · 审计 K35 / Q114 裁「按 md」）：三态均展示，逐字照 md -->
      <div class="ad-editor-note">1 个 API 对应 1 个可被技能引用的工具，发布前必须通过连通性验证。</div>
      <!-- 首行元信息（拍板：创建/更新/发布时间上移至此弱色展示） -->
      <div v-if="isEdit" class="page-time ad-meta-row">
        <span>创建时间：{{ times.createdAt ? fmtTime(times.createdAt) : '—' }}</span>
        <span>最近更新：{{ times.updatedAt ? fmtTime(times.updatedAt) : '—' }}</span>
        <span>最近发布：{{ times.publishedAt ? fmtTime(times.publishedAt) : '—' }}</span>
      </div>

      <section class="section-card">
        <div class="section-title">基本信息</div>
        <el-form label-position="top" :disabled="readonly">
          <!-- A3：照原型最终态首行「名称 ｜ 所属服务提供系统」同行 -->
          <div class="ad-row2">
            <el-form-item label="名称" :error="fieldErrors.name" required>
              <el-input v-model="form.name" :maxlength="API_NAME_MAX" placeholder="如 报销查询 API" />
            </el-form-item>
            <el-form-item label="所属服务提供系统" :error="fieldErrors.providerSystemId" required>
              <el-select
                v-model="form.providerSystemId"
                class="ad-w"
                filterable
                :loading="psLoading"
                placeholder="请选择所属服务提供系统"
              >
                <el-option
                  v-for="ps in providerSystems"
                  :key="ps.id"
                  :value="ps.id"
                  :label="ps.name"
                />
              </el-select>
              <!-- 兜底：下拉无任何分组时明确提示先建分组（正常路径由列表页零分组禁建前置拦住） -->
              <div v-if="!psLoading && !providerSystems.length" class="ad-ps-empty">
                当前没有任何服务提供系统，请先在 API 列表页新建服务提供系统后再新建 API。
              </div>
            </el-form-item>
          </div>
          <!-- 图标（md §三.2 L106「图标：必填」；原型最终层 L2181 把它删了属原型缺陷，
               Q101 负责人已确认以 md 为准，故保留）。S3：预览块 + 并排两个 plain 按钮 -->
          <div class="ad-row2">
            <el-form-item label="图标" :error="fieldErrors.icon" required>
              <IconField
                :icon="form.icon"
                :name="form.name"
                :readonly="readonly"
                placeholder="—"
                @pick="onIconPick"
              />
            </el-form-item>
            <!-- 操作性质（PRD §三.2）：写操作在客户端实际执行前必须经用户确认，读操作直接执行。 -->
            <el-form-item :error="fieldErrors.readWrite">
              <template #label>
                <span>这个操作会改动数据吗？</span>
              </template>
              <el-radio-group
                v-model="form.readWrite"
                class="ad-rw-group"
                :class="{ 'is-err': !!fieldErrors.readWrite }"
              >
                <el-radio value="read">只是查看（读）</el-radio>
                <el-radio value="write">会改动 / 新增数据（写）</el-radio>
              </el-radio-group>
              <div class="ad-rw-hint">写操作在客户端执行前会先弹确认；读操作直接执行。</div>
            </el-form-item>
          </div>
          <!-- 启用 / 停用状态（2026-09-09 PRD 复核轮 · G4/A16 · Q338）：
               md prd-API.md §三.4 L152「启用 / 停用状态：必填，默认启用；停用后技能不再可引用该 API」，
               《各模块必填选填字段一览表》亦已补录该字段。此控件曾按「原型最终态删了、md 亦无」一并删除，
               本版 md 已明确列出 → 恢复录入。字段与 payload 链路一直完整（form.enabled / buildPayload），
               本次只是把 UI 补回来。 -->
          <el-form-item label="状态" :error="fieldErrors.enabled" required>
            <el-radio-group v-model="form.enabled" class="ad-enabled-group">
              <el-radio :value="true">启用</el-radio>
              <el-radio :value="false">停用</el-radio>
            </el-radio-group>
            <div class="ad-rw-hint">停用后技能不再可引用该 API；已引用的技能运行效果可能受限。</div>
          </el-form-item>
          <!-- API ID（2026-09-12 对齐 md §三.2 L120「系统生成，编辑和查看态只读展示（如 api_1101）」· 审计 K36 / Q113）：
               新建态尚未生成不展示；编辑 / 查看态只读文本，不给输入框 -->
          <el-form-item v-if="isEdit" label="API ID">
            <code class="ad-api-id">{{ form.code || '—' }}</code>
          </el-form-item>
          <el-form-item label="API 描述" :error="fieldErrors.description" required>
            <el-input
              v-model="form.description"
              type="textarea"
              :rows="2"
              :autosize="{ minRows: 2, maxRows: 4 }"
              maxlength="2000"
              show-word-limit
              placeholder="一句话说明这个 API 是做什么的（如：按报销单号查询报销状态）"
            />
          </el-form-item>
        </el-form>

        <!-- 示例问题（md §三.2 L118「位于基本信息卡片内」；2026-09-06 Q1 拍板需要填写。
             原型最终层 L2182 删除属原型缺陷，Q102 负责人已确认以 md 为准 → 保留并按 md 放进基本信息卡，
             形态与 MCP / 业务系统同款子分区） -->
        <div class="connector-basic-subsection" :class="{ 'ad-eq-error': !!fieldErrors.exampleQuestions }">
          <div class="section-title ad-eq-title">
            <span>
              示例问题
              <span class="section-sub">必填，固定 3 条，用于帮助用户理解如何使用该连接器</span>
            </span>
            <el-button
              v-if="!readonly"
              class="ad-eq-ai"
              size="small"
              :disabled="aiDisabled"
              :title="aiTitle || undefined"
              @click="generateQuestions"
            >
              {{ aiLabel }}
            </el-button>
          </div>
          <div class="ad-eq-list">
            <div v-for="i in 3" :key="i" class="ad-eq-row">
              <span class="ad-eq-index">{{ i }}</span>
              <el-input
                v-model="form.exampleQuestions[i - 1]"
                :maxlength="QUESTION_MAX"
                show-word-limit
                :disabled="readonly"
                :placeholder="i === 1 ? '帮我查询报销单的当前审批状态' : '请输入示例问题'"
                @input="delete fieldErrors.exampleQuestions"
              />
            </div>
          </div>
          <div v-if="fieldErrors.exampleQuestions" class="ad-eq-err-msg">
            {{ fieldErrors.exampleQuestions }}
          </div>
        </div>
      </section>

      <!-- 请求配置（拍板：请求方式|API 地址 同行，方式下拉收窄；健康检查路径已删）。
           先于鉴权（提案 20260831-2 B.1 拍板）：鉴权 BODY 位的行级软提示依赖已选请求方式 -->
      <section class="section-card">
        <div class="section-title">请求配置</div>
        <el-form label-position="top" :disabled="readonly">
          <div class="ad-req-row">
            <el-form-item label="请求方式" :error="fieldErrors.method" required class="ad-req-method">
              <el-select v-model="form.method">
                <el-option v-for="m in methods" :key="m" :value="m" :label="m" />
              </el-select>
            </el-form-item>
            <el-form-item label="API 地址" :error="fieldErrors.url" required class="ad-req-url">
              <el-input v-model="form.url" placeholder="如 https://finance.example.com/api/expense/status" />
            </el-form-item>
          </div>
        </el-form>
      </section>

      <!-- 鉴权配置（提案 20260831-2 B 节；2026-09-01 拍板提示文案从简，静态附加说明收进标题副注） -->
      <section class="section-card">
        <div class="section-title">
          鉴权配置
          <span class="section-sub">凭证会静态附加到每次请求</span>
        </div>
        <el-form label-position="top" :disabled="readonly">
          <el-form-item label="鉴权类型">
            <el-radio-group v-model="authType">
              <el-radio v-for="t in authTypes" :key="t.value" :value="t.value">{{ t.label }}</el-radio>
            </el-radio-group>
            <div v-if="willClearSecret" class="ad-auth-warn">保存后将清除已配置的密钥</div>
          </el-form-item>
          <template v-if="isApiKey">
            <!-- A4：说明常显（原型 `.api-auth-add-note` 与【＋ 添加参数】同行，不随勾选出现）；
                 参数值密码态；无行时空态「暂无鉴权参数」（代码选 API_KEY 时预置一行，空态一般见不到，
                 但删光最后一行仍会落到空态） -->
            <el-form-item label="鉴权参数" :error="fieldErrors.authConfig">
              <ParamRowsEditor
                :rows="authRows"
                :readonly="readonly"
                show-in
                :in-options="authInOptions"
                :row-notice="authRowNotice"
                key-header="参数名"
                key-placeholder="如 X-Api-Key"
                value-header="参数值"
                desc-placeholder="选填：这个参数是做什么的"
                add-label="＋ 添加参数"
                empty-text="暂无鉴权参数"
                secret-value
                client-fill-hint="客户端填写参数由客户端收集，平台不存值"
                client-fill-hint-always
                @update:rows="authRows = $event"
                @interact="delete fieldErrors.authConfig"
              />
            </el-form-item>
          </template>
          <template v-if="isBearer">
            <el-form-item :error="fieldErrors.authValue" required>
              <template #label>
                <span>Token</span>
                <span class="lbl-hint">只填 Token 本体；加密存储，不回显明文</span>
              </template>
              <!-- 查看态以掩码展示（全站密钥掩码口径），同样保留完整头格式 -->
              <div v-if="readonly" class="ad-auth-masked">
                <code>Authorization: Bearer </code>
                <code>{{ authConfigured ? bearerMasked || '******' : '（未配置）' }}</code>
              </div>
              <!-- 固定前置段展示完整请求头格式，避免误把 Bearer 前缀填进 Token -->
              <template v-else>
                <el-input
                  v-model="bearerToken"
                  type="password"
                  show-password
                  autocomplete="new-password"
                  class="ad-bearer-input"
                  :placeholder="keepOldSecret ? '已配置（留空保持不变）' : '粘贴Bearer Token（不含Bearer前缀）'"
                  @input="delete fieldErrors.authValue"
                >
                  <template #prepend>Authorization: Bearer</template>
                </el-input>
                <!-- 已配置掩码提示（模型页同款形态）：不塞进密码框，输入框保持「留空不修改」语义 -->
                <div v-if="keepOldSecret && bearerMasked" class="ad-auth-masked">
                  当前：<code>{{ bearerMasked }}</code>（留空保持不变，重填覆盖）
                </div>
              </template>
            </el-form-item>
          </template>
        </el-form>
      </section>

      <!-- 请求参数 / 响应字段（PRD §三.5）：结构化输入/输出约束，均选填 -->
      <section class="section-card">
        <div class="section-title">
          请求参数
          <span class="ad-sec-field">requestSchema</span>
          <span class="section-sub">（可选；类型选「对象」或「数组」可套子字段，支持任意层级嵌套）</span>
        </div>
        <el-form :disabled="readonly">
          <!-- 查看态隐藏新增 / 删除 / 添加子字段入口（md §三.5 L170 · 审计 K38，2026-09-12） -->
          <SchemaFieldEditor v-model:rows="requestRows" variant="request" :readonly="readonly" :error="fieldErrors.requestSchema" />
        </el-form>
      </section>

      <section class="section-card">
        <div class="section-title">
          响应字段
          <span class="ad-sec-field">responseSchema</span>
          <span class="section-sub">（可选；类型选「对象」或「数组」可套子字段，支持任意层级嵌套）</span>
        </div>
        <el-form :disabled="readonly">
          <SchemaFieldEditor v-model:rows="responseRows" variant="response" :readonly="readonly" :error="fieldErrors.responseSchema" />
        </el-form>
      </section>

      <!-- 被技能引用（原型 renderApiEditor 同款：标题+副注+tag 列表；时间行已上移首行。
           原型副注"被引用时不可删除"与软引用可删拍板冲突，未采纳——差异已记待裁决 -->
      <section v-if="isEdit" class="reference-section">
        <div class="section-title">
          被技能引用
          <span class="section-sub">只读；停用或删除后引用技能仍可执行，可能受限或报错</span>
        </div>
        <div v-if="referencedBySkills.length" class="ad-refs">
          <el-tag
            v-for="s in referencedBySkills"
            :key="s.skillId"
            type="info"
            size="small"
          >
            {{ s.skillName }}
          </el-tag>
        </div>
        <div v-else class="ad-refs-empty">暂无技能引用</div>
      </section>
  </DrawerEditor>
</template>

<style scoped>
/* 分区卡（.section-card / .section-title / .section-sub / .reference-section / .page-time）
   样式统一在 assets/admin-shell.css（S1，批次 1 已提供），本文件不重复。
   首行元信息走 `.page-time`；照原型 L2159 移到抽屉首行后，去掉其上分隔线（悬空线）。
   admin-shell.css 的规则是 `body.admin-scope .page-time`（0,2,1），故叠一个类提到 (0,3,0)。 */
.page-time.ad-meta-row {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
/* 抽屉顶部提示（md §三.1 L102，K35）：弱色一行，置于首行元信息之上 */
.ad-editor-note {
  margin: 0 2px 10px;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: 1.6;
}
/* API ID 只读展示（md §三.2 L120，K36）：等宽弱色文本 */
.ad-api-id {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
/* 示例问题作基本信息卡内子分区（A3/md §三.2 L118，原型 L1126-1127 `.connector-basic-subsection`）：
   上边线分隔 margin-top 26 / padding-top 24，标题 17px/700 */
.connector-basic-subsection {
  margin-top: 26px;
  padding-top: 24px;
  border-top: 1px solid var(--border-soft);
}
.connector-basic-subsection > .section-title {
  margin: 0 0 18px;
  font-size: 17px;
  line-height: 24px;
  font-weight: 700;
}
/* 字段技术名（requestSchema/responseSchema 等）：弱色等宽副标 */
.ad-sec-field {
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  color: var(--c-text-faint);
  margin-left: var(--space-1);
}
.lbl-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-1);
}
.ad-w {
  width: 100%;
}
/* 图标行样式随 IconField 组件走（S3），本文件不再自绘预览格与按钮 */
/* 两列行（原型 form-grid 同款）：名称 | 所属服务提供系统、图标 | 操作性质 */
.ad-row2 {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.ad-row2 > .el-form-item {
  flex: 1;
  min-width: 0;
}
/* 零分组兜底提示：警示色，引导先建分组 */
.ad-ps-empty {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-warning);
}
/* 读/写 radio 错误态：radio 无天然红框，有错误时给整组补一条红边 */
.ad-rw-group.is-err {
  border: 1px solid var(--c-danger);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-2);
}
.ad-rw-hint {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1.5;
}
/* 启用/停用 radio 组（A16/Q338 恢复）：与读/写组同排版，独占整行 */
.ad-enabled-group {
  display: flex;
  align-items: center;
}
/* Bearer 前置段（完整请求头格式展示）：等宽字体弱色 */
.ad-bearer-input :deep(.el-input-group__prepend) {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 鉴权提示独占一行（el-form-item 内容区是 flex-wrap，宽 100% 强制换行，避免挤到 radio 同行） */
.ad-auth-hint {
  width: 100%;
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ad-auth-warn {
  width: 100%;
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-warning);
}
.ad-auth-masked {
  width: 100%;
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ad-auth-masked code {
  font-family: var(--font-mono);
}
/* 请求配置：请求方式|API 地址同行，方式下拉收窄（与地址输入框同高对齐） */
.ad-req-row {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.ad-req-method {
  flex: 0 0 130px;
}
.ad-req-url {
  flex: 1;
  min-width: 0;
}
.ad-refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.ad-refs-empty {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 示例问题区（MCP/业务系统同形态：标题行右侧 AI 按钮 + 3 行序号输入） */
.ad-eq-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ad-eq-ai {
  /* 常规字重（一览表附录「AI 生成按钮样式」：技能/专家/连接器统一不加粗） */
  font-weight: var(--fw-regular, 400);
  white-space: nowrap;
}
.ad-eq-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ad-eq-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ad-eq-index {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ad-eq-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.ad-eq-err-msg {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
