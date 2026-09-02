<script setup>
/**
 * 知识库配置抽屉（新建 / 编辑 / 审核期只读），DrawerEditor 720px。
 * 设计：docs/frontend/交互设计-知识库管理.md §3。
 *
 * 2026-08-31 对齐「连接器」范式改造：数据源在「数据源管理」子页独立管理，本抽屉只做**引用**——
 * 段 ① 基本信息：名称 / 类型（建后不可改）/ 可见范围（随类型派生）/ 描述
 * 段 ② 数据源引用：上传 / API / MCP 三组多选（每类上限 MAX_SOURCES_PER_TYPE=5），从数据源池选择；
 *   选中项以标签呈现，未连通 / 已停用 / 无文档的引用就地给弱提示。新建与改配置去「数据源管理」。
 * 底部：按状态出按钮——未发布：删除 ··· 取消 · 保存 · 提交发布；审核中：关闭 · 撤回；已发布：取消 · 保存 · 提交停用。
 *
 * 【回草稿确认】已发布库增删数据源引用 → 保存前二次确认（后端会回草稿重审）。名称 / 描述不算。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import {
  getKnowledgeBase,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  publishKnowledgeBase,
  delistKnowledgeBase,
  withdrawKnowledgeBase,
  listKnowledgeSources,
  listExpertOptions,
  listPositionOptions
} from '@/api/knowledgeBase'
import {
  KB_TYPE_OPTIONS,
  SOURCE_TYPES,
  SOURCE_LABELS,
  MAX_SOURCES_PER_TYPE,
  stateMeta,
  isPending,
  isOffline,
  isOnline,
  publishBlockReason,
  sourceRefsChanged
} from '@/utils/knowledgeBaseMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 编辑目标 id；null=新建 */
  kbId: { type: String, default: null }
})
const emit = defineEmits(['update:visible', 'saved', 'changed'])

const SOURCE_DESC = {
  UPLOAD: '平台内置 RAG 库（含各自的切片 / Embedding / 检索策略与文档）',
  API: '第三方 RAG 检索接口',
  MCP: 'MCP 协议的第三方 RAG 平台'
}

