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
 * - 页签调整为新 PRD 七页签序：人格 / 采集字段 / 工作档案 / 知识 / Agent 与技能 / 自动化任务 / 业务系统（新增）。
 *
 * 2026-09-10 页签调整：
 * - 删除「运行」和「效果测试」页签。
 * - 恢复「业务系统」页签，展示岗位引用的已发布业务系统列表。
 * - 人格页签重排为 md §2 六区块：岗位图标 / 岗位描述 / 领用页文案 / 示例问题(3 条+AI 生成) /
 *   岗位 SOP(4000+AI 生成) / 岗位人格；原「推荐问题 4 条」editor 退役（文件保留）。
 * - 顶部栏对齐 md §1.2：名称 64 字 / 三态状态标签 / 版本号 / 未保存提示 / 保存 / 发布岗位；
 *   只读态（列表【查看】进入 query.view=1）与审核中隐藏保存与发布、全页签只读。
 *
 * 2026-09-08 PRD-20260908 对齐（批次 A）：
 * - 发布前检查弹窗清单改 md §9.2，版本号改「更新类型三选一 + 自动算号只读」（md §3.7）；
 *   （当时口径：图标、领用页文案、采集字段不参与发布阻断；2026-09-21 起三项均改必填并入发布阻断，见下方完整性校验九项。）
 * - 「岗位认领说明」→「领用页文案」（md §2.3：可选、≤6 条 × 100 字，底层字段仍 claimDescriptions）。
 * - 岗位描述上限统一 500（2026-09-08 决议第 5 项）；采集字段达 10 置灰新增、单/多选选项全空阻断保存；
 *   每个 Agent 技能达 100【勾选】置灰；Agent 名称 64 / 职责必填 ≤500（md §6.2）。
 * - 知识页签：列 知识库名称 / 描述 / 数据源 / 文档数量 / 状态 / 操作，行内仅【查看】【检索测试】，
 *   无新建 / 编辑入口（md §5.1–§5.3）。
 *
 * 2026-09-09 PRD 复核（G1 · Q11/Q455）：
 * - 完整性校验统一为 md §9.1 九项（名称 / 图标 / 描述 / 领用页文案 / 示例问题 3 条 / SOP / 采集字段 / Agent 与技能 / 自动化任务）：
 *   【发布岗位】任一缺失即阻断并定位到缺失项所在页签；【保存】执行同一套校验但**不阻断**，
 *   改以顶部提示条（.pd-complete-banner）列出未完成项。口径实现在 utils/positionModel.js
 *   的 computeCompletenessMissing / computePublishCheck，两处共用同一份。
 * - 知识页签【检索测试】改为原地打开 KnowledgeSearchDialog（md §5.3 / Q455），不再跳知识库模块；
 *   【查看】仍按 md 跳转。
 *
 * 2026-09-10 病 A 拆分（冗余治理第二批方案第 5 项）：
 * - 人格 / 采集字段 / 知识 / Agent 与技能 四页签抽为 components/position/Position*Tab.vue 子组件
 *   （DOM 与交互零变更）；子组件直接用 usePositionStore，只接 isReadonly 一个 prop。
 * - 本文件保留壳层（顶栏 / 页签切换 / ?tab= 深链）、保存与脏检查、发布编排与完整性校验、只读态推导；
 *   跨层接线走 provide：pdActiveTab（知识页签懒加载）/ pdEqShowErrors（示例问题标红）/
 *   pdEnsurePersisted（新建态先落库）。
 */
