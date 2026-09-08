<script setup>
/**
 * 岗位「工作档案」子页面。2026-09-09 原型复刻批次 4A 按 md §4 + 原型最终生效层整体重做骨架。
 *
 * 骨架（原型 `pane()` L2302 + `alignWorkProfile` L2706 + `enhanceStrategies` L2792 + L4010）：
 *   左 200px 档案列表面板（每档案一张卡：名称 + 「N 个字段」，底部虚线「＋ 新增」）
 *   右侧纵排三张卡：
 *     ① 基本信息（卡头 = 标题 + 右侧【取消】【保存】；卡体 = 档案名称 / 档案说明 两列就地编辑，
 *        下接分隔线后的三列：抽取方式（md §4.2.1 单一复选框「自动抽取」）/ 置信度阈值 / 用户确认）
 *     ② 编目信息（行内网格 DossierCatalogGrid，N / 8）
 *     ③ 档案详情（行内网格 DossierRuleListEditor，N / 8）
 * 字段定义与校验按 md §4.2.1–4.2.3；原型有而 md 无的（字段类型「标签（枚举）」、唯一 ID 联动必填）不做。
 * 新建档案弹窗按 md §4.2：【取消】【下一步】+ 提示「工作档案已创建，请继续配置编目信息和档案详情」。
 *
 * 事件流 / 档案视图 / 抽取 / 归纳等运行时在客户端，本页只配规则。
 * 保存为手动：元信息 → 卡位（原子批量）→ 策略 / 规则。
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
import { validateFields, validateTableMeta, normalizeFieldForSubmit, MAX_SLOTS } from '@/utils/dataTableTypes'
import {
  hydrateDossierConfig,
  defaultDossierConfig,
  validateDossierConfig,
  normalizeDossierForSubmit,
  dossierSnapshot,
  TIERS,
  CONFIRM_MODES,
  MAX_RULES
} from '@/utils/dossierConfig'
import DossierCatalogGrid from '@/components/position/dossier/DossierCatalogGrid.vue'
import DossierRuleListEditor from '@/components/position/dossier/DossierRuleListEditor.vue'

const props = defineProps({
  positionId: { type: [Number, String], default: null },
  positionName: { type: String, default: '岗位' },
  tableCount: { type: Number, default: 0 },
  embedded: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['saved', 'update:tableCount'])

/* ============================ 档案列表（左侧面板） ============================ */
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
        : `工作档案「${row.label}」还没有数据。删除后将彻底移除（含编目信息、档案详情、抽取策略），无法恢复。${refLine}\n确定要删除吗？`
    await ElMessageBox.confirm(tip, '删除工作档案', {
      type: 'warning',
      confirmButtonText: affected > 0 ? '停用并删除' : '彻底删除',
      cancelButtonText: '再想想',
      confirmButtonClass: 'el-button--danger'
    })
    await deleteDataTable(props.positionId, row.id)
    ElMessage.success('工作档案已删除')
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

/* 编目信息网格只编业务字段；系统字段（uid 等）不出现在网格里，保存时原样带回。 */
const systemFields = computed(() => fields.value.filter((r) => r.isSystem))
const bizSlotRows = computed(() => fields.value.filter((r) => !r.isSystem))
function setBizRows(rows) {
  fields.value = [...systemFields.value, ...rows]
}
/* 行内网格的错误下标以业务行为准，需把 validateFields（含系统行）的下标折算过去 */
function bizRowErrors(all) {
  const map = {}
  fields.value.forEach((r, i) => {
    if (r.isSystem) return
    const n = bizSlotRows.value.indexOf(r)
    if (all[i]) map[n] = all[i]
  })
  return map
}
const ruleRowErrors = ref({})

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
  ruleRowErrors.value = {}
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

/* ============================ 新建：弹窗起名 →【下一步】进编辑态（md §4.2） ============================ */
const createDialogOpen = ref(false)
const createDraft = reactive({ label: '', description: '' })
async function startCreate() {
  if (props.readonly) return
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
  // md §4.2：点【下一步】后提示继续配置编目信息与档案详情
  ElMessage.success('工作档案已创建，请继续配置编目信息和档案详情')
}

/* ============================ 编目信息 / 档案详情：行内网格 ============================ */
function onCatalogLimit() {
  ElMessage.warning(`编目信息最多 ${MAX_SLOTS} 条`)
}
function onRuleLimit() {
  ElMessage.warning(`档案详情最多 ${MAX_RULES} 条`)
}
function setRules(rows) {
  dossier.value = { ...dossier.value, reduceRules: rows }
}

