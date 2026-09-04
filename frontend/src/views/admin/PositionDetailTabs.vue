<script setup>
/**
 * 白板工作台（交互规格全篇 13 项决议）。
 *
 * 沉浸式编排页：顶部条 + 白板（总览态：身份卡 + Agent 泳道 + 技能卡）+ 数据底座弹窗。
 *
 * 技能编辑（设计 §5 改造）：点技能卡 / 新建技能 → 新标签打开整页编辑器（AdminSkillEdit），
 * 白板内不再有聚焦浮层（SkillFocusEditor 已退役）；回到白板标签（window focus）时轻量 refetch 同步。
 *
 * 保存（2026-08-28 负责人拍板：取消自动保存）：
 * - 一律手动：顶部「保存」显式提交并跑校验；「发布」前先保存一次再走发布检查；
 * - 脏检查：以最近一次 hydrate 的 basic 快照为基线，离开路由 / 关闭窗口时有未保存修改则提示。
 *
 * 2026-09-04 PRD-20260903 对齐改造：
 * - 页签调整为新 PRD 七页签序：人格 / 采集字段 / 工作档案 / 知识 / Agent 与技能 / 自动化任务 / 业务系统（新增）；
 *   其后保留 demo 既有扩展页签 运行 / 效果测试 / 版本（版本页签为 Q2 冻结项，走现有版本侧栏链路）。
 * - 人格页签重排为 md 三.2 六区块：岗位描述(500 必填) / 岗位图标 / 岗位认领说明 / 示例问题(3 条+AI 生成) /
 *   岗位 SOP(4000+AI 生成) / 岗位人格；原「领用页文案 / 推荐问题 4 条」editor 退役（文件保留）。
 * - 顶部栏对齐 md 三.1：名称 64 字 / 三态状态标签 / 版本号 / 未保存提示 / 保存 / 发布岗位；
 *   只读态（列表【查看】进入 query.view=1）与审核中隐藏保存与发布、全页签只读。
 * - 【发布岗位】仍走现有版本侧栏流程（冻结区）；新 PRD「发布前检查弹窗 + 7 项阻断校验」本轮不实现，
 *   仅保留轻量人格必填前置门（toast「请先填写：…」+ 自动切人格页签）。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { createPosition, publishPosition, getNextVersionLabel, listPositionPublications } from '@/api/position'
import { useVersionPublish } from '@/composables/useVersionPublish'
import { listDataTables } from '@/api/dataTable'
import {
  computePublishCheck,
  normalizeIntakeForSubmit,
  validateIntakeRows,
  normalizePublishWarnings,
  normalizeRecommendedQuestions,
  recommendedQuestionsComplete,
  normalizeExampleQuestions,
  exampleQuestionsComplete,
  genExampleQuestions,
  genPositionSop,
  DESCRIPTION_MAX_LEN,
  EXAMPLE_Q_MAX_LEN,
  SOP_MAX_LEN,
  LIMITS,
  INTAKE_TYPES,
  isSelectType,
  genKeyFromLabel
} from '@/utils/positionModel'
import { EFFECT_TEST_ENABLED } from '@/utils/featureFlags'
import { listKnowledgeBases } from '@/api/knowledgeBase'
import SkillPickerDialog from '@/components/position/SkillPickerDialog.vue'
import StatusTag from '@/components/StatusTag.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import PublishCheckDialog from '@/components/position/PublishCheckDialog.vue'
import PositionDataTableStage from '@/components/position/PositionDataTableStage.vue'
import PositionSampleTaskStage from '@/components/position/PositionSampleTaskStage.vue'
import PositionVersionHistoryDialog from '@/components/position/PositionVersionHistoryDialog.vue'
import AdminRail from '@/components/admin/AdminRail.vue'
// Tab 内联编辑器（2026-09-04 PRD-20260903 对齐：认领说明列表 / 图标 popover / 业务系统页签）
import ClaimNotesEditor from '@/components/position/ClaimNotesEditor.vue'
import IconPickerPopover from '@/components/position/IconPickerPopover.vue'
import PositionBizSystemsPane from '@/components/position/PositionBizSystemsPane.vue'
import SkillMilkdownEditor from '@/components/position/SkillMilkdownEditor.vue'
import { iconIsUrl } from '@/utils/iconDisplay'
// 效果测试台异步加载：仅在点「效果测试」打开时拉取，避免把对话链路提前并入白板首屏 + 保持现有测试 import 图不变。
const EffectTestStage = defineAsyncComponent(() => import('@/components/test/EffectTestStage.vue'))

const route = useRoute()
const router = useRouter()
const store = usePositionStore()

const isNew = computed(() => route.params.id === 'new')

/* ---------- Tab 切换（9 个 sheet 页；改造：白板+弹窗 → Tab 内联） ---------- */
const activeTab = ref('persona')

/* ---------- 效果测试台（纯前端 demo，就地扮演终端用户试跑该岗位） ---------- */
const testStageOpen = ref(false)
function openTest() {
  // 把当前岗位对象（basic + agents + 数据表数）传入；缺字段由测试台 mock 兜底。
  testStageOpen.value = true
}
function closeTest() {
  testStageOpen.value = false
}

/* ---------- 加载 ---------- */
const intakeErrors = ref({})

// 延迟骨架屏（闪烁修复）：仅当加载持续 >250ms 才显骨架，避免缓存/快响应时骨架一闪而过的「闪屏」感。
const showSkeleton = ref(false)
let skeletonTimer = null
watch(
  () => store.loading,
  (v) => {
    clearTimeout(skeletonTimer)
    if (v) {
      skeletonTimer = setTimeout(() => { showSkeleton.value = true }, 250)
    } else {
      showSkeleton.value = false
    }
  }
)

onMounted(async () => {
  if (isNew.value) {
    store.initNew()
  } else {
    try {
      await store.load(route.params.id)
      // 岗位详情就绪后轻量预取数据表数量，供身份卡「数据底座」入口徽标显示
      prefetchDtCount()
      loadCurrentVersion()
    } catch {
      /* error 态由 store.error 呈现 */
    }
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  // 整页编辑器在新标签编完关掉、焦点回白板 → 轻量 refetch 当前岗位（设计 §5.4，对齐 AdminSkills）。
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearTimeout(skeletonTimer)
  store.reset()
})

// 回到白板标签（窗口聚焦 / 可见）时对当前岗位轻量 refetch，避免整页改名/删技能后看到旧态（§5.4）。
async function refetchOnReturn() {
  if (store.positionId == null) return
  // 取消自动保存后：本地若有未保存修改，静默 refetch 会用服务端旧值覆盖编辑 → 跳过，等用户保存后再同步。
  if (isDirty.value) return
  // 静默刷新：不切骨架屏，避免每次切回白板标签整页闪一下（窗口聚焦/可见性回切闪烁修复）。
  store.load(store.positionId, { silent: true })
}
// wasHidden 门：只有标签真被隐藏过再回来才 refetch；纯页内点击不触发（修「点击即刷新」，window focus 在嵌入式下每点必触发）。
let wasHidden = false
function onWindowFocus() {
  if (wasHidden) {
    wasHidden = false
    refetchOnReturn()
  }
}
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    wasHidden = true
  } else if (document.visibilityState === 'visible' && wasHidden) {
    wasHidden = false
    refetchOnReturn()
  }
}

/* ---------- 只读态（2026-09-04 PRD-20260903 对齐） ----------
 * 列表【查看】进入携带 query.view=1 → 全页签只读、顶部无保存/发布；
 * 审核中（detail.pendingAction 非空）同样锁定只读（md 三.10「审核中：全部页签只读」）。 */
const isReadonly = computed(() => route.query.view === '1' || !!store.detail?.pendingAction)

