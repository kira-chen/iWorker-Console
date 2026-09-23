<script setup>
/**
 * 知识库配置抽屉（新建 / 编辑 / 查看 / 审核期只读），DrawerEditor 默认 780px（2026-09-08 原型复刻批次 1）。
 * 2026-09-04 按 PRD-20260903《prd.知识库.md》§三.3～§三.6 + 交互原型 openKbEditor/openKbViewer 对齐重排。
 *
 * 段 ① 基本信息：名称（≤64 必填）/ 类型（三选一，创建后不可修改）/ 可见范围 / 描述（≤2000 必填）
 * 段 ② 数据源引用：上传 / API / MCP 三组多选（每类最多 5 个），只引用、不在此创建或编辑数据源；
 *   已停用 / 无解析成功文档 / 未验证或验证失败的引用就地风险提示（md §三.3.2）。
 *
 * 【底部按钮】（md §三.4.1 / §三.4.2；2026-09-08 PRD-20260908 对齐：编辑 / 查看抽屉已发布态均删【提交停用】，
 *   停用入口收敛为列表行内【停用】= 原型 removeKnowledgeStopButtons L3226）
 *   编辑：新建=取消·保存；未发布=删除···取消·保存·提交发布；审核中=关闭·撤回（配置只读）；已发布=取消·保存
 *   查看：审核中=关闭·撤回；未发布=关闭·提交发布；已发布=关闭
 *
 * 【关键变更回未发布】（md §三.5）已发布库改数据源引用或可见范围 → 保存前二次确认，确认后回未发布重审。
 * 【岗位上下文】（md §三.8）positionLock 传入时类型锁「岗位知识库」、可见范围锁当前岗位，均不可更改。
 *
 * 【2026-09-09 原型复刻批次 3B · C1–C5/C8】静态形态照原型 openKbEditor：
 *   C1 两段改 .section-card 卡壳（admin-shell.css，= 原型 .proto2-form-sec + .proto2-form-title 灰底标题条），
 *      第二段无标题条、用 .kb-ds-header「数据源 + 副注」作区块头；
 *   C2 基本信息 2 列网格（.proto2-form-grid 1fr 1fr / gap 17 20，描述跨列）+ 标签顶置、help 下置；
 *   C3 类型改 el-select（原型 <select id="kbEditType">），企业类型可见范围改 disabled el-select 单项「全员」；
 *   C4 引用行标签窄档 44px（原型 .kb-ds-label）、计数「N / 5」加粗（原型 <strong>）；
 *   C5 底部按钮样式档：删除=文字链 link danger、撤回=无色 plain、提交发布=primary；
 *   C8 标题右侧状态标签（原型 drawerShell 第二参 kTag）——已一致。
 * 处理逻辑与 mock 交互按 md + 代码现状不变。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import IconField from '@/components/common/IconField.vue'
import {
  getKnowledgeBase,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  publishKnowledgeBase,
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
  KB_ACTION_CONFIRMS,
  stateMeta,
  isPending,
  isOffline,
  publishBlockReason,
  sourceRefsChanged
} from '@/utils/knowledgeBaseMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 编辑目标 id；null=新建 */
  kbId: { type: String, default: null },
  /** 'edit'（默认）| 'view'：查看抽屉配置只读，底部按钮按 md §三.4.2 出 */
  mode: { type: String, default: 'edit' },
  /** 岗位上下文锁（md §三.8）：{ id, name? }，新建时类型锁岗位、可见范围锁该岗位 */
  positionLock: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'saved', 'changed'])

const SOURCE_DESC = {
  UPLOAD: '平台内置 RAG 库（含各自的切片 / Embedding / 检索策略与文档）',
  API: '第三方 RAG 检索接口',
  MCP: 'MCP 协议的第三方 RAG 平台'
}
const SCOPE_HELP = {
  ENTERPRISE: '企业知识库全员可见',
  EXPERT: '选择可使用该知识库的专家，创建后不可更改',
  POSITION: '选择可使用该知识库的岗位'
}