import { ref, computed, watch, provide, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import { createPosition, publishPosition, getNextVersionLabel, listPositionPublications } from '@/api/position'
import { useVersionPublish } from '@/composables/useVersionPublish'
import { listDataTables } from '@/api/dataTable'
import { listSampleTasks } from '@/api/sampleTask'
import {
  computePublishCheck,
  computeCompletenessMissing,
  normalizeIntakeForSubmit,
  validateIntakeRows,
  normalizePublishWarnings,
  normalizeExampleQuestions
} from '@/utils/positionModel'
import { KIND, deriveTriView, isLocked } from '@/utils/publishState'
import StatusTag from '@/components/StatusTag.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import PublishCheckDialog from '@/components/position/PublishCheckDialog.vue'
import PositionDataTableStage from '@/components/position/PositionDataTableStage.vue'
import PositionSampleTaskStage from '@/components/position/PositionSampleTaskStage.vue'
import AdminRail from '@/components/admin/AdminRail.vue'
// 四个内容页签子组件（2026-09-10 病 A 拆分）：直接用 usePositionStore，只接 isReadonly
import PositionPersonaTab from '@/components/position/PositionPersonaTab.vue'
import PositionIntakeTab from '@/components/position/PositionIntakeTab.vue'
import PositionKnowledgeTab from '@/components/position/PositionKnowledgeTab.vue'
import PositionAgentSkillTab from '@/components/position/PositionAgentSkillTab.vue'
import PositionBusinessSystemTab from '@/components/position/PositionBusinessSystemTab.vue'

const route = useRoute()
const router = useRouter()
const store = usePositionStore()

const isNew = computed(() => route.params.id === 'new')

/* ---------- Tab 切换（9 个 sheet 页；改造：白板+弹窗 → Tab 内联） ---------- */
// 初值可由 ?tab= 指定：技能整页编辑器「← 返回」据此回到来源页签（#15，2026-09-09 批次 4C）。
const activeTab = ref(typeof route.query.tab === 'string' && route.query.tab ? route.query.tab : 'persona')

/* ---------- 页签子组件接线（2026-09-10 病 A 拆分） ----------
 * 子组件数据都直接走 usePositionStore、只接 isReadonly 一个 prop；仅以下三条跨层状态经 provide 注入：
 * - pdActiveTab：知识页签懒加载 watch 的目标（拆分前为同文件闭包引用）；
 * - pdEqShowErrors：发布阻断时示例问题标红（openPublish 置位，人格页签消费）；
 * - pdEnsurePersisted：新建态先落库编排（Agent 页签「＋ 新增 Agent」前置调用；函数声明有提升，此处引用安全）。 */
const eqShowErrors = ref(false)
provide('pdActiveTab', activeTab)
provide('pdEqShowErrors', eqShowErrors)
provide('pdEnsurePersisted', ensurePersisted)

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
      // 完整性校验（md §9.1 第 9 条）依赖自动化任务条数，未访问该页签时也需要，故此处独立预取
      refreshSampleTaskCount()
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
 * 审核中（detail.pendingAction 非空）同样锁定只读（md 三.10「审核中：全部页签只读」）。
 * 2026-09-09 批 2-2 收编：锁定改 publishState.isLocked（对岗位即 !!pendingAction）。 */
const isReadonly = computed(() => route.query.view === '1' || isLocked(KIND.POSITION, store.detail))

// 顶部状态标签三态（md 三.1：未发布 灰 / 审核中 橙 / 已发布 绿）
// 2026-09-09 批 2-2 收编：折叠规则改走 publishState.deriveTriView（返回 { label, type } 同形；
// store.isPublished ≡ detail.status==='published'，detail 为空时两版同落「未发布」）
const statusView = computed(() => deriveTriView(KIND.POSITION, store.detail || {}))

/* ---------- 顶栏岗位名就地编辑（写入 store.basic，随顶部【保存】提交） ----------
 * 人格 / 采集页签的字段绑定已随拆分下沉到各自子组件（子组件各持同款 patchBasic 三行）。 */
function patchBasic(key, value) {
  store.basic = { ...store.basic, [key]: value }
}

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
    // 2026-09-04 PRD-20260903 对齐新增：领用页文案（claimDescriptions）/ 示例问题（3 条）/ 岗位 SOP / 引用业务系统
    claimDescriptions: Array.isArray(b.claimDescriptions) ? b.claimDescriptions : [],
    exampleQuestions: normalizeExampleQuestions(b.exampleQuestions),
    positionSop: b.positionSop || '',
    businessSystemIds: Array.isArray(b.businessSystemIds) ? b.businessSystemIds : [],
    // md 岗位 §8.1 L506 / §8.2 L524：连接器页签「岗位私有 MCP / API」引用清单，此前只写 store 未透传进
    // 保存 payload，toast「绑定成功」→ 保存 → 刷新即丢（2026-09-23 待办 yuepu#7①④）
    connectorMcpIds: Array.isArray(b.connectorMcpIds) ? b.connectorMcpIds : [],
    connectorApiIds: Array.isArray(b.connectorApiIds) ? b.connectorApiIds : [],
    persona: b.persona,
    intakeSchema: normalizeIntakeForSubmit(b.intakeSchema)
  }
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

