<script setup>
/**
 * 数据源配置抽屉（「数据源管理」子页的新建 / 编辑 / 查看），DrawerEditor 720px。
 * 2026-09-04 按 PRD-20260903《prd.知识库.md》§四～§七 + 交互原型 openSourceEditor/openSourceViewer 对齐重排。
 *
 * 【公共字段】（md §四.3）名称（≤50 必填）/ 类型（上传·API·MCP，创建后不可修改）/ 状态（启用·停用）。
 * 数据源保存后立即生效、不过知识库发布审核；API/MCP 修改连接配置后需要重新测试（编辑界面常驻该提示）。
 *
 * 【上传】（md §五）文档类型三选一（决定可收文件格式）；预处理项按文档类型动态展示；向量模型
 *   （更换需确认「全量重建索引」）；检索方式 混合/向量/关键词；Top K 1~20 默认 5；
 *   检索阈值不在管理端设置，由客户端每次发起检索时提供。
 * 【API】（md §六）请求地址（≤500，http/https）/ GET·POST / 无鉴权·API Key（参数名+位置 Header·Query+凭证遮罩）/
 *   超时 1000~60000 默认 8000 / query·topK 请求映射 / 结果数组 JSONPath + content 必、source·score 可选 / 测试连接。
 * 【MCP】（md §七）引用现有 MCP（与连接器同源，不回显其凭证）或内联配置（Endpoint ≤500、
 *   无鉴权·Bearer Token·自定义 Header、凭证遮罩）；检索工具必选（Schema 默认折叠按需查看）；
 *   query 必、topK 可选映射；content 必、source·score 可选；超时用系统默认值可直接修改；测试连接。
 *
 * 敏感信息遮罩：明文只在提交瞬间存在，回显一律 maskSecret 掩码（md §四.3 / §八.2）。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import {
  getKnowledgeSource,
  createKnowledgeSource,
  updateKnowledgeSource,
  testKnowledgeSource,
  listMcpToolsForKb,
  listMcpOptions,
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
  MCP_DEFAULTS
} from '@/utils/knowledgeBaseMeta'
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
/** API 鉴权参数位置：Header 或 Query（md §六.1） */
const API_AUTH_IN = [
  { value: 'HEADER', label: 'Header' },
  { value: 'QUERY', label: 'Query' }
]

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
  // 三类 config 字段平铺（按 sourceType 取用）
  ...UPLOAD_DEFAULTS,
  ...API_DEFAULTS,
  ...MCP_DEFAULTS,
  authValue: '',
  authValueMasked: ''
})
const verify = ref(null)
const testing = ref(false)
const mcpTools = ref([])
const mcps = ref([])
const embeddingModels = ref([])
const schemaOpen = ref([]) // 工具 Schema 默认折叠（md §七.3）

