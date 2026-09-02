<script setup>
/**
 * 数据源配置抽屉（「数据源管理」子页的新建 / 编辑），DrawerEditor 720px，2026-08-31 新增。
 *
 * 类型（上传 / API / MCP）新建时选定、建后不可改（同知识库类型口径）；三类各自的配置表单
 * 由原 KnowledgeBaseEditor 内联卡抽出：上传=文档类型 / 预处理规则 / Embedding / 检索策略（拆分方式走系统内置，不暴露）；
 * API / MCP=连接 + 映射 + 测试连接。启停位 status 同 MCP / API 页（停用后引用它的知识库检索时跳过）。
 *
 * 【职责边界（2026-08-31 负责人定）】本抽屉只管**库维度配置**；上传类的文档清单拆到独立的
 * 「文档」入口（KnowledgeSourceDocsDrawer），两者在列表操作列层面分开。
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
  MCP_DEFAULTS,
} from '@/utils/knowledgeBaseMeta'
import { API_AUTH_IN_OPTIONS } from '@/utils/defValidate'
import { fmtRelative } from '@/utils/docMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 编辑目标 id；null=新建 */
  sourceId: { type: String, default: null }
})
const emit = defineEmits(['update:visible', 'saved', 'changed'])

const TYPE_DESC = {
  UPLOAD: '文档上传到平台内置 RAG 库，由平台切片与向量化',
  API: '调用第三方 RAG 平台的检索接口，按需取回切片',
  MCP: '通过 MCP 协议从第三方 RAG 平台取回切片'
}

