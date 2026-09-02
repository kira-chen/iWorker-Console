<script setup>
/**
 * 新建 / 编辑定时任务（PRD §4，独立页便于容纳长 SOP 正文）。
 *
 * 4 分区：基本信息 / 调度计划（SchedulePicker）/ 详细说明（MarkdownEditor）/ 引用工具（ToolPicker）。
 * 路由：/tasks/new（创建）、/tasks/:id/edit（编辑，回填详情）。
 *
 * 字段映射（契约 §1）：提交 toolRefs 仅回传 {type, code, bizName} 三元组，丢弃 requiresConfirmation。
 * 时间口径：schedule 内部为本地墙钟，不拼时区（SchedulePicker 已保证）。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createTask, updateTask, getTask, listAvailableTools, previewSchedule } from '@/api/task'
import { ApiError } from '@/api/request'
import SchedulePicker from '@/components/task/SchedulePicker.vue'
import ToolPicker from '@/components/admin/ToolPicker.vue'
import MarkdownEditor from '@/components/admin/MarkdownEditor.vue'
import PageHeader from '@/components/PageHeader.vue'

const route = useRoute()
const router = useRouter()

const taskId = computed(() => route.params.id || null)
const isEdit = computed(() => !!taskId.value)

// ---- 表单模型 ----
const form = reactive({
  name: '',
  remark: '',
  schedule: {
    scheduleType: 'DAILY',
    daysOfWeek: [],
    daysOfMonth: [],
    times: ['09:00'],
    onceAt: '',
    startDate: '',
    endDate: ''
  },
  sopDoc: '',
  toolRefs: [] // ToolPicker selected: { type, code, requiresConfirmation }
})

// 字段级错误（后端 data.field 命中 / 前端校验）
const errors = reactive({ name: '', schedule: '', sopDoc: '', tools: '' })

const loading = ref(false) // 编辑回填 loading
const submitting = ref(false)
const dirty = ref(false)

function markDirty() {
  dirty.value = true
}

// ---- 工具清单 ----
const available = ref({ mock: [], mcp: [], api: [] })
const toolsLoading = ref(false)

async function loadTools() {
  toolsLoading.value = true
  try {
    available.value = await listAvailableTools()
  } catch (e) {
    /* 拦截器已提示；工具非必填，不阻塞 */
  } finally {
    toolsLoading.value = false
  }
}

// 工具清单按 (type,code) → bizName 映射，提交时补全 bizName
const bizNameMap = computed(() => {
  const m = new Map()
  for (const g of ['mock', 'mcp', 'api']) {
    for (const t of available.value?.[g] || []) {
      m.set(`${t.type}::${t.code}`, t.bizName || t.code)
    }
  }
  return m
})

// ---- 调度预览（SchedulePicker 触发 preview 事件后防抖调用） ----
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

// 仅在调度看起来「填齐」时才预览，避免无谓 400
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
  previewLoading.value = true
  previewError.value = ''
  try {
    const data = await previewSchedule({ schedule: buildSchedule(), count: 3 })
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

// 组装提交用 Schedule：按类型只带相关字段，避免冗余
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

// ---- 前端校验（定位到分区） ----
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

  const sc = form.schedule
  if (sc.scheduleType === 'ONCE') {
    if (!sc.onceAt) {
      errors.schedule = '请选择执行时间'
      ok = false
    }
    // 注意：此处 new Date(onceAt) 按浏览器本地时区解释，而后端调度固定 Asia/Shanghai。
    // 故这只是前端「未来时刻」的粗筛（拦明显已过的时间，提升体验），最终以后端校验为准。
    else if (new Date(sc.onceAt).getTime() <= Date.now()) {
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

// toolRefs 字段映射：丢 requiresConfirmation，补 bizName
function buildToolRefs() {
  return form.toolRefs.map((t) => ({
    type: t.type,
    code: t.code,
    bizName: bizNameMap.value.get(`${t.type}::${t.code}`) || t.bizName || undefined
  }))
}

function resetErrors() {
  errors.name = ''
  errors.schedule = ''
  errors.sopDoc = ''
  errors.tools = ''
}

async function submit(enable) {
  resetErrors()
  if (!validate()) {
    ElMessage.warning('请检查表单中标红的项')
    return
  }
  // 未选任何工具时给明确提醒（不硬性拦死，确认才继续）
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
    remark: form.remark.trim() || undefined,
    schedule: buildSchedule(),
    sopDoc: form.sopDoc,
    toolRefs: buildToolRefs(),
    enable
  }
  submitting.value = true
  try {
    if (isEdit.value) {
      await updateTask(taskId.value, payload)
      ElMessage.success('任务已保存')
    } else {
      await createTask(payload)
      ElMessage.success(enable ? '任务已创建并启用' : '草稿已保存')
    }
    dirty.value = false
    router.push({ name: 'Tasks' })
  } catch (e) {
    handleSubmitError(e)
  } finally {
    submitting.value = false
  }
}

// 后端字段级错误回显（契约 §0.3.1 field 命中分区）
function handleSubmitError(e) {
  if (e instanceof ApiError) {
    const field = e.field
    if (field === 'name') errors.name = e.message
    else if (field === 'schedule') errors.schedule = e.message
    else if (field === 'sopDoc') errors.sopDoc = e.message
    else if (field === 'tools' || field === 'toolRefs') errors.tools = e.message
    else ElMessage.error(e.message || '提交失败，请检查后重试')
  } else {
    ElMessage.error('提交失败，请稍后重试')
  }
}

async function onCancel() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('放弃未保存的内容？', '提示', {
        type: 'warning',
        confirmButtonText: '放弃',
        cancelButtonText: '继续编辑'
      })
    } catch (e) {
      return
    }
  }
  router.push({ name: 'Tasks' })
}