/* Agent 增删改 / 二维表 / Agent 抽屉已随拆分下沉 PositionAgentSkillTab.vue（2026-09-10 病 A 拆分） */

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

// 2026-09-09 PRD 复核（A1 / md §9.1 第 9 条）：自动化任务条数进入完整性校验，
// 但 PositionSampleTaskStage 只在切到该页签时才挂载并 emit 计数 —— 未访问过页签时计数恒 0，
// 会把「已配置任务」的岗位误判为缺失。故在详情页层独立拉一次条数（与页签 emit 同源，后者仍会覆盖为最新值）。
async function refreshSampleTaskCount() {
  if (store.positionId == null) {
    sampleTaskCount.value = 0
    return
  }
  try {
    const data = await listSampleTasks(store.positionId)
    sampleTaskCount.value = (data?.list || []).length
  } catch {
    /* 取数失败不打断页面；计数保持原值（校验按已知值走） */
  }
}

// 与 onOpenDataTable 同款：岗位未落库先 ensurePersisted（样例是岗位级资产，须先有 positionId 才能挂载）。
async function onOpenSampleTasks() {
  if (!(await ensurePersisted())) return
  sampleStageOpen.value = true
}

/* 知识页签（只读列表 + 检索测试弹窗 + 跳模块深链）已随拆分下沉 PositionKnowledgeTab.vue（2026-09-10 病 A 拆分） */

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
})

/* 技能从 Agent 移除（onDeleteSkill）已随拆分下沉 PositionAgentSkillTab.vue（2026-09-10 病 A 拆分） */

/* ============================ 顶部条：保存 / 发布 / 下架 ============================ */
const publishDialogVisible = ref(false)
const publishing = ref(false)
// 2026-09-09 PRD 复核（A1 / Q11）：完整性校验入参 = store.checkInput（名称/描述/示例问题/SOP/agents）
// + 详情页侧的自动化任务条数（store 不持有样例任务，见 refreshSampleTaskCount）。
const completenessInput = computed(() => ({ ...store.checkInput, sampleTaskCount: sampleTaskCount.value }))
const publishCheck = computed(() => computePublishCheck(completenessInput.value))

/* ---------- md §9.1 完整性校验 9 项（保存提示 / 发布阻断共用同一口径） ---------- */
const completenessMissing = computed(() => computeCompletenessMissing(completenessInput.value))
// 保存后才展示提示条：避免新建岗位一进页面就满屏红字（md §9.1 末段的语义是「保存时列出未完成项」）。
const showCompletenessBanner = ref(false)
const completenessBannerText = computed(() => completenessMissing.value.map((i) => i.label).join('、'))

/* ---------- N5 发布版本号 + 升级说明（编排收敛到 useVersionPublish；行为不变） ---------- */
// atMax/nextLoading 别名回本组件既有模板变量名（versionAtMax/nextLabelLoading），保持模板与测试引用不变。
const {
  versionLabel, // 展示版本号（语义化 vX.Y.Z，打开发布页自动带出建议号，按更新类型自动算号、只读）
  releaseNotes, // 升级说明（必填）
  atMax: versionAtMax, // 无法自动建议版本号（人话提示 + 禁发）
  nextLoading: nextLabelLoading,
  bump: versionBump, // 更新类型（NONE 修订版本 / MINOR 功能更新 / MAJOR 重大更新，md §3.7）
  firstPublish: versionFirstPublish, // 首个版本：无更新类型可选，固定 v1.0.0
  setBump: setVersionBump,
  load: loadNextVersionLabel
} = useVersionPublish({ fetchNextLabel: () => getNextVersionLabel(store.positionId) })

// 版本历史对话框随「版本」页签一并移除（2026-09-09 负责人裁决）：
// 版本管理的正式入口在岗位列表页【版本管理】按钮（md §3.7），详情页不再重复承载。

