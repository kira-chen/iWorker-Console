<script setup>
/**
 * 岗位「样例定时任务」两栏聚焦弹窗（交互规格 §1.3 / §2 / §3 / §4）。
 *
 * 与「数据底座 / 效果测试」并列的第三个岗位级 .focus-stage 聚焦弹窗，整体复刻 PositionDataTableStage 骨架：
 *   zoomIn 入场 + .ed-crumb 面包屑顶栏（↩ 返回总览 / ✕）+ 左列表 + 右编辑 master/detail + 脏检查关闭。
 *
 * 左栏（master）：样例条目（拖拽手柄 ⠿ + 名称 + 副行「周期人话摘要 · 引用 N 工具」+ hover 编辑/测试/删除）；
 *   末尾「＋ 新增样例任务」（软上限 20 满额置灰 + warning）；空态 / loading / error 四态。
 *   拖拽排序：native HTML5 draggable（对齐 AgentLane / SkillCard，本项目未装 vuedraggable，按现实用原生拖拽）
 *   + 即时持久化（乐观更新，失败回滚重拉）。列表不显示任何运行态。
 * 右栏（detail）：内嵌 SampleTaskEditor（新建 / 编辑，显式保存 + 脏检查）；未选 → 居中占位。
 *
 * 测试（§4 收口）：条目「测试」→ POST test-run（headless runOnce）→ 轻量结果面板展示 AttemptResult
 *   （success/summary + 可展开步骤，步骤复用 ReActSteps）。不复用对话式 EffectTestStage。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listSampleTasks,
  reorderSampleTasks,
  deleteSampleTask,
  testRunSampleTask
} from '@/api/sampleTask'
import { LIMITS } from '@/utils/positionModel'
import { EFFECT_TEST_ENABLED } from '@/utils/featureFlags'
import SampleTaskEditor from './SampleTaskEditor.vue'
import ReActSteps from '@/components/ReActSteps.vue'

const props = defineProps({
  positionId: { type: [Number, String], default: null },
  positionName: { type: String, default: '岗位' },
  // Tab 内联模式：隐藏面包屑/返回；功能逻辑不变
  embedded: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'saved', 'update:sampleCount'])

/* ============================ ① 列表（master） ============================ */
const listLoading = ref(false)
const listError = ref(false)
const items = ref([])

const atLimit = computed(() => items.value.length >= LIMITS.SAMPLE_TASK_MAX)

async function loadList() {
  if (props.positionId == null) {
    items.value = []
    emit('update:sampleCount', 0)
    return
  }
  listLoading.value = true
  listError.value = false
  try {
    const data = await listSampleTasks(props.positionId)
    items.value = data?.list || []
    emit('update:sampleCount', items.value.length)
  } catch (e) {
    listError.value = true
  } finally {
    listLoading.value = false
  }
}

onMounted(loadList)

// 缺「一句话指令」标记：样例默认启用（ENABLED），发布时后端硬拦空 prompt（1003）。
// 前端在列表侧提前给可感知提示（红点 tag），让 FDE 发布前就能看出哪条样例还没填指令、需补齐。
function missingPrompt(it) {
  return !String(it?.prompt || '').trim()
}

// 副行：周期人话摘要 · 引用 N 个工具（无工具显「未引用工具」）· 引用 M 平台技能（有才显）
function subLine(it) {
  const n = (it.toolRefs || []).length
  const tool = n > 0 ? `引用 ${n} 个工具` : '未引用工具'
  const sched = it.scheduleSummary || '未设置周期'
  const m = (it.skillRefs || []).length
  const skill = m > 0 ? ` · 引用 ${m} 平台技能` : ''
  return `${sched} · ${tool}${skill}`
}

/* ============================ ② 选中态（detail） ============================ */
// selectedId：null = 未选（占位）；'__new__' = 新建态；id = 编辑该样例
const NEW = '__new__'
const selectedId = ref(null)
const hasSelection = computed(() => selectedId.value != null)
const isNew = computed(() => selectedId.value === NEW)
const selectedSample = computed(() =>
  isNew.value ? null : items.value.find((i) => i.id === selectedId.value) || null
)

// 编辑器脏态（SampleTaskEditor 通过 dirty-change 上报）
const editorDirty = ref(false)
function onEditorDirty(v) {
  editorDirty.value = v
}

