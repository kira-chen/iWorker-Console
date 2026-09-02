<script setup>
/**
 * 样例定时任务编辑表单（弹窗右栏 detail）。
 *
 * 抽取自 TaskEditor.vue 的 4 分区表单 + 校验 / 组装逻辑：
 *   基本信息（name + remark）/ 调度计划（SchedulePicker）/ 详细说明（MarkdownEditor sopDoc）/ 引用工具（ToolPicker）。
 * 剥离（交互规格 §3.3）：路由导航 / onBeforeRouteLeave / PageHeader / 「创建并启用·保存草稿」双按钮
 *   → 改单一「保存 / 创建样例」；去掉一切运行态（status / 上下次执行 / 立即执行）。
 *
 * 与用户端差异：
 * - 调度预览走 FDE 门 previewSampleSchedule（POST .../sample-tasks/preview-schedule），不用前台 /tasks/preview-schedule。
 * - 工具候选走 FDE 门 tool-picker（与岗位技能配工具同源），ToolPicker friendly=false（后台原样露 type/code）。
 * - 显式保存 + 脏检查（切换条目 / 关闭由父组件调 isDirty() 决定是否二次确认）。
 *
 * 保存时机：显式点按钮才提交（不逐字段即时保存，避免半成品样例落库）。
 * 子组件 SchedulePicker / ToolPicker / MarkdownEditor 零改复用。
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import {
  createSampleTask,
  updateSampleTask,
  previewSampleSchedule
} from '@/api/sampleTask'
import { listToolPicker, listPlatformSkillCandidates } from '@/api/position'
import { ApiError } from '@/api/request'
import SchedulePicker from '@/components/task/SchedulePicker.vue'
import ToolPicker from '@/components/admin/ToolPicker.vue'
import MarkdownEditor from '@/components/admin/MarkdownEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import { categoryLabel, categoryTagType, hasCategory } from '@/utils/skillCategory'

const props = defineProps({
  positionId: { type: [Number, String], default: null },
  // null = 新建态；样例条目 = 编辑态（回填自该条目）
  sample: { type: Object, default: null }
})
const emit = defineEmits(['saved', 'created', 'dirty-change'])

const isEdit = computed(() => !!props.sample)

// ---- 表单模型（对齐 TaskEditor.form） ----
function blankSchedule() {
  return {
    scheduleType: 'DAILY',
    daysOfWeek: [],
    daysOfMonth: [],
    times: ['09:00'],
    onceAt: '',
    startDate: '',
    endDate: ''
  }
}
const form = reactive({
  name: '',
  // 一句话指令（后端 SampleTaskUpsertRequest.prompt，@Size(max=2000)）：
  // 到点让搭子做什么；发布态（ENABLED 样例）后端硬拦空 prompt（1003），前端同步给必填标记 + 发布前可感知提示。
  prompt: '',
  remark: '',
  schedule: blankSchedule(),
  sopDoc: '',
  toolRefs: [], // { type, code, requiresConfirmation }（ToolPicker selected 结构）
  skillRefs: [] // { platformSkillId, name }（引用平台技能）
})

// 与后端 @Size(max=2000) 对齐（字数提示 + maxlength 双保险）
const PROMPT_MAX = 2000

const errors = reactive({ name: '', prompt: '', schedule: '', sopDoc: '', tools: '', skills: '' })
const saving = ref(false)

/* ---- 脏检查基线（对齐 PositionDataTableStage 快照法） ---- */
const dirty = ref(false)
function markDirty() {
  if (!dirty.value) {
    dirty.value = true
    emit('dirty-change', true)
  }
}
function clearDirty() {
  dirty.value = false
  emit('dirty-change', false)
}

/* ============================ 工具清单（FDE 门 tool-picker，与岗位技能配工具同源） ============================ */
const available = ref({ mock: [], mcp: [], api: [] })
const toolsLoading = ref(false)

