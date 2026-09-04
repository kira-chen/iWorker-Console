<script setup>
/**
 * 岗位「工作档案」子页面（2026-08-28 负责人定稿）。
 *
 * 一份「工作档案」= 一个对象类型（后端 data_table_def；原数据表模型升级）。页面结构：
 *  - 首次进入（没有档案）：页面中部提示「新建工作档案」；
 *  - 已有档案：上部左侧卡片切换多份档案，右侧「保存」「新建工作档案」；
 *  - 每份档案分三区：
 *      ① 上：沉淀策略 —— 抽取方式（自动抽取 / 指定触发）· 置信度阈值（高 / 中 / 低）· 用户确认（低置信度需确认 / 全部需要确认 / 不需要确认）
 *      ② 左下：卡片字段（= 结构化卡位，≤ 8）—— 列表：字段名 / 字段类型 / 字段用途；弹窗编辑整表（DataTableFieldEditor）
 *      ③ 右下：业务规则（= 提取项归纳规则，≤ 8）—— 列表：规则名 / 规则描述 / 归纳方式；弹窗编辑整表（DossierRuleListEditor）
 *  - 档案名称 / 说明 / 状态 / 删除：段标题右侧「档案信息」弹窗。
 *
 * 样式沿用岗位详情 Tab 既有范式（assets/position-detail.css：pd-list-head + el-table.pd-table + pd-drawer-form；
 * 弹窗用 el-dialog，与 IntakeEditDialog 同口径）。保存为手动：元信息 → 卡位（原子批量）→ 策略 / 规则。
 * 事件流 / 档案视图 / 抽取 / 归纳等运行时在客户端，本页只配规则。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listDataTables,
  getDataTable,
  createDataTable,
  updateDataTable,
  saveDataTableFields,
  deleteDataTable,
  getTableDeleteImpact,
  saveDossierConfig
} from '@/api/dataTable'
import { validateFields, validateTableMeta, normalizeFieldForSubmit, MAX_SLOTS, fieldTypeLabel, slotRoleLabel } from '@/utils/dataTableTypes'
import {
  hydrateDossierConfig,
  defaultDossierConfig,
  validateDossierConfig,
  normalizeDossierForSubmit,
  dossierSnapshot,
  TIERS,
  CONFIRM_MODES,
  EXTRACT_MODES,
  REDUCE_STRATEGIES,
  MAX_RULES
} from '@/utils/dossierConfig'
import DataTableFieldEditor from '@/components/admin/DataTableFieldEditor.vue'
import DossierRuleListEditor from '@/components/position/dossier/DossierRuleListEditor.vue'

const props = defineProps({
  positionId: { type: [Number, String], default: null },
  positionName: { type: String, default: '岗位' },
  tableCount: { type: Number, default: 0 },
  embedded: { type: Boolean, default: false }
})
const emit = defineEmits(['saved', 'update:tableCount'])

/* ============================ 档案列表（卡片） ============================ */
const listLoading = ref(false)
const listError = ref(false)
const tables = ref([])
const delBusy = ref(null)

async function loadTables() {
  if (props.positionId == null) {
    tables.value = []
    emit('update:tableCount', 0)
    return
  }
  listLoading.value = true
  listError.value = false
  try {
    const data = await listDataTables(props.positionId)
    tables.value = data?.list || []
    emit('update:tableCount', tables.value.length)
  } catch (e) {
    listError.value = true
  } finally {
    listLoading.value = false
  }
}

onMounted(async () => {
  await loadTables()
  // 已有档案：默认打开第一份（无需再点一次）
  if (tables.value.length && selectedId.value == null) {
    selectedId.value = tables.value[0].id
    await loadDetail(selectedId.value)
  }
})