const rules = computed(() => ({
  name: [{ required: true, message: '请输入数据源名称', trigger: 'blur' }],
  url:
    form.sourceType === 'API'
      ? [
          { required: true, message: '请填写请求地址', trigger: 'blur' },
          {
            validator: (r, v, cb) => (v && !/^https?:\/\//i.test(v.trim()) ? cb(new Error('需为合法 HTTP/HTTPS 地址')) : cb()),
            trigger: 'blur'
          }
        ]
      : []
}))

/** 按文档类型动态展示预处理项（md §五.1：不展示对当前类型无效的配置）。 */
const preprocessVisible = computed(() => PREPROCESS_OPTIONS.filter((o) => o.kinds.includes(form.docKind)))
/** 当前所选检索工具（EXISTING 模式，供 Schema 折叠查看）。 */
const activeTool = computed(() => mcpTools.value.find((t) => t.name === form.toolName) || null)

async function loadOptions() {
  const [m, em] = await Promise.all([listMcpOptions().catch(() => []), listEmbeddingModelOptions().catch(() => [])])
  mcps.value = m
  embeddingModels.value = em
}
async function loadMcpTools() {
  mcpTools.value = []
  if (form.mode !== 'EXISTING' || !form.mcpId) return
  mcpTools.value = await listMcpToolsForKb(form.mcpId).catch(() => [])
}
function onMcpChange() {
  form.toolName = ''
  loadMcpTools()
}

function resetForm() {
  Object.assign(form, {
    sourceType: 'UPLOAD',
    name: '',
    status: 'ENABLED',
    ...UPLOAD_DEFAULTS,
    ...API_DEFAULTS,
    ...MCP_DEFAULTS,
    authValue: '',
    authValueMasked: ''
  })
  verify.value = null
  mcpTools.value = []
  schemaOpen.value = []
}
function hydrate(d) {
  detail.value = d
  Object.assign(form, { sourceType: d.sourceType, name: d.name || '', status: d.status || 'ENABLED' }, d.config || {}, {
    authValue: '',
    authValueMasked: d.config?.authValueMasked || ''
  })
  verify.value = d.sourceType === 'UPLOAD' ? null : { verifyStatus: d.verifyStatus, verifiedAt: d.verifiedAt, verifyError: d.verifyError }
}
async function load() {
  loadError.value = ''
  loading.value = true
  try {
    await loadOptions()
    if (targetId.value) {
      hydrate(await getKnowledgeSource(targetId.value))
      await loadMcpTools()
    }
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
// 修改连接配置 → 验证状态回未验证（md §六.3 / §七.4：配置变更后重置为未验证，需重新测试）
watch(
  () => [form.url, form.method, form.authType, form.authName, form.authIn, form.mcpId, form.endpoint, form.authHeaderName, form.toolName, form.queryField, form.topKField, form.itemsPath, form.queryParam, form.topKParam, form.contentField, form.sourceField, form.scoreField, form.authValue],
  () => {
    if (loading.value || viewMode.value || form.sourceType === 'UPLOAD') return
    if (verify.value && verify.value.verifyStatus !== 'UNVERIFIED') verify.value = { verifyStatus: 'UNVERIFIED' }
  }
)

/* ---------- 测试连接（API / MCP，md §六.3 / §七.4） ---------- */
async function doTest() {
  testing.value = true
  try {
    const r = await testKnowledgeSource(form.sourceType, { sourceId: targetId.value, config: buildConfig(), authValue: form.authValue || null })
    verify.value = r
    if (r.verifyStatus === 'SUCCESS') ElMessage.success('连接测试成功')
    else ElMessage.error(r.verifyError || '连接失败')
  } catch (e) {
    ElMessage.error(e?.message || '测试失败')
  } finally {
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

/* ---------- 保存 ---------- */
const CONFIG_KEYS = {
  UPLOAD: Object.keys(UPLOAD_DEFAULTS),
  API: Object.keys(API_DEFAULTS),
  MCP: Object.keys(MCP_DEFAULTS)
}
function buildConfig() {
  const cfg = {}
  for (const k of CONFIG_KEYS[form.sourceType]) cfg[k] = form[k]
  return cfg
}
function validateTyped() {
  if (form.sourceType === 'API' && !(form.url || '').trim()) return '请填写请求地址'
  if (form.sourceType === 'MCP') {
    if (form.mode === 'EXISTING' && !form.mcpId) return '请选择 MCP 服务'
    if (form.mode === 'INLINE' && !(form.endpoint || '').trim()) return '请填写 MCP 服务地址'
    if (form.mode === 'INLINE' && form.authType === 'header' && !(form.authHeaderName || '').trim()) return '请填写 Header 名称'
    if (!(form.toolName || '').trim()) return '请选择用于知识检索的工具'
  }
  return null
}
async function save() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  const err = validateTyped()
  if (err) {
    ElMessage.error(err)
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
      authValue: form.sourceType === 'UPLOAD' ? undefined : form.authValue || null
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
    if (e?.field) formRef.value?.validateField?.(e.field)
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

    <el-form ref="formRef" :model="form" :rules="rules" label-width="118px" label-position="right" :disabled="viewMode">
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

      <!-- 上传类：内置 RAG 配置（md §五.1） -->
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

      <!-- API 类（md §六） -->
      <section v-else-if="form.sourceType === 'API'" class="ksrc-sec">
        <div class="ksrc-sec-title">连接配置</div>
        <el-form-item label="请求地址" prop="url">
          <el-input v-model="form.url" maxlength="500" placeholder="如 https://rag.example.com/api/v1/search" />
        </el-form-item>
        <el-form-item label="请求方法">
          <el-select v-model="form.method" class="ksrc-half">
            <el-option label="GET" value="GET" />
            <el-option label="POST" value="POST" />
          </el-select>
        </el-form-item>
        <el-form-item label="鉴权方式">
          <div class="ksrc-row">
            <el-select v-model="form.authType" class="ksrc-half">
              <el-option label="无鉴权" value="NONE" />
              <el-option label="API Key" value="API_KEY" />
            </el-select>
            <template v-if="form.authType === 'API_KEY'">
              <el-input v-model="form.authName" class="ksrc-quarter" placeholder="参数名称，如 X-Api-Key" />
              <el-select v-model="form.authIn" class="ksrc-quarter">
                <el-option v-for="o in API_AUTH_IN" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </template>
          </div>
        </el-form-item>
        <el-form-item v-if="form.authType === 'API_KEY'" label="访问凭证">
          <el-input v-model="form.authValue" type="password" show-password autocomplete="new-password" class="ksrc-half" :placeholder="form.authValueMasked ? `已配置 ${form.authValueMasked}，留空表示保留` : '请输入访问凭证'" />
        </el-form-item>
        <el-form-item label="超时时间">
          <div class="ksrc-inline">
            <el-input-number v-model="form.timeoutMs" :min="1000" :max="60000" :step="1000" controls-position="right" />
            <span class="ksrc-unit">ms（1000～60000，默认 8000）</span>
          </div>
        </el-form-item>
        <div class="ksrc-sub">请求映射</div>
        <el-form-item label="参数名">
          <div class="ksrc-row">
            <el-input v-model="form.queryField" class="ksrc-half"><template #prepend>query</template></el-input>
            <el-input v-model="form.topKField" class="ksrc-half" placeholder="可选"><template #prepend>topK</template></el-input>
          </div>
        </el-form-item>
        <div class="ksrc-sub">响应映射</div>
        <el-form-item label="结果数组">
          <el-input v-model="form.itemsPath" placeholder="JSONPath，如 $.data[*]" class="ksrc-mono" />
        </el-form-item>
        <el-form-item label="结果字段">
          <div class="ksrc-row">
            <el-input v-model="form.contentField" class="ksrc-third"><template #prepend>content</template></el-input>
            <el-input v-model="form.sourceField" class="ksrc-third" placeholder="可选"><template #prepend>source</template></el-input>
            <el-input v-model="form.scoreField" class="ksrc-third" placeholder="可选"><template #prepend>score</template></el-input>
          </div>
        </el-form-item>
        <el-form-item label=" ">
          <div class="ksrc-row ksrc-inline">
            <el-button size="small" :loading="testing" @click="doTest">测试连接</el-button>
            <span v-if="verifyLine" class="ksrc-verify" :class="verify?.verifyStatus === 'SUCCESS' ? 'ok' : 'bad'">● {{ verifyLine }}</span>
            <span v-else-if="!viewMode" class="ksrc-hint">修改连接配置后需要重新测试</span>
          </div>
        </el-form-item>
      </section>

      <!-- MCP 类（md §七） -->
      <section v-else class="ksrc-sec">
        <div class="ksrc-sec-title">MCP 检索</div>
        <el-form-item label="接入方式">
          <el-radio-group v-model="form.mode">
            <el-radio value="EXISTING">引用现有 MCP</el-radio>
            <el-radio value="INLINE">内联配置</el-radio>
          </el-radio-group>
        </el-form-item>
        <template v-if="form.mode === 'EXISTING'">
          <el-form-item label="MCP 服务">
            <div class="ksrc-row">
              <el-select v-model="form.mcpId" filterable placeholder="从连接器模块选择已登记的 MCP" class="ksrc-half" @change="onMcpChange">
                <el-option v-for="m in mcps" :key="m.id" :label="m.name" :value="m.id" />
              </el-select>
              <span class="ksrc-hint">复用连接器配置，不复制或回显其凭证</span>
            </div>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="MCP 服务地址">
            <el-input v-model="form.endpoint" maxlength="500" placeholder="Endpoint，如 https://rag.example.com/mcp" />
          </el-form-item>
          <el-form-item label="鉴权方式">
            <div class="ksrc-row">
              <el-select v-model="form.authType" class="ksrc-half">
                <el-option label="无鉴权" value="none" />
                <el-option label="Bearer Token" value="bearer" />
                <el-option label="自定义 Header" value="header" />
              </el-select>
              <el-input v-if="form.authType === 'header'" v-model="form.authHeaderName" class="ksrc-half" placeholder="Header 名称，如 X-Api-Key" />
            </div>
          </el-form-item>
          <el-form-item v-if="form.authType !== 'none'" label="访问凭证">
            <el-input v-model="form.authValue" type="password" show-password autocomplete="new-password" class="ksrc-half" :placeholder="form.authValueMasked ? `已配置 ${form.authValueMasked}，留空表示保留` : '请输入访问凭证'" />
          </el-form-item>
        </template>
        <el-form-item label="工具">
          <div class="ksrc-tool">
            <div class="ksrc-row">
              <el-select v-if="form.mode === 'EXISTING'" v-model="form.toolName" filterable placeholder="选择用于知识检索的工具" class="ksrc-half" :no-data-text="form.mcpId ? '该 MCP 没有工具，先到连接器「拉取工具」' : '先选择 MCP 服务'">
                <el-option v-for="tool in mcpTools" :key="tool.name" :label="tool.name" :value="tool.name" />
              </el-select>
              <el-input v-else v-model="form.toolName" class="ksrc-half" placeholder="工具名，如 search" />
              <span class="ksrc-hint">用于知识检索的 MCP 工具</span>
            </div>
            <!-- 工具 Schema 默认折叠，按需查看入参（md §七.3） -->
            <el-collapse v-if="activeTool?.inputSchema" v-model="schemaOpen" class="ksrc-schema">
              <el-collapse-item name="schema" title="查看工具入参 Schema">
                <pre class="ksrc-schema-pre">{{ JSON.stringify(activeTool.inputSchema, null, 2) }}</pre>
              </el-collapse-item>
            </el-collapse>
          </div>
        </el-form-item>
        <el-form-item label="参数映射">
          <div class="ksrc-row">
            <el-input v-model="form.queryParam" class="ksrc-half"><template #prepend>query</template></el-input>
            <el-input v-model="form.topKParam" class="ksrc-half" placeholder="可选"><template #prepend>topK</template></el-input>
          </div>
        </el-form-item>
        <el-form-item label="结果字段">
          <div class="ksrc-row">
            <el-input v-model="form.contentField" class="ksrc-third"><template #prepend>content</template></el-input>
            <el-input v-model="form.sourceField" class="ksrc-third" placeholder="可选"><template #prepend>source</template></el-input>
            <el-input v-model="form.scoreField" class="ksrc-third" placeholder="可选"><template #prepend>score</template></el-input>
          </div>
        </el-form-item>
        <el-form-item label="超时时间">
          <div class="ksrc-inline">
            <el-input-number v-model="form.timeoutMs" :min="1000" :max="60000" :step="1000" controls-position="right" />
            <span class="ksrc-unit">ms（系统默认值，可直接修改）</span>
          </div>
        </el-form-item>
        <el-form-item label=" ">
          <div class="ksrc-row ksrc-inline">
            <el-button size="small" :loading="testing" @click="doTest">测试连接</el-button>
            <span v-if="verifyLine" class="ksrc-verify" :class="verify?.verifyStatus === 'SUCCESS' ? 'ok' : 'bad'">● {{ verifyLine }}</span>
            <span v-else-if="!viewMode" class="ksrc-hint">修改连接配置后需要重新测试</span>
          </div>
        </el-form-item>
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
.ksrc-sec :deep(.el-form-item) {
  margin-bottom: var(--space-4);
}
.ksrc-sec :deep(.el-form-item:last-child) {
  margin-bottom: 0;
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
.ksrc-third {
  width: calc(33.333% - 7px);
}
.ksrc-quarter {
  width: calc(25% - 8px);
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
.ksrc-mono :deep(input) {
  font-family: var(--font-mono);
}
.ksrc-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  font-weight: var(--fw-medium);
  margin: 0 0 var(--space-2);
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
.ksrc-tool {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ksrc-schema {
  border: 0;
}
.ksrc-schema :deep(.el-collapse-item__header) {
  height: 32px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  border: 0;
}
.ksrc-schema :deep(.el-collapse-item__wrap) {
  border: 0;
}
.ksrc-schema-pre {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--c-bg-subtle, rgba(0, 0, 0, 0.03));
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--c-text);
  max-height: 240px;
  overflow: auto;
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