async function loadTools() {
  toolsLoading.value = true
  try {
    // 与岗位技能配工具同源：FDE 门 tool-picker 按 type 分别取（MCP / API），friendly=false 原样露。
    // 数据表 / 业务系统类工具由岗位技能侧的 skill.md 引用维护，样例任务工具坞聚焦 MCP / API 两来源。
    const [mcp, api] = await Promise.all([
      listToolPicker({ type: 'MCP' }).catch(() => []),
      listToolPicker({ type: 'API' }).catch(() => [])
    ])
    available.value = {
      mock: [],
      mcp: normalizeTools(mcp, 'MCP'),
      api: normalizeTools(api, 'API')
    }
  } catch (e) {
    /* 工具非必填，不阻塞 */
  } finally {
    toolsLoading.value = false
  }
}

// tool-picker 项 { type, code, bizName, description, displayStatus } → ToolPicker available 项
function normalizeTools(list, fallbackType) {
  return (Array.isArray(list) ? list : list?.items || []).map((t) => ({
    type: t.type || fallbackType,
    code: t.code,
    bizName: t.bizName || t.code,
    description: t.description || '',
    requiresConfirmation: false
  }))
}

// (type,code) → bizName 映射，提交时补全 bizName
const bizNameMap = computed(() => {
  const m = new Map()
  for (const g of ['mock', 'mcp', 'api']) {
    for (const t of available.value?.[g] || []) {
      m.set(`${t.type}::${t.code}`, t.bizName || t.code)
    }
  }
  return m
})

/* ============================ 引用平台技能（origin=PLATFORM 已发布给 FDE；候选接口天然排除 FDE 技能） ============================ */
// 候选 VO（PlatformSkillCandidateVO）：{ id | skillId, code, name, description, category, updatedAt }。
// 候选接口只返回「系统配置员发布给 FDE」的平台技能，FDE 自建技能不在候选内。
const skillKeyword = ref('')
const skillCandidates = ref([])
const skillsLoading = ref(false)
let skillSearchTimer = null

// 兼容后端候选 id 字段命名（id / skillId），取到即为唯一键。
function candId(c) {
  return c?.id ?? c?.skillId
}

// 已选平台技能 id 集（去重 + 命中「已选」态）
const selectedSkillIdSet = computed(() => new Set(form.skillRefs.map((s) => s.platformSkillId)))

async function loadSkillCandidates() {
  skillsLoading.value = true
  try {
    const list = await listPlatformSkillCandidates(skillKeyword.value.trim() || undefined)
    skillCandidates.value = Array.isArray(list) ? list : []
  } catch (e) {
    /* 读接口全局已提示；平台技能非必填，不阻塞 */
  } finally {
    skillsLoading.value = false
  }
}

// 搜索防抖（对齐工具坞的克制交互，输入即搜）
function onSkillSearch() {
  if (skillSearchTimer) clearTimeout(skillSearchTimer)
  skillSearchTimer = setTimeout(loadSkillCandidates, 300)
}

function isSkillSelected(c) {
  return selectedSkillIdSet.value.has(candId(c))
}

// 候选行点击 → 切换选中（已选则移除，未选则加入）
function toggleSkill(c) {
  const id = candId(c)
  if (id == null) return
  clearError('skills')
  markDirty()
  if (selectedSkillIdSet.value.has(id)) {
    form.skillRefs = form.skillRefs.filter((s) => s.platformSkillId !== id)
  } else {
    form.skillRefs = [...form.skillRefs, { platformSkillId: id, name: c.name || '' }]
  }
}

// 从已选 chip 移除
function removeSkillRef(platformSkillId) {
  clearError('skills')
  markDirty()
  form.skillRefs = form.skillRefs.filter((s) => s.platformSkillId !== platformSkillId)
}

/* ============================ 调度预览（FDE 门，防抖） ============================ */
const previewSummary = ref('')
const previewTimes = ref([])
const previewLoading = ref(false)
const previewError = ref('')
let previewTimer = null

function clearError(key) {
  errors[key] = ''
}

function onScheduleChange() {
  markDirty()
  clearError('schedule')
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(doPreview, 400)
}

function scheduleReady(sc) {
  if (sc.scheduleType === 'ONCE') return !!sc.onceAt
  if (!sc.times || !sc.times.length || sc.times.some((t) => !t)) return false
  if (sc.scheduleType === 'WEEKLY') return (sc.daysOfWeek || []).length > 0
  if (sc.scheduleType === 'MONTHLY') return (sc.daysOfMonth || []).length > 0
  return true // DAILY
}