// 顶部状态标签三态（md 三.1：未发布 灰 / 审核中 橙 / 已发布 绿）
const statusView = computed(() => {
  if (store.detail?.pendingAction) return { label: '审核中', type: 'warning' }
  if (store.isPublished) return { label: '已发布', type: 'success' }
  return { label: '未发布', type: 'info' }
})

/* ---------- 人格 Tab 内联绑定（md 三.2 六区块；改动 patch→store.basic，随顶部【保存】提交） ---------- */
function patchBasic(key, value) {
  store.basic = { ...store.basic, [key]: value }
}
// 岗位认领说明（纯文本动态列表，≤6 条 × 100 字）
const claimNotesModel = computed({
  get: () => (Array.isArray(store.basic?.claimDescriptions) ? store.basic.claimDescriptions : []),
  set: (v) => patchBasic('claimDescriptions', v)
})
// 示例问题固定 3 格
const exampleQuestions = computed(() => normalizeExampleQuestions(store.basic?.exampleQuestions))
function onExampleInput(idx, val) {
  const next = normalizeExampleQuestions(store.basic?.exampleQuestions)
  next[idx] = val
  patchBasic('exampleQuestions', next)
}
const eqShowErrors = ref(false)
const eqPlaceholders = ['如：帮我分析本周经营数据', '请输入示例问题', '请输入示例问题']
const personaLen = computed(() => (store.basic?.persona || '').length)

// 图标选择回吐（IconPickerPopover 单次给 {icon, iconSource}）
function onPickIcon({ icon, iconSource }) {
  store.basic = { ...store.basic, icon, iconSource }
}

/* ---------- AI 生成（本地拟真：延迟 500ms；描述为空禁用并 title 提示） ---------- */
const descEmpty = computed(() => !String(store.basic?.description || '').trim())
const aiQuestionsBusy = ref(false)
const aiSopBusy = ref(false)
function aiGenQuestions() {
  if (descEmpty.value || aiQuestionsBusy.value) return
  aiQuestionsBusy.value = true
  setTimeout(() => {
    patchBasic('exampleQuestions', genExampleQuestions(store.basic?.name, store.basic?.description))
    aiQuestionsBusy.value = false
    ElMessage.success('AI 内容已生成，请确认后保存')
  }, 500)
}
function aiGenSop() {
  if (descEmpty.value || aiSopBusy.value) return
  aiSopBusy.value = true
  setTimeout(() => {
    patchBasic('positionSop', genPositionSop(store.basic?.name, store.basic?.description))
    aiSopBusy.value = false
    ElMessage.success('AI 内容已生成，请确认后保存')
  }, 500)
}

/* ---------- 采集 Tab 内联绑定（搬自 IntakeEditDialog） ---------- */
const intakeRows = computed({
  get: () => store.basic?.intakeSchema || [],
  set: (v) => patchBasic('intakeSchema', v)
})

/* ---------- 采集字段:标准列表 + 右侧抽屉编辑（2026-08-22 列表化改造） ---------- */
const intakeTypeLabel = (t) => INTAKE_TYPES.find((x) => x.value === t)?.label || t
const intakeDrawerOpen = ref(false)
const intakeEditIndex = ref(-1) // -1=新增，>=0=编辑该行
const intakeDraft = ref({ label: '', key: '', type: 'text', required: false, options: [] })