const formRef = ref(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const createdId = ref(null)
const detail = ref(null)

const targetId = computed(() => props.sourceId || createdId.value)
const isEdit = computed(() => !!targetId.value)

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

const rules = computed(() => ({
  name: [{ required: true, message: '请输入数据源名称', trigger: 'blur' }],
  url: form.sourceType === 'API' ? [{ required: true, message: '请填写检索地址', trigger: 'blur' }] : []
}))

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

/* ---------- 测试连接（API / MCP） ---------- */
async function doTest() {
  testing.value = true
  try {
    const r = await testKnowledgeSource(form.sourceType, { sourceId: targetId.value, config: buildConfig(), authValue: form.authValue || null })
    verify.value = r
    if (r.verifyStatus === 'SUCCESS') ElMessage.success('连接成功')
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
    return `连接成功${extra}${v.verifiedAt ? ` · ${fmtRelative(v.verifiedAt)}` : ''}`
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
  if (form.sourceType === 'API' && !(form.url || '').trim()) return '请填写检索地址'
  if (form.sourceType === 'MCP' && !(form.mode === 'EXISTING' ? form.mcpId : (form.endpoint || '').trim())) return '请选择或填写 MCP'
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
    ElMessage.success(form.sourceType === 'UPLOAD' && !props.sourceId ? '已保存，文档在列表「文档」入口上传' : '已保存')
    close()
  } catch (e) {
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

    <el-form ref="formRef" :model="form" :rules="rules" label-width="118px" label-position="right">
      <!-- 基本信息 -->
      <section class="ksrc-sec">
        <div class="ksrc-sec-title">基本信息</div>
        <el-form-item label="类型">
          <el-radio-group v-model="form.sourceType" :disabled="isEdit">
            <el-radio v-for="t in SOURCE_TYPES" :key="t" :value="t">{{ SOURCE_LABELS[t] }}</el-radio>
          </el-radio-group>
          <span class="ksrc-hint">创建后不可更改</span>
        </el-form-item>
        <el-form-item label="数据源名称" prop="name">
          <el-input v-model="form.name" maxlength="50" :placeholder="form.sourceType === 'UPLOAD' ? '如 产品资料、案例集' : form.sourceType === 'API' ? '如 国标检索接口' : '如 法规库 MCP'" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">停用</el-radio>
          </el-radio-group>
          <span class="ksrc-hint">停用后引用它的知识库检索时跳过</span>
        </el-form-item>
        <el-form-item label=" ">
          <span class="ksrc-desc">{{ TYPE_DESC[form.sourceType] }}</span>
        </el-form-item>
      </section>

      <!-- 上传类：内置 RAG 配置 + 文档 -->
      <section v-if="form.sourceType === 'UPLOAD'" class="ksrc-sec">
        <div class="ksrc-sec-title">内置 RAG 配置</div>
        <!-- 文档类型（2026-08-31 负责人定稿）：决定该库收什么文件；拆分方式不暴露，走系统内置方案 -->
        <el-form-item label="文档类型">
          <el-radio-group v-model="form.docKind">
            <el-radio v-for="o in DOC_KIND_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
          </el-radio-group>
          <span class="ksrc-hint">拆分方式由系统内置方案自动处理</span>
        </el-form-item>
        <!-- 文本预处理规则（对齐负责人截图，系统已默认删除目录、页眉页脚、水印） -->
        <el-form-item label="文本预处理">
          <div class="ksrc-pre">
            <div class="ksrc-pre-tip">系统已默认删除目录、页眉页脚、水印</div>
            <div v-for="o in PREPROCESS_OPTIONS" :key="o.key" class="ksrc-pre-item">
              <el-checkbox v-model="form[o.key]">
                <span class="ksrc-pre-name">{{ o.label }}</span>
                <span class="ksrc-pre-desc">{{ o.desc }}</span>
              </el-checkbox>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="Embedding 模型">
          <div class="ksrc-row">
            <el-select v-model="form.embeddingModelId" placeholder="选择向量模型" class="ksrc-half">
              <el-option v-for="m in embeddingModels" :key="m.id" :label="m.name" :value="m.id" />
            </el-select>
            <span class="ksrc-hint">更换后需全量重建索引</span>
          </div>
        </el-form-item>
        <el-form-item label="检索策略">
          <div class="ksrc-row">
            <el-select v-model="form.retrieval" class="ksrc-half">
              <el-option v-for="o in RETRIEVAL_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <div class="ksrc-half ksrc-inline">
              <span class="ksrc-unit">Top-K</span>
              <el-input-number v-model="form.topK" :min="1" :max="20" controls-position="right" />
              <span class="ksrc-unit">阈值</span>
              <el-input-number v-model="form.threshold" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" />
            </div>
          </div>
        </el-form-item>
      </section>

      <!-- API 类 -->
      <section v-else-if="form.sourceType === 'API'" class="ksrc-sec">
        <div class="ksrc-sec-title">检索接口</div>
        <el-form-item label="检索地址" prop="url">
          <el-input v-model="form.url" maxlength="500" placeholder="如 https://rag.example.com/api/v1/search" />
        </el-form-item>
        <el-form-item label="请求方式">
          <el-select v-model="form.method" class="ksrc-half">
            <el-option label="POST" value="POST" />
            <el-option label="GET" value="GET" />
          </el-select>
        </el-form-item>
        <el-form-item label="鉴权方式">
          <div class="ksrc-row">
            <el-select v-model="form.authType" class="ksrc-half">
              <el-option label="不鉴权" value="NONE" />
              <el-option label="API KEY" value="API_KEY" />
            </el-select>
            <template v-if="form.authType === 'API_KEY'">
              <el-input v-model="form.authName" class="ksrc-quarter" placeholder="参数名，如 X-Api-Key" />
              <el-select v-model="form.authIn" class="ksrc-quarter">
                <el-option v-for="o in API_AUTH_IN_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </template>
          </div>
        </el-form-item>
        <el-form-item v-if="form.authType === 'API_KEY'" label="参数值（密钥）">
          <el-input v-model="form.authValue" type="password" show-password autocomplete="new-password" class="ksrc-half" :placeholder="form.authValueMasked ? `已配置 ${form.authValueMasked}，留空则保留` : '密钥'" />
        </el-form-item>
        <div class="ksrc-sub">请求映射</div>
        <el-form-item label="字段名">
          <div class="ksrc-row">
            <el-input v-model="form.queryField" class="ksrc-half"><template #prepend>query</template></el-input>
            <el-input v-model="form.topKField" class="ksrc-half"><template #prepend>Top-K</template></el-input>
          </div>
        </el-form-item>
        <div class="ksrc-sub">响应映射</div>
        <el-form-item label="切片数组">
          <el-input v-model="form.itemsPath" placeholder="JSONPath，如 $.data[*]" class="ksrc-mono" />
        </el-form-item>
        <el-form-item label="切片字段">
          <div class="ksrc-row">
            <el-input v-model="form.contentField" class="ksrc-third"><template #prepend>正文</template></el-input>
            <el-input v-model="form.sourceField" class="ksrc-third"><template #prepend>来源</template></el-input>
            <el-input v-model="form.scoreField" class="ksrc-third"><template #prepend>分数</template></el-input>
          </div>
        </el-form-item>
        <el-form-item label="超时">
          <div class="ksrc-row ksrc-inline">
            <el-input-number v-model="form.timeoutMs" :min="1000" :max="60000" :step="1000" controls-position="right" />
            <span class="ksrc-unit">ms</span>
            <el-button size="small" :loading="testing" @click="doTest">测试连接</el-button>
            <span v-if="verifyLine" class="ksrc-verify" :class="verify?.verifyStatus === 'SUCCESS' ? 'ok' : 'bad'">● {{ verifyLine }}</span>
          </div>
        </el-form-item>
      </section>

      <!-- MCP 类 -->
      <section v-else class="ksrc-sec">
        <div class="ksrc-sec-title">MCP 检索</div>
        <el-form-item label="接入方式">
          <el-radio-group v-model="form.mode">
            <el-radio value="EXISTING">选择已有 MCP</el-radio>
            <el-radio value="INLINE">直接填写</el-radio>
          </el-radio-group>
        </el-form-item>
        <template v-if="form.mode === 'EXISTING'">
          <el-form-item label="MCP 服务">
            <div class="ksrc-row">
              <el-select v-model="form.mcpId" filterable placeholder="从连接器里选择" class="ksrc-half" @change="onMcpChange">
                <el-option v-for="m in mcps" :key="m.id" :label="m.name" :value="m.id" />
              </el-select>
              <span class="ksrc-hint">在「连接器 → MCP」维护地址与鉴权</span>
            </div>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="Endpoint">
            <el-input v-model="form.endpoint" maxlength="500" placeholder="如 https://rag.example.com/mcp（streamable-http）" />
          </el-form-item>
          <el-form-item label="鉴权方式">
            <div class="ksrc-row">
              <el-select v-model="form.authType" class="ksrc-half">
                <el-option label="不鉴权" value="none" />
                <el-option label="Bearer Token" value="bearer" />
                <el-option label="自定义 Header" value="header" />
              </el-select>
              <el-input v-if="form.authType === 'header'" v-model="form.authHeaderName" class="ksrc-half" placeholder="Header 名，如 X-Api-Key" />
            </div>
          </el-form-item>
          <el-form-item v-if="form.authType !== 'none'" label="密钥">
            <el-input v-model="form.authValue" type="password" show-password autocomplete="new-password" class="ksrc-half" :placeholder="form.authValueMasked ? `已配置 ${form.authValueMasked}，留空则保留` : '密钥'" />
          </el-form-item>
        </template>
        <el-form-item label="检索工具">
          <div class="ksrc-row">
            <el-select v-if="form.mode === 'EXISTING'" v-model="form.toolName" filterable placeholder="选择用于检索的工具" class="ksrc-half" :no-data-text="form.mcpId ? '该 MCP 没有工具，先到连接器「拉取工具」' : '先选择 MCP 服务'">
              <el-option v-for="tool in mcpTools" :key="tool.name" :label="tool.name" :value="tool.name" />
            </el-select>
            <el-input v-else v-model="form.toolName" class="ksrc-half" placeholder="工具名，如 search" />
            <span class="ksrc-hint">从该 MCP 的工具清单中选择</span>
          </div>
        </el-form-item>
        <el-form-item label="参数映射">
          <div class="ksrc-row">
            <el-input v-model="form.queryParam" class="ksrc-half"><template #prepend>query</template></el-input>
            <el-input v-model="form.topKParam" class="ksrc-half"><template #prepend>Top-K</template></el-input>
          </div>
        </el-form-item>
        <el-form-item label="切片字段">
          <div class="ksrc-row">
            <el-input v-model="form.contentField" class="ksrc-third"><template #prepend>正文</template></el-input>
            <el-input v-model="form.sourceField" class="ksrc-third"><template #prepend>来源</template></el-input>
            <el-input v-model="form.scoreField" class="ksrc-third"><template #prepend>分数</template></el-input>
          </div>
        </el-form-item>
        <el-form-item label=" ">
          <div class="ksrc-row ksrc-inline">
            <el-button size="small" :loading="testing" @click="doTest">测试连接</el-button>
            <span v-if="verifyLine" class="ksrc-verify" :class="verify?.verifyStatus === 'SUCCESS' ? 'ok' : 'bad'">● {{ verifyLine }}</span>
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
  width: 96px;
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