async function confirmDiscardIfDirty() {
  if (!editorDirty.value) return true
  try {
    await ElMessageBox.confirm('有未保存的修改，切换将丢弃。继续？', '切换样例', {
      type: 'warning',
      confirmButtonText: '丢弃并切换',
      cancelButtonText: '继续编辑'
    })
    return true
  } catch {
    return false
  }
}

async function selectItem(it) {
  if (selectedId.value === it.id) return
  if (!(await confirmDiscardIfDirty())) return
  selectedId.value = it.id
  editorDirty.value = false
}

async function startCreate() {
  if (props.positionId == null) {
    ElMessage.warning('请先保存岗位')
    return
  }
  if (atLimit.value) {
    ElMessage.warning(`样例任务建议不超过 ${LIMITS.SAMPLE_TASK_MAX} 条，把最推荐的放前面`)
    return
  }
  if (selectedId.value === NEW) return
  if (!(await confirmDiscardIfDirty())) return
  selectedId.value = NEW
  editorDirty.value = false
}

function clearSelection() {
  selectedId.value = null
  editorDirty.value = false
}

/* ---- 编辑器保存回调 ---- */
// 消费后端 create/save 返回的 SampleTaskVO.warnings（如 sample_over_soft_limit / 工具健康度）：
// 非空时逐条 ElMessage.warning，复用站内 warning 展示口径（不阻断，仅提示）。
function showSaveWarnings(vo) {
  const list = Array.isArray(vo?.warnings) ? vo.warnings : []
  for (const w of list) {
    const msg = w?.message || (typeof w === 'string' ? w : '')
    if (msg) ElMessage.warning(msg)
  }
}
async function onSaved(vo) {
  showSaveWarnings(vo)
  await loadList()
  emit('saved')
}
async function onCreated(vo) {
  showSaveWarnings(vo)
  await loadList()
  emit('saved')
  // 新建成功 → 自动选中新条目切编辑态
  if (vo?.id) {
    selectedId.value = vo.id
  } else {
    clearSelection()
  }
  editorDirty.value = false
}