async function removeCurrent() {
  if (!isEdit.value) return
  const row = { id: selectedId.value, label: meta.label }
  try {
    delBusy.value = row.id
    const impact = await getTableDeleteImpact(props.positionId, row.id)
    const affected = impact?.affectedRows ?? 0
    const refs = impact?.refSkills || []
    const refLine = refs.length ? `\n注意：还有技能在用它（${refs.map((s) => s.name).join('、')}）。` : ''
    const tip =
      affected > 0
        ? `工作档案「${row.label}」已经存了 ${affected} 条数据。删除后会停用、数据会先保留下来。${refLine}\n确定要删除吗？`
        : `工作档案「${row.label}」还没有数据。删除后将彻底移除（含卡片字段、业务规则、沉淀策略），无法恢复。${refLine}\n确定要删除吗？`
    await ElMessageBox.confirm(tip, '删除工作档案', {
      type: 'warning',
      confirmButtonText: affected > 0 ? '停用并删除' : '彻底删除',
      cancelButtonText: '再想想',
      confirmButtonClass: 'el-button--danger'
    })
    await deleteDataTable(props.positionId, row.id)
    ElMessage.success('工作档案已删除')
    infoDialogOpen.value = false
    clearSelection()
    await loadTables()
    if (tables.value.length) {
      selectedId.value = tables.value[0].id
      await loadDetail(selectedId.value)
    }
    emit('saved')
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e?.message || '删除失败')
  } finally {
    delBusy.value = null
  }
}

/* ============================ 选中态 ============================ */
const NEW = '__new__'
const selectedId = ref(null)
const hasSelection = computed(() => selectedId.value != null)
const isEdit = computed(() => hasSelection.value && selectedId.value !== NEW)

const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)

const meta = reactive({ tableCode: '', label: '', description: '', status: 'active' })
const fields = ref([])
const recordCount = ref(0)
const dossier = ref(defaultDossierConfig())

const metaErrors = reactive({ tableCode: '', label: '' })
const fieldRowErrors = ref({})
const fieldGlobalError = ref('')
const dossierErrors = ref({})

const bizSlotRows = computed(() => fields.value.filter((r) => !r.isSystem))
const keySuggestions = computed(() => bizSlotRows.value.map((r) => (r.label || '').trim()).filter(Boolean))

/* ---- 脏检查基线快照 ---- */
const baselineSnapshot = ref('')
function snapshot() {
  return JSON.stringify({
    meta: { tableCode: meta.tableCode, label: meta.label, description: meta.description, status: meta.status },
    fields: fields.value,
    dossier: dossierSnapshot(dossier.value)
  })
}
function captureBaseline() {
  baselineSnapshot.value = snapshot()
}
function isDirty() {
  if (!hasSelection.value) return false
  if (loading.value || loadError.value) return false
  return snapshot() !== baselineSnapshot.value
}

function resetErrors() {
  metaErrors.tableCode = ''
  metaErrors.label = ''
  fieldRowErrors.value = {}
  fieldGlobalError.value = ''
  dossierErrors.value = {}
}

function resetForm(label = '', description = '') {
  meta.tableCode = ''
  meta.label = label
  meta.description = description
  meta.status = 'active'
  fields.value = []
  recordCount.value = 0
  dossier.value = defaultDossierConfig()
  resetErrors()
  captureBaseline()
}