function openIntakeCreate() {
  intakeEditIndex.value = -1
  intakeDraft.value = { label: '', key: '', type: 'text', required: false, options: [] }
  intakeDrawerOpen.value = true
}
function openIntakeEdit(row, index) {
  intakeEditIndex.value = index
  intakeDraft.value = { label: row.label || '', key: row.key || '', type: row.type || 'text', required: !!row.required, options: [...(row.options || [])] }
  intakeDrawerOpen.value = true
}
function saveIntakeDraft() {
  const d = intakeDraft.value
  if (!String(d.label || '').trim()) { ElMessage.warning('请填写字段名'); return }
  const row = { ...d, key: (d.key || '').trim() || genKeyFromLabel(d.label), options: isSelectType(d.type) ? (d.options || []).filter((o) => String(o).trim()) : [] }
  const next = [...intakeRows.value]
  if (intakeEditIndex.value >= 0) next[intakeEditIndex.value] = row
  else {
    if (next.length >= LIMITS.INTAKE_MAX) { ElMessage.warning(`最多 ${LIMITS.INTAKE_MAX} 个采集字段`); return }
    next.push(row)
  }
  intakeRows.value = next
  intakeDrawerOpen.value = false
  // md 三.3.2：保存后提示「采集字段已保存」，列表刷新（本地即时）
  ElMessage.success('采集字段已保存')
}
async function deleteIntakeRow(index) {
  try {
    await ElMessageBox.confirm('删除该采集字段？删除后员工领用时不再采集该项。', '删除字段', { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' })
  } catch { return }
  intakeRows.value = intakeRows.value.filter((_, i) => i !== index)
  // md 三.3.3：删除后提示「采集字段已删除」
  ElMessage.success('采集字段已删除')
}
function addIntakeOption() { intakeDraft.value.options = [...(intakeDraft.value.options || []), ''] }
function removeIntakeOption(i) { intakeDraft.value.options = (intakeDraft.value.options || []).filter((_, idx) => idx !== i) }

/* ---------- 手动保存 + 脏检查（2026-08-28：取消 debounce 自动保存） ---------- */
const hasPositionId = computed(() => store.positionId != null)
// 基线 = 最近一次从服务端 hydrate 的 basic（load / saveBasic / createPosition 后由 store.detail 变化触发）
const basicBaseline = ref('')
function snapshotBasic() {
  return JSON.stringify(store.basic || null)
}
watch(
  () => store.detail,
  () => {
    basicBaseline.value = snapshotBasic()
  },
  { immediate: true }
)
const isDirty = computed(() => !!store.basic && snapshotBasic() !== basicBaseline.value)

function onBeforeUnload(e) {
  if (!isDirty.value) return
  e.preventDefault()
  e.returnValue = '' // 浏览器标准「离开此页？」提示
}

/* ---------- 顶栏：当前已发布版本号（已发布岗位才显示） ---------- */
const currentVersionLabel = ref('')
async function loadCurrentVersion() {
  currentVersionLabel.value = ''
  if (!store.isPublished || store.positionId == null) return
  try {
    const list = await listPositionPublications(store.positionId)
    const rows = Array.isArray(list) ? list : list?.list || []
    // 列表按 version DESC；取最新的在架版本（ACTIVE），无在架则取最新一条
    const cur = rows.find((r) => (r.status || 'ACTIVE') === 'ACTIVE') || rows[0]
    if (cur) currentVersionLabel.value = cur.versionLabel || `v${cur.version}`
  } catch {
    /* 版本号仅展示，取不到不打扰 */
  }
}

function buildBasicPayload() {
  const b = store.basic
  const payload = {
    name: b.name,
    intro: b.intro,
    // 岗位描述（2026-08-26 开放编辑入口）：展示给使用者的一段介绍；对外 positions[].description（缺则回落 intro）
    description: b.description,
    icon: b.icon,
    iconSource: b.iconSource,
    // claimDesc 多条数组 [{emoji,content}]（content 富文本由后端 Jsoup 净化）；welcome/sopDoc 已退役不上送（设计 §2）
    claimDesc: b.claimDesc,
    // 2026-09-04 PRD-20260903 对齐新增：认领说明 / 示例问题（3 条）/ 岗位 SOP / 引用业务系统
    claimDescriptions: Array.isArray(b.claimDescriptions) ? b.claimDescriptions : [],
    exampleQuestions: normalizeExampleQuestions(b.exampleQuestions),
    positionSop: b.positionSop || '',
    businessSystemIds: Array.isArray(b.businessSystemIds) ? b.businessSystemIds : [],
    persona: b.persona,
    intakeSchema: normalizeIntakeForSubmit(b.intakeSchema)
  }
  // N4 推荐问题（部分更新语义）：仅当 4 格全部填好才随保存下发（后端要求非 null 时恰好 4 个且非空）；
  // 未填满时不上送该字段（=不改），避免 debounce 静默自动保存因半填被后端校验拦下。
  const rq = normalizeRecommendedQuestions(b.recommendedQuestions)
  if (recommendedQuestionsComplete(rq)) payload.recommendedQuestions = rq.map((q) => q.trim())
  return payload
}

async function doSaveBasic(silent) {
  if (!hasPositionId.value) return
  // 采集字段前端轻校验
  const { ok, errors } = validateIntakeRows(store.basic.intakeSchema || [])
  intakeErrors.value = errors
  if (!ok) {
    if (!silent) ElMessage.warning('采集字段有误，请修正后保存')
    return
  }
  try {
    const { warnings } = await store.saveBasic(buildBasicPayload())
    if (!silent) {
      // md 三.1：保存成功提示「岗位配置已保存」
      ElMessage.success(warnings.length ? `岗位配置已保存（${warnings.length} 项提示）` : '岗位配置已保存')
    }
  } catch (e) {
    if (e?.field) {
      // 字段级回显（采集 key/name 等）
      ElMessage.error(e.message || '保存失败')
    } else if (!silent) {
      ElMessage.error(e?.message || '保存失败')
    }
  }
}

/* ---------- 新建态首次落库 ---------- */
async function ensurePersisted() {
  if (hasPositionId.value) return true
  if (!String(store.basic.name || '').trim()) {
    // md 三.1：岗位名称为空时提示「请填写岗位名称」
    ElMessage.warning('请填写岗位名称')
    return false
  }
  try {
    const data = await createPosition(buildBasicPayload())
    store.hydrate(data)
    // 路由切到真实 id（replace，避免回退到 new）
    router.replace({ name: 'PositionWorkbench', params: { id: data.positionId } })
    return true
  } catch (e) {
    ElMessage.error(e?.message || '创建失败')
    return false
  }
}

/* ---------- Agent 增删改 ---------- */
const agentAtLimit = computed(() => store.agents.length >= LIMITS.AGENT_MAX)

async function addAgent() {
  if (!(await ensurePersisted())) return
  if (agentAtLimit.value) {
    ElMessage.warning(`单岗位最多 ${LIMITS.AGENT_MAX} 个 Agent`)
    return
  }
  try {
    await store.addAgent({ name: '新 Agent', sortOrder: store.agents.length })
  } catch (e) {
    ElMessage.error(e?.message || '新建 Agent 失败')
  }
}
async function onAgentRename(agentId, payload) {
  try {
    await store.patchAgent(agentId, payload)
  } catch (e) {
    ElMessage.error(e?.message || (e?.field === 'name' ? 'Agent 名已存在' : '保存失败'))
  }
}
// 删除 Agent（2026-09-04 PRD-20260903 对齐，md 三.6.3）：确认文案与 toast 逐字照 md。
async function onAgentDelete(agentId) {
  try {
    await ElMessageBox.confirm(
      '删除该 Agent 后会解除其技能关联，技能本身不会被删除。确认删除？',
      '删除 Agent',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  try {
    await store.removeAgent(agentId)
    ElMessage.success('Agent 已删除')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

/* ---------- 技能整页编辑（设计 §5：移除聚焦浮层，改新标签开整页编辑器） ---------- */
// 新标签打开整页技能编辑器（对齐 AdminSkills.openEditorTab 范式）。
function openSkillFullPage(skillId) {
  const href = router.resolve({ name: 'AdminSkillEdit', params: { id: skillId } }).href
  window.open(href, '_blank')
}

/* ---------- 技能引用（岗位页只引用「已发布」技能，不创建；创建/管理在「技能」页） ---------- */
/* 从技能库引用已发布 FDE 技能（V84 引用模型） */
const pickSkillVisible = ref(false)
const pickSkillAgentId = ref(null)
// 本岗位已引用的技能 id 集合（跨全部 Agent）：picker 据此置灰，防岗位内重复引用。
const positionSkillIds = computed(() =>
  store.allSkills.map((x) => x.skill?.skillId).filter(Boolean)
)
/* ---------- Agent 与技能:层级列表（2026-08-22 列表化，对齐截图） ---------- */
import { categoryLabel } from '@/utils/skillCategory'
// 扁平化为「Agent 行 + 其下技能行」，供 el-table 层级渲染（kind 区分）。
const agentSkillRows = computed(() => {
  const out = []
  for (const a of store.agents) {
    out.push({ kind: 'agent', agentId: a.agentId, name: a.name, description: a.description || '', skillCount: (a.skills || []).length })
    for (const sk of a.skills || []) {
      out.push({ kind: 'skill', rowKey: 's_' + a.agentId + '_' + sk.skillId, agentId: a.agentId, skillId: sk.skillId, name: sk.name, category: sk.category, tools: agentSkillToolText(sk) })
    }
  }
  return out
})
// 工具读写摘要：referencedTools 在总览态被剥离（store 稳定性），此处能拿到就算读/写、拿不到显 —。
function agentSkillToolText(sk) {
  const refs = sk?.referencedTools
  if (!Array.isArray(refs) || !refs.length) return '—'
  const write = refs.filter((t) => t.requiresConfirmation).length
  const read = refs.length - write
  const parts = []
  if (read) parts.push(`${read} 读`)
  if (write) parts.push(`${write} 写`)
  return parts.join(' · ') || '—'
}
const skillCategoryText = (c) => (c ? categoryLabel(c) : '—')

// Agent 编辑抽屉（名称 + 职责描述）——复用 onAgentRename（emit 同款 payload，逻辑不变）。
const agentDrawerOpen = ref(false)
const agentEditId = ref(null)
const agentDraft = ref({ name: '', description: '' })
function openAgentEdit(row) {
  agentEditId.value = row.agentId
  agentDraft.value = { name: row.name || '', description: row.description || '' }
  agentDrawerOpen.value = true
}
async function saveAgentDraft() {
  if (!String(agentDraft.value.name || '').trim()) { ElMessage.warning('请填写 Agent 名称'); return }
  await onAgentRename(agentEditId.value, { name: agentDraft.value.name.trim(), description: agentDraft.value.description })
  agentDrawerOpen.value = false
  // md 三.6.2：保存后提示「Agent 已保存」
  ElMessage.success('Agent 已保存')
}

function onPickSkill(agentId) {
  pickSkillAgentId.value = agentId
  pickSkillVisible.value = true
}
async function onSkillPicked(skillId) {
  try {
    await store.assignSkillToAgent(skillId, pickSkillAgentId.value)
    ElMessage.success('已引用技能到该 Agent')
  } catch (e) {
    ElMessage.error(e?.message || '引用失败')
  }
}
async function onReorderSkills(agentId, newSkills) {
  store.reorderSkillsLocal(agentId, newSkills)
  // 逐条 PUT sortOrder 持久化（决议 9 整体 PUT 思路，最小代价）
  try {
    await Promise.all(
      newSkills.map((s, i) => store.patchSkill(s.skillId, { sortOrder: i }))
    )
  } catch (e) {
    ElMessage.error('调序保存失败')
  }
}
// Agent↔Agent 跨泳道迁移：走 assign 端点（PUT /skills/{id}/assign）。收纳区退役后，仅服务白板内
// 把技能从一个 Agent 拖到另一个 Agent。
async function assignSkillTo(skillId, fromAgentId, toAgentId) {
  if (fromAgentId === toAgentId) return
  const target = store.agents.find((a) => a.agentId === toAgentId)
  try {
    await store.assignSkillToAgent(skillId, toAgentId)
    ElMessage.success(`已分配技能到 ${target?.name || 'Agent'}`)
  } catch (e) {
    // 1002 该 Agent 技能数上限 / 1003 跨岗位非法 / 其它
    if (e?.code === 1002) {
      ElMessage.error(`${target?.name || '该 Agent'} 技能数已达上限`)
    } else if (e?.code === 1003) {
      ElMessage.error('该技能不属于本岗位，无法分配')
    } else {
      ElMessage.error(e?.message || '分配失败')
    }
    // 失败：重拉详情回到后端真实态
    store.load(store.positionId)
  }
}

function onMoveSkill({ skillId, fromAgentId, toAgentId }) {
  assignSkillTo(skillId, fromAgentId, toAgentId)
}

/* ---------- 数据底座：三栏聚焦弹窗（身份卡入口打开） ---------- */
const dtStageOpen = ref(false)
const dtTableCount = ref(0)
const dtCountLoading = ref(false)

// 首屏轻量预取一次数据表数量，供身份卡入口徽标显示（新建岗位未落库 → 0）。
async function prefetchDtCount() {
  if (store.positionId == null) {
    dtTableCount.value = 0
    return
  }
  dtCountLoading.value = true
  try {
    const data = await listDataTables(store.positionId)
    dtTableCount.value = (data?.list || []).length
  } catch {
    /* 预取失败：徽标降级显示「暂无表」，打开 stage 后会以真实列表回吐覆盖 */
  } finally {
    dtCountLoading.value = false
  }
}

// 点身份卡「数据底座」入口：若岗位未落库先 ensurePersisted（与 addAgent 同款，岗位名空则提示先填名），
// 落库成功后打开三栏弹窗（此时 positionId 已就绪，避免越权/报错）。
async function onOpenDataTable() {
  if (!(await ensurePersisted())) return
  dtStageOpen.value = true
}

/* ---------- 样例任务：两栏聚焦弹窗（顶部条「⏰ 样例任务」入口打开，与数据底座同款 ensurePersisted） ---------- */
const sampleStageOpen = ref(false)
const sampleTaskCount = ref(0)

// 与 onOpenDataTable 同款：岗位未落库先 ensurePersisted（样例是岗位级资产，须先有 positionId 才能挂载）。
async function onOpenSampleTasks() {
  if (!(await ensurePersisted())) return
  sampleStageOpen.value = true
}

/* ---------- 知识页签（2026-09-04 PRD-20260903 对齐，md 三.5 轻量口径） ----------
 * 页签内只做只读列表（走现有 api/knowledgeBase.js，不改函数签名）：
 * 取岗位知识库（kbType=POSITION）并按可见范围 = 当前岗位名过滤；
 * 新建 / 查看 / 编辑 / 检索测试均跳知识库模块（query 携带岗位上下文，深度锁定由知识库批次承接）。 */
const kbRows = ref([])
const kbLoading = ref(false)
const kbError = ref(false)
const kbLoaded = ref(false)
async function loadPositionKbs() {
  kbLoading.value = true
  kbError.value = false
  try {
    const data = await listKnowledgeBases({ kbType: 'POSITION', page: 1, size: 200 })
    const list = Array.isArray(data) ? data : data?.list || []
    const posName = String(store.basic?.name || '').trim()
    kbRows.value = list.filter((r) => (r.scopeRefName || '') === posName)
    kbLoaded.value = true
  } catch {
    kbError.value = true
  } finally {
    kbLoading.value = false
  }
}
// 首次切到「知识」页签时懒加载
watch(activeTab, (tab) => {
  if (tab === 'knowledge' && !kbLoaded.value && !kbLoading.value) loadPositionKbs()
})
const kbStatusView = (row) => {
  if (row.pendingAction) return { label: '审核中', type: 'warning' }
  if (row.status === 'PUBLISHED') return { label: '已发布', type: 'success' }
  return { label: '未发布', type: 'info' }
}
const kbSourcesText = (row) => {
  const names = (row.sources || []).map((s) => s?.name).filter(Boolean)
  return names.length ? names.join('、') : '—'
}
// 跳知识库模块：query 携带岗位上下文（fromPositionId/fromPositionName）；
// kbId/kbAction 供知识库批次承接「打开查看/编辑抽屉、检索测试弹窗」的深链。
function gotoKbModule(action, row) {
  router.push({
    name: 'AdminKnowledgeBase',
    query: {
      tab: 'kb',
      fromPositionId: store.positionId,
      fromPositionName: store.basic?.name || '',
      ...(row ? { kbId: row.id, kbAction: action } : { kbAction: action })
    }
  })
}

// 白板画布滚动容器（数据底座弹窗 .focus-mode 复用其退背后视觉；非聚焦态用）
const boardRef = ref(null)

// 反馈 4 修复「切页面时弹窗下遮罩闪一下」：append-to-body 的 el-dialog/弹窗 .el-overlay 挂在 body 上，
// 路由离开时组件直接卸载会让遮罩被异步突兀移除（闪一下）。改为离开路由前先关闭所有弹窗/数据底座，
// 让 Vue 过渡正常收起遮罩，再卸载组件——遮罩平滑消失，无闪烁。
onBeforeRouteLeave(async () => {
  if (isDirty.value) {
    try {
      await ElMessageBox.confirm('有未保存的修改，离开后将丢失。确定离开？', '未保存的修改', {
        type: 'warning',
        confirmButtonText: '放弃修改并离开',
        cancelButtonText: '留在本页'
      })
    } catch {
      return false
    }
  }
  dtStageOpen.value = false
  sampleStageOpen.value = false
  // 同页其它 append-to-body 浮层一并复位，避免遮罩在卸载时残留闪烁（CR 一致性）。
  // 注：这两个 ref 在下方声明，回调在导航时（setup 完成后）才执行，闭包引用安全。
  publishDialogVisible.value = false
  testStageOpen.value = false
})

/* ============================ 技能从 Agent 移除（V84 引用模型：可逆 detach） ============================
 * 从 Agent 移除 = 删该 Agent 对技能的引用行；技能本体留在库里、可在「技能」页查看，也可再拉入任意 Agent。
 * 取代旧「解绑=彻底游离、不可逆」语义（后端 detach 端点：DELETE /fde/agents/{agentId}/skills/{skillId}）。 */
async function onDeleteSkill({ agentId, skillId }) {
  try {
    // md 三.6.4：确认文案逐字「仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？」
    await ElMessageBox.confirm(
      '仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？',
      '移除技能',
      {
        type: 'warning',
        confirmButtonText: '移除',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  try {
    await store.detachSkillFromAgent(agentId, skillId)
    ElMessage.success('已移除')
  } catch (e) {
    ElMessage.error(e?.message || '移除失败')
  }
}

/* ============================ 顶部条：保存 / 发布 / 下架 ============================ */
const publishDialogVisible = ref(false)
const publishing = ref(false)
const publishCheck = computed(() => computePublishCheck(store.checkInput))

/* ---------- N5 发布版本号 + 升级说明（编排收敛到 useVersionPublish；行为不变） ---------- */
// atMax/nextLoading 别名回本组件既有模板变量名（versionAtMax/nextLabelLoading），保持模板与测试引用不变。
const {
  versionLabel, // 展示版本号（语义化 vX.Y.Z，打开发布页自动带出建议号）
  releaseNotes, // 升级说明（必填）
  prevMaxLabel, // 历史最大版本号（供"建议递增"软提示）
  atMax: versionAtMax, // 无法自动建议版本号（禁用版本框 + 人话提示）
  nextLoading: nextLabelLoading,
  load: loadNextVersionLabel
} = useVersionPublish({ fetchNextLabel: () => getNextVersionLabel(store.positionId) })

// 版本历史对话框（管理侧 §6.6 C/D）：仅已发布岗位有版本快照可看/下线。
const versionHistoryVisible = ref(false)
function openVersionHistory() {
  versionHistoryVisible.value = true
}

async function explicitSave() {
  // 技能整页化后白板无聚焦态，技能保存在整页编辑器自管；此处只存身份卡基本信息。
  if (!(await ensurePersisted())) return
  await doSaveBasic(false)
}

async function openPublish() {
  if (!(await ensurePersisted())) return
  // 先存一遍身份卡当前内容
  await doSaveBasic(true)
  // 轻量人格必填前置门（2026-09-04 PRD-20260903 对齐 md 三.9.1 口径的 toast「请先填写：…」+
  // 自动切人格页签；完整「发布前检查弹窗 + 7 项阻断校验」按冻结区 Q1-Q4 挂账本轮不实现，
  // 通过前置门后仍走现有版本侧栏发布流程）。
  const b = store.basic
  const missing = []
  if (!String(b.name || '').trim()) missing.push('岗位名称')
  if (!b.icon) missing.push('岗位图标')
  if (!String(b.description || '').trim()) missing.push('岗位描述')
  if (!(Array.isArray(b.claimDescriptions) && b.claimDescriptions.some((s) => String(s).trim()))) missing.push('岗位认领说明')
  if (!exampleQuestionsComplete(b.exampleQuestions)) missing.push('3 条示例问题')
  if (!String(b.positionSop || '').trim()) missing.push('岗位 SOP')
  if (missing.length) {
    activeTab.value = 'persona'
    eqShowErrors.value = missing.includes('3 条示例问题')
    ElMessage.warning(`请先填写：${missing.join('、')}`)
    return
  }
  // N5：打开即带出建议的下一个版本号；load 内部会清空升级说明（每次发布重填，必填）。
  publishDialogVisible.value = true
  loadNextVersionLabel()
}

async function doPublish() {
  publishing.value = true
  try {
    const res = await publishPosition(store.positionId, {
      versionLabel: versionLabel.value.trim(),
      releaseNotes: releaseNotes.value.trim()
    })
    const w = normalizePublishWarnings(res?.warnings)
    publishDialogVisible.value = false
    await store.load(store.positionId)
    loadCurrentVersion()
    if (w.count) {
      const lines = w.items
        .map((i) => `<li>${i.label}${i.message ? '：' + i.message : ''}${i.detail ? `<br/><span style="color:var(--c-text-faint)">${i.detail}</span>` : ''}</li>`)
        .join('')
      const head = w.unhealthy.length
        ? `已发布，但有 ${w.unhealthy.length} 个被引用工具当前异常（运行时可能降级）：`
        : `已发布，但有 ${w.count} 项提示：`
      await ElMessageBox.alert(`<div>${head}</div><ul style="margin:8px 0 0;padding-left:18px">${lines}</ul>`, '发布完成（含告警）', {
        dangerouslyUseHTMLString: true,
        confirmButtonText: '知道了',
        type: 'warning'
      })
    } else {
      ElMessage.success('已发布')
    }
  } catch (e) {
    ElMessage.error(e?.message || '发布失败')
  } finally {
    publishing.value = false
  }
}

function backToList() {
  router.push({ name: 'AdminPositions' })
}

/* Esc 不再关闭聚焦窗 / 不收抽屉（规格 §5：误触退聚焦问题）。退聚焦唯一显式入口为「↩ 返回总览」/面包屑跳转。 */

</script>

<template>
  <div class="wb-shell">
    <!-- 共享后台窄轨（与 AdminLayout 同源，保证一致；工作台路由 meta.activeMenu 高亮「岗位」） -->
    <AdminRail />

    <div class="wb-container">
      <!-- 顶部条 -->
      <header class="topbar">
        <div class="tb-l">
          <span class="tb-back" @click="backToList">← 返回</span>
          <span class="tb-sep">|</span>
          <!-- 岗位名称可直接编辑（md 三.1：最多 64 字；只读态禁用）：写入 store.basic.name，随「保存」提交 -->
          <el-input
            :model-value="store.basic?.name || ''"
            class="tb-name-input"
            maxlength="64"
            placeholder="岗位名称"
            :disabled="isReadonly"
            @update:model-value="patchBasic('name', $event)"
          />
          <!-- 状态标签三态（md 三.1：未发布 灰 / 审核中 橙 / 已发布 绿） -->
          <StatusTag :type="statusView.type">{{ statusView.label }}</StatusTag>
          <span v-if="store.isPublished && currentVersionLabel" class="tb-version" title="当前已发布的最新版本">{{ currentVersionLabel }}</span>
        </div>

        <div class="tb-r">
          <span class="tb-dirty" :class="{ on: isDirty }">{{ isDirty ? '有未保存的修改' : '' }}</span>
          <ThemeToggle />
          <!-- md 三.1：只读状态和审核中状态隐藏【保存】和【发布岗位】 -->
          <template v-if="!isReadonly">
            <el-button @click="explicitSave">保存</el-button>
            <el-button type="primary" @click="openPublish">发布岗位</el-button>
          </template>
        </div>
      </header>

      <!-- Tab 主体（9 个 sheet 页；已有功能内联填充，未实现的占位「开发中」） -->
      <div class="wb-body tabs-body">
        <!-- 加载 / 错误态 -->
        <div v-if="showSkeleton" class="board-state">
          <el-skeleton :rows="8" animated style="max-width: 900px; margin: 0 auto" />
        </div>
        <div v-else-if="store.error" class="board-state">
          <p>{{ store.error }}</p>
          <el-button @click="store.load(route.params.id)">重试</el-button>
        </div>
        <div v-else-if="store.loading" class="board-state"></div>

        <el-tabs v-else-if="store.basic" v-model="activeTab" class="pd-tabs">
          <!-- ① 人格（2026-09-04 PRD-20260903 对齐，md 三.2 六区块纵向排列） -->
          <el-tab-pane label="人格" name="persona">
            <div class="pd-pane">
              <!-- 1. 岗位描述（必填，≤500 字；全链同口径：新建弹窗 / mock 校验） -->
              <section class="pd-sec">
                <div class="pd-sec-title">
                  岗位描述<i class="pd-req">*</i><span class="pd-sec-sub">向用户说明该岗位的职责范围</span>
                </div>
                <el-input
                  :model-value="store.basic.description || ''"
                  type="textarea"
                  :rows="3"
                  :maxlength="DESCRIPTION_MAX_LEN"
                  show-word-limit
                  placeholder="说明该岗位负责什么、可以帮助用户完成哪些工作"
                  class="pd-desc-input pd-half"
                  :disabled="isReadonly"
                  @update:model-value="patchBasic('description', $event)"
                />
              </section>

              <!-- 2. 岗位图标（必填；IconPickerPopover：图标库 / 上传 + 方形裁剪） -->
              <section class="pd-sec">
                <div class="pd-sec-title">
                  岗位图标<i class="pd-req">*</i><span class="pd-sec-sub">用于岗位列表与员工端展示</span>
                </div>
                <div class="pd-icon-row">
                  <span class="pd-icon-preview">
                    <img v-if="iconIsUrl(store.basic.icon)" :src="store.basic.icon" alt="" class="pd-icon-img" />
                    <span v-else>{{ store.basic.icon || '♟' }}</span>
                  </span>
                  <IconPickerPopover
                    :icon="store.basic.icon"
                    :position-name="store.basic.name"
                    :readonly="isReadonly"
                    @pick="onPickIcon"
                  />
                </div>
              </section>

              <!-- 3. 岗位认领说明（动态列表：≥1 条为发布必填、≤6 条 × 100 字） -->
              <section class="pd-sec pd-half">
                <div class="pd-sec-title">岗位认领说明<span class="pd-sec-sub">一行一条，员工认领岗位时展示</span></div>
                <ClaimNotesEditor v-model="claimNotesModel" :readonly="isReadonly" />
              </section>

              <!-- 4. 示例问题（3 条必填 × 60 字 + 区级 AI 生成） -->
              <section class="pd-sec pd-half">
                <div class="pd-sec-title">
                  示例问题<i class="pd-req">*</i><span class="pd-sec-sub">帮助用户快速了解如何使用该岗位</span>
                  <el-button
                    v-if="!isReadonly"
                    class="pd-ai-btn"
                    size="small"
                    plain
                    :loading="aiQuestionsBusy"
                    :disabled="descEmpty || aiQuestionsBusy"
                    :title="descEmpty ? '请先填写岗位描述' : undefined"
                    @click="aiGenQuestions"
                  >
                    {{ aiQuestionsBusy ? '生成中...' : 'AI 生成' }}
                  </el-button>
                </div>
                <div class="pd-eq-list">
                  <div v-for="(q, idx) in exampleQuestions" :key="idx" class="pd-eq-row">
                    <span class="pd-eq-no">{{ idx + 1 }}</span>
                    <el-input
                      :model-value="q"
                      :maxlength="EXAMPLE_Q_MAX_LEN"
                      show-word-limit
                      :placeholder="eqPlaceholders[idx]"
                      :disabled="isReadonly"
                      :class="{ 'pd-eq-err': eqShowErrors && !String(q).trim() }"
                      @update:model-value="onExampleInput(idx, $event)"
                    />
                  </div>
                </div>
                <div class="pd-eq-hint">3 条均为必填，每条不超过 {{ EXAMPLE_Q_MAX_LEN }} 个字符</div>
              </section>

              <!-- 5. 岗位 SOP（必填，≤4000 字 + AI 生成） -->
              <section class="pd-sec">
                <div class="pd-sec-title">
                  岗位 SOP<i class="pd-req">*</i><span class="pd-sec-sub">对该岗位绑定的所有能力进行综述</span>
                  <el-button
                    v-if="!isReadonly"
                    class="pd-ai-btn"
                    size="small"
                    plain
                    :loading="aiSopBusy"
                    :disabled="descEmpty || aiSopBusy"
                    :title="descEmpty ? '请先填写岗位描述' : undefined"
                    @click="aiGenSop"
                  >
                    {{ aiSopBusy ? '生成中...' : 'AI 生成' }}
                  </el-button>
                </div>
                <el-input
                  :model-value="store.basic.positionSop || ''"
                  type="textarea"
                  :rows="6"
                  :maxlength="SOP_MAX_LEN"
                  show-word-limit
                  placeholder="说明岗位如何组合使用 Agent、技能、知识与工具完成工作"
                  class="pd-sop-input"
                  :disabled="isReadonly"
                  @update:model-value="patchBasic('positionSop', $event)"
                />
              </section>

              <!-- 6. 岗位人格（富文本编辑器沿用现有 Milkdown） -->
              <section class="pd-sec">
                <div class="pd-sec-title">
                  岗位人格<span class="pd-sec-sub">定义岗位的语气、表达方式和行为边界 · markdown</span>
                  <span class="pd-hint" :class="{ over: personaLen > LIMITS.PERSONA_SOFT }">{{ personaLen }} / {{ LIMITS.PERSONA_SOFT }}</span>
                </div>
                <div class="pd-mde">
                  <SkillMilkdownEditor
                    :model-value="store.basic.persona"
                    height="320px"
                    placeholder="你是一名严谨的经营分析助手。优先核对数据口径，先给结论，再展示关键依据和风险提示。"
                    :readonly="isReadonly"
                    @update:model-value="patchBasic('persona', $event)"
                  />
                </div>
              </section>
            </div>
          </el-tab-pane>

          <!-- ② 采集字段 -->
          <el-tab-pane label="采集字段" name="intake">
            <div class="pd-pane">
              <div class="pd-list-head">
                <div class="pd-list-title">采集字段<span class="pd-list-sub">员工领用时填写 · ≤{{ LIMITS.INTAKE_MAX }} 个</span></div>
                <el-button v-if="!isReadonly" type="primary" size="small" @click="openIntakeCreate">＋ 新增采集字段</el-button>
              </div>
              <el-table :data="intakeRows" class="pd-table" empty-text="暂无采集字段，点「新增字段」添加">
                <el-table-column type="index" label="#" width="52" />
                <el-table-column prop="label" label="字段名" min-width="160" />
                <el-table-column label="字段 key" min-width="140">
                  <template #default="{ row }"><span class="pd-mono">{{ row.key || genKeyFromLabel(row.label) || '—' }}</span></template>
                </el-table-column>
                <el-table-column label="类型" width="120">
                  <template #default="{ row }">{{ intakeTypeLabel(row.type) }}</template>
                </el-table-column>
                <el-table-column label="必填" width="80" align="center">
                  <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
                </el-table-column>
                <el-table-column label="选项" min-width="180">
                  <template #default="{ row }">
                    <span v-if="isSelectType(row.type)">{{ (row.options || []).filter(Boolean).join(' / ') || '—' }}</span>
                    <span v-else class="pd-faint">—</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="130" fixed="right">
                  <template #default="{ row, $index }">
                    <span v-if="isReadonly" class="pd-faint">只读</span>
                    <template v-else>
                      <el-button link type="primary" @click="openIntakeEdit(row, $index)">编辑</el-button>
                      <el-button link type="danger" @click="deleteIntakeRow($index)">删除</el-button>
                    </template>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <!-- 采集字段编辑抽屉 -->
            <!-- 走统一抽屉外壳：随之获得「禁点遮罩关闭」——本抽屉是带输入的编辑态，
                 原先点一下遮罩草稿即丢（见 docs/frontend/规范-管理后台列表页.md §6）。 -->
            <DrawerEditor
              v-model:visible="intakeDrawerOpen"
              :title="intakeEditIndex >= 0 ? '编辑采集字段' : '新增采集字段'"
              size="480px"
              append-to-body
            >
              <el-form label-position="top" class="pd-drawer-form">
                <el-form-item label="字段名" required>
                  <el-input v-model="intakeDraft.label" maxlength="40" placeholder="如：客户公司名称" />
                </el-form-item>
                <el-form-item label="字段 key（英文，留空自动生成）">
                  <el-input v-model="intakeDraft.key" :placeholder="genKeyFromLabel(intakeDraft.label) || 'auto'" />
                </el-form-item>
                <el-form-item label="类型">
                  <el-select v-model="intakeDraft.type" style="width: 100%">
                    <el-option v-for="t in INTAKE_TYPES" :key="t.value" :value="t.value" :label="t.label" />
                  </el-select>
                </el-form-item>
                <el-form-item label="必填">
                  <el-switch v-model="intakeDraft.required" />
                </el-form-item>
                <el-form-item v-if="isSelectType(intakeDraft.type)" label="选项">
                  <div class="pd-opts">
                    <div v-for="(opt, i) in intakeDraft.options" :key="i" class="pd-opt-row">
                      <el-input :model-value="opt" placeholder="选项内容" @update:model-value="intakeDraft.options[i] = $event" />
                      <el-button link type="danger" @click="removeIntakeOption(i)">✕</el-button>
                    </div>
                    <el-button link type="primary" @click="addIntakeOption">＋ 添加选项</el-button>
                  </div>
                </el-form-item>
              </el-form>
              <template #footer>
                <el-button @click="intakeDrawerOpen = false">取消</el-button>
                <el-button type="primary" @click="saveIntakeDraft">保存</el-button>
              </template>
            </DrawerEditor>
          </el-tab-pane>

          <!-- ③ 工作档案（对象类型配置：卡位 / 应沉淀清单 / 归纳规则 / 沉淀策略；原「数据底座 / 数据表」模型升级）
               只读态：Stage 未提供 readonly prop，用 pointer-events 冻结兜底（demo 口径，见 PRD-review 记录）。 -->
          <el-tab-pane label="工作档案" name="workProfile">
            <div class="pd-pane pd-pane--flush" :class="{ 'pd-ro-freeze': isReadonly }">
              <PositionDataTableStage
                v-if="store.positionId != null"
                :position-id="store.positionId"
                :position-name="store.basic.name || '岗位'"
                :table-count="dtTableCount"
                embedded
                @update:table-count="dtTableCount = $event"
                @saved="prefetchDtCount"
              />
              <div v-else class="pd-empty">保存岗位后即可配置工作档案（对象类型 · 结构化卡位 · 应沉淀清单 · 归纳规则 · 沉淀策略）。</div>
            </div>
          </el-tab-pane>

          <!-- ④ 知识（2026-09-04 PRD-20260903 对齐，md 三.5 轻量口径：只读列表 + 跳知识库模块） -->
          <el-tab-pane label="知识" name="knowledge">
            <div class="pd-pane">
              <div class="pd-list-head">
                <div class="pd-list-title">知识库<span class="pd-list-sub">该岗位可见范围内的知识库 · 新建与编辑在知识库模块完成</span></div>
                <el-button v-if="!isReadonly" type="primary" size="small" @click="gotoKbModule('create')">＋ 新建知识库</el-button>
              </div>
              <div v-if="kbError" class="pd-empty">
                知识库加载失败
                <el-button link type="primary" @click="loadPositionKbs">重试</el-button>
              </div>
              <el-table
                v-else
                v-loading="kbLoading"
                :data="kbRows"
                class="pd-table"
                :empty-text="'暂无知识库，点击&quot;新建知识库&quot;添加'"
              >
                <el-table-column label="知识库名称" min-width="200">
                  <template #default="{ row }">
                    <span class="pd-kb-name" :title="row.description || ''">{{ row.name }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="类型" width="120">
                  <template #default>岗位知识库</template>
                </el-table-column>
                <el-table-column label="数据源" min-width="200" show-overflow-tooltip>
                  <template #default="{ row }">{{ kbSourcesText(row) }}</template>
                </el-table-column>
                <el-table-column label="状态" width="100" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="kbStatusView(row).type" effect="plain">{{ kbStatusView(row).label }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="200" fixed="right">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="gotoKbModule('view', row)">查看</el-button>
                    <el-button v-if="!isReadonly" link type="primary" @click="gotoKbModule('edit', row)">编辑</el-button>
                    <el-button
                      v-if="row.status === 'PUBLISHED'"
                      link
                      type="primary"
                      @click="gotoKbModule('search', row)"
                    >
                      检索测试
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </el-tab-pane>

          <!-- ⑤ Agent 与技能 -->
          <el-tab-pane label="Agent 与技能" name="agents">
            <div class="pd-pane">
              <div class="pd-list-head">
                <div class="pd-list-title">Agent 与技能<span class="pd-list-sub">每个 Agent 是一组技能 · 主实例按职责描述委派子任务</span></div>
                <el-button v-if="!isReadonly" type="primary" size="small" :disabled="agentAtLimit" @click="addAgent">
                  {{ agentAtLimit ? `已达 ${LIMITS.AGENT_MAX} 个上限` : '＋ 新增 Agent' }}
                </el-button>
              </div>
              <el-table :data="agentSkillRows" class="pd-table pd-table--tree" row-key="rowKey"
                        :row-class-name="({ row }) => row.kind === 'agent' ? 'pd-row-agent' : 'pd-row-skill'"
                        empty-text="暂无 Agent，点「＋ 新 Agent」创建">
                <el-table-column label="AGENT / 技能" min-width="220">
                  <template #default="{ row }">
                    <span v-if="row.kind === 'agent'" class="pd-agent-name">◆ {{ row.name }}</span>
                    <span v-else class="pd-skill-name">· {{ row.name }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="职责描述 / 分类" min-width="320">
                  <template #default="{ row }">
                    <span v-if="row.kind === 'agent'" class="pd-agent-desc">{{ row.description || '—' }}</span>
                    <el-tag v-else size="small" type="info" effect="plain">{{ skillCategoryText(row.category) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="工具" width="120" align="center">
                  <template #default="{ row }">
                    <span v-if="row.kind === 'agent'" class="pd-faint">—</span>
                    <span v-else>{{ row.tools }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="150" fixed="right">
                  <template #default="{ row }">
                    <span v-if="isReadonly" class="pd-faint">只读</span>
                    <template v-else-if="row.kind === 'agent'">
                      <el-button link type="primary" @click="openAgentEdit(row)">编辑</el-button>
                      <el-button link type="primary" @click="onPickSkill(row.agentId)">＋技能</el-button>
                      <el-button link type="danger" @click="onAgentDelete(row.agentId)">删除</el-button>
                    </template>
                    <template v-else>
                      <el-button link type="primary" @click="openSkillFullPage(row.skillId)">编辑</el-button>
                      <el-button link type="danger" @click="onDeleteSkill({ agentId: row.agentId, skillId: row.skillId })">移除</el-button>
                    </template>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <!-- Agent 编辑抽屉（名称 + 职责描述） -->
            <DrawerEditor v-model:visible="agentDrawerOpen" title="编辑 Agent" size="480px" append-to-body>
              <el-form label-position="top" class="pd-drawer-form">
                <el-form-item label="Agent 名称" required>
                  <el-input v-model="agentDraft.name" maxlength="40" placeholder="如：客户洞察" />
                </el-form-item>
                <el-form-item label="职责描述">
                  <el-input v-model="agentDraft.description" type="textarea" :rows="5" maxlength="500" show-word-limit
                            placeholder="决定主实例把子任务委派给这个 Agent 时的执行口径" />
                </el-form-item>
              </el-form>
              <template #footer>
                <el-button @click="agentDrawerOpen = false">取消</el-button>
                <el-button type="primary" @click="saveAgentDraft">保存</el-button>
              </template>
            </DrawerEditor>
          </el-tab-pane>

          <!-- ⑥ 自动化任务（样例定时任务承载；只读态 pointer-events 冻结兜底） -->
          <el-tab-pane label="自动化任务" name="sampleTasks">
            <div class="pd-pane pd-pane--flush" :class="{ 'pd-ro-freeze': isReadonly }">
              <PositionSampleTaskStage
                v-if="store.positionId != null"
                :position-id="store.positionId"
                :position-name="store.basic.name || '岗位'"
                embedded
                @update:sample-count="sampleTaskCount = $event"
              />
              <div v-else class="pd-empty">保存岗位后即可配置自动化任务。</div>
            </div>
          </el-tab-pane>

          <!-- ⑦ 业务系统（2026-09-04 PRD-20260903 对齐新增，md 三.8：引用已发布业务系统） -->
          <el-tab-pane label="业务系统" name="bizSystems">
            <div class="pd-pane">
              <PositionBizSystemsPane
                :business-system-ids="store.basic.businessSystemIds || []"
                :readonly="isReadonly"
                @update:business-system-ids="patchBasic('businessSystemIds', $event)"
              />
            </div>
          </el-tab-pane>

          <!-- 以下三页签为 demo 既有扩展，按 2026-09-04 对齐拍板保留在新 PRD 七页签之后：
               运行（规划位）/ 效果测试（featureFlag 承载）/ 版本（Q2 冻结：版本管理全链保持现状）。 -->
          <el-tab-pane label="运行" name="runtime">
            <div class="pd-pane"><div class="pd-empty pd-dev">🚧 运行 · 开发中</div></div>
          </el-tab-pane>

          <el-tab-pane label="效果测试" name="effectTest">
            <div class="pd-pane pd-pane--flush">
              <EffectTestStage
                v-if="EFFECT_TEST_ENABLED"
                mode="position"
                :position="{ basic: store.basic, agents: store.agents, tableCount: dtTableCount }"
                :position-id="store.positionId"
                embedded
              />
              <div v-else class="pd-empty pd-dev">🚧 效果测试 · 开发中</div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="版本" name="version">
            <div class="pd-pane">
              <div v-if="store.isPublished" class="pd-empty">
                <el-button type="primary" @click="openVersionHistory">🗂 打开版本历史</el-button>
                <p class="pd-empty-hint">查看已发布版本、下线 / 恢复历史版本。</p>
              </div>
              <div v-else class="pd-empty">岗位尚未发布，暂无版本记录。发布后可在此管理版本。</div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <!-- 从技能库引用已发布 FDE 技能：选中后写引用行到当前 Agent；岗位内已引用的置灰。
         岗位页只引用、不创建——新技能在「FDE 工作台 → 技能」页创建后再来引用。 -->
    <SkillPickerDialog
      v-model="pickSkillVisible"
      :existing-ids="positionSkillIds"
      @pick="onSkillPicked"
    />

    <!-- 人格 / 采集编辑弹窗已随 2026-09-04 PRD-20260903 对齐退役（内容全部内联进人格 / 采集字段页签），
         PersonaEditDialog / IntakeEditDialog 组件文件保留备查。 -->

    <!-- 发布前检查 + N5 版本号/升级说明 -->
    <PublishCheckDialog
      v-model:visible="publishDialogVisible"
      v-model:version-label="versionLabel"
      v-model:release-notes="releaseNotes"
      :check="publishCheck"
      :publishing="publishing"
      :prev-max-label="prevMaxLabel"
      :at-max="versionAtMax"
      :next-loading="nextLabelLoading"
      @publish="doPublish"
    />

    <!-- 版本历史（管理侧 §6.6 C/D）：只读版本列表 + 下线/恢复历史版本 -->
    <PositionVersionHistoryDialog
      v-model="versionHistoryVisible"
      :position-id="store.positionId"
      :position-name="store.basic?.name || '岗位'"
    />

  </div>
</template>

<style scoped>
.wb-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-app);
}
.wb-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 0 var(--space-5);
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-base);
  z-index: 30;
}
.tb-l {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.tb-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  color: var(--c-text-muted);
  padding: 5px 10px;
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
}
.tb-back:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.tb-sep {
  color: var(--border-strong);
  font-size: var(--fs-sm);
  user-select: none;
}
/* 岗位名称就地编辑：静态时无边框像标题，聚焦时才显输入框（与技能编辑页名称框同口径） */
.tb-name-input {
  width: 240px;
}
.tb-name-input :deep(.el-input__inner) {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.tb-name-input :deep(.el-input__wrapper) {
  box-shadow: none;
  background: transparent;
  padding-left: var(--space-2);
}
.tb-name-input :deep(.el-input__wrapper:hover),
.tb-name-input :deep(.el-input__wrapper.is-focus) {
  background: var(--bg-sunken);
  box-shadow: 0 0 0 1px var(--border-base) inset;
}
.tb-version {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 1px 8px;
}
.tb-r {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.tb-dirty {
  font-size: var(--fs-xs);
  color: var(--c-warning);
  margin-right: var(--space-1);
  min-width: 92px;
  text-align: right;
}
.wb-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}
.board {
  flex: 1;
  overflow: auto;
  padding: var(--space-5) var(--space-8) var(--space-12);
  background-color: var(--board-bg, var(--bg-sunken));
  background-image: radial-gradient(var(--board-dot, rgba(55, 53, 47, 0.07)) 1px, transparent 1px);
  background-size: 22px 22px;
  transition: filter var(--dur-slow) var(--ease-out), opacity var(--dur-slow) var(--ease-out);
}
/* 聚焦态：白板退背后（决议 7：blur 单层 + contain，不卸载 DOM 保滚动位） */
/* UI1：冻结滚动（overflow hidden）避免长文回流抖动，scrollTop 仍由 DOM 保留，exitFocus 原位回位 */
.wb-body.focus-mode .board {
  filter: blur(4px) saturate(0.7);
  opacity: 0.45;
  pointer-events: none;
  overflow: hidden;
  will-change: filter, opacity;
  contain: layout paint;
}
.board-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  color: var(--c-text-muted);
  padding: var(--space-10);
}
.stage-head {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  margin: var(--space-2) 0 var(--space-4);
}
.stage-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  color: var(--c-text-strong);
  display: flex;
  align-items: center;
  gap: 8px;
}
.stage-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  padding-bottom: 2px;
}
.lanes {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: var(--space-4);
}
.lane-new {
  flex: 0 0 240px;
  width: 240px;
  align-self: stretch;
  min-height: 160px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-4);
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}
.lane-new:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
.lane-new.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.lane-new.disabled:hover {
  border-color: var(--border-strong);
  color: var(--c-text-muted);
  background: transparent;
}
.focus-stage {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  z-index: 40;
  padding: var(--space-4) var(--space-6) var(--space-6);
}

/* ============ 9-Tab 详情页（2026-08-22 白板→Tab 改造） ============ */
.tabs-body {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.pd-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-6);
}
.pd-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding-top: var(--space-3);
}
.pd-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.pd-tabs :deep(.el-tab-pane) {
  height: 100%;
}
/* 常规内容页：居中限宽、上下留白、内部滚动 */
.pd-pane {
  /* 宽度与 Tab 标签栏保持一致：不独立居中限宽，左右边界统一由 .pd-tabs 的 padding 控制（sheet 内 = sheet 列表同宽） */
  width: 100%;
  padding: var(--space-5) 0 var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
/* 铺满型页（数据底座/样例任务/效果测试内联，自带三栏/两栏布局，不限宽） */
.pd-pane--flush {
  max-width: none;
  height: 100%;
  padding: 0;
  gap: 0;
}
/* .pd-sec / .pd-list-head / .pd-table / .pd-drawer-form 等岗位详情通用段落与列表类已上收为全局 assets/position-detail.css（2026-08-28），
   供各 Tab 内嵌组件（如工作档案 PositionDataTableStage）复用，不再各自复制。 */
/* ---- Agent 与技能：层级列表（Agent 行加粗，技能行缩进） ---- */
.pd-agent-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.pd-skill-name {
  padding-left: var(--space-4);
  color: var(--c-text-base);
}
.pd-agent-desc {
  color: var(--c-text-base);
}
.pd-table :deep(.pd-row-agent) {
  background: var(--bg-subtle, var(--fill-subtle));
}
.pd-table :deep(.pd-row-agent > td) {
  border-top: 1px solid var(--border-base);
}

/* ---- 2026-09-04 PRD-20260903 对齐新增 ---- */
/* 必填红星（对齐 el-form required 视觉口径） */
.pd-req {
  color: var(--c-danger);
  font-style: normal;
  margin: 0 var(--space-2) 0 2px;
}
/* 人格 · 岗位图标行 */
.pd-icon-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.pd-icon-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  font-size: 24px;
  line-height: 1;
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  overflow: hidden;
}
.pd-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 人格 · 示例问题 3 格 */
.pd-eq-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.pd-eq-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.pd-eq-no {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.pd-eq-hint {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
:deep(.pd-eq-err .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
/* 区级 AI 生成按钮（示例问题 / 岗位 SOP 标题右侧） */
.pd-ai-btn {
  margin-left: auto;
}
/* 人格 · SOP 输入宽度与描述同口径 */
.pd-sop-input {
  max-width: 720px;
}
/* 知识页签：知识库名称 */
.pd-kb-name {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
/* 只读冻结兜底：工作档案 / 自动化任务两个内嵌 Stage 暂无 readonly prop，
   查看态 / 审核中用 pointer-events 冻结（demo 口径，正式实现由后续批次下沉 readonly）。 */
.pd-ro-freeze {
  pointer-events: none;
  opacity: 0.72;
}
</style>