async function doPreview() {
  if (!scheduleReady(form.schedule)) {
    previewSummary.value = ''
    previewTimes.value = []
    previewError.value = ''
    return
  }
  if (props.positionId == null) return
  previewLoading.value = true
  previewError.value = ''
  try {
    const data = await previewSampleSchedule(props.positionId, {
      schedule: buildSchedule(),
      count: 3
    })
    previewSummary.value = data?.summary || ''
    previewTimes.value = data?.nextRunTimes || []
  } catch (e) {
    previewSummary.value = ''
    previewTimes.value = []
    previewError.value = e instanceof ApiError ? e.message : '调度计划有误，请检查'
  } finally {
    previewLoading.value = false
  }
}

/* ---- 组装提交用 Schedule（对齐 TaskEditor.buildSchedule） ---- */
function buildSchedule() {
  const sc = form.schedule
  const out = { scheduleType: sc.scheduleType }
  if (sc.scheduleType === 'ONCE') {
    out.onceAt = sc.onceAt
  } else {
    out.times = dedupeTimes(sc.times)
    if (sc.scheduleType === 'WEEKLY') out.daysOfWeek = sc.daysOfWeek
    if (sc.scheduleType === 'MONTHLY') out.daysOfMonth = sc.daysOfMonth
  }
  if (sc.startDate) out.startDate = sc.startDate
  if (sc.endDate) out.endDate = sc.endDate
  return out
}

function dedupeTimes(times) {
  return [...new Set((times || []).filter(Boolean))]
}

/* ---- 校验（对齐 TaskEditor.validate，定位到分区） ---- */
function validate() {
  let ok = true
  const name = form.name.trim()
  if (!name) {
    errors.name = '请填写任务名称'
    ok = false
  } else if (name.length > 60) {
    errors.name = '任务名称不超过 60 字'
    ok = false
  }

  // 一句话指令：样例默认启用（后端缺省 ENABLED），后端对 ENABLED 样例硬拦空 prompt（1003）→ 前端同口径必填，
  // 别只靠后端报错。字数上限与后端 @Size(max=2000) 对齐。
  const prompt = form.prompt.trim()
  if (!prompt) {
    errors.prompt = '请填写一句话指令（启用样例必填）'
    ok = false
  } else if (form.prompt.length > PROMPT_MAX) {
    errors.prompt = `一句话指令不超过 ${PROMPT_MAX} 字`
    ok = false
  }

  const sc = form.schedule
  if (sc.scheduleType === 'ONCE') {
    if (!sc.onceAt) {
      errors.schedule = '请选择执行时间'
      ok = false
    } else if (new Date(sc.onceAt).getTime() <= Date.now()) {
      errors.schedule = '这个时间已经过去了，请选个以后的时间'
      ok = false
    }
  } else {
    const times = dedupeTimes(sc.times)
    if (!times.length) {
      errors.schedule = '请至少添加一个定点时间'
      ok = false
    } else if (sc.scheduleType === 'WEEKLY' && !(sc.daysOfWeek || []).length) {
      errors.schedule = '请至少选择一个执行星期'
      ok = false
    } else if (sc.scheduleType === 'MONTHLY' && !(sc.daysOfMonth || []).length) {
      errors.schedule = '请至少选择一个执行日期'
      ok = false
    }
  }

  if (!form.sopDoc.trim()) {
    errors.sopDoc = '请填写详细说明（这件事要怎么办）'
    ok = false
  }
  return ok
}

function buildToolRefs() {
  return form.toolRefs.map((t) => ({
    type: t.type,
    code: t.code,
    bizName: bizNameMap.value.get(`${t.type}::${t.code}`) || t.bizName || undefined
  }))
}

// 提交用平台技能引用（只留后端契约字段 { platformSkillId, name }）
function buildSkillRefs() {
  return form.skillRefs.map((s) => ({
    platformSkillId: s.platformSkillId,
    name: s.name || undefined
  }))
}

function resetErrors() {
  errors.name = ''
  errors.prompt = ''
  errors.schedule = ''
  errors.sopDoc = ''
  errors.tools = ''
  errors.skills = ''
}