const formRef = ref(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const busy = ref('') // 'delete' | 'publish' | 'withdraw'
const createdId = ref(null)
const detail = ref(null) // 服务端最新行（状态判定与关键变更比对的基线）

const targetId = computed(() => props.kbId || createdId.value)
const isEdit = computed(() => !!targetId.value)
const viewMode = computed(() => props.mode === 'view' && isEdit.value)
const pendingLocked = computed(() => isPending(detail.value)) // 审核中：配置锁定，仅允许查看或撤回
const readonlyAll = computed(() => viewMode.value || pendingLocked.value)

const form = reactive({ name: '', icon: '', kbType: 'ENTERPRISE', scopeRefId: '', description: '' })
/** 每类选中的数据源 id 列表（引用）。 */
const refs = reactive({ UPLOAD: [], API: [], MCP: [] })

const rules = computed(() => ({
  name: [{ required: true, message: '请输入知识库名称', trigger: 'blur' }],
  // 2026-09-21 负责人拍板：图标必填（原选填）；文案与模型 / 连接器图标同口径
  icon: [{ required: true, message: '请选择或上传图标', trigger: 'change' }],
  kbType: [{ required: true, message: '请选择类型', trigger: 'change' }],
  // 必填星标放在规则里（required: true + 自定义 validator），不要写在 <el-form-item required> 上：
  // 后者会让 Element 额外塞一条内置必填规则，企业类型固定「全员」、scopeRefId 恒为空 → 永远报 `scopeRefId is required`。
  // 规则带 validator 时 async-validator 只认 validator，required 仅供 Element 画星标。
  scopeRefId: [
    {
      required: true,
      validator: (r, v, cb) => (form.kbType !== 'ENTERPRISE' && !v ? cb(new Error('请选择可见范围')) : cb()),
      trigger: 'change'
    }
  ],
  description: [{ required: true, message: '请输入知识库描述', trigger: 'blur' }]
}))

/* ---------- 选择器数据 ---------- */
const experts = ref([])
const positions = ref([])
const sourcePool = ref([]) // 全量数据源（数据源管理里维护；此处只引用，md §三.3.2）
const scopeOptions = computed(() => (form.kbType === 'EXPERT' ? experts.value : form.kbType === 'POSITION' ? positions.value : []))
const scopeLabel = computed(() => (form.kbType === 'EXPERT' ? '专家' : form.kbType === 'POSITION' ? '岗位' : ''))
/** 类型锁：创建后不可修改（md §三.3.1）；岗位上下文新建也锁（md §三.8）。 */
const typeLocked = computed(() => isEdit.value || readonlyAll.value || !!props.positionLock)
/** 可见范围锁：专家类型创建后不可更改（md §三.3.1）；岗位上下文锁当前岗位（md §三.8）。 */
const scopeLocked = computed(
  () => readonlyAll.value || !!props.positionLock || (isEdit.value && form.kbType === 'EXPERT')
)

/**
 * 可引用候选：只出「启用」的数据源（2026-09-09 负责人拍板「停用的数据源不可被引用」）。
 * 已被本知识库引用的停用源仍保留在列表里，否则存量数据会在下拉里凭空消失、无法手动移除
 * ——正常链路下这种组合已不可能出现（停用侧有引用即拦，见 knowledgeBaseMock.updateSource），
 * 此处仅作存量兜底。
 */
function poolOf(type) {
  return sourcePool.value.filter(
    (s) => s.sourceType === type && (s.status !== 'DISABLED' || (refs[type] || []).includes(s.id))
  )
}
function sourceById(id) {
  return sourcePool.value.find((s) => s.id === id) || null
}
/** 选项副标题：上传=解析成功文档数；API/MCP=连通性；停用的一律标注。 */
function optionHint(s) {
  const parts = []
  if (s.status === 'DISABLED') parts.push('已停用')
  if (s.sourceType === 'UPLOAD') parts.push(`${s.parsedDocCount ?? s.docCount ?? 0} 篇解析成功`)
  else parts.push(s.verifyStatus === 'SUCCESS' ? '已连通' : s.verifyStatus === 'FAILED' ? '连接失败' : '未验证')
  return parts.join(' · ')
}
/** 引用风险提示（md §三.3.2）：停用 / 无解析成功文档 / 未验证或验证失败，就地列出（不阻断保存，只挡发布）。 */
function refWarnings(type) {
  return refs[type]
    .map(sourceById)
    .filter(Boolean)
    .filter((s) => {
      if (s.status === 'DISABLED') return true
      if (s.sourceType === 'UPLOAD') return !((s.parsedDocCount ?? s.docCount) > 0)
      return s.verifyStatus !== 'SUCCESS'
    })
    .map((s) => {
      if (s.status === 'DISABLED') return `「${s.name}」已停用，检索时不参与召回`
      if (s.sourceType === 'UPLOAD') return `「${s.name}」还没有解析成功的文档`
      return `「${s.name}」${s.verifyStatus === 'FAILED' ? '连接验证失败' : '尚未验证连接'}`
    })
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
  const lock = props.positionLock
  Object.assign(form, {
    name: '',
    icon: '',
    kbType: lock ? 'POSITION' : 'ENTERPRISE',
    scopeRefId: lock ? lock.id : '',
    description: ''
  })
  for (const t of SOURCE_TYPES) refs[t] = []
}
function hydrate(d) {
  detail.value = d
  form.name = d.name || ''
  form.icon = d.icon || ''
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
// immediate 必需，同 ApiEditor：治理侧条件挂载时组件创建即 visible=true，无跃迁（2026-09-09 收口回归 P1）
watch(
  () => props.visible,
  (v) => {
    if (!v) return
    createdId.value = null
    detail.value = null
    resetForm()
    formRef.value?.clearValidate()
    load()
  },
  { immediate: true }
)
watch(
  () => form.kbType,
  () => {
    if (!isEdit.value && !props.positionLock) form.scopeRefId = ''
  }
)

/* ---------- 保存 / 动作 ---------- */
function allRefIds() {
  return SOURCE_TYPES.flatMap((t) => refs[t])
}
function buildPayload() {
  return {
    name: form.name.trim(),
    icon: form.icon,
    kbType: form.kbType,
    scopeRefId: form.kbType === 'ENTERPRISE' ? null : form.scopeRefId || null,
    description: form.description.trim(),
    sourceIds: allRefIds()
  }
}
/** 已发布库的关键变更（md §三.5）：数据源引用集合 或 可见范围变化 → 保存前必须二次确认。 */
function criticalChange(payload) {
  if (detail.value?.status !== 'PUBLISHED' || isPending(detail.value)) return false
  const refsChanged = sourceRefsChanged((detail.value.sources || []).map((s) => s.id), payload.sourceIds)
  const scopeChanged = (detail.value.scopeRefId || null) !== (payload.scopeRefId || null)
  return refsChanged || scopeChanged
}
async function save({ silent = false } = {}) {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return false
  const payload = buildPayload()
  if (isEdit.value && criticalChange(payload)) {
    try {
      await ElMessageBox.confirm(
        '修改数据源引用或可见范围会改变检索内容与使用范围，保存后该知识库将返回未发布状态，需要重新提交发布审核。确认修改？',
        '需要重新审核',
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
    // 保存失败：保留表单内容、不关抽屉（md §八.2）
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

/** 发布前完整校验（md §三.6）当前表单态的原因（用于按钮 tooltip 与拦截提示）。 */
const publishBlock = computed(() =>
  publishBlockReason({
    name: form.name,
    description: form.description,
    kbType: form.kbType,
    scopeRefId: form.kbType === 'ENTERPRISE' ? 'ALL' : form.scopeRefId,
    sources: allRefIds().map(sourceById).filter(Boolean)
  })
)

async function confirmAction(key) {
  const c = KB_ACTION_CONFIRMS[key]
  try {
    await ElMessageBox.confirm(c.content, c.title, { type: 'warning', confirmButtonText: c.confirmText, cancelButtonText: '取消' })
    return true
  } catch (e) {
    return false
  }
}
async function doPublish() {
  if (viewMode.value) {
    // 查看抽屉：不保存，直接对服务端最新配置做完整校验后提交
    const reason = publishBlockReason(detail.value || {})
    if (reason) {
      ElMessage.error(reason)
      return
    }
  } else {
    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) return
    if (publishBlock.value) {
      // 校验失败：保留编辑内容、就地展示原因，不进入审核中（md §三.6）
      ElMessage.error(publishBlock.value)
      return
    }
  }
  if (!(await confirmAction('publish'))) return
  if (!viewMode.value && !(await save({ silent: true }))) return
  busy.value = 'publish'
  try {
    hydrate(await publishKnowledgeBase(targetId.value))
    ElMessage.success(KB_ACTION_CONFIRMS.publish.toast)
    emit('changed')
    close()
  } catch (e) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    busy.value = ''
  }
}
async function doWithdraw() {
  if (!(await confirmAction('withdraw'))) return
  busy.value = 'withdraw'
  try {
    hydrate(await withdrawKnowledgeBase(targetId.value))
    ElMessage.success(KB_ACTION_CONFIRMS.withdraw.toast)
    emit('changed')
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  } finally {
    busy.value = ''
  }
}
async function doDelete() {
  if (!(await confirmAction('remove'))) return
  busy.value = 'delete'
  try {
    await deleteKnowledgeBase(targetId.value)
    ElMessage.success(KB_ACTION_CONFIRMS.remove.toast)
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
    :readonly="readonlyAll"
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

    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" :disabled="readonlyAll">
      <!-- ① 基本信息（md §三.3.1）；壳与网格照原型 openKbEditor：.proto2-form-sec 卡 + .proto2-form-grid 两列 -->
      <section class="section-card">
        <div class="section-title">基本信息</div>
        <div class="kb-grid">
          <!-- 第一行：名称 + 图标 -->
          <el-form-item label="知识库名称" prop="name" required>
            <el-input v-model="form.name" maxlength="64" show-word-limit placeholder="如 产品与解决方案库" />
          </el-form-item>
          <el-form-item label="图标" prop="icon" required>
            <IconField :icon="form.icon" :name="form.name" :readonly="readonlyAll" @pick="({ icon }) => (form.icon = icon)" />
          </el-form-item>
          <!-- 第二行：类型 + 可见范围 -->
          <el-form-item label="类型" prop="kbType" required>
            <el-select v-model="form.kbType" :disabled="typeLocked" class="kb-full">
              <el-option v-for="o in KB_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <div class="kb-help">{{ positionLock && !isEdit ? '岗位知识库不可更改' : '创建后不可更改' }}</div>
          </el-form-item>
          <el-form-item label="可见范围" prop="scopeRefId">
            <el-select v-if="form.kbType === 'ENTERPRISE'" model-value="ALL" disabled class="kb-full">
              <el-option label="全员" value="ALL" />
            </el-select>
            <el-select v-else v-model="form.scopeRefId" filterable :disabled="scopeLocked" :placeholder="`选择${scopeLabel}`" class="kb-full">
              <el-option v-for="o in scopeOptions" :key="o.id" :label="o.name" :value="o.id" />
            </el-select>
            <div class="kb-help">{{ positionLock ? '可见范围锁定为当前岗位' : SCOPE_HELP[form.kbType] }}</div>
          </el-form-item>
          <el-form-item label="描述" prop="description" class="kb-grid-full" required>
            <el-input v-model="form.description" type="textarea" :rows="3" maxlength="2000" show-word-limit placeholder="必填：这个知识库放什么、给谁用" />
          </el-form-item>
        </div>
      </section>

      <!-- ② 数据源引用（md §三.3.2）：只引用，不在此创建或编辑数据源。
           照原型第二段 .proto2-form-sec 无灰底标题条，内部 .kb-ds-header 作区块头 -->
      <section class="section-card kb-ds-card">
        <div class="kb-ds-header">
          <strong>数据源</strong>
          <span class="kb-ds-header-hint">从「数据源管理」里选引用，每类最多 {{ MAX_SOURCES_PER_TYPE }} 个；新建与配置去「数据源管理」子页</span>
        </div>

        <!-- 引用行左标签窄档 44px（原型 .kb-ds-label），与基本信息的顶置标签不同档 -->
        <el-form-item v-for="t in SOURCE_TYPES" :key="t" :label="SOURCE_LABELS[t]" class="kb-ds-item" label-position="right" label-width="44px">
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
              <strong class="kb-ref-count">{{ refs[t].length }} / {{ MAX_SOURCES_PER_TYPE }}</strong>
              <span class="kb-ref-desc">{{ SOURCE_DESC[t] }}</span>
            </div>
            <div v-for="(w, i) in refWarnings(t)" :key="i" class="kb-ref-warn">⚠ {{ w }}</div>
          </div>
        </el-form-item>
      </section>
    </el-form>

    <!-- 底部按状态出按钮（md §三.4.1 编辑 / §三.4.2 查看） -->
    <template #footer>
      <div class="kb-foot">
        <!-- 查看抽屉：审核中=关闭·撤回；未发布=关闭·提交发布；已发布=关闭（提交停用已删，md §三.4.2） -->
        <template v-if="viewMode">
          <span class="kb-foot-sp" />
          <el-button @click="close">关闭</el-button>
          <el-button v-if="pendingLocked" plain :loading="busy === 'withdraw'" @click="doWithdraw">撤回</el-button>
          <el-button v-else-if="isOffline(detail)" type="primary" :loading="busy === 'publish'" @click="doPublish">提交发布</el-button>
        </template>
        <!-- 编辑抽屉·审核中：关闭·撤回（配置只读） -->
        <template v-else-if="pendingLocked">
          <span class="kb-foot-sp" />
          <el-button @click="close">关闭</el-button>
          <el-button plain :loading="busy === 'withdraw'" @click="doWithdraw">撤回</el-button>
        </template>
        <!-- 编辑抽屉：新建=取消·保存；未发布=删除···取消·保存·提交发布；已发布=取消·保存（提交停用已删，md §三.4.1） -->
        <template v-else>
          <el-button v-if="isEdit && isOffline(detail)" link type="danger" :loading="busy === 'delete'" :disabled="saving" @click="doDelete">删除</el-button>
          <span class="kb-foot-sp" />
          <el-button :disabled="saving" @click="close">取消</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
          <el-tooltip v-if="isEdit && isOffline(detail)" :disabled="!publishBlock" :content="publishBlock || ''" placement="top">
            <span>
              <el-button type="primary" :disabled="saving" :loading="busy === 'publish'" @click="doPublish">提交发布</el-button>
            </span>
          </el-tooltip>
        </template>
      </div>
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* 分区卡壳走 assets/admin-shell.css 的 .section-card / .section-title（原型 .proto2-form-sec + .proto2-form-title）。
 * 卡内网格照原型 .proto2-form-grid{grid-template-columns:1fr 1fr;gap:17px 20px}，.full 跨两列。 */
.kb-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 17px 20px;
}
.kb-grid-full {
  grid-column: 1 / -1;
}
.kb-grid :deep(.el-form-item) {
  margin-bottom: 0;
}
/* 标签顶置、必填星号前置（原型 .proto2-label 内 <span class="required">*</span> 在文字前） */
.kb-grid :deep(.el-form-item__label) {
  margin-bottom: 7px;
  padding: 0;
  line-height: 1.4;
  color: var(--c-text);
}
@media (max-width: 1000px) {
  .kb-grid {
    grid-template-columns: 1fr;
  }
  .kb-grid-full {
    grid-column: auto;
  }
}
/* 控件下方 help（原型 .proto2-help{margin-top:6px;font-size:12px}） */
.kb-help {
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-text-muted);
}
.kb-full {
  width: 100%;
}
/* 数据源段：无灰底标题条，内部区块头（原型 .kb-ds-header{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}） */
.kb-ds-card {
  padding-top: 20px;
}
.kb-ds-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}
.kb-ds-header strong {
  font-size: 14px;
  white-space: nowrap;
  color: var(--c-text-strong);
}
.kb-ds-header-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-text-muted);
}
/* 引用行：左标签窄档（原型 .kb-ds-label 44px 右对齐），宽度由 label-width="44px" 给 */
.kb-ds-item :deep(.el-form-item__label) {
  justify-content: flex-end;
  padding-right: 12px;
  color: var(--c-text);
}
.kb-ds-item {
  margin-bottom: 12px;
}
.kb-ds-item:last-child {
  margin-bottom: 0;
}
/* 数据源引用块 */
.kb-ref {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
/* 计数行照原型 .kb-ds-count：12px 弱色、N / 5 加粗深一档 */
.kb-ref-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: 5px;
  padding-left: 2px;
  font-size: 12px;
  color: var(--c-text-muted);
}
.kb-ref-count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--c-text);
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