async function loadDetail(tableId) {
  loading.value = true
  loadError.value = false
  resetErrors()
  try {
    const d = await getDataTable(props.positionId, tableId)
    if (selectedId.value !== tableId) return
    meta.tableCode = d.tableCode || ''
    meta.label = d.label || ''
    meta.description = d.description || ''
    meta.status = d.status || 'active'
    recordCount.value = d.recordCount ?? 0
    fields.value = (d.fields || [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((f) => ({
        id: f.id,
        fieldCode: f.fieldCode || '',
        label: f.label || '',
        fieldType: f.fieldType,
        required: !!f.required,
        defaultValue: f.defaultValue ?? null,
        options: Array.isArray(f.options) ? f.options.slice() : [],
        fieldDesc: f.fieldDesc || '',
        slotRole: f.slotRole || '',
        isPrimary: !!f.isPrimary,
        isSystem: !!f.isSystem
      }))
    dossier.value = hydrateDossierConfig(d.dossier)
    captureBaseline()
  } catch (e) {
    if (selectedId.value === tableId) loadError.value = true
  } finally {
    if (selectedId.value === tableId) loading.value = false
  }
}

function clearSelection() {
  selectedId.value = null
  loadError.value = false
}

async function confirmDiscardIfDirty() {
  if (!isDirty()) return true
  try {
    await ElMessageBox.confirm('有未保存的修改，切换将丢弃。继续？', '切换工作档案', {
      type: 'warning',
      confirmButtonText: '丢弃并切换',
      cancelButtonText: '继续编辑'
    })
    return true
  } catch {
    return false
  }
}

async function selectTable(row) {
  if (selectedId.value === row.id) return
  if (!(await confirmDiscardIfDirty())) return
  selectedId.value = row.id
  await loadDetail(row.id)
}

/* ============================ 新建：先在弹窗里起名，再进编辑态 ============================ */
const createDialogOpen = ref(false)
const createDraft = reactive({ label: '', description: '' })
async function startCreate() {
  if (props.positionId == null) {
    ElMessage.warning('请先保存岗位')
    return
  }
  if (!(await confirmDiscardIfDirty())) return
  createDraft.label = ''
  createDraft.description = ''
  createDialogOpen.value = true
}
function confirmCreate() {
  const label = (createDraft.label || '').trim()
  if (!label) {
    ElMessage.warning('请填写档案名称')
    return
  }
  createDialogOpen.value = false
  selectedId.value = NEW
  loadError.value = false
  resetForm(label, (createDraft.description || '').trim())
  // md 三.4.2（2026-09-04 PRD-20260903 对齐）：点【下一步】后提示继续配置编目信息与档案详情
  ElMessage.success('工作档案已创建，请继续配置编目信息和档案详情')
}

/* ============================ 档案信息弹窗（名称 / 说明 / 状态 / 删除） ============================ */
const infoDialogOpen = ref(false)
const infoDraft = reactive({ label: '', description: '', status: 'active' })
function openInfo() {
  Object.assign(infoDraft, { label: meta.label, description: meta.description, status: meta.status })
  infoDialogOpen.value = true
}
function saveInfo() {
  if (!(infoDraft.label || '').trim()) {
    ElMessage.warning('档案名称必填')
    return
  }
  meta.label = infoDraft.label.trim()
  meta.description = infoDraft.description
  meta.status = infoDraft.status
  infoDialogOpen.value = false
}

/* ============================ 卡片字段：弹窗编辑整表 ============================ */
const slotsDialogOpen = ref(false)
const slotsDraft = ref([])
const slotsRowErrors = ref({})
const slotsGlobalError = ref('')
function openSlotsEdit() {
  slotsDraft.value = fields.value.map((r) => ({ ...r, options: (r.options || []).slice() }))
  if (!slotsDraft.value.some((r) => !r.isSystem)) {
    slotsDraft.value.push({ fieldCode: '', label: '', fieldType: 'TEXT', required: true, defaultValue: null, options: [], fieldDesc: '', slotRole: 'IDENTITY', isPrimary: true, isSystem: false })
  }
  slotsRowErrors.value = {}
  slotsGlobalError.value = ''
  slotsDialogOpen.value = true
}
function saveSlots() {
  const r = validateFields(slotsDraft.value)
  slotsRowErrors.value = r.errors.rows || {}
  slotsGlobalError.value = r.errors.__global || ''
  if (!r.ok) return
  fields.value = slotsDraft.value
  fieldRowErrors.value = {}
  fieldGlobalError.value = ''
  slotsDialogOpen.value = false
}

/* ============================ 业务规则：弹窗编辑整表 ============================ */
const rulesDialogOpen = ref(false)
const rulesDraft = ref([])
const rulesRowErrors = ref({})
const rulesGlobalError = ref('')
function openRulesEdit() {
  rulesDraft.value = dossier.value.reduceRules.map((r) => ({ ...r, params: { ...(r.params || {}) } }))
  rulesRowErrors.value = {}
  rulesGlobalError.value = ''
  rulesDialogOpen.value = true
}
function saveRules() {
  const res = validateDossierConfig({ ...dossier.value, reduceRules: rulesDraft.value })
  const rows = {}
  let global = ''
  Object.entries(res.errors).forEach(([k, msg]) => {
    const m = k.match(/^reduceRules\[(\d+)\]\.(?:params\.)?(\w+)$/)
    if (m) {
      rows[m[1]] = { ...(rows[m[1]] || {}), [m[2]]: msg }
    } else if (k === 'reduceRules') {
      global = msg
    }
  })
  rulesRowErrors.value = rows
  rulesGlobalError.value = global
  if (Object.keys(rows).length || global) return
  dossier.value = { ...dossier.value, reduceRules: rulesDraft.value }
  rulesDialogOpen.value = false
}
function strategyLabel(v) {
  return REDUCE_STRATEGIES.find((s) => s.value === v)?.label || v
}
function ruleStrategyText(r) {
  return r.strategy === 'SUMMARY' ? `${strategyLabel(r.strategy)}（最近 ${r.params?.n ?? 5} 条）` : strategyLabel(r.strategy)
}

/* ============================ 沉淀策略（三选项就地编辑） ============================ */
function setPolicy(key, value) {
  dossier.value = { ...dossier.value, policy: { ...dossier.value.policy, [key]: value } }
}
function policyErr(key) {
  return dossierErrors.value[`policy.${key}`] || ''
}
const extractHint = computed(() => EXTRACT_MODES.find((m) => m.value === !!dossier.value.policy.autoExtract)?.hint || '')
const tierHint = computed(() => TIERS.find((t) => t.value === dossier.value.policy.writeTier)?.hint || '')
const confirmHint = computed(() => CONFIRM_MODES.find((m) => m.value === dossier.value.policy.confirmMode)?.hint || '')

/* ============================ 保存 ============================ */
function runLocalValidate() {
  resetErrors()
  const m = validateTableMeta(meta, { isEdit: isEdit.value })
  Object.assign(metaErrors, { tableCode: m.errors.tableCode || '', label: m.errors.label || '' })
  const f = validateFields(fields.value)
  fieldRowErrors.value = f.errors.rows || {}
  fieldGlobalError.value = f.errors.__global || ''
  const d = validateDossierConfig(dossier.value)
  dossierErrors.value = d.errors
  return m.ok && f.ok && d.ok
}

function submitIdxToRowIdx(submitIdx) {
  let n = -1
  for (let i = 0; i < fields.value.length; i++) {
    if (fields.value[i].isSystem) continue
    n += 1
    if (n === submitIdx) return i
  }
  return -1
}

function applyServerError(e, fallbackMsg) {
  const field = e?.field
  const msg = e?.message || fallbackMsg || '保存失败'
  const errorCode = e?.data?.errorCode
  if (errorCode === 'DOSSIER_CONFIG_ILLEGAL' && field) {
    dossierErrors.value = { ...dossierErrors.value, [field]: msg }
    ElMessage.error(msg)
    return
  }
  if (errorCode === 'SLOT_LIMIT_EXCEEDED') {
    fieldGlobalError.value = msg
    ElMessage.error(msg)
    return
  }
  if (field === 'tableCode' || field === 'label') {
    metaErrors[field] = msg
    ElMessage.error(msg)
    return
  }
  const submitIdx = e?.data?.fieldIndex
  if (submitIdx != null && submitIdx >= 0) {
    const rowIdx = submitIdxToRowIdx(submitIdx)
    if (rowIdx >= 0) {
      fieldRowErrors.value = { ...fieldRowErrors.value, [rowIdx]: { [field || 'fieldCode']: msg } }
      ElMessage.error(`卡片字段第 ${submitIdx + 1} 行：${msg}`)
      return
    }
  }
  ElMessage.error(msg)
}

function businessFieldsPayload() {
  return fields.value.filter((r) => !r.isSystem).map(normalizeFieldForSubmit)
}
function dossierIsDefault() {
  return dossierSnapshot(dossier.value) === dossierSnapshot(defaultDossierConfig())
}

async function saveCreate() {
  const res = await createDataTable(props.positionId, {
    tableCode: meta.tableCode.trim() || null,
    label: meta.label.trim(),
    description: meta.description.trim() || null,
    fields: businessFieldsPayload()
  })
  const newId = res?.id
  if (newId != null && !dossierIsDefault()) {
    await saveDossierConfig(props.positionId, newId, normalizeDossierForSubmit(dossier.value))
  }
  ElMessage.success('工作档案已创建')
  return newId
}

async function saveFieldsWithConfirm() {
  const payload = businessFieldsPayload()
  try {
    await saveDataTableFields(props.positionId, selectedId.value, payload, false)
  } catch (e) {
    if (e?.data?.errorCode !== 'FIELD_DELETE_NEED_CONFIRM') throw e
    const d = e.data || {}
    const affected = d.affectedRows ?? 0
    const codes = Array.isArray(d.deleteFieldCodes) ? d.deleteFieldCodes : []
    const codeLine = codes.length ? `\n会删掉的字段：${codes.join('、')}` : ''
    const tip =
      affected > 0
        ? `你删掉了一些卡片字段，而这份档案已经存了 ${affected} 条数据。保存后这些字段里已填的内容也会一起去掉。${codeLine}\n确定要这样保存吗？`
        : `你删掉了一些卡片字段，保存后会移除。${codeLine}\n确定要这样保存吗？`
    await ElMessageBox.confirm(tip, '确认删除字段', {
      type: 'warning',
      confirmButtonText: '确认保存',
      cancelButtonText: '再想想',
      confirmButtonClass: 'el-button--danger'
    })
    await saveDataTableFields(props.positionId, selectedId.value, payload, true)
  }
}

async function saveEdit() {
  await updateDataTable(props.positionId, selectedId.value, {
    label: meta.label.trim(),
    description: meta.description.trim() || null,
    status: meta.status
  })
  await saveFieldsWithConfirm()
  const saved = await saveDossierConfig(props.positionId, selectedId.value, normalizeDossierForSubmit(dossier.value))
  if (saved) dossier.value = hydrateDossierConfig(saved)
  ElMessage.success('工作档案已保存')
}

async function save() {
  if (!runLocalValidate()) {
    ElMessage.warning('请先修正标红项')
    return
  }
  saving.value = true
  try {
    if (isEdit.value) {
      await saveEdit()
      captureBaseline()
      await loadTables()
    } else {
      const newId = await saveCreate()
      await loadTables()
      if (newId != null) {
        selectedId.value = newId
        await loadDetail(newId)
      } else {
        clearSelection()
      }
    }
    emit('saved')
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    applyServerError(e, '保存失败')
  } finally {
    saving.value = false
  }
}

async function cancelEdit() {
  if (saving.value) return
  if (!(await confirmDiscardIfDirty())) return
  if (isEdit.value) {
    await loadDetail(selectedId.value)
  } else {
    clearSelection()
    if (tables.value.length) {
      selectedId.value = tables.value[0].id
      await loadDetail(selectedId.value)
    }
  }
}

function cardSubLine(t) {
  return `${t.fieldCount ?? 0} 个字段${t.status !== 'active' ? ' · 停用' : ''}`
}
</script>

<template>
  <div class="pd-pane wd">
    <!-- 顶部：卡片切换（左）+ 操作（右）；无档案时不渲染顶部条，只留中部提示 -->
    <div v-if="tables.length || hasSelection || listError" class="pd-list-head wd-top" v-loading="listLoading">
      <div class="wd-cards">
        <div v-if="listError" class="pd-list-sub">
          档案加载失败 <el-button link type="primary" @click="loadTables">重试</el-button>
        </div>
        <template v-else>
          <button
            v-for="t in tables"
            :key="t.id"
            type="button"
            class="wd-card"
            :class="{ on: selectedId === t.id, off: t.status !== 'active' }"
            @click="selectTable(t)"
          >
            <span class="wd-card-name">{{ t.label }}</span>
            <span class="wd-card-sub">{{ cardSubLine(t) }}</span>
          </button>
          <button v-if="selectedId === NEW" type="button" class="wd-card on">
            <span class="wd-card-name">{{ meta.label || '新建中…' }}</span>
            <span class="wd-card-sub">未保存</span>
          </button>
        </template>
      </div>
      <div class="wd-actions">
        <el-button v-if="hasSelection" size="small" @click="cancelEdit">取消</el-button>
        <el-button v-if="hasSelection" type="primary" size="small" :loading="saving" :disabled="loading || loadError" @click="save">
          {{ isEdit ? '保存' : '创建档案' }}
        </el-button>
        <el-button size="small" :disabled="selectedId === NEW" @click="startCreate">＋ 新建工作档案</el-button>
      </div>
    </div>

    <!-- 首次进入：中部提示 -->
    <div v-if="!hasSelection && !listLoading && !listError" class="pd-empty wd-empty">
      <span>还没有工作档案</span>
      <p class="pd-empty-hint">工作档案围绕一类对象沉淀（如「客户」「项目」）：AI 从对话里记录事实，按你配的规则归纳成档案</p>
      <el-button type="primary" @click="startCreate">＋ 新建工作档案</el-button>
    </div>

    <div v-else-if="hasSelection && loading"><el-skeleton :rows="8" animated /></div>
    <div v-else-if="hasSelection && loadError" class="pd-empty">
      <span>加载失败</span>
      <el-button type="primary" @click="loadDetail(selectedId)">重试</el-button>
    </div>

    <template v-else-if="hasSelection">
      <!-- ① 上：沉淀策略 -->
      <section class="pd-sec">
        <div class="pd-sec-title">
          {{ meta.label }}
          <span class="pd-sec-sub">{{ meta.description || '沉淀策略 · 决定 AI 什么时候记、多有把握才记、要不要先问你' }}</span>
          <span class="pd-hint">
            <el-button link type="primary" size="small" @click="openInfo">档案信息</el-button>
          </span>
        </div>
        <p v-if="metaErrors.label" class="pd-empty-hint wd-err">{{ metaErrors.label }}</p>
        <el-form label-position="top" class="wd-policy">
          <el-form-item label="抽取方式">
            <el-select :model-value="!!dossier.policy.autoExtract" @update:model-value="setPolicy('autoExtract', $event)">
              <el-option v-for="m in EXTRACT_MODES" :key="String(m.value)" :value="m.value" :label="m.label" />
            </el-select>
            <div class="pd-empty-hint wd-note">{{ extractHint }}</div>
          </el-form-item>
          <el-form-item label="置信度阈值" :error="policyErr('writeTier')">
            <el-select :model-value="dossier.policy.writeTier" @update:model-value="setPolicy('writeTier', $event)">
              <el-option v-for="t in TIERS" :key="t.value" :value="t.value" :label="t.value === 'MID' ? '中（推荐）' : t.label" />
            </el-select>
            <div class="pd-empty-hint wd-note">低于此值不入档 · {{ tierHint }}</div>
          </el-form-item>
          <el-form-item label="用户确认" :error="policyErr('confirmMode')">
            <el-select :model-value="dossier.policy.confirmMode" @update:model-value="setPolicy('confirmMode', $event)">
              <el-option v-for="m in CONFIRM_MODES" :key="m.value" :value="m.value" :label="m.label" />
            </el-select>
            <div class="pd-empty-hint wd-note">{{ confirmHint }}</div>
          </el-form-item>
        </el-form>
      </section>

      <div class="wd-two">
        <!-- ② 左下：卡片字段 -->
        <section class="pd-sec">
          <div class="pd-list-head">
            <div class="pd-list-title">
              卡片字段
              <span class="pd-list-sub">系统要拿来算账的字段 · {{ bizSlotRows.length }} / {{ MAX_SLOTS }}</span>
            </div>
            <el-button type="primary" size="small" @click="openSlotsEdit">编辑</el-button>
          </div>
          <div class="table-wrap">
            <el-table :data="bizSlotRows" class="pd-table" empty-text="还没有卡片字段 · 点「编辑」添加">
              <el-table-column prop="label" label="字段名" min-width="140" />
              <el-table-column label="字段类型" width="110">
                <template #default="{ row }">{{ fieldTypeLabel(row.fieldType) }}</template>
              </el-table-column>
              <el-table-column label="字段用途" min-width="120">
                <template #default="{ row }"><span v-if="row.slotRole">{{ slotRoleLabel(row.slotRole) }}</span><span v-else class="pd-faint">普通</span></template>
              </el-table-column>
              <el-table-column label="唯一 ID" width="80" align="center">
                <template #default="{ row }"><span v-if="row.isPrimary">✓</span><span v-else class="pd-faint">—</span></template>
              </el-table-column>
            </el-table>
            <p v-if="fieldGlobalError" class="pd-empty-hint wd-err">{{ fieldGlobalError }}</p>
            <p v-if="isEdit && recordCount > 0" class="pd-empty-hint">已有 {{ recordCount }} 条数据，新增字段对历史行将取空 / 默认值；已落库字段的类型不可改。</p>
          </div>
        </section>

        <!-- ③ 右下：业务规则 -->
        <section class="pd-sec">
          <div class="pd-list-head">
            <div class="pd-list-title">
              业务规则
              <span class="pd-list-sub">同一信息多次出现时怎么合并 · {{ dossier.reduceRules.length }} / {{ MAX_RULES }}</span>
            </div>
            <el-button type="primary" size="small" @click="openRulesEdit">编辑</el-button>
          </div>
          <div class="table-wrap">
            <el-table :data="dossier.reduceRules" class="pd-table" empty-text="还没有业务规则（一律取最新）· 点「编辑」添加">
              <el-table-column prop="key" label="规则名" min-width="120" />
              <el-table-column label="规则描述" min-width="180">
                <template #default="{ row }"><span v-if="row.desc">{{ row.desc }}</span><span v-else class="pd-faint">—</span></template>
              </el-table-column>
              <el-table-column label="归纳方式" min-width="140">
                <template #default="{ row }">{{ ruleStrategyText(row) }}</template>
              </el-table-column>
            </el-table>
            <p v-if="dossierErrors.reduceRules" class="pd-empty-hint wd-err">{{ dossierErrors.reduceRules }}</p>
          </div>
        </section>
      </div>
    </template>

    <!-- 弹窗：新建工作档案 -->
    <el-dialog v-model="createDialogOpen" title="新建工作档案" width="480px" :close-on-click-modal="false" append-to-body>
      <el-form label-position="top" class="pd-drawer-form">
        <el-form-item label="档案名称" required>
          <el-input v-model="createDraft.label" maxlength="128" placeholder="围绕什么沉淀，如「客户」「项目」「商机」" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="createDraft.description" type="textarea" :rows="3" placeholder="这份档案记录什么、供哪些办事场景使用（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogOpen = false">取消</el-button>
        <el-button type="primary" @click="confirmCreate">下一步</el-button>
      </template>
    </el-dialog>

    <!-- 弹窗：档案信息 -->
    <el-dialog v-model="infoDialogOpen" title="档案信息" width="480px" :close-on-click-modal="false" append-to-body>
      <el-form label-position="top" class="pd-drawer-form">
        <el-form-item label="档案名称" required>
          <el-input v-model="infoDraft.label" maxlength="128" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="infoDraft.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item v-if="isEdit" label="状态">
          <el-switch v-model="infoDraft.status" active-value="active" inactive-value="disabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
        <el-form-item v-if="isEdit && meta.tableCode" label="系统标识">
          <span class="pd-mono">{{ meta.tableCode }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="isEdit" link type="danger" :loading="delBusy === selectedId" class="wd-del" @click="removeCurrent">删除此档案</el-button>
        <el-button @click="infoDialogOpen = false">取消</el-button>
        <el-button type="primary" @click="saveInfo">确定</el-button>
      </template>
    </el-dialog>

    <!-- 弹窗：卡片字段整表编辑 -->
    <el-dialog v-model="slotsDialogOpen" title="编辑卡片字段" width="960px" :close-on-click-modal="false" append-to-body>
      <div class="wd-dialog-body">
        <DataTableFieldEditor v-model:rows="slotsDraft" :mode="isEdit ? 'edit' : 'create'" :row-errors="slotsRowErrors" :global-error="slotsGlobalError" />
      </div>
      <template #footer>
        <el-button @click="slotsDialogOpen = false">取消</el-button>
        <el-button type="primary" @click="saveSlots">确定</el-button>
      </template>
    </el-dialog>

    <!-- 弹窗：业务规则整表编辑 -->
    <el-dialog v-model="rulesDialogOpen" title="编辑业务规则" width="960px" :close-on-click-modal="false" append-to-body>
      <div class="wd-dialog-body">
        <DossierRuleListEditor v-model:rows="rulesDraft" :key-suggestions="keySuggestions" :row-errors="rulesRowErrors" :global-error="rulesGlobalError" />
      </div>
      <template #footer>
        <el-button @click="rulesDialogOpen = false">取消</el-button>
        <el-button type="primary" @click="saveRules">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 段落 / 列表 / 表单样式走全局 position-detail.css；这里只有本页布局：顶部卡片行、策略三栏、下方双栏 */
.wd {
  padding: var(--space-5) var(--space-6) var(--space-8);
}
.wd-top {
  align-items: flex-start;
  gap: var(--space-4);
}
.wd-cards {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}
.wd-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 140px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  text-align: left;
}
.wd-card:hover {
  background: var(--bg-hover);
}
.wd-card.on {
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
.wd-card.off .wd-card-name {
  color: var(--c-text-muted);
}
.wd-card-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.wd-card-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.wd-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
.wd-empty {
  min-height: 360px;
}
.wd-policy {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 var(--space-4);
}
.wd-policy :deep(.el-form-item) {
  margin-bottom: var(--space-2);
}
.wd-policy :deep(.el-select) {
  width: 100%;
}
.wd-note {
  margin-top: var(--space-1);
}
.wd-two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-5);
  align-items: start;
}
.wd-err {
  color: var(--c-danger);
}
.wd-del {
  margin-right: auto;
}
.wd-dialog-body {
  max-height: 64vh;
  overflow: auto;
}
@media (max-width: 1000px) {
  .wd-policy,
  .wd-two {
    grid-template-columns: 1fr;
  }
}
</style>