/* ============================ 抽取策略（md §4.2.1） ============================ */
function setPolicy(key, value) {
  dossier.value = { ...dossier.value, policy: { ...dossier.value.policy, [key]: value } }
}
function policyErr(key) {
  return dossierErrors.value[`policy.${key}`] || ''
}

/* ============================ 保存 ============================ */
function runLocalValidate() {
  resetErrors()
  const m = validateTableMeta(meta, { isEdit: isEdit.value })
  Object.assign(metaErrors, { tableCode: m.errors.tableCode || '', label: m.errors.label || '' })
  const f = validateFields(fields.value)
  fieldRowErrors.value = bizRowErrors(f.errors.rows || {})
  fieldGlobalError.value = f.errors.__global || ''
  const d = validateDossierConfig(dossier.value)
  dossierErrors.value = d.errors
  const rows = {}
  Object.entries(d.errors).forEach(([k, msg]) => {
    const hit = k.match(/^reduceRules\[(\d+)\]\.(?:params\.)?(\w+)$/)
    if (hit) rows[hit[1]] = { ...(rows[hit[1]] || {}), [hit[2]]: msg }
  })
  ruleRowErrors.value = rows
  return m.ok && f.ok && d.ok
}

function submitIdxToRowIdx(submitIdx) {
  return submitIdx >= 0 && submitIdx < bizSlotRows.value.length ? submitIdx : -1
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
      ElMessage.error(`编目信息第 ${submitIdx + 1} 行：${msg}`)
      return
    }
  }
  ElMessage.error(msg)
}

function businessFieldsPayload() {
  return bizSlotRows.value.map(normalizeFieldForSubmit)
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
        ? `你删掉了一些编目字段，而这份档案已经存了 ${affected} 条数据。保存后这些字段里已填的内容也会一起去掉。${codeLine}\n确定要这样保存吗？`
        : `你删掉了一些编目字段，保存后会移除。${codeLine}\n确定要这样保存吗？`
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
}

async function save() {
  if (props.readonly) return
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
    // md §4.2：【保存】保存当前档案全部配置，提示「配置已保存到页面草稿」
    ElMessage.success('配置已保存到页面草稿')
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
  // md §4.2：【取消】放弃本次编辑，提示「已取消未保存修改」
  ElMessage.info('已取消未保存修改')
}

/* 左栏卡片副行：md §4.1「卡片显示档案名称 + 该档案下的字段数量」 */
function cardFieldCount(t) {
  return t.fieldCount ?? 0
}
</script>