const formRef = ref(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const busy = ref('') // 'delete' | 'publish' | 'delist' | 'withdraw'
const createdId = ref(null)
const detail = ref(null) // 服务端最新行（状态判定与回草稿比对的基线）

const targetId = computed(() => props.kbId || createdId.value)
const isEdit = computed(() => !!targetId.value)
const locked = computed(() => isPending(detail.value)) // 审核中：可看不可改

const form = reactive({ name: '', kbType: 'ENTERPRISE', scopeRefId: '', description: '' })
/** 每类选中的数据源 id 列表（引用）。 */
const refs = reactive({ UPLOAD: [], API: [], MCP: [] })

const rules = computed(() => ({
  name: [{ required: true, message: '请输入知识库名称', trigger: 'blur' }],
  kbType: [{ required: true, message: '请选择类型', trigger: 'change' }],
  scopeRefId: [
    {
      validator: (r, v, cb) => (form.kbType !== 'ENTERPRISE' && !v ? cb(new Error('请选择可见范围')) : cb()),
      trigger: 'change'
    }
  ]
}))

/* ---------- 选择器数据 ---------- */
const experts = ref([])
const positions = ref([])
const sourcePool = ref([]) // 全量数据源（数据源管理里维护）
const scopeOptions = computed(() => (form.kbType === 'EXPERT' ? experts.value : form.kbType === 'POSITION' ? positions.value : []))
const scopeLabel = computed(() => (form.kbType === 'EXPERT' ? '专家' : form.kbType === 'POSITION' ? '岗位' : ''))

function poolOf(type) {
  return sourcePool.value.filter((s) => s.sourceType === type)
}
function sourceById(id) {
  return sourcePool.value.find((s) => s.id === id) || null
}
/** 选项副标题：上传=文档数；API/MCP=连通性；停用的一律标注。 */
function optionHint(s) {
  const parts = []
  if (s.status === 'DISABLED') parts.push('已停用')
  if (s.sourceType === 'UPLOAD') parts.push(`${s.docCount || 0} 篇文档`)
  else parts.push(s.verifyStatus === 'SUCCESS' ? '已连通' : s.verifyStatus === 'FAILED' ? '连接失败' : '未验证')
  return parts.join(' · ')
}
/** 引用告警：选中的数据源里有停用 / 未连通 / 无文档的，就地列出来（不阻断保存，只影响发布门）。 */
function refWarnings(type) {
  return refs[type]
    .map(sourceById)
    .filter(Boolean)
    .filter((s) => s.status === 'DISABLED' || (s.sourceType === 'UPLOAD' ? !(s.docCount > 0) : s.verifyStatus !== 'SUCCESS'))
    .map((s) => `「${s.name}」${s.status === 'DISABLED' ? '已停用' : s.sourceType === 'UPLOAD' ? '还没有解析成功的文档' : '未测试连接成功'}`)
}

async function loadOptions() {
  const [e, p, pool] = await Promise.all([
    listExpertOptions().catch(() => []),
    listPositionOptions().catch(() => []),
    listKnowledgeSources({ page: 1, size: 200 }).catch(() => ({ list: [] }))
  ])
  experts.value = e
  positions.value = p
  sourcePool.value = Array.isArray(pool) ? pool : pool?.list || []
}

/* ---------- 回填 ---------- */
function resetForm() {
  Object.assign(form, { name: '', kbType: 'ENTERPRISE', scopeRefId: '', description: '' })
  for (const t of SOURCE_TYPES) refs[t] = []
}
function hydrate(d) {
  detail.value = d
  form.name = d.name || ''
  form.kbType = d.kbType || 'ENTERPRISE'
  form.scopeRefId = d.scopeRefId || ''
  form.description = d.description || ''
  for (const t of SOURCE_TYPES) {
    refs[t] = (d.sources || []).filter((s) => s.sourceType === t).map((s) => s.id)
  }
}
async function load() {
  loadError.value = ''
  loading.value = true
  try {
    await loadOptions()
    if (targetId.value) hydrate(await getKnowledgeBase(targetId.value))
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
watch(
  () => form.kbType,
  () => {
    if (!isEdit.value) form.scopeRefId = ''
  }
)

/* ---------- 保存 / 动作 ---------- */
function allRefIds() {
  return SOURCE_TYPES.flatMap((t) => refs[t])
}
function buildPayload() {
  return {
    name: form.name.trim(),
    kbType: form.kbType,
    scopeRefId: form.kbType === 'ENTERPRISE' ? null : form.scopeRefId || null,
    description: form.description.trim() || null,
    sourceIds: allRefIds()
  }
}
async function save({ silent = false } = {}) {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return false
  const payload = buildPayload()
  if (
    isEdit.value &&
    detail.value?.status === 'PUBLISHED' &&
    sourceRefsChanged((detail.value.sources || []).map((s) => s.id), payload.sourceIds)
  ) {
    try {
      await ElMessageBox.confirm(
        '修改了数据源引用，保存后该知识库会回到未发布并需重新提交审核，审核通过前对可见范围不再生效。确认修改？',
        '数据源引用变更',
        { type: 'warning', confirmButtonText: '确认修改' }
      )
    } catch (e) {
      return false
    }
  }
  saving.value = true
  try {
    let saved
    if (targetId.value) saved = await updateKnowledgeBase(targetId.value, payload)
    else {
      saved = await createKnowledgeBase(payload)
      createdId.value = saved?.id || null
    }
    if (saved) hydrate(saved)
    if (!silent) ElMessage.success('已保存')
    emit('saved')
    return true
  } catch (e) {
    if (e?.field) formRef.value?.validateField?.(e.field)
    ElMessage.error(e?.message || '保存失败')
    return false
  } finally {
    saving.value = false
  }
}
async function onSave() {
  const ok = await save()
  if (ok) close()
}

const publishBlock = computed(() => publishBlockReason({ sources: allRefIds().map(sourceById).filter(Boolean) }))

async function doPublish() {
  if (!(await save({ silent: true }))) return
  busy.value = 'publish'
  try {
    hydrate(await publishKnowledgeBase(targetId.value))
    ElMessage.success('已提交发布，等待审核')
    emit('changed')
    close()
  } catch (e) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    busy.value = ''
  }
}
async function doDelist() {
  try {
    await ElMessageBox.confirm('提交停用后进入审核，审核通过前该知识库对可见范围仍然生效。确认提交？', '提交停用', { type: 'warning', confirmButtonText: '提交停用' })
  } catch (e) {
    return
  }
  busy.value = 'delist'
  try {
    hydrate(await delistKnowledgeBase(targetId.value))
    ElMessage.success('已提交停用，等待审核')
    emit('changed')
    close()
  } catch (e) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    busy.value = ''
  }
}
async function doWithdraw() {
  busy.value = 'withdraw'
  try {
    hydrate(await withdrawKnowledgeBase(targetId.value))
    ElMessage.success('已撤回')
    emit('changed')
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  } finally {
    busy.value = ''
  }
}
async function doDelete() {
  try {
    await ElMessageBox.confirm(`删除知识库「${detail.value?.name}」？数据源本身不受影响。此操作不可恢复。`, '删除知识库', { type: 'warning', confirmButtonText: '删除' })
  } catch (e) {
    return
  }
  busy.value = 'delete'
  try {
    await deleteKnowledgeBase(targetId.value)
    ElMessage.success('已删除')
    emit('changed')
    close()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    busy.value = ''
  }
}
function close() {
  emit('update:visible', false)
}
</script>

<template>
  <DrawerEditor
    :visible="visible"
    entity="知识库"
    :is-edit="isEdit"
    :readonly="locked"
    :loading="loading"
    :error="loadError"
    :saving="saving"
    create-text="保存"
    @update:visible="close"
    @retry="load"
    @save="onSave"
  >
    <template #title-extra>
      <StatusTag v-if="detail" :type="stateMeta(detail).type">{{ stateMeta(detail).label }}</StatusTag>
    </template>

    <el-form ref="formRef" :model="form" :rules="rules" label-width="112px" label-position="right" :disabled="locked">
      <!-- ① 基本信息 -->
      <section class="kb-sec">
        <div class="kb-sec-title">基本信息</div>
        <el-form-item label="知识库名称" prop="name">
          <el-input v-model="form.name" maxlength="100" placeholder="如 产品与解决方案库" />
        </el-form-item>
        <el-form-item label="类型" prop="kbType">
          <el-radio-group v-model="form.kbType" :disabled="isEdit || locked">
            <el-radio v-for="o in KB_TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
          </el-radio-group>
          <span class="kb-hint">创建后不可更改</span>
        </el-form-item>
        <el-form-item label="可见范围" prop="scopeRefId">
          <el-input v-if="form.kbType === 'ENTERPRISE'" model-value="全员" disabled />
          <el-select v-else v-model="form.scopeRefId" filterable :placeholder="`选择${scopeLabel}`" class="kb-full">
            <el-option v-for="o in scopeOptions" :key="o.id" :label="o.name" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="这个知识库放什么、给谁用（选填）" />
        </el-form-item>
      </section>

      <!-- ② 数据源引用 -->
      <section class="kb-sec">
        <div class="kb-sec-title">
          数据源
          <span class="kb-sec-sub">从「数据源管理」里选择引用，每类最多 {{ MAX_SOURCES_PER_TYPE }} 个；新建与配置去「数据源管理」子页</span>
        </div>

        <el-form-item v-for="t in SOURCE_TYPES" :key="t" :label="SOURCE_LABELS[t]">
          <div class="kb-ref">
            <el-select
              v-model="refs[t]"
              multiple
              filterable
              :multiple-limit="MAX_SOURCES_PER_TYPE"
              :placeholder="`选择${SOURCE_LABELS[t]}数据源（可多选）`"
              class="kb-full"
              :no-data-text="`还没有${SOURCE_LABELS[t]}数据源，先到「数据源管理」新建`"
            >
              <el-option v-for="s in poolOf(t)" :key="s.id" :label="s.name" :value="s.id">
                <span class="kb-opt-name">{{ s.name }}</span>
                <span class="kb-opt-hint">{{ optionHint(s) }}</span>
              </el-option>
            </el-select>
            <div class="kb-ref-foot">
              <span class="kb-ref-count">{{ refs[t].length }} / {{ MAX_SOURCES_PER_TYPE }}</span>
              <span class="kb-ref-desc">{{ SOURCE_DESC[t] }}</span>
            </div>
            <div v-for="(w, i) in refWarnings(t)" :key="i" class="kb-ref-warn">⚠ {{ w }}</div>
          </div>
        </el-form-item>
      </section>
    </el-form>

    <!-- 底部按状态出按钮（设计 §3.5） -->
    <template #footer>
      <div class="kb-foot">
        <template v-if="locked">
          <span class="kb-foot-sp" />
          <el-button @click="close">关闭</el-button>
          <el-button type="warning" plain :loading="busy === 'withdraw'" @click="doWithdraw">撤回</el-button>
        </template>
        <template v-else>
          <el-button v-if="isEdit && isOffline(detail)" type="danger" plain :loading="busy === 'delete'" :disabled="saving" @click="doDelete">删除</el-button>
          <span class="kb-foot-sp" />
          <el-button :disabled="saving" @click="close">取消</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
          <el-tooltip v-if="isEdit && isOffline(detail)" :content="publishBlock || '保存当前配置并提交审核'" placement="top">
            <span>
              <el-button type="success" :disabled="!!publishBlock || saving" :loading="busy === 'publish'" @click="doPublish">提交发布</el-button>
            </span>
          </el-tooltip>
          <el-button v-if="isEdit && isOnline(detail)" type="warning" plain :loading="busy === 'delist'" :disabled="saving" @click="doDelist">提交停用</el-button>
        </template>
      </div>
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* 段 20（外壳 gap）> 字段 16 > 段标题-内容 12（规范 §6.2） */
.kb-sec {
  display: flex;
  flex-direction: column;
}
.kb-sec + .kb-sec {
  margin-top: var(--space-5);
}
.kb-sec-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-3);
}
.kb-sec-sub {
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-2);
}
.kb-sec :deep(.el-form-item) {
  margin-bottom: var(--space-4);
}
.kb-sec :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}
.kb-full {
  width: 100%;
}
.kb-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-2);
  white-space: nowrap;
}
/* 数据源引用块 */
.kb-ref {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.kb-ref-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.kb-ref-count {
  font-variant-numeric: tabular-nums;
  color: var(--c-text-faint);
}
.kb-ref-warn {
  font-size: var(--fs-xs);
  color: var(--c-warning);
}
.kb-opt-name {
  margin-right: var(--space-3);
}
.kb-opt-hint {
  float: right;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
/* 底部 */
.kb-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
}
.kb-foot-sp {
  flex: 1;
}
</style>