async function explicitSave() {
  // 技能整页化后白板无聚焦态，技能保存在整页编辑器自管；此处只存身份卡基本信息。
  if (!(await ensurePersisted())) return
  await doSaveBasic(false)
  // md §9.1 末段（2026-09-09 Q11 决策）：保存时同样执行 9 项完整性校验，但**不阻断保存**——
  // 保存已正常完成，这里只把未完成项以顶部提示条列出，便于配置者分次补齐。
  await refreshSampleTaskCount()
  showCompletenessBanner.value = completenessMissing.value.length > 0
}

async function openPublish() {
  if (!(await ensurePersisted())) return
  // 先存一遍身份卡当前内容
  await doSaveBasic(true)
  await refreshSampleTaskCount()
  // 阻断校验六项（md §9.1，2026-09-09 Q11 负责人决策，推翻此前「阻断四项」口径）：
  // 岗位名称 / 岗位描述 / 示例问题 3 条 / 岗位 SOP / Agent 与技能（≥1 个 Agent 且该 Agent ≥1 个技能）/
  // 自动化任务（≥1 条）。任一缺失 → toast「请先填写：X、Y」+ 自动定位到第一个缺失项所在页签。
  const missingItems = completenessMissing.value
  if (missingItems.length) {
    activeTab.value = missingItems[0].tab
    eqShowErrors.value = missingItems.some((i) => i.key === 'exampleQuestions')
    showCompletenessBanner.value = true
    ElMessage.warning(`请先填写：${missingItems.map((i) => i.label).join('、')}`)
    return
  }
  showCompletenessBanner.value = false
  // 通过阻断校验 → 发布前检查弹窗（md §9.2）：打开即拉建议版本号并按更新类型自动算号（md §3.7，不可手输）；
  // load 内部会清空升级说明（每次发布重填，必填）。
  publishDialogVisible.value = true
  loadNextVersionLabel()
}