<template>
  <div class="pd-pane wd">
    <!-- 首次进入且无档案：中部提示（代码超集，原型无空态） -->
    <div v-if="!tables.length && !hasSelection && !listLoading && !listError" class="pd-empty wd-empty">
      <span>还没有工作档案</span>
      <p class="pd-empty-hint">工作档案围绕一类对象沉淀（如「客户」「项目」）：AI 从对话里记录事实，按你配的规则归纳成档案</p>
      <el-button v-if="!readonly" type="primary" @click="startCreate">＋ 新增</el-button>
    </div>

    <!-- 左 200px 档案列表面板 + 右侧三张卡（原型 .wp3-grid） -->
    <div v-else class="wd-grid">
      <aside class="wd-side" v-loading="listLoading">
        <div v-if="listError" class="pd-list-sub">
          档案加载失败 <el-button link type="primary" @click="loadTables">重试</el-button>
        </div>
        <template v-else>
          <button
            v-for="t in tables"
            :key="t.id"
            type="button"
            class="wd-profile-card"
            :class="{ on: selectedId === t.id, off: t.status !== 'active' }"
            @click="selectTable(t)"
          >
            <strong>{{ t.label }}</strong>
            <span>{{ cardFieldCount(t) }} 个字段<template v-if="t.status !== 'active'"> · 停用</template></span>
          </button>
          <button v-if="selectedId === NEW" type="button" class="wd-profile-card on">
            <strong>{{ meta.label || '新建中…' }}</strong>
            <span>未保存</span>
          </button>
          <button v-if="!readonly" type="button" class="wd-add-tab" :disabled="selectedId === NEW" @click="startCreate">＋ 新增</button>
        </template>
      </aside>

      <main class="wd-main">
        <div v-if="hasSelection && loading"><el-skeleton :rows="8" animated /></div>
        <div v-else-if="hasSelection && loadError" class="pd-empty">
          <span>加载失败</span>
          <el-button type="primary" @click="loadDetail(selectedId)">重试</el-button>
        </div>
        <div v-else-if="!hasSelection" class="pd-empty">
          <span>请选择左侧的工作档案</span>
        </div>

        <template v-else>
          <!-- ① 基本信息 -->
          <section class="wd-sec">
            <div class="wd-sec-head">
              <strong>基本信息</strong>
              <span class="wd-spacer"></span>
              <div v-if="!readonly" class="wd-head-actions">
                <el-button @click="cancelEdit">取消</el-button>
                <el-button type="primary" :loading="saving" :disabled="loading || loadError" @click="save">保存</el-button>
              </div>
            </div>
            <div class="wd-sec-body">
              <div class="wd-basic-fields">
                <div class="wd-field">
                  <label>档案名称</label>
                  <el-input
                    v-if="!readonly"
                    v-model="meta.label"
                    maxlength="128"
                    placeholder="如「经营分析报告」"
                    :class="{ 'is-err': !!metaErrors.label }"
                  />
                  <div v-else class="wd-readonly-value">{{ meta.label || '-' }}</div>
                  <p v-if="metaErrors.label" class="wd-err">{{ metaErrors.label }}</p>
                </div>
                <div class="wd-field">
                  <label>档案说明</label>
                  <el-input v-if="!readonly" v-model="meta.description" maxlength="500" placeholder="如「沉淀岗位生成的周期分析结论」" />
                  <div v-else class="wd-readonly-value">{{ meta.description || '-' }}</div>
                </div>
              </div>

              <div class="wd-policy">
                <div class="wd-field">
                  <label>抽取方式</label>
                  <!-- md §4.2.1：单一复选框「自动抽取」——勾选后由系统在会话中自动识别并抽取；
                       不勾选则仅在用户指定时触发（Q25③「指定触发是抽取方式必选的一项…当前显得展示多余」
                       → 2026-09-09 PRD 复核 A3 删掉常显的「指定触发」只读行，改由未勾选态的 hint 表达）。 -->
                  <div class="wd-extract">
                    <el-checkbox
                      :model-value="!!dossier.policy.autoExtract"
                      :disabled="readonly"
                      @update:model-value="setPolicy('autoExtract', $event)"
                    >
                      自动抽取
                    </el-checkbox>
                    <span class="wd-extract-hint">
                      {{ dossier.policy.autoExtract ? '会话中自动识别并抽取' : '仅在用户指定时触发' }}
                    </span>
                  </div>
                </div>
                <div class="wd-field">
                  <label>置信度阈值</label>
                  <el-select
                    :model-value="dossier.policy.writeTier"
                    :disabled="readonly"
                    @update:model-value="setPolicy('writeTier', $event)"
                  >
                    <el-option v-for="t in TIERS" :key="t.value" :value="t.value" :label="t.value === 'MID' ? '中（推荐）' : t.label" />
                  </el-select>
                  <p v-if="policyErr('writeTier')" class="wd-err">{{ policyErr('writeTier') }}</p>
                </div>
                <div class="wd-field">
                  <label>用户确认</label>
                  <el-select
                    :model-value="dossier.policy.confirmMode"
                    :disabled="readonly"
                    @update:model-value="setPolicy('confirmMode', $event)"
                  >
                    <el-option v-for="m in CONFIRM_MODES" :key="m.value" :value="m.value" :label="m.label" />
                  </el-select>
                  <p v-if="policyErr('confirmMode')" class="wd-err">{{ policyErr('confirmMode') }}</p>
                </div>
              </div>

              <!-- 删除档案入口（代码超集：原型最终无此入口，保留避免能力回退） -->
              <div v-if="isEdit && !readonly" class="wd-danger-row">
                <el-button link type="danger" :loading="delBusy === selectedId" @click="removeCurrent">删除此档案</el-button>
                <span v-if="meta.tableCode" class="wd-code">系统标识 {{ meta.tableCode }}</span>
              </div>
            </div>
          </section>

          <!-- ② 编目信息 -->
          <section class="wd-sec">
            <div class="wd-sec-head">
              <strong>编目信息</strong>
              <span>{{ bizSlotRows.length }} / {{ MAX_SLOTS }}</span>
            </div>
            <div class="wd-sec-body">
              <DossierCatalogGrid
                :rows="bizSlotRows"
                :row-errors="fieldRowErrors"
                :global-error="fieldGlobalError"
                :readonly="readonly"
                @update:rows="setBizRows"
                @limit="onCatalogLimit"
              />
              <p v-if="isEdit && recordCount > 0" class="pd-empty-hint wd-note">
                已有 {{ recordCount }} 条数据，新增字段对历史行将取空 / 默认值；已落库字段的类型不可改。
              </p>
            </div>
          </section>

          <!-- ③ 档案详情 -->
          <section class="wd-sec">
            <div class="wd-sec-head">
              <strong>档案详情</strong>
              <span>{{ dossier.reduceRules.length }} / {{ MAX_RULES }}</span>
            </div>
            <div class="wd-sec-body">
              <DossierRuleListEditor
                :rows="dossier.reduceRules"
                :row-errors="ruleRowErrors"
                :global-error="dossierErrors.reduceRules || ''"
                :readonly="readonly"
                @update:rows="setRules"
                @limit="onRuleLimit"
              />
            </div>
          </section>
        </template>
      </main>
    </div>

    <!-- 弹窗：新建工作档案（md §4.2：【取消】【下一步】） -->
    <el-dialog v-model="createDialogOpen" title="新建工作档案" width="480px" :close-on-click-modal="false" append-to-body>
      <el-form label-position="top" class="pd-drawer-form">
        <el-form-item label="档案名称" required>
          <el-input v-model="createDraft.label" maxlength="128" placeholder="如「经营分析报告」" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="createDraft.description" type="textarea" :rows="3" placeholder="描述档案用途，如「沉淀岗位生成的周期分析结论」" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogOpen = false">取消</el-button>
        <el-button type="primary" @click="confirmCreate">下一步</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 骨架照原型 .wp3-*：左 200px 档案列表 + 右侧纵排三卡（令牌化，不搬硬编码色值） */