/* ---- 保存（显式，单按钮；对齐 TaskEditor.submit 但去启用/草稿双态） ---- */
async function save() {
  resetErrors()
  if (!validate()) {
    ElMessage.warning('请检查表单中标红的项')
    return
  }
  // 未选任何工具时给明确提醒（复用 TaskEditor 口径，确认才继续）
  if (!form.toolRefs.length) {
    try {
      await ElMessageBox.confirm(
        '你还没有选择任何工具，任务可能无法办成，确定继续吗？',
        '提示',
        { type: 'warning', confirmButtonText: '继续', cancelButtonText: '去选工具' }
      )
    } catch (e) {
      return
    }
  }
  const payload = {
    name: form.name.trim(),
    // 一句话指令：保留原文（含换行/[SILENT] 等语义），仅去首尾空白判空由 validate 兜住。
    prompt: form.prompt.trim(),
    remark: form.remark.trim() || undefined,
    schedule: buildSchedule(),
    sopDoc: form.sopDoc,
    toolRefs: buildToolRefs(),
    skillRefs: buildSkillRefs()
    // 无 enable / status：样例默认启用（后端缺省 ENABLED），列表不呈现运行态。
  }
  saving.value = true
  try {
    if (isEdit.value) {
      const vo = await updateSampleTask(props.positionId, props.sample.id, payload)
      ElMessage.success('样例已保存')
      clearDirty()
      emit('saved', vo)
    } else {
      const vo = await createSampleTask(props.positionId, payload)
      ElMessage.success('样例已创建')
      clearDirty()
      emit('created', vo)
    }
  } catch (e) {
    handleSubmitError(e)
  } finally {
    saving.value = false
  }
}

// 后端字段级错误回显（field 命中分区，对齐 TaskEditor.handleSubmitError）
function handleSubmitError(e) {
  if (e instanceof ApiError) {
    const field = e.field
    if (field === 'name') errors.name = e.message
    else if (field === 'prompt') errors.prompt = e.message
    else if (field === 'schedule') errors.schedule = e.message
    else if (field === 'sopDoc') errors.sopDoc = e.message
    else if (field === 'tools' || field === 'toolRefs') errors.tools = e.message
    else if (field === 'skills' || field === 'skillRefs') errors.skills = e.message
    else ElMessage.error(e.message || '保存失败，请检查后重试')
  } else {
    ElMessage.error('保存失败，请稍后重试')
  }
}

/* ============================ 回填 / 重置 ============================ */
function fillFrom(sample) {
  resetErrors()
  if (!sample) {
    form.name = ''
    form.prompt = ''
    form.remark = ''
    form.schedule = blankSchedule()
    form.sopDoc = ''
    form.toolRefs = []
    form.skillRefs = []
  } else {
    form.name = sample.name || ''
    // 详情回填 SampleTaskVO.prompt（后端出参）
    form.prompt = sample.prompt || ''
    form.remark = sample.remark || ''
    form.schedule = {
      scheduleType: sample.schedule?.scheduleType || 'DAILY',
      daysOfWeek: sample.schedule?.daysOfWeek || [],
      daysOfMonth: sample.schedule?.daysOfMonth || [],
      times: sample.schedule?.times?.length ? sample.schedule.times : ['09:00'],
      onceAt: sample.schedule?.onceAt || '',
      startDate: sample.schedule?.startDate || '',
      endDate: sample.schedule?.endDate || ''
    }
    form.sopDoc = sample.sopDoc || ''
    form.toolRefs = (sample.toolRefs || []).map((t) => ({
      type: t.type,
      code: t.code,
      bizName: t.bizName,
      requiresConfirmation: false
    }))
    // 平台技能引用回填（后端 SampleTaskVO.skillRefs: [{ platformSkillId, name }]）
    form.skillRefs = (sample.skillRefs || [])
      .map((s) => ({
        platformSkillId: s.platformSkillId ?? s.id ?? s.skillId,
        name: s.name || ''
      }))
      .filter((s) => s.platformSkillId != null)
  }
  clearDirty()
  previewSummary.value = ''
  previewTimes.value = []
  previewError.value = ''
  doPreview()
}

