<script setup>
/**
 * API 定义编辑器（2026-09-01 对齐 PRD-20260828《03能力/连接器/API/prd-API.md》§三）。
 *
 * 抽屉式，新建 / 编辑 / 查看三态（查看全只读，底部仅【关闭】；点遮罩不直接关闭防误丢内容）。
 * 信息结构（2026-09-01 拍板对齐交互原型 v2 的 API 弹窗，renderApiEditor；原顶部提示行删除）：
 *   首行元信息（编辑/查看态：创建 / 最近更新 / 最近发布时间，弱色提示展示）
 *   → 基本信息（原型最终态：名称|图标 → 所属服务提供系统 → 描述[必填,通栏] → 状态[启用/停用]|操作性质；
 *     图标 2026-09-02 B-5 拍板加回——原型后置补丁层 addConnectorIconField 实为 API 抽屉注入图标，
 *     推翻 2026-09-01 N4-① 旧结论；示例问题仍不展示（字段随详情透传保留存量数据）；
 *     启用/停用状态单选按原型加回仅作示意；API id 行随后拍板不展示（code 字段保留于状态供内部用））
 *   → 请求配置（请求方式|API 地址 同行，方式下拉收窄；健康检查路径已删——连通性验证保留，
 *     探测语义为 API 地址可达性）
 *   → 鉴权配置（不鉴权 / API_KEY 多参数行[ParamRowsEditor] / Bearer Token；提示文案从简，
 *     密钥类值均按敏感信息处理：密码态输入、不回显明文）
 *   → 请求参数 / 响应字段（SchemaFieldEditor，对象/数组可套子字段，任意层级）
 *   → 被技能引用（只读）。
 *
 * 校验（PRD §三.7）在本组件收口：名称/图标/所属系统/描述/示例问题必填、URL 合法、
 * API_KEY 鉴权参数行走 validateApiAuthParams（去重/互斥/必值，编辑态已配置行留空=保留原值）、
 * BEARER Token 必填（编辑态已配置留空=保留）、schema 字段名非空且同层唯一。
 * 鉴权密钥脱敏：编辑态已配置只显「已配置」，绝不回显明文，也不进 console。
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
import IconPickerPopover from '@/components/position/IconPickerPopover.vue'
import { iconIsUrl } from '@/utils/iconDisplay'

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
  // 启用/停用（原型 renderApiEditor 状态单选；仅配置项示意，与发布状态机无联动）
  enabled: true,
  // 读/写：write → 客户端实际执行前必须经用户确认；read 直接执行（PRD §三.2）
  readWrite: 'read',
  // 图标：2026-09-02 B-5 拍板加回弹窗（原型后置补丁层实有此字段，推翻 N4-①）；
  // 示例问题仍不在弹窗展示，随详情透传保留存量数据
  icon: '',
  exampleQuestions: ['', '', '']
})
// 图标：URL/dataURL 按图片渲染，否则按 emoji/字符（全站统一判断）
const iconIsUrlFlag = computed(() => iconIsUrl(form.icon))
/** IconPickerPopover 回吐 { icon, iconSource }；此处只取 icon。 */
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