.wd {
  padding: var(--space-5) var(--space-6) var(--space-8);
}
.wd-grid {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: var(--space-5);
  align-items: start;
  max-width: 1180px;
  margin: 0 auto;
}
.wd-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  min-width: 0;
}
.wd-profile-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  text-align: left;
}
.wd-profile-card:hover {
  background: var(--bg-hover);
}
.wd-profile-card.on {
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
.wd-profile-card strong {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
  line-height: 1.3;
}
.wd-profile-card.on strong {
  color: var(--c-accent);
}
.wd-profile-card span {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.wd-profile-card.off strong {
  color: var(--c-text-muted);
}
.wd-add-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--border-base);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-accent);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.wd-add-tab:disabled {
  color: var(--c-text-muted);
  cursor: not-allowed;
}
.wd-main {
  min-width: 0;
}
.wd-sec {
  margin-bottom: var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
}
.wd-sec:last-child {
  margin-bottom: 0;
}
.wd-sec-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 50px;
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border-base);
  background: var(--bg-sunken);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}
.wd-sec-head strong {
  font-size: var(--fs-md, 15px);
  color: var(--c-text-strong);
}
.wd-sec-head span {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.wd-spacer {
  flex: 1;
}
.wd-head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.wd-sec-body {
  padding: var(--space-5);
}
.wd-basic-fields {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: var(--space-5);
}
.wd-basic-fields + .wd-policy {
  margin-top: var(--space-5);
  padding-top: var(--space-5);
  border-top: 1px solid var(--border-base);
}
.wd-policy {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-5);
}
.wd-field {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  min-width: 0;
}
.wd-field label {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.wd-field :deep(.el-select) {
  width: 100%;
}
.wd-extract {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 32px;
}
.wd-extract-hint {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
}
.wd-readonly-value {
  font-size: var(--fs-sm);
  color: var(--c-text);
  line-height: 32px;
}
.wd-danger-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-5);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-base);
}
.wd-code {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  font-family: var(--font-mono, monospace);
}
.wd-err {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.wd-note {
  margin-top: var(--space-3);
}
.wd-empty {
  min-height: 360px;
}
.is-err :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
@media (max-width: 960px) {
  .wd-grid,
  .wd-basic-fields,
  .wd-policy {
    grid-template-columns: 1fr;
  }
}
</style>