/* ============================ 删除（二次确认，软删口径） ============================ */
const delBusy = ref(null)
async function removeItem(it) {
  try {
    await ElMessageBox.confirm(
      `删除样例「${it.name}」？删除后随下次发布从客户端下载中移除，不可恢复。`,
      '删除样例任务',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  delBusy.value = it.id
  try {
    await deleteSampleTask(props.positionId, it.id)
    ElMessage.success('样例已删除')
    if (selectedId.value === it.id) clearSelection()
    await loadList()
    emit('saved')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    delBusy.value = null
  }
}

/* ============================ 拖拽排序（native HTML5 + 即时持久化 + 乐观回滚） ============================ */
const draggingIndex = ref(-1)
const dragOverIndex = ref(-1)

function onDragStart(e, index) {
  draggingIndex.value = index
  e.dataTransfer.effectAllowed = 'move'
  // Firefox 需要 setData 才能触发拖拽
  try {
    e.dataTransfer.setData('text/plain', String(index))
  } catch {
    /* 忽略 */
  }
}
function onDragOver(e, index) {
  if (draggingIndex.value < 0) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  dragOverIndex.value = index
}
function onDrop(e, index) {
  e.preventDefault()
  const from = draggingIndex.value
  const to = index
  resetDrag()
  if (from < 0 || from === to) return
  reorder(from, to)
}
function onDragEnd() {
  resetDrag()
}
function resetDrag() {
  draggingIndex.value = -1
  dragOverIndex.value = -1
}

async function reorder(from, to) {
  const prev = items.value.slice()
  const next = prev.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  items.value = next // 乐观更新
  try {
    await reorderSampleTasks(props.positionId, next.map((i) => i.id))
  } catch (e) {
    items.value = prev // 失败回滚
    ElMessage.error('调序保存失败')
  }
}

/* ============================ ③ 测试试跑（headless runOnce，轻量结果面板） ============================ */
const testPanel = reactive({
  open: false,
  loading: false,
  error: '',
  sampleId: null,
  sampleName: '',
  success: null,
  summary: '',
  failureReason: '',
  steps: []
})

async function testItem(it) {
  // 测试前若右栏在编辑该条目且脏，提示先保存（可选二次确认，不强制）
  if (editorDirty.value && selectedId.value === it.id) {
    try {
      await ElMessageBox.confirm(
        '当前样例有未保存的修改，测试用的是已保存的版本。要先关闭提示继续测试吗？',
        '测试提示',
        { type: 'info', confirmButtonText: '继续测试', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }
  testPanel.open = true
  testPanel.loading = true
  testPanel.error = ''
  testPanel.sampleId = it.id
  testPanel.sampleName = it.name
  testPanel.success = null
  testPanel.summary = ''
  testPanel.failureReason = ''
  testPanel.steps = []
  try {
    const r = await testRunSampleTask(props.positionId, it.id)
    testPanel.success = r?.success ?? null
    testPanel.summary = r?.resultSummary || r?.summary || ''
    testPanel.failureReason = r?.failureReason || ''
    testPanel.steps = normalizeSteps(r?.steps)
  } catch (e) {
    testPanel.error = e?.message || '测试失败，请稍后重试'
  } finally {
    testPanel.loading = false
  }
}

// AttemptResult.steps → ReActSteps step 结构（尽量透传，缺 status 兜底 success）
function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((s, i) => ({
    no: s.no ?? i + 1,
    type: s.type || 'OBSERVATION',
    bizName: s.bizName || '',
    status: s.status || 'success',
    latencyMs: s.latencyMs ?? null,
    observationBrief: s.observationBrief || s.observation || '',
    toolCode: s.toolCode,
    simulated: s.simulated,
    simulatedTool: s.simulatedTool
  }))
}

function closeTestPanel() {
  testPanel.open = false
}
function retryTest() {
  const it = items.value.find((i) => i.id === testPanel.sampleId)
  if (it) testItem(it)
}

/* ============================ 顶栏关闭（脏检查） ============================ */
async function requestClose() {
  if (editorDirty.value) {
    try {
      await ElMessageBox.confirm('有未保存的修改，确定关闭？', '关闭样例任务', {
        type: 'warning',
        confirmButtonText: '确定关闭',
        cancelButtonText: '继续编辑'
      })
    } catch {
      return
    }
  }
  emit('close')
}
</script>

<template>
  <div class="st-editor">
    <!-- 顶栏面包屑（复刻 .ed-crumb）；Tab 内联模式隐藏 -->
    <div v-if="!embedded" class="ed-crumb">
      <span class="crumb-link" @click="requestClose">⏰ {{ positionName }}</span>
      <span class="crumb-sep">/</span>
      <span class="crumb-cur">样例定时任务</span>
      <span class="crumb-sp"></span>
      <span class="ed-close" @click="requestClose">↩ 返回总览</span>
      <button type="button" class="crumb-x" title="关闭" aria-label="关闭" @click="requestClose">✕</button>
    </div>

    <!-- 两栏体 -->
    <div class="st-body">
      <!-- ① 列表（master） -->
      <aside class="st-col-list" v-loading="listLoading">
        <div v-if="listError" class="list-error">
          <span>样例加载失败</span>
          <el-button link type="primary" @click="loadList">重试</el-button>
        </div>

        <template v-else>
          <!-- 软上限提示（>0 条时才提，克制） -->
          <div v-if="atLimit" class="st-limit-tip">
            样例任务建议不超过 {{ LIMITS.SAMPLE_TASK_MAX }} 条，把最推荐的放前面
          </div>

          <div
            v-for="(it, idx) in items"
            :key="it.id"
            class="st-item"
            :class="{
              on: selectedId === it.id,
              'st-drag-over': dragOverIndex === idx,
              'st-drag-over-below': dragOverIndex === idx && draggingIndex >= 0 && draggingIndex < idx,
              'st-dragging': draggingIndex === idx
            }"
            draggable="true"
            @click="selectItem(it)"
            @dragstart="onDragStart($event, idx)"
            @dragover="onDragOver($event, idx)"
            @drop="onDrop($event, idx)"
            @dragend="onDragEnd"
          >
            <span class="st-drag" title="拖动排序">⠿</span>
            <div class="st-main">
              <div class="st-name">
                {{ it.name }}
                <el-tooltip
                  v-if="missingPrompt(it)"
                  content="还没填「一句话指令」，发布时会被拦下，请先补齐"
                  placement="top"
                >
                  <span class="st-flag">缺指令</span>
                </el-tooltip>
              </div>
              <div class="st-sub">{{ subLine(it) }}</div>
            </div>
            <div class="st-ops">
              <el-button link size="small" @click.stop="selectItem(it)">编辑</el-button>
              <!-- 执行链路未就绪，仿真试跑入口统一由 EFFECT_TEST_ENABLED 隐藏（utils/featureFlags.js） -->
              <el-button
                v-if="EFFECT_TEST_ENABLED"
                link
                size="small"
                :loading="testPanel.loading && testPanel.sampleId === it.id"
                :disabled="testPanel.loading"
                title="仿真试跑（不产生真实副作用，会消耗模型额度）"
                @click.stop="testItem(it)"
              >测试</el-button>
              <el-button
                link
                type="danger"
                size="small"
                :loading="delBusy === it.id"
                @click.stop="removeItem(it)"
              >删除</el-button>
            </div>
          </div>

          <!-- 新建态临时高亮行（未落库不可排序 → 不渲染排序手柄，与「手柄克制隐藏」一致） -->
          <div v-if="selectedId === NEW" class="st-item on st-creating">
            <div class="st-main">
              <div class="st-name">新增中…</div>
              <div class="st-sub">填写右侧信息后创建</div>
            </div>
          </div>

          <!-- ＋ 新增样例任务（虚线，软上限满额置灰） -->
          <div
            class="st-new"
            :class="{ disabled: atLimit || selectedId === NEW }"
            @click="startCreate"
          >
            <template v-if="atLimit">已达 {{ LIMITS.SAMPLE_TASK_MAX }} 条样例上限</template>
            <template v-else>＋ 新增样例任务</template>
          </div>
        </template>
      </aside>

      <!-- ② 未选：占位（空态 / 引导） -->
      <div v-if="!hasSelection" class="st-placeholder">
        <div class="ph-icon">⏰</div>
        <div class="ph-title">
          {{ items.length ? '从左侧选一条样例' : '还没有样例定时任务' }}
        </div>
        <div class="ph-sub">
          {{ items.length ? '或 ＋ 新增样例任务' : '加一条帮领用者快速上手（会随岗位发布，供客户端下载展示）' }}
        </div>
      </div>

      <!-- ② 编辑区（detail） -->
      <section v-else class="st-col-edit">
        <SampleTaskEditor
          :key="selectedId"
          :position-id="positionId"
          :sample="selectedSample"
          @dirty-change="onEditorDirty"
          @saved="onSaved"
          @created="onCreated"
        />
      </section>
    </div>

    <!-- ③ 测试试跑结果面板（轻量抽屉，不复用对话式测试台） -->
    <el-drawer
      v-model="testPanel.open"
      :title="`测试样例「${testPanel.sampleName}」`"
      direction="rtl"
      size="480px"
      append-to-body
    >
      <!-- 顶部轻量提示：仿真试跑（不产生真实副作用）+ 消耗模型额度 -->
      <div class="tr-note">
        仿真试跑：走沙箱、不产生真实副作用，会消耗模型额度。
      </div>

      <div v-if="testPanel.loading" class="tr-loading" v-loading="true" element-loading-text="测试运行中…">
        <div class="tr-loading-ph"></div>
      </div>
      <div v-else-if="testPanel.error" class="tr-error">
        <el-empty :description="testPanel.error">
          <el-button type="primary" :loading="testPanel.loading" @click="retryTest">重试</el-button>
        </el-empty>
      </div>
      <div v-else class="tr-result">
        <div
          class="tr-verdict"
          :class="testPanel.success ? 'tr-ok' : 'tr-bad'"
        >
          {{ testPanel.success ? '✓ 试跑成功' : '✕ 试跑未成功' }}
        </div>
        <div v-if="testPanel.summary" class="tr-summary">{{ testPanel.summary }}</div>
        <div v-if="!testPanel.success && testPanel.failureReason" class="tr-fail">
          {{ testPanel.failureReason }}
        </div>

        <!-- 步骤复用 ReActSteps（默认展开，便于 FDE 看链路） -->
        <ReActSteps
          v-if="testPanel.steps.length"
          :steps="testPanel.steps"
          :default-open="true"
        />
        <el-empty v-else description="本次试跑无步骤记录" :image-size="56" />

        <div class="tr-foot">
          <el-button :loading="testPanel.loading" :disabled="testPanel.loading" @click="retryTest">再跑一次</el-button>
          <el-button type="primary" @click="closeTestPanel">关闭</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
/* ── 根：复刻数据底座 .dt-editor（zoomIn 入场，像素级一致） ── */
.st-editor {
  width: 100%;
  max-width: min(96vw, 1440px);
  margin: 0 auto;
  height: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: stsZoomIn var(--dur-slow) var(--ease-out) both;
}
@keyframes stsZoomIn {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(14px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* ── 顶栏面包屑（复刻 .ed-crumb） ── */
.ed-crumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-sunken);
  flex-wrap: wrap;
}
.crumb-link {
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: var(--fs-sm);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.crumb-link:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.crumb-sep {
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
}
.crumb-cur {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.crumb-sp {
  flex: 1;
}
.ed-close {
  cursor: pointer;
  color: var(--c-text-muted);
  padding: 4px 10px;
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  border: 1px solid var(--border-base);
  background: var(--bg-surface);
}
.ed-close:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.crumb-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
}
.crumb-x:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}

/* ── 两栏体 ── */
.st-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
}

/* ① 列表栏 */
.st-col-list {
  border-right: 1px solid var(--border-soft);
  background: var(--bg-surface);
  padding: var(--space-3);
  overflow: auto;
}
.list-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  padding: var(--space-2);
}
.st-limit-tip {
  font-size: var(--fs-xs);
  color: var(--c-warning);
  background: var(--c-warning-soft);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-2);
  line-height: 1.5;
}