// 切换条目（父组件已做脏检查）→ 重新回填
watch(
  () => props.sample,
  (s) => fillFrom(s)
)

onMounted(async () => {
  await Promise.all([loadTools(), loadSkillCandidates()])
  fillFrom(props.sample)
})
</script>

<template>
  <div class="ste-body">
    <div class="ste-scroll">
      <!-- 分区 1：基本信息 -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 基本信息
        </div>
        <div class="te-field">
          <label class="te-label">任务名称 <span class="req">*</span></label>
          <el-input
            v-model="form.name"
            maxlength="60"
            show-word-limit
            placeholder="给样例起个名字，如「每日工单汇总」"
            :class="{ 'is-err': errors.name }"
            @input="markDirty(); clearError('name')"
          />
          <p v-if="errors.name" class="te-err">{{ errors.name }}</p>
        </div>
        <div class="te-field">
          <label class="te-label">一句话指令 <span class="req">*</span></label>
          <el-input
            v-model="form.prompt"
            type="textarea"
            :rows="3"
            :maxlength="PROMPT_MAX"
            show-word-limit
            placeholder="到点让搭子做什么，自包含大白话，可含 [SILENT] 降噪（无实质变化只输出不打扰）"
            :class="{ 'is-err': errors.prompt }"
            @input="markDirty(); clearError('prompt')"
          />
          <p class="te-field-hint">启用样例必填：这句话就是到点触发搭子办事的指令。</p>
          <p v-if="errors.prompt" class="te-err">{{ errors.prompt }}</p>
        </div>
        <div class="te-field">
          <label class="te-label">说明（备注）</label>
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="这条样例帮领用者做什么、适合谁用（可不填）"
            @input="markDirty"
          />
        </div>
      </section>

      <!-- 分区 2：调度计划 -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 调度计划
        </div>
        <SchedulePicker
          v-model:schedule="form.schedule"
          :error="errors.schedule"
          :preview-summary="previewSummary"
          :preview-times="previewTimes"
          :preview-loading="previewLoading"
          :preview-error="previewError"
          @preview="onScheduleChange"
        />
      </section>

      <!-- 分区 3：详细说明 -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 详细说明 <span class="req">*</span>
        </div>
        <p class="te-card-hint">
          用自然语言写清这件事要怎么办：目标是什么、分哪几步、用到哪些工具、产出什么结果。
        </p>
        <MarkdownEditor
          v-model="form.sopDoc"
          :error="errors.sopDoc"
          height="320px"
          placeholder="例如：每天上班前，用「工单查询工具」拉取昨日工单，汇总成今日待办清单。"
          @update:model-value="markDirty(); clearError('sopDoc')"
        />
      </section>

      <!-- 分区 4：引用工具 -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 引用工具
        </div>
        <p class="te-card-hint">勾选这条样例要用到的工具；不选工具，多半办不成事。</p>
        <ToolPicker
          v-model:selected="form.toolRefs"
          :available="available"
          :loading="toolsLoading"
          :error="errors.tools"
          :show-confirm="false"
          @update:selected="markDirty"
        />
      </section>

      <!-- 分区 5：引用平台技能 -->
      <section class="te-card">
        <div class="te-card-title">
          <span class="te-card-dot"></span> 引用平台技能
        </div>
        <p class="te-card-hint">
          引用<b>平台技能</b>（由系统配置员发布），让这条样例复用现成能力；你自建的 FDE 技能不在此列。
        </p>

        <!-- 已选平台技能 chips（名称 + 可移除） -->
        <div v-if="form.skillRefs.length" class="sk-chips">
          <span v-for="s in form.skillRefs" :key="s.platformSkillId" class="sk-chip">
            <span class="sk-chip-name">{{ s.name || `技能 #${s.platformSkillId}` }}</span>
            <button
              type="button"
              class="sk-chip-x"
              title="移除"
              aria-label="移除"
              @click="removeSkillRef(s.platformSkillId)"
            >✕</button>
          </span>
        </div>

        <el-input
          v-model="skillKeyword"
          placeholder="搜索平台技能名 / 描述"
          clearable
          class="sk-search"
          @input="onSkillSearch"
          @keyup.enter="loadSkillCandidates"
          @clear="loadSkillCandidates"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>

        <div v-loading="skillsLoading" class="sk-list">
          <div v-if="!skillsLoading && !skillCandidates.length" class="sk-empty">
            <template v-if="skillKeyword.trim()">
              没有匹配「{{ skillKeyword.trim() }}」的平台技能。
            </template>
            <template v-else>
              没有可引用的平台技能（仅展示系统配置员发布给 FDE 的平台技能）。
            </template>
          </div>
          <div
            v-for="c in skillCandidates"
            :key="candId(c)"
            class="sk-row"
            :class="{ on: isSkillSelected(c) }"
            @click="toggleSkill(c)"
          >
            <el-checkbox
              :model-value="isSkillSelected(c)"
              class="sk-check"
              @click.stop="toggleSkill(c)"
            />
            <div class="sk-main">
              <div class="sk-name-line">
                <span class="sk-name">{{ c.name }}</span>
                <el-tooltip
                  v-if="hasCategory(c.category)"
                  :content="categoryLabel(c.category)"
                  placement="top"
                >
                  <StatusTag :type="categoryTagType(c.category)" class="sk-cat">
                    {{ categoryLabel(c.category) }}
                  </StatusTag>
                </el-tooltip>
                <code v-if="c.code" class="sk-code">{{ c.code }}</code>
              </div>
              <div v-if="c.description" class="sk-desc" :title="c.description">{{ c.description }}</div>
            </div>
          </div>
        </div>
        <p v-if="errors.skills" class="te-err">{{ errors.skills }}</p>
      </section>
    </div>

    <!-- 底部 sticky 操作条（复刻数据底座 .meta-actions；单一保存，无启用/草稿双态） -->
    <div class="meta-actions">
      <el-button type="primary" :loading="saving" @click="save">
        {{ isEdit ? '保存' : '创建样例' }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.ste-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.ste-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 分区卡（逐视觉复用 TaskEditor .te-card） */
.te-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: var(--space-5);
}
.te-card-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-4);
}
.te-card-dot {
  width: 6px;
  height: 16px;
  border-radius: var(--radius-pill);
  background: var(--c-accent);
}
.te-card-hint {
  margin: calc(-1 * var(--space-2)) 0 var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.te-field {
  margin-bottom: var(--space-4);
}
.te-field:last-child {
  margin-bottom: 0;
}
.te-label {
  display: block;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
}
.req {
  color: var(--c-danger);
}
.te-err {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
/* 字段内联提示（一句话指令的发布必填说明），沿用 .te-card-hint 视觉、muted 中性色 */
.te-field-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.is-err :deep(.el-input__wrapper),
.is-err :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}

.te-card-hint b {
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
}

/* ── 引用平台技能：已选 chips ── */
.sk-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.sk-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-1) 2px var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--c-accent-soft);
  color: var(--c-accent);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  max-width: 100%;
}
.sk-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sk-chip-x {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--c-accent);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
}
.sk-chip-x:hover {
  background: var(--c-accent);
  color: var(--bg-surface);
}

/* ── 引用平台技能：搜索 + 候选列表（对齐 PlatformSkillRefPicker 视觉） ── */
.sk-search {
  width: 100%;
  margin-bottom: var(--space-2);
}
.sk-list {
  min-height: 120px;
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
.sk-empty {
  padding: var(--space-6);
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
}
.sk-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.sk-row:last-child {
  border-bottom: none;
}
.sk-row:hover {
  background: var(--bg-hover);
}
.sk-row.on {
  background: var(--bg-selected);
}
.sk-check {
  flex-shrink: 0;
  pointer-events: none;
}
.sk-main {
  flex: 1;
  min-width: 0;
}
.sk-name-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.sk-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sk-cat {
  flex-shrink: 0;
  cursor: default;
}
.sk-code {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-accent);
}
.sk-desc {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 底部 sticky 操作条（复刻数据底座 .meta-actions） */
.meta-actions {
  flex-shrink: 0;
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border-soft);
  background: var(--bg-sunken);
}
</style>