watch(
  () => [props.visible, props.apiId],
  ([vis]) => {
    if (vis) {
      loadProviderSystems()
      load()
    }
  }
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
  if (!form.icon) errors.icon = '请选择或上传图标'
  if (form.providerSystemId == null) errors.providerSystemId = '必须选择所属服务提供系统'
  if (!form.description.trim()) errors.description = 'API 描述必填'
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
      <!-- 首行元信息（拍板：原顶部提示行删除，创建/更新/发布时间上移至此弱色展示） -->
      <div v-if="isEdit" class="ad-meta-row">
        <span>创建时间：{{ times.createdAt ? fmtTime(times.createdAt) : '—' }}</span>
        <span>最近更新：{{ times.updatedAt ? fmtTime(times.updatedAt) : '—' }}</span>
        <span>最近发布：{{ times.publishedAt ? fmtTime(times.publishedAt) : '—' }}</span>
      </div>

      <section class="ad-sec">
        <div class="ad-sec-title">基本信息</div>
        <el-form label-position="top" :disabled="readonly">
          <!-- 原型最终态布局（addConnectorIconField 在名称后注入图标）：名称 | 图标 → 所属系统 -->
          <div class="ad-row2">
            <el-form-item label="名称" :error="fieldErrors.name" required>
              <el-input v-model="form.name" maxlength="128" placeholder="如 报销查询 API" />
            </el-form-item>
            <!-- 图标（2026-09-02 B-5 拍板加回：原型后置补丁层实为 API 抽屉注入图标，推翻 N4-① 旧结论） -->
            <el-form-item label="图标" :error="fieldErrors.icon" required>
              <div class="ad-icon-row">
                <span class="ad-icon-preview" :class="{ 'is-empty': !form.icon }">
                  <img v-if="iconIsUrlFlag" :src="form.icon" alt="" class="ad-icon-img" />
                  <span v-else-if="form.icon">{{ form.icon }}</span>
                  <span v-else class="ad-icon-ph">—</span>
                </span>
                <IconPickerPopover
                  v-if="!readonly"
                  :icon="form.icon"
                  :position-name="form.name"
                  @pick="onIconPick"
                />
              </div>
            </el-form-item>
          </div>
          <div class="ad-row2">
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
          <!-- 状态 | 操作性质 同行（原型 renderApiEditor 第三行） -->
          <div class="ad-row2">
            <el-form-item label="状态">
              <el-radio-group v-model="form.enabled">
                <el-radio :value="true">启用</el-radio>
                <el-radio :value="false">停用</el-radio>
              </el-radio-group>
            </el-form-item>
            <!-- 操作性质（PRD §三.2）：写操作在客户端实际执行前必须经用户确认，读操作直接执行 -->
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

        </el-form>
      </section>

      <!-- 请求配置（拍板：请求方式|API 地址 同行，方式下拉收窄；健康检查路径已删）。
           先于鉴权（提案 20260831-2 B.1 拍板）：鉴权 BODY 位的行级软提示依赖已选请求方式 -->
      <section class="ad-sec">
        <div class="ad-sec-title">请求配置</div>
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
      <section class="ad-sec">
        <div class="ad-sec-title">
          鉴权配置
          <span class="ad-sec-sub">凭证会静态附加到每次请求</span>
        </div>
        <el-form label-position="top" :disabled="readonly">
          <el-form-item label="鉴权类型">
            <el-radio-group v-model="authType">
              <el-radio v-for="t in authTypes" :key="t.value" :value="t.value">{{ t.label }}</el-radio>
            </el-radio-group>
            <div v-if="willClearSecret" class="ad-auth-warn">保存后将清除已配置的密钥</div>
          </el-form-item>
          <template v-if="isApiKey">
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
                add-label="+ 添加参数"
                client-fill-hint="客户端填写参数由客户端收集，平台不存值"
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
                  :placeholder="keepOldSecret ? '已配置（留空保持不变）' : '请输入 Token'"
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
      <section class="ad-sec">
        <div class="ad-sec-title">
          请求参数
          <span class="ad-sec-field">requestSchema</span>
          <span class="ad-sec-sub">（可选；类型选「对象」或「数组」可套子字段，支持任意层级嵌套）</span>
        </div>
        <el-form :disabled="readonly">
          <SchemaFieldEditor v-model:rows="requestRows" variant="request" :error="fieldErrors.requestSchema" />
        </el-form>
      </section>

      <section class="ad-sec">
        <div class="ad-sec-title">
          响应字段
          <span class="ad-sec-field">responseSchema</span>
          <span class="ad-sec-sub">（可选；类型选「对象」或「数组」可套子字段，支持任意层级嵌套）</span>
        </div>
        <el-form :disabled="readonly">
          <SchemaFieldEditor v-model:rows="responseRows" variant="response" :error="fieldErrors.responseSchema" />
        </el-form>
      </section>

      <!-- 被技能引用（原型 renderApiEditor 同款：标题+副注+tag 列表；时间行已上移首行。
           原型副注"被引用时不可删除"与软引用可删拍板冲突，未采纳——差异已记待裁决 -->
      <section v-if="isEdit" class="ad-sec">
        <div class="ad-sec-title">
          被技能引用
          <span class="ad-sec-sub">只读；停用或删除后引用技能仍可执行，可能受限或报错</span>
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
/* 首行元信息（创建/更新/发布时间）：弱色提示行，不抢内容 */
.ad-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.ad-sec-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-2);
}
.ad-sec-sub {
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-2);
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
/* 图标行（B-5 加回，样式与 BizSystemEditor 同款） */
.ad-icon-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ad-icon-preview {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  overflow: hidden;
}
.ad-icon-preview.is-empty,
.ad-icon-ph {
  color: var(--c-text-faint);
}
.ad-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 两列行（原型 form-grid 同款）：名称|图标、所属系统 */
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
</style>