async function doPublish() {
  publishing.value = true
  try {
    const res = await publishPosition(store.positionId, {
      versionLabel: versionLabel.value.trim(),
      bump: versionBump.value,
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
      // 提交后岗位进入「审核中」而非已上线，文案按 md §3.3 取「已提交发布审核」
      ElMessage.success('已提交发布审核')
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
          <!-- 岗位名称：只读静态展示；编辑入口已移至「人格」页签的岗位名称卡 -->
          <span class="tb-name-display">{{ store.basic?.name || '未命名岗位' }}</span>
          <!-- 状态标签三态（md 三.1：未发布 灰 / 审核中 橙 / 已发布 绿） -->
          <StatusTag :type="statusView.type">{{ statusView.label }}</StatusTag>
          <span v-if="store.isPublished && currentVersionLabel" class="tb-version" title="当前已发布的最新版本">{{ currentVersionLabel }}</span>
        </div>

        <div class="tb-r">
          <span class="tb-dirty" :class="{ on: isDirty }">{{ isDirty ? '有未保存的修改' : '' }}</span>
          <ThemeToggle />
          <!-- md 三.1：只读状态和审核中状态隐藏【保存】和【发布岗位】 -->
          <!-- 详情就绪（store.basic 有值）前禁用：冷加载期间点击会在 ensurePersisted 读 store.basic.name 报 TypeError -->
          <template v-if="!isReadonly">
            <el-button :disabled="!store.basic" @click="explicitSave">保存</el-button>
            <el-button type="primary" :disabled="!store.basic" @click="openPublish">发布岗位</el-button>
          </template>
        </div>
      </header>

      <!-- md §9.1 末段（2026-09-09 Q11 决策）：【保存】时执行同一套 9 项完整性校验，但不阻断保存，
           改以顶部提示条列出尚未完成的项，便于配置者分次补齐；只读态不展示。
           点条目文字可直接跳到该项所在页签。 -->
      <div v-if="showCompletenessBanner && !isReadonly && completenessMissing.length" class="pd-complete-banner">
        <span class="pd-cb-icon">!</span>
        <span class="pd-cb-text">
          已保存，但以下内容尚未完成，发布前需补齐：
          <template v-for="(item, i) in completenessMissing" :key="item.key">
            <span class="pd-cb-item" @click="activeTab = item.tab">{{ item.label }}</span><span v-if="i < completenessMissing.length - 1">、</span>
          </template>
        </span>
        <span class="pd-cb-close" title="关闭提示" @click="showCompletenessBanner = false">×</span>
      </div>

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

        <el-tabs v-else-if="store.basic" v-model="activeTab" :class="['pd-tabs', { 'tab-flush': ['tasks', 'dataTable'].includes(activeTab) }]">
          <!-- ① 人格（md §2 六区块；卡片化分区照交互原型岗位详情页最终覆写态——每区块=独立卡片
               （头：标题+必填星+弱色说明，体：内容+底部 hint），区块顺序 图标→描述→领用页文案→示例问题→SOP→人格） -->
          <el-tab-pane label="人格" name="persona">
            <PositionPersonaTab :is-readonly="isReadonly" />
          </el-tab-pane>

          <!-- ② 采集字段 -->
          <el-tab-pane label="采集字段" name="intake">
            <PositionIntakeTab :is-readonly="isReadonly" />
          </el-tab-pane>

          <!-- ③ 工作档案（md §4：左侧档案列表面板 + 右侧 基本信息 / 编目信息 / 档案详情 三卡）
               2026-09-09 原型复刻批次 4A：Stage 已提供 readonly prop，pd-ro-freeze 仅作兜底。 -->
          <el-tab-pane label="工作档案" name="workProfile">
            <div class="pd-pane pd-pane--flush" :class="{ 'pd-ro-freeze': isReadonly }">
              <PositionDataTableStage
                v-if="store.positionId != null"
                :position-id="store.positionId"
                :position-name="store.basic.name || '岗位'"
                :table-count="dtTableCount"
                :readonly="isReadonly"
                embedded
                @update:table-count="dtTableCount = $event"
                @saved="prefetchDtCount"
              />
              <div v-else class="pd-empty">保存岗位后即可配置工作档案（档案模型 · 编目信息 · 档案详情 · 抽取策略）。</div>
            </div>
          </el-tab-pane>

          <!-- ④ 知识（2026-09-04 PRD-20260903 对齐，md 三.5 轻量口径：只读列表 + 跳知识库模块） -->
          <el-tab-pane label="知识" name="knowledge">
            <!-- 检索测试弹窗（KnowledgeSearchDialog）接线随之在子组件内 -->
            <PositionKnowledgeTab :is-readonly="isReadonly" />
          </el-tab-pane>

          <!-- ⑤ Agent 与技能（2026-09-09 原型复刻批次 4C）
               形态按负责人 Q383 决议 + 补充说明第 5 条「采纳 A」：二维表（两级），不做泳道、也不做
               ◆ 技能分类分组的三级结构——行维度 = Agent（◆）与其下技能（·），列维度 = 名称 /
               职责描述·分类 / 工具 / 操作，同一列在两级上承载各自语义。 -->
          <el-tab-pane label="Agent 与技能" name="agents">
            <PositionAgentSkillTab :is-readonly="isReadonly" />
          </el-tab-pane>

          <!-- ⑥ 自动化任务（样例定时任务承载；只读态 pointer-events 冻结兜底）
               页签标识 `tasks` 照 md §1.3 L160（2026-09-12 审计 J8③，原 `sampleTasks`；深链 ?tab= 旧值不兼容）；
               PositionSampleTaskStage 的 embedded 开关已退役（审计 J5），只剩页签内联形态。 -->
          <el-tab-pane label="自动化任务" name="tasks">
            <div class="pd-pane pd-pane--flush" :class="{ 'pd-ro-freeze': isReadonly }">
              <PositionSampleTaskStage
                v-if="store.positionId != null"
                :position-id="store.positionId"
                :position-name="store.basic.name || '岗位'"
                @update:sample-count="sampleTaskCount = $event"
              />
              <div v-else class="pd-empty">保存岗位后即可配置自动化任务。</div>
            </div>
          </el-tab-pane>

          <!-- ⑦ 连接器（展示岗位绑定的私有 MCP / 私有 API / 业务系统） -->
          <el-tab-pane label="连接器" name="businessSystems">
            <PositionBusinessSystemTab :is-readonly="isReadonly" />
          </el-tab-pane>

        </el-tabs>
      </div>
    </div>

    <!-- 技能引用弹窗（SkillPickerDialog）已随 2026-09-09 批次 4C 退役：技能改在 Agent 抽屉内勾选
         （负责人 Q383 决议 + 原型 L4025 删 Agent 行「＋技能」）。组件文件已于 2026-09-09
         代码冗余清理中作为零引用死文件删除，如需查阅见 git 历史。 -->

    <!-- 人格 / 采集编辑弹窗已随 2026-09-04 PRD-20260903 对齐退役（内容全部内联进人格 / 采集字段页签）。
         PersonaEditDialog / IntakeEditDialog 组件文件同批删除，如需查阅见 git 历史。 -->

    <!-- 发布前检查（md §9.2）：清单四行 + 更新类型三选一 → 自动算号只读版本号 + 升级说明 -->
    <PublishCheckDialog
      v-model:visible="publishDialogVisible"
      v-model:release-notes="releaseNotes"
      :version-label="versionLabel"
      :bump="versionBump"
      :first-publish="versionFirstPublish"
      :check="publishCheck"
      :publishing="publishing"
      :at-max="versionAtMax"
      :next-loading="nextLabelLoading"
      @update:bump="setVersionBump"
      @publish="doPublish"
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
/* 岗位名称静态展示（编辑入口已移至人格页签） */
.tb-name-display {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ============ 保存时的完整性提示条（md §9.1 末段，2026-09-09 Q11） ============ */
.pd-complete-banner {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 20px;
  font-size: 13px;
  line-height: 20px;
  color: var(--c-warning);
  background: var(--c-warning-soft);
  border-bottom: 1px solid var(--c-border);
}
.pd-cb-icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  /* 2026-09-12 审计 K43：原 --c-bg 未定义 → 图标与圆底同色看不见；改用强调底上的文字反色令牌 */
  color: var(--c-text-on-accent);
  background: var(--c-warning);
}
.pd-cb-text {
  flex: 1;
  min-width: 0;
}
.pd-cb-item {
  cursor: pointer;
  font-weight: 600;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}
.pd-cb-item:hover {
  opacity: 0.75;
}
.pd-cb-close {
  flex: 0 0 auto;
  cursor: pointer;
  font-size: 16px;
  line-height: 20px;
  opacity: 0.6;
}
.pd-cb-close:hover {
  opacity: 1;
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
}
.pd-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: var(--space-3) var(--space-6) 0;
}
/* 内容区照原型 pd2-content：浅灰（sunken）底铺满，内容列在其上居中限宽 */
.pd-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bg-sunken);
  padding: 0 var(--space-6);
}
/* 铺满型页签（自动化任务/数据底座/效果测试）：内容区禁止外层滚动，把滚动权交给内部组件 */
.pd-tabs.tab-flush :deep(.el-tabs__content) {
  overflow: hidden;
  padding: 0;
}
.pd-tabs :deep(.el-tab-pane) {
  height: 100%;
}
/* 常规内容页：照原型 pd2-pane 居中限宽（max-width 1180px），卡片纵向排布 */
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
/* 铺满型页（数据底座/样例任务/效果测试内联，自带三栏/两栏布局）：同进居中限宽容器，纵向不留白 */
.pd-pane--flush {
  height: 100%;
  padding: 0;
  gap: 0;
}
/* .pd-sec / .pd-list-head / .pd-table / .pd-drawer-form 等岗位详情通用段落与列表类已上收为全局 assets/position-detail.css（2026-08-28），
   供各 Tab 内嵌组件（如工作档案 PositionDataTableStage）复用，不再各自复制。 */
/* Agent 与技能页签样式段（层级列表 / 表格包卡 / 抽屉勾选区）随拆分搬入 PositionAgentSkillTab.vue */

/* 人格页签样式段（必填星 / .pd-card 卡片家族 / 示例问题 3 格）随拆分搬入 PositionPersonaTab.vue
   （.pd-card 家族在人格与 Agent 两子组件各持一份：scoped 样式不穿子组件内层 DOM，也罩不住 append-to-body 抽屉） */
/* 知识页签样式段（名称高亮 / 工具栏）随拆分搬入 PositionKnowledgeTab.vue */
/* 只读冻结兜底：工作档案 / 自动化任务两个内嵌 Stage 暂无 readonly prop，
   查看态 / 审核中用 pointer-events 冻结（demo 口径，正式实现由后续批次下沉 readonly）。 */
.pd-ro-freeze {
  pointer-events: none;
  opacity: 0.72;
}
</style>