/* 单条样例条目（复刻数据底座 .lt-item + 拖拽手柄） */
.st-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  position: relative;
  border-left: 2px solid transparent;
  transition: background var(--dur-fast) var(--ease-out);
}
.st-item:hover {
  background: var(--bg-hover);
}
.st-item.on {
  background: var(--bg-selected);
  border-left-color: var(--c-accent);
}
.st-item.st-creating {
  cursor: default;
  font-style: italic;
}
.st-item.st-dragging {
  background: var(--bg-active);
  opacity: 0.6;
}
/* 落点指示：向上拖（from>to）画在目标行顶部；向下拖（from<to）画在目标行底部——语义直观 */
.st-item.st-drag-over {
  box-shadow: inset 0 2px 0 var(--c-accent);
}
.st-item.st-drag-over.st-drag-over-below {
  box-shadow: inset 0 -2px 0 var(--c-accent);
}
.st-drag {
  flex-shrink: 0;
  color: var(--c-text-faint);
  cursor: grab;
  opacity: 0;
  font-size: var(--fs-sm);
  transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.st-item:hover .st-drag {
  opacity: 1;
}
.st-drag:hover {
  color: var(--c-text-muted);
}
.st-drag:active {
  cursor: grabbing;
}
.st-main {
  flex: 1;
  min-width: 0;
}
.st-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 缺「一句话指令」发布前提示标（走 warning 弱底，克制不刺眼） */
.st-flag {
  display: inline-block;
  margin-left: var(--space-1);
  padding: 0 6px;
  font-size: var(--fs-xs);
  font-weight: var(--fw-regular);
  color: var(--c-warning);
  background: var(--c-warning-soft);
  border-radius: var(--radius-sm);
  vertical-align: middle;
  cursor: help;
}
/* hover 行内浮出操作 */
.st-ops {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.st-item:hover .st-ops,
.st-item.on .st-ops {
  opacity: 1;
}

.st-new {
  margin-top: var(--space-3);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-3);
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}
.st-new:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
.st-new.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.st-new.disabled:hover {
  border-color: var(--border-strong);
  color: var(--c-text-muted);
  background: transparent;
}

/* ② 占位 */
.st-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--c-text-muted);
  padding: var(--space-10);
  text-align: center;
}
.ph-icon {
  font-size: 40px;
  opacity: 0.6;
}
.ph-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--c-text);
}
.ph-sub {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  max-width: 320px;
  line-height: 1.6;
}

/* ② 编辑区栏 */
.st-col-edit {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* ── 测试结果面板 ── */
/* 顶部仿真/成本提示条（克制，走 warning 弱底） */
.tr-note {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  line-height: 1.5;
}
.tr-loading {
  position: relative;
  padding: var(--space-2);
  min-height: 160px;
}
.tr-loading-ph {
  min-height: 140px;
}
.tr-error {
  padding: var(--space-6) 0;
}
.tr-result {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.tr-verdict {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}
.tr-ok {
  color: var(--c-success);
  background: var(--c-success-soft);
}
.tr-bad {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.tr-summary {
  font-size: var(--fs-sm);
  color: var(--c-text);
  line-height: 1.6;
  white-space: pre-wrap;
}
.tr-fail {
  font-size: var(--fs-sm);
  color: var(--c-danger);
  line-height: 1.6;
}
.tr-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

/* ── 窄屏降级（≤900px 单列，复刻数据底座） ── */
@media (max-width: 900px) {
  .st-body {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .st-col-list {
    border-right: none;
    border-bottom: 1px solid var(--border-soft);
    max-height: 220px;
  }
  .st-col-edit {
    overflow: visible;
    max-height: none;
  }
}
</style>