// 离开守卫：有未保存改动时拦截
onBeforeRouteLeave(async (to, from, next) => {
  if (!dirty.value) return next()
  try {
    await ElMessageBox.confirm('放弃未保存的内容？', '提示', {
      type: 'warning',
      confirmButtonText: '放弃',
      cancelButtonText: '继续编辑'
    })
    next()
  } catch (e) {
    next(false)
  }
})

// ---- 编辑回填 ----
async function loadForEdit() {
  loading.value = true
  try {
    const d = await getTask(taskId.value)
    form.name = d.name || ''
    form.remark = d.remark || ''
    form.sopDoc = d.sopDoc || ''
    // schedule 回填，补齐缺省数组字段防止 picker 取 undefined
    form.schedule = {
      scheduleType: d.schedule?.scheduleType || 'DAILY',
      daysOfWeek: d.schedule?.daysOfWeek || [],
      // S6：过滤已下线的「月末 LAST」及其它非 1..31 的存量游离值，避免 picker 出现无匹配 tag
      daysOfMonth: (d.schedule?.daysOfMonth || []).filter((x) => {
        const n = Number(x)
        return Number.isInteger(n) && n >= 1 && n <= 31
      }),
      times: d.schedule?.times?.length ? d.schedule.times : ['09:00'],
      onceAt: d.schedule?.onceAt || '',
      startDate: d.schedule?.startDate || '',
      endDate: d.schedule?.endDate || ''
    }
    // toolRefs → ToolPicker selected 结构（补 requiresConfirmation 占位 false）
    form.toolRefs = (d.toolRefs || []).map((t) => ({
      type: t.type,
      code: t.code,
      bizName: t.bizName,
      requiresConfirmation: false
    }))
    doPreview()
  } catch (e) {
    ElMessage.error('任务加载失败')
    router.push({ name: 'Tasks' })
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadTools()
  if (isEdit.value) await loadForEdit()
  else doPreview()
})
</script>

<template>
  <div class="te-page">
    <div class="te-back-row">
      <el-button link class="te-back" @click="onCancel">
        <el-icon><ArrowLeft /></el-icon> 返回
      </el-button>
    </div>
    <PageHeader :title="isEdit ? '编辑任务' : '新建定时任务'" />

    <div v-if="loading" class="te-loading">
      <el-skeleton :rows="8" animated />
    </div>

    <div v-else class="te-body">
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
            placeholder="给任务起个名字，如「每日工单汇总」"
            :class="{ 'is-err': errors.name }"
            @input="markDirty(); clearError('name')"
          />
          <p v-if="errors.name" class="te-err">{{ errors.name }}</p>
        </div>
        <div class="te-field">
          <label class="te-label">任务描述（备注）</label>
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="给自己看的备注，可不填"
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
        <p class="te-card-hint">勾选这个任务要用到的工具；不选工具，多半办不成事。</p>
        <ToolPicker
          v-model:selected="form.toolRefs"
          :available="available"
          :loading="toolsLoading"
          :error="errors.tools"
          :show-confirm="false"
          friendly
          @update:selected="markDirty"
        />
      </section>

      <!-- 底部操作 -->
      <footer class="te-foot">
        <el-button @click="onCancel">取消</el-button>
        <span v-if="!isEdit" class="te-draft-wrap">
          <el-button
            :loading="submitting"
            @click="submit(false)"
          >保存为草稿</el-button>
          <span class="te-draft-hint">先存着、暂不自动执行</span>
        </span>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submit(true)"
        >{{ isEdit ? '保存' : '创建并启用' }}</el-button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.te-page {
  max-width: 880px;
  margin: 0 auto;
}
.te-back-row {
  margin-bottom: var(--space-2);
}
.te-back {
  color: var(--c-text-muted);
}
.te-back:hover {
  color: var(--c-accent);
}
.te-loading {
  padding: var(--space-6);
}
.te-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
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
.is-err :deep(.el-input__wrapper),
.is-err :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.te-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-2) 0 var(--space-6);
}
.te-draft-wrap {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.te-draft-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
