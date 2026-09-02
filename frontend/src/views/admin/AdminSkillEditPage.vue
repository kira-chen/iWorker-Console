<script setup>
/**
 * 技能整页编辑器（技能菜单「编辑」入口）。
 *
 * 复用岗位白板的 SkillFocusEditor（Milkdown + 工具坞），替代旧 AdminSkillEditor 抽屉。
 * 只编 name / triggers / skill_md / 工具引用；保存契约 = PUT /fde/skills/{id}（不写 sop_doc/schema）。
 *
 * 容器：沉浸式整屏（自带后台窄轨 AdminRail，不挂 AdminLayout），与岗位工作台体验一致；
 * 顶部条提供「返回技能列表」入口与自动保存提示；focus-stage 为 SkillFocusEditor 提供铺满的定位父级。
 *
 * 岗位归属：
 * - skill.positionId 非空 → 拉该岗位详情取岗位名（面包屑回返）；工具坞数据表 tab 按岗位正常；
 * - skill.positionId 为空（游离技能 / 未绑定岗位）→ 不拉岗位，传空 positionId 触发降级（工具坞数据表 tab 禁用、面包屑无岗位前缀）。
 * 注（反馈 5）：面包屑「所属 Agent ▾」下拉与「同组」切换已移除，故不再向 SkillFocusEditor 传 agents/currentAgentId。
 *
 * 保存（沿用工作台混合保存的「技能改动 debounce 自动保存」）：update:skill → 2s debounce → patchSkill。
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, defineAsyncComponent, h } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import { platformSkillApi, systemSkillApi } from '@/api/platformSkill'
import {
  getBizSystemOwnedSkillDetail,
  updateBizSystemOwnedSkill
} from '@/api/admin'
import { setSkillCategory } from '@/api/skillCategory'
// 技能分类选项统一同源 fieldDict（固定 8 类，2026-09-01 疑点8 处置），不再调 skillCategory.js 列表接口。
import { listFieldDict } from '@/api/fieldDict'
import {
  apiFor,
  SKILL_TYPE,
  skillPublishReadiness,
  deriveSkillDisplayView
} from '@/api/unifiedSkill'
import AdminRail from '@/components/admin/AdminRail.vue'
import SkillFocusEditor from '@/components/position/SkillFocusEditor.vue'
import VersionDrawer from '@/components/admin/VersionDrawer.vue'
// 组④：效果测试台按需异步加载（重组件，仅点试跑才拉）。
// 兜底（CR）：加 loading/error 占位 + timeout + chunk 加载失败 toast，弱网不至于浮层空白无反馈。
const TestLoading = { render: () => h('div', { class: 'se-test-fallback' }, '正在打开试跑…') }
const TestError = { render: () => h('div', { class: 'se-test-fallback' }, '试跑组件加载失败，请检查网络后重试') }
const EffectTestStage = defineAsyncComponent({
  loader: () => import('@/components/test/EffectTestStage.vue'),
  loadingComponent: TestLoading,
  errorComponent: TestError,
  delay: 200,
  timeout: 15000,
  onError(err, retry, fail) {
    ElMessage.error('试跑组件加载失败（网络异常），请稍后重试')
    fail()
  }
})
import { listSkillFiles, getSkillFile, saveSkillFile, downloadSkillFile } from '@/api/skillFiles'
import {
  ENTRY_PATH,
  extOf,
  diffRemovedTools,
  setSkillPackageLimits
} from '@/utils/skillFileTree'
// 2026-09-01 PRD 对齐改造（治理页）：技能整页只读/编辑被「审核中心 / 我的申请」以
// query（govReview / myApp）借用为 SKILL 类型的业务原生详情页，此时渲染吸底操作栏
// （审核中心：关闭|驳回|通过；我的申请：按审核结果出按钮 / 编辑态 关闭|提交审核）。
// 注：治理 api 层（reviews/myApplications）走**动态 import**——静态引会把 api/request →
// @/router 的链条拖进本页测试（它们部分 mock 了 vue-router，无 createRouter 导出即炸）；
// 治理借用态仅按需触发，动态引在功能上等价且不扩大既有测试的模块图。
import ReviewRejectDialog from '@/components/admin/ReviewRejectDialog.vue'
import {
  confirmApproveReview,
  confirmWithdrawMyApp,
  alertResubmitSuccess
} from '@/utils/govDialogs'

const route = useRoute()
const router = useRouter()
const store = usePositionStore()

/**
 * 数据源切换（V34 切片1）：同一整页编辑器同时服务「FDE 技能」与「平台技能」，
 * 由路由 meta.skillSource 区分（默认 'fde'，零改动；平台技能传 'platform'）。
 * 平台技能走 /fde/platform-skills 端点，且无岗位归属（positionId 恒 null → 编辑器自动降级：
 * 隐藏岗位/Agent 面包屑与数据表 tab），故返回列表的路由名同步切换。
 */
const isPlatform = computed(() => route.meta.skillSource === 'platform')
// 只读浏览态（V92，meta.readonly=true）：整页降级为只读——SkillFocusEditor 传 :readonly，
// 所有写链路（自动保存/配置保存/离开 flush）短路。用于「用户上传待确认技能」等只读预览场景，
// 与既有 platform/system source 正交（source 仍决定数据源端点，readonly 仅决定能否写）。
// 2026-09-01：技能列表「查看」入口 = 编辑路由 + ?view=1（router 冻结不加只读路由，query 承载只读语义），
// 与 meta.readonly 等效（编辑页顶行加「只读查看」标记由 SkillFocusEditor adminContext 渲染）。
const readonly = computed(() => route.meta.readonly === true || route.query?.view === '1')
// V89 系统默认技能通道视图（meta.skillChannel='system'）：同 platform 数据源（同端点，通道建时已落定），
// 仅隐藏市场用户面字段（默认安装/技能分类）并把返回路由指回系统默认技能列表。
const isSystemChannel = computed(() => isPlatform.value && route.meta.skillChannel === 'system')
// N8：业务系统专属技能（第三类）编辑模式。数据源走 /fde/connectors/biz-systems/{bizId}/skills。
// 与平台/FDE 的最大差别：无多文件包（只编单 SKILL.md）、无展示分类、无平台发布态、无岗位归属。
const isBizSystem = computed(() => route.meta.skillSource === 'bizSystem')
// 业务系统 id（拼端点 + 返回业务系统列表用）。仅 bizSystem 模式有值。
const bizId = computed(() => route.params.bizId)
// skillFiles.js 的 source 前缀分支（F4：仅此处收敛）。业务系统技能无独立文件端点 → 不接文件树，故 source 用不到（保留 'fde' 占位，绝不调）。
// V89：系统默认技能走 /fde/system-skills 前缀（通道前缀分段隔离，端点与 platform 同构）。
const fileSource = computed(() => {
  if (isSystemChannel.value) return 'system'
  return isPlatform.value ? 'platform' : 'fde'
})
// 平台族命名空间 API 按通道整体切换（详情/保存；跨通道 id 后端一律 404）。
const channelApi = computed(() => (isSystemChannel.value ? systemSkillApi : platformSkillApi))
// 返回列表：技能三页合一后（2026-08-23）三类统一回「技能」页；业务系统技能仍回其自己的列表。
const listRouteName = computed(() => (isBizSystem.value ? 'AdminBizSystems' : 'AdminSkillsUnified'))
const editRouteName = computed(() => {
  if (!isPlatform.value) return 'AdminSkillEdit'
  return isSystemChannel.value ? 'SysConfigSystemSkillEdit' : 'SysConfigSkillEdit'
})
// 顶部条返回文案：平台技能带「平台」标识当前所在列表场景（与菜单「平台技能」口径一致）。
// #2：返回文案 FDE/平台一律「← 返回」（不再区分技能列表/平台技能列表）。
const backLabel = computed(() => '← 返回')
// 详情 / 保存：平台技能走平台端点；业务系统技能走 biz-systems/{bizId}/skills 端点；FDE 沿用 position store。
// 注：整页编辑器无删除入口（见 SkillFocusEditor 删除 ⋯ 仅 showClose=true 工作台渲染），故此处不含删除分支。
function loadDetail(skillId) {
  if (isBizSystem.value) return getBizSystemOwnedSkillDetail(bizId.value, skillId)
  return isPlatform.value ? channelApi.value.get(skillId) : store.fetchSkillDetail(skillId)
}
function saveDetail(skillId, payload) {
  if (isBizSystem.value) return updateBizSystemOwnedSkill(bizId.value, skillId, payload)
  if (isPlatform.value) return channelApi.value.update(skillId, payload)
  return store.patchSkill(skillId, payload).then(({ skill }) => skill)
}

/* ---------- 当前技能编辑态 ---------- */
const skill = ref(null)
const loading = ref(false)
const loadError = ref(false)

// 岗位上下文（positionId 非空时装载）：岗位名供面包屑回返（反馈 5：已去 Agent▾/同组，不再需要 agents/currentAgentId）。
const positionId = ref(null)
const positionName = ref('岗位')

// 全线 ID 改造 方案B/B3：skill id 已字符串化（sk_*），路由参数原样作字符串用，不再 Number()（会变 NaN）。
const currentSkillId = computed(() => route.params.id)

/* ---------- 技能包多文件状态（切片3，F2/F3 per-path 缓存 + dirtyMap） ---------- */
// 后端扁平 files[]（SkillFileTreeVO.files）。
const files = ref([])
const treeLoading = ref(false)
const treeLoadError = ref(false)
// 当前激活文件。默认入口 SKILL.md。
const activeFilePath = ref(ENTRY_PATH)
// per-path 内容缓存 + savedContent 快照 + 脏态 + .json 错态（F2/F3 新增复杂度核心）。
const contentCache = reactive({}) // { [path]: 当前内容 }
const savedCache = reactive({}) // { [path]: 上次保存内容快照 }
const dirtyMap = reactive({}) // { [path]: true } 派生但缓存，供树渲染脏点
const jsonErrorMap = reactive({}) // { [path]: true } .json 语法错
// 平台发布态（来自详情 publications）：透传给编辑器做「审核中锁定」判定（isLocked）。
const publications = ref([])

/* ---------- 版本发布抽屉（统一 VersionDrawer，与列表页同一组件） ---------- */
const versionVisible = ref(false)
// 入参用稳定 computed（而非模板内联字面量 {...}）：内联字面量每次父组件重渲染都新建对象，
// 导致抽屉内 id/state computed + watch(immediate) 反复触发 → 首次打开先空后填「闪一下」。
// computed 仅在 skill/publications 真正变化时重算，引用稳定，与列表页同效。
const versionSkill = computed(() => {
  if (!skill.value) return null
  return { ...skill.value, id: skill.value.skillId, skillId: skill.value.skillId, publications: publications.value }
})

/**
 * 本页技能类型（2026-09-01：三类技能同构接入统一状态机）：
 * fde → POSITION（岗位私有）/ system 通道 → SYSTEM_DEFAULT（通用）/ platform → PLATFORM（市场）。
 * 业务系统技能不入统一状态机（无版本/发布概念），返回 null。
 */
const pageSkillType = computed(() => {
  if (isBizSystem.value) return null
  if (!isPlatform.value) return SKILL_TYPE.POSITION
  return isSystemChannel.value ? SKILL_TYPE.SYSTEM_DEFAULT : SKILL_TYPE.PLATFORM
})

/** 发布就绪门（清单19：与列表共用同一 readiness 谓词；SKILL.md 取当前编辑态正文）。 */
const publishReadiness = computed(() => {
  const s = skill.value
  if (!s) return { ready: false, missing: [] }
  return skillPublishReadiness({
    name: s.name,
    type: pageSkillType.value,
    displayCategoryId: s.displayCategoryId,
    icon: s.icon,
    description: s.description,
    exampleQuestion: s.exampleQuestion,
    skillMd: s.skillMd
  })
})

/** 技能版本适配器（与列表页同构：apiFor 按类型分流；三态标签；启用互斥 + 最后启用版守卫）。 */
const versionAdapter = computed(() => {
  const sk = versionSkill.value
  if (!sk || !pageSkillType.value) return null
  const api = apiFor({ type: pageSkillType.value })
  const sid = sk.skillId
  return {
    title: '版本管理',
    entityLabel: '技能',
    entityKey: '技能名称',
    name: sk.name,
    id: sid,
    // 顶部状态标签三态（未发布/审核中/已发布）；state 保留内部原始态供首发判定/动作矩阵。
    deriveView: () => deriveSkillDisplayView(sk.publications),
    nextVersionLabel: (id) => api.nextVersionLabel(id),
    publish: (id, payload) => api.publish(id, payload),
    withdraw: (id) => api.withdrawPublish(id),
    listVersions: (id) => api.listSnapshots(id, 'USER_END'),
    mapRow: (sn) => ({ ...sn, verLabel: sn.versionLabel }),
    delist: (r) => api.delistSnapshot(sid, r.version, 'USER_END'),
    relist: (r) => api.relistSnapshot(sid, r.version, 'USER_END'),
    delistTerm: '禁用',
    relistTerm: '启用',
    activeLabel: '已启用',
    guardLastActive: true,
    lastActiveTip: '当前版本是该技能最后一个启用版本。如需停止对外提供，请先整体下架技能',
    exclusiveActive: true,
    // 【发布】按钮已按完整必填集置灰（publishReadiness），此处保留市场技能分类门兜底（原型 version-gate）。
    submitGate: () =>
      pageSkillType.value === SKILL_TYPE.PLATFORM && !(sk.displayCategoryId ?? null)
        ? '该技能还未选择「技能分类」，按规则不可提交发布。请到技能编辑页选择分类并保存后再来发布。'
        : '',
    // 疑点10：撤回确认保留现状分场景文案
    withdrawText: (state) =>
      state === 'REVIEWING'
        ? '撤回发布申请后将回到未发布态。确认撤回？'
        : '撤回在审新版后，改动回到「未提交」状态，线上版本不受影响。确认撤回？'
  }
})
function openVersionDialog() {
  // 完整发布门由【发布】按钮承担（未就绪置灰 + title 列缺项，见 SkillFocusEditor publishReadiness）。
  versionVisible.value = true
}
// 发布/撤回成功：重拉详情刷新发布态（publications）与锁定态（locked 依赖 publications）。
function onVersionDone() {
  loadSkill(currentSkillId.value)
}
// 当前激活文件类型（派生）。
const activeFileType = computed(() => extOf(activeFilePath.value) || 'md')
// 当前激活文件是否可在线编辑（完整保真，2026-07-29）：SKILL.md 恒可编辑；其余据后端节点 editable 标志；
// 未知（新建/懒迁移未入 files[]）默认可编辑。二进制文件 editable=false → 预览页走「下载态」而非编辑器。
function isEditablePath(path) {
  if (path === ENTRY_PATH) return true
  const node = files.value.find((f) => f.path === path)
  return node ? node.editable !== false : true
}
const activeEditable = computed(() => isEditablePath(activeFilePath.value))

/* ---------- 保存状态四态（组① · 数据安全）：聚合 dirtyMap / 在途保存 / 失败 / lastSavedAt ---------- */
const savingCount = ref(0) // 在途自动保存请求数（>0 → 保存中）
const saveErrorPaths = reactive({}) // { [path]: true } 上次保存失败的文件（含 ENTRY_PATH）
const lastSavedAt = ref(0) // 最近一次成功保存的时间戳（相对时间显示用）
const flushing = ref(false) // 返回/切文件等触发的 flush 进行中（给 loading 态，避免点了无反馈）
// 未保存文件数（聚合）：dirtyMap 真值键数。
const dirtyCount = computed(() => Object.values(dirtyMap).filter(Boolean).length)
const hasSaveError = computed(() => Object.values(saveErrorPaths).some(Boolean))
const hasUnsaved = computed(() => dirtyCount.value > 0)
// 四态聚合：失败优先 > 保存中/flush > 有未保存 > 已保存（有过保存）> idle。
const saveStatus = computed(() => {
  if (hasSaveError.value) return { phase: 'error', dirtyCount: dirtyCount.value }
  if (savingCount.value > 0 || flushing.value) {
    return { phase: 'saving', dirtyCount: dirtyCount.value, flushing: flushing.value }
  }
  if (hasUnsaved.value) return { phase: 'editing', dirtyCount: dirtyCount.value }
  if (lastSavedAt.value > 0) return { phase: 'saved', savedAt: lastSavedAt.value }
  return { phase: 'idle' }
})

// 标记某文件保存结果（成功清错 + 记时间；失败置错）。
function markSaved(path) {
  delete saveErrorPaths[path]
  lastSavedAt.value = Date.now()
}
function markSaveError(path) {
  saveErrorPaths[path] = true
}

/* ---------- 配置区（手动保存）：与 SKILL.md 文档区自动保存拆开 ----------
 * 需求（2026-07-08）：只有 Markdown 文档区（SKILL.md 正文 + references 等文件）自动保存；
 * 技能其它配置（名称/描述/触发词/示例问题/默认安装/展示分类）改动只标脏，须用户点「保存配置」才提交。
 * 展示分类并入手动保存（不再选即存）；离开/切技能时配置只提示不自动存（数据安全靠确认框，不静默提交）。 */
const savedConfig = reactive({
  name: '', icon: '', description: '', triggers: [], exampleQuestion: '', defaultInstall: false, displayCategoryId: null
})
const configSaving = ref(false)
// 把当前 skill 的配置字段设为「已保存」基线（loadSkill 后 / 保存成功后调用）。
function snapshotConfig() {
  const s = skill.value || {}
  savedConfig.name = s.name ?? ''
  savedConfig.icon = s.icon ?? ''
  savedConfig.description = s.description ?? ''
  savedConfig.triggers = [...(s.triggers ?? [])]
  savedConfig.exampleQuestion = s.exampleQuestion ?? ''
  savedConfig.defaultInstall = !!s.defaultInstall
  savedConfig.displayCategoryId = s.displayCategoryId ?? null
}
function sameStrList(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
// 配置区是否有未保存改动（任一受管字段 ≠ 基线）。
const configDirty = computed(() => {
  const s = skill.value
  if (!s) return false
  return (s.name ?? '') !== savedConfig.name
    || (s.icon ?? '') !== savedConfig.icon
    || (s.description ?? '') !== savedConfig.description
    || !sameStrList(s.triggers ?? [], savedConfig.triggers)
    || (s.exampleQuestion ?? '') !== savedConfig.exampleQuestion
    || !!s.defaultInstall !== savedConfig.defaultInstall
    || (s.displayCategoryId ?? null) !== savedConfig.displayCategoryId
})

// 当前激活文件内容（供编辑器双向绑定）。SKILL.md 走 skill.skillMd（运行时镜像），其它走 contentCache。
const activeFileContent = computed({
  get: () => {
    if (activeFilePath.value === ENTRY_PATH) return skill.value?.skillMd || ''
    return contentCache[activeFilePath.value] ?? ''
  },
  set: (v) => onUpdateActiveContent(v)
})

/* ---------- 技能分类选项（2026-09-01 疑点8：三类技能均显示，固定 8 类 fieldDict 同源）----------
 * 不再调 skillCategory.js 后端接口取选项；demo 用「分类名」充当 id（与 unifiedSkillMock 口径一致）。
 * 业务系统技能无分类概念，不拉。 */
const categoryOptions = ref([])
async function loadCategoryOptions() {
  if (isBizSystem.value) return // 业务系统技能无分类概念
  try {
    const dict = await listFieldDict()
    categoryOptions.value = (dict?.skillCategory || []).map((c) => ({ id: c.name, name: c.name }))
  } catch (e) {
    // 分类读失败：选择器降级为空、不阻断技能编辑（displayCategoryId 仍回填当前值，只是没得选/改）
  }
}

// 技能挂分类改动：并入手动「保存配置」（2026-07-08）——此处只更新本地态 + 标脏（configDirty 派生），
// 不再即时调 setSkillCategory；实际提交在 saveConfig。
function onUpdateDisplayCategory(categoryId) {
  const id = skill.value?.skillId
  if (id == null || !skill.value) return
  const next = categoryId || null
  if ((skill.value.displayCategoryId ?? null) === next) return
  skill.value = { ...skill.value, displayCategoryId: next }
}

onMounted(() => {
  loadSkill(currentSkillId.value)
  loadCategoryOptions()
  // 治理借用态（2026-09-01）：按 query 拉审核/申请行渲染吸底操作栏
  loadGovContext()
})
// 前往修改会 router.replace 到编辑路由（同组件复用不重挂）：query 变化时重拉治理行
watch(
  () => [route.query?.govReview, route.query?.myApp],
  () => loadGovContext()
)
onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  clearTimeout(fileSaveTimer)
  store.reset()
})

/* ---------- 加载技能 + 岗位上下文 ----------
 * B7 首屏并行（性能批次一）：详情（loadDetail）与目录树（listSkillFiles）无依赖（skillId 来自路由、
 * entryPath 恒 SKILL.md）→ 两请求**同时发起**并发，去掉「详情→岗位→树」三段串行瀑布，首屏 RTT 由「和」降为「max」。
 * 岗位名（store.load）依赖详情返回的 positionId，且仅供面包屑、失败不阻断 → 详情到达后**异步补**、不进首屏关键路径。
 * 竞态护栏：两路各自回填前校验 currentSkillId 仍为发起时 skillId（与原逻辑一致）；
 * 树须等详情设好 skill 后再 apply（syncEntryCache 读 skill.skillMd 做脏态基线）。 */
async function loadSkill(skillId) {
  loading.value = true
  loadError.value = false
  treeLoading.value = true
  treeLoadError.value = false
  positionId.value = null
  positionName.value = '岗位'
  // 并发发起：详情 + 目录树（互不依赖，同时打出请求）。
  // N8：业务系统技能无独立文件端点 → 不拉目录树，files 恒空，编辑器退化为单 SKILL.md 两栏（复用 SkillFocusEditor 既有降级）。
  const detailP = loadDetail(skillId)
  const treeP = isBizSystem.value ? Promise.resolve({ files: [] }) : listSkillFiles(skillId, fileSource.value)
  // detailReady：详情成功设好 skill 后 resolve；失败 reject（让树分支提前退出）。
  let detailResolve
  let detailReject
  const detailReady = new Promise((res, rej) => {
    detailResolve = res
    detailReject = rej
  })
  detailReady.catch(() => {}) // 防 unhandledrejection（reject 仅用于通知树分支）
  // 树分支：独立并发，等详情就绪后再 apply。失败不阻断 SKILL.md 编辑（树区单独错误条 + 重试）。
  const applyTree = (async () => {
    try {
      const tree = await treeP
      // 技能包上限（文件数/层级）以后端下发为准：改后端配置前端即时适配、无需发版（全局配置，不区分技能，无竞态顾虑）。
      setSkillPackageLimits(tree?.limits)
      await detailReady // 等 skill.value 设好再 apply
      if (currentSkillId.value !== skillId || skill.value?.skillId !== skillId) return
      files.value = tree?.files || []
      resetFileState()
      syncEntryCache()
    } catch (e) {
      if (currentSkillId.value === skillId) treeLoadError.value = true
    } finally {
      if (currentSkillId.value === skillId) treeLoading.value = false
    }
  })()
  try {
    const data = await detailP
    // B 竞态护栏：await 期间若路由已切到别的技能，丢弃过期详情。
    if (currentSkillId.value !== skillId) {
      detailReject(new Error('stale'))
      return
    }
    skill.value = {
      skillId: data.skillId,
      name: data.name || '',
      // 图标（2026-09-01 疑点4：发布必填集成员）：详情回填，随配置保存提交。
      icon: data.icon || '',
      // 描述（§11.4 受管键）：详情携带，纳入编辑态 + autoSave PUT 载荷。
      description: data.description || '',
      triggers: data.triggers || [],
      // N2 技能示例问题（2026-09-01 疑点5：必填）：详情回填，随技能 PUT 提交（编辑/发布门校验）。
      exampleQuestion: data.exampleQuestion || '',
      // N9 平台技能默认安装标记（仅平台技能编辑有意义）：详情回填，随技能 PUT 提交。
      defaultInstall: !!data.defaultInstall,
      skillMd: data.skillMd || '',
      referencedTools: data.referencedTools || [],
      agentId: data.agentId ?? null,
      // 派生类别（只读派生标签，前端不可改；保存回显会刷新它）
      category: data.category ?? null,
      // N3 展示分类引用 id（可空=未分类）。并入手动「保存配置」（2026-07-08：不再选即存）。
      displayCategoryId: data.displayCategoryId ?? null,
      // 只读元信息（2026-09-01 清单22：编辑区底部元信息条）
      createdAt: data.createdAt || '',
      updatedAt: data.updatedAt || '',
      lastPublishedAt: data.lastPublishedAt || '',
      versionLabel: data.versionLabel || ''
    }
    snapshotConfig() // 配置区脏态基线（详情即已保存态）
    // 2026-09-01：三类技能统一携带 publications（岗位私有已接入同构状态机，mock 派生）。
    publications.value = data.publications || []
    detailResolve() // 通知树分支：skill 已就绪，可 apply tree
    // 岗位名：依赖详情的 positionId，仅供面包屑、失败不阻断 → 异步补，不 await 进首屏关键路径。
    if (data.positionId != null) {
      positionId.value = data.positionId
      store
        .load(data.positionId)
        .then(() => {
          if (currentSkillId.value === skillId) positionName.value = store.basic?.name || '岗位'
        })
        .catch(() => {
          /* 岗位详情拉取失败不阻断技能编辑：面包屑降级到岗位名占位即可 */
        })
    }
    // 汇合树分支（已并发，此处仅等其完成，不再串行新请求）。
    await applyTree
  } catch (e) {
    detailReject(e) // 详情失败 → 树分支提前退出
    if (currentSkillId.value === skillId) loadError.value = true
  } finally {
    if (currentSkillId.value === skillId) loading.value = false
  }
}

/* ---------- 目录树装载（F6 懒迁移：存量技能后端兜底虚拟出 SKILL.md 节点） ---------- */
async function loadTree(skillId) {
  treeLoading.value = true
  treeLoadError.value = false
  try {
    const tree = await listSkillFiles(skillId, fileSource.value)
    setSkillPackageLimits(tree?.limits) // 上限随树响应刷新（全局配置，不受技能切换竞态影响）
    if (currentSkillId.value !== skillId) return
    files.value = tree?.files || []
    // 复位多文件态：清缓存/脏态，默认激活入口；SKILL.md 内容 = skill.skillMd（运行时镜像，无需再拉）。
    resetFileState()
    syncEntryCache()
  } catch (e) {
    if (currentSkillId.value === skillId) treeLoadError.value = true
  } finally {
    if (currentSkillId.value === skillId) treeLoading.value = false
  }
}

function resetFileState() {
  for (const k of Object.keys(contentCache)) delete contentCache[k]
  for (const k of Object.keys(savedCache)) delete savedCache[k]
  for (const k of Object.keys(dirtyMap)) delete dirtyMap[k]
  for (const k of Object.keys(jsonErrorMap)) delete jsonErrorMap[k]
  // 组①：复位保存态（切技能/重载树不串上一个技能的失败/未保存/时间）。
  for (const k of Object.keys(saveErrorPaths)) delete saveErrorPaths[k]
  savingCount.value = 0
  flushing.value = false
  lastSavedAt.value = 0
  activeFilePath.value = ENTRY_PATH
}

// SKILL.md 内容与 skill.skillMd 互为镜像：把 entry 的 savedContent 快照对齐 skillMd（脏态推导基线）。
function syncEntryCache() {
  savedCache[ENTRY_PATH] = skill.value?.skillMd ?? ''
}

/* ---------- 技能改动回吐 → 拆两条链路：SKILL.md 正文自动保存 / 其它配置留手动保存 ---------- */
let saveTimer = null
function onUpdateSkill(next) {
  if (readonly.value) return   // 只读态：忽略任何回吐，不置脏、不排自动保存
  const prevMd = skill.value?.skillMd ?? ''
  skill.value = next
  // 维护 SKILL.md（entry）脏态：当前 skillMd ≠ 上次保存快照。
  recomputeEntryDirty()
  // 仅 SKILL.md 正文变化才排 2s 自动保存；名称/描述/触发词/示例问题/默认安装等配置改动只反映到
  // configDirty（等用户点「保存配置」），不再自动 PUT。
  if ((next?.skillMd ?? '') !== prevMd) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(autoSaveEntry, 2000)
  }
}

function recomputeEntryDirty() {
  const cur = skill.value?.skillMd ?? ''
  if (cur !== (savedCache[ENTRY_PATH] ?? '')) dirtyMap[ENTRY_PATH] = true
  else delete dirtyMap[ENTRY_PATH]
}

// SKILL.md 正文自动保存（文档区）：PUT 只带 skillMd。不带 name/triggers/exampleQuestion——
// 这些配置字段由「保存配置」手动链路提交，避免文档自动保存把用户未点保存的配置一起冲提交。
// 因不带 triggers/exampleQuestion，后端部分更新不会触发 N1/N2 必填校验，文档保存不被必填拦。
// 返回是否「无需保存或保存成功」（false=保存失败），供手动「保存」链路（saveConfig 冲刷调用）区分提示文案。
async function autoSaveEntry() {
  clearTimeout(saveTimer)
  const s = skill.value
  if (!s || s.skillId == null) return true
  const id = s.skillId
  // F3 空 PUT 跳过：SKILL.md 无脏改动不发。
  const wasEntryDirty = !!dirtyMap[ENTRY_PATH]
  if (!wasEntryDirty) return true
  savingCount.value += 1 // 组①：在途保存 → 状态灯「保存中…」
  let ok = true
  try {
    const saved = await saveDetail(id, { skillMd: s.skillMd })
    // 仅当仍停留在同一技能时才回填后端回显的 referencedTools（健康态四态）+ 派生类别。
    if (saved && skill.value?.skillId === id) {
      const patch = {}
      if (saved.referencedTools) patch.referencedTools = saved.referencedTools
      if ('category' in saved) patch.category = saved.category
      if (Object.keys(patch).length) skill.value = { ...skill.value, ...patch }
      // 保存成功 → 刷新 entry 快照、清脏态。
      savedCache[ENTRY_PATH] = skill.value?.skillMd ?? ''
      recomputeEntryDirty()
    }
    if (skill.value?.skillId === id) markSaved(ENTRY_PATH) // 绿勾 + 相对时间
  } catch (e) {
    ok = false
    if (skill.value?.skillId === id) markSaveError(ENTRY_PATH) // 红 + 重试
  } finally {
    savingCount.value = Math.max(0, savingCount.value - 1)
  }
  return ok
}

// 手动保存配置区（用户点「保存」）：name/description/exampleQuestion/defaultInstall 一次 PUT，
// 展示分类脏则再走独立端点。此路径即「保存门」——必填项为空则提示补齐并拦下（不静默丢，也不提交半成品）。
// 2026-08-17：①按钮任何时刻可点——无脏改动也照常提交（幂等 PUT，同值覆写无副作用），不再无脏早退；
// ②点「保存」同时冲刷 SKILL.md 未保存正文（flush 文档区 2s debounce，entry 无脏自动跳过）。
async function saveConfig() {
  if (readonly.value) return   // 只读态：不提交配置
  const s = skill.value
  if (!s || s.skillId == null) return
  const id = s.skillId
  // 2026-09-01 保存门（清单20 对齐原型 skill-editor-save 校验链）：
  // 名称必填 ≤64 / 分类必选 / 描述必填 ≤2000 / 示例问题必填 ≤60（业务系统技能沿用旧口径豁免分类）。
  const nameText = String(s.name || '').trim()
  if (!nameText || nameText.length > 64) {
    ElMessage.warning('请填写不超过 64 个字符的技能名称')
    return
  }
  const catRequired = !isBizSystem.value
  if (catRequired && !(s.displayCategoryId ?? null)) {
    ElMessage.warning('请选择技能分类')
    return
  }
  const descText = String(s.description || '').trim()
  if (!isBizSystem.value && (!descText || descText.length > 2000)) {
    ElMessage.warning('请填写不超过 2000 个字符的技能描述')
    return
  }
  const exampleText = String(s.exampleQuestion || '').trim()
  if (!isBizSystem.value && (!exampleText || exampleText.length > 60)) {
    ElMessage.warning('请填写不超过 60 个字符的示例问题')
    return
  }
  const catChanged = (s.displayCategoryId ?? null) !== savedConfig.displayCategoryId
  configSaving.value = true
  try {
    const saved = await saveDetail(id, {
      name: s.name,
      description: s.description,
      // 图标（2026-09-01 疑点4）：随配置保存提交（发布必填集成员）。
      icon: s.icon,
      // 不带 triggers：填写入口已下线（2026-08-13），后端为部分更新语义，不带即不动库内数据；
      // 若透传（空技能为 []）会误触后端「显式编辑触发词必 ≥1」保存门（N1），把无关配置保存拦死。
      exampleQuestion: s.exampleQuestion,
      // N9 默认安装标记：仅平台技能有意义，FDE 技能提交后端忽略（部分更新）。
      defaultInstall: s.defaultInstall
      // 不带 skillMd：正文由文档区自动保存，配置保存不重复提交正文。
    })
    if (skill.value?.skillId !== id) return
    if (saved) {
      const patch = {}
      if (saved.referencedTools) patch.referencedTools = saved.referencedTools
      if ('category' in saved) patch.category = saved.category
      if (Object.keys(patch).length) skill.value = { ...skill.value, ...patch }
    }
    // 技能分类并入手动保存：脏时调独立端点提交（2026-09-01 起三类技能均有分类，业务系统技能除外）。
    if (catChanged && catRequired) await setSkillCategory(id, s.displayCategoryId ?? null)
    // 2026-08-17：点「保存」同时冲刷 SKILL.md 未保存正文（取消 2s debounce 立即提交；entry 无脏则内部跳过）。
    // entry 失败不抛（autoSaveEntry 内部已标红「重试」入口），此处仅区分提示文案，不吞掉配置已保存的事实。
    const entryOk = await autoSaveEntry()
    if (skill.value?.skillId === id) {
      snapshotConfig() // 刷新配置基线 → configDirty 归零
      lastSavedAt.value = Date.now()
      if (entryOk) ElMessage.success('技能配置已保存')
      else ElMessage.warning('配置已保存，但 SKILL.md 正文保存失败，可在顶部保存状态处重试')
    }
  } catch (e) {
    if (skill.value?.skillId === id) ElMessage.error(e?.message || '配置保存失败')
  } finally {
    configSaving.value = false
  }
}

/* ---------- 非入口文件（references/*.md / *.json / *.txt）编辑 → 端点5 PUT，(skillId,path) 竞态键 ---------- */
let fileSaveTimer = null
// 编辑器回吐当前激活文件内容（仅非 entry 走此；entry 走 skill.skillMd 链路）。
function onUpdateActiveContent(v) {
  if (readonly.value) return   // 只读态：忽略文件内容回吐
  const path = activeFilePath.value
  if (path === ENTRY_PATH) {
    // entry 由 SkillMilkdownEditor 通过 update:skill 回吐，不会走到此（防御）。
    return
  }
  contentCache[path] = v
  if (v !== (savedCache[path] ?? '')) dirtyMap[path] = true
  else delete dirtyMap[path]
  clearTimeout(fileSaveTimer)
  fileSaveTimer = setTimeout(() => autoSaveFile(path), 2000)
}

// 保存单个非 entry 文件（端点5）。竞态键 = (skillId, path)：回填前校验仍停留在发起时的 (skillId,path)。
async function autoSaveFile(path) {
  const id = skill.value?.skillId
  if (id == null || path === ENTRY_PATH) return
  // F3 空 PUT 跳过：无脏改动不发。
  if (!dirtyMap[path]) return
  const content = contentCache[path] ?? ''
  savingCount.value += 1 // 组①：在途保存 → 状态灯「保存中…」
  try {
    const saveVO = await saveSkillFile(id, { path, content }, fileSource.value)
    // (skillId, path) 竞态护栏：回填前校验仍停留在发起时的技能与文件。
    if (skill.value?.skillId !== id) return
    savedCache[path] = content
    if ((contentCache[path] ?? '') === content) delete dirtyMap[path]
    applyFileSaveVO(saveVO)
    markSaved(path) // 绿勾 + 相对时间
  } catch (e) {
    if (skill.value?.skillId === id) markSaveError(path) // 红 + 重试
    // 脏态保留（不清），下次编辑/切文件再重试。
  } finally {
    savingCount.value = Math.max(0, savingCount.value - 1)
  }
}

// 把 SkillFileSaveVO 的回吐应用到页面态：刷新树 + referencedTools/category（全包聚合回吐）。
//
// 批次二「按回吐 flags 跳过重建」（契约 §1.4/§1.5，性能主战场）：
// 后端瘦身回吐新增 treeChanged / refsChanged 两个 Boolean 标志位。消费铁律——**只有显式 === false 才跳过**：
//  - treeChanged === false → 树结构未变（内容覆盖保存）→ 不替换本地 files、不触发 el-tree 整树重建
//    （消除每 2s 整树重渲与选中态闪烁，B5 根因）。
//  - refsChanged === false → 引用集指纹未变 → 不动 referencedTools 工具白名单（保留现值）。
// 缺省（undefined，老后端不带标志）语义 = 全量回吐：treeChanged/refsChanged 非 false 时按现状全量替换，
// 不崩、不丢功能（仅未享瘦身收益）。tree/referencedTools 仍各自判空（瘦身回吐时后端置 null）。
function applyFileSaveVO(saveVO) {
  if (!saveVO) return
  // 树：仅当未显式标记「未变」且确有 tree.files 才整包替换（触发整树重建）。
  const shouldReplaceTree = saveVO.treeChanged !== false && saveVO.tree?.files
  if (shouldReplaceTree) files.value = saveVO.tree.files
  // 工具白名单 + 派生类别。
  const patch = {}
  const shouldReplaceRefs = saveVO.refsChanged !== false && saveVO.referencedTools != null
  if (shouldReplaceRefs) patch.referencedTools = saveVO.referencedTools
  if ('category' in saveVO && saveVO.category != null) patch.category = saveVO.category
  if (Object.keys(patch).length && skill.value) skill.value = { ...skill.value, ...patch }
}

/* ---------- 切文件（F2/F3：先 flush 当前文件再切，竞态键 (skillId,path)） ---------- */
async function onSelectFile(path) {
  if (path === activeFilePath.value) return
  const prev = activeFilePath.value
  // 1) 当前文件有脏改动 → 先 flush（等其保存完成）；失败给 confirm 让用户选是否丢弃（不静默丢）。
  if (dirtyMap[prev]) {
    const ok = await flushCurrentFile(prev)
    if (!ok) {
      try {
        await ElMessageBox.confirm(
          `当前文件「${prev}」保存失败，仍要切换吗？切换将丢失未保存改动。`,
          '保存失败',
          { type: 'warning', confirmButtonText: '仍切换', cancelButtonText: '留在当前' }
        )
      } catch {
        return // 留在当前文件
      }
    }
  }
  // 2) 切换 activeFilePath；按需拉内容（entry 用 skillMd 镜像，无需拉；非 entry 缓存未命中才拉）。
  activeFilePath.value = path
  if (path === ENTRY_PATH) return
  // 二进制/只读文件（完整保真）：无 content、不可在线编辑 → 不拉内容，预览页走下载态。
  if (!isEditablePath(path)) return
  if (contentCache[path] === undefined) {
    await loadFileContent(skill.value?.skillId, path)
  }
}

// 下载当前二进制/只读文件（完整保真）：走 blob 下载，成功/失败给 toast。
async function onDownloadFile(path) {
  const target = path || activeFilePath.value
  if (!skill.value?.skillId || !target) return
  try {
    const name = await downloadSkillFile(skill.value.skillId, target, fileSource.value)
    ElMessage.success(`已下载 ${name}`)
  } catch (e) {
    ElMessage.error(e?.message || '下载失败，请稍后重试')
  }
}

// flush 当前文件（entry → autoSave；非 entry → autoSaveFile）。返回是否成功（无脏视为成功）。
async function flushCurrentFile(path) {
  if (!dirtyMap[path]) return true
  if (path === ENTRY_PATH) {
    await autoSaveEntry() // 文档区 flush：只落 SKILL.md 正文（配置由手动保存，不在此提交）
    return !dirtyMap[ENTRY_PATH]
  }
  await autoSaveFile(path)
  return !dirtyMap[path]
}

// 拉单文件内容（竞态键 (skillId,path)：回填前校验仍停留在发起时技能与文件）。
async function loadFileContent(skillId, path) {
  if (skillId == null) return
  try {
    const vo = await getSkillFile(skillId, path, fileSource.value)
    if (skill.value?.skillId !== skillId || activeFilePath.value !== path) return
    contentCache[path] = vo?.content ?? ''
    savedCache[path] = vo?.content ?? ''
    delete dirtyMap[path]
  } catch (e) {
    // 读单文件失败：编辑器中栏照常（空），不崩整页；树选中态保持。
    if (skill.value?.skillId === skillId && activeFilePath.value === path) {
      ElMessage.error(e?.message || '文件加载失败')
    }
  }
}

/* ---------- 树操作回吐（新建/重命名/删除，由 SkillFileTree 发起请求、此处据回吐刷新态） ---------- */
function onFileCreated(path, saveVO) {
  applyFileSaveVO(saveVO)
  // 新建 = 空内容，缓存就位并自动打开新文件（先 flush 当前，再切）。
  contentCache[path] = ''
  savedCache[path] = ''
  delete dirtyMap[path]
  onSelectFile(path)
}

async function onFileRenamed(fromPath, toPath, saveVO) {
  applyFileSaveVO(saveVO)
  // 迁移缓存键（内容/快照/脏态/json 错态）。
  migrateKey(contentCache, fromPath, toPath)
  migrateKey(savedCache, fromPath, toPath)
  migrateKey(dirtyMap, fromPath, toPath)
  migrateKey(jsonErrorMap, fromPath, toPath)
  // 保持选中该文件（current 切到 toPath）。
  if (activeFilePath.value === fromPath) activeFilePath.value = toPath
}

async function onFileDeleted(path, saveVO) {
  // Q2：删前快照 referencedTools，与回吐 diff（确有工具移出才提示）。
  const beforeTools = skill.value?.referencedTools || []
  applyFileSaveVO(saveVO)
  // 清该文件缓存态。
  delete contentCache[path]
  delete savedCache[path]
  delete dirtyMap[path]
  delete jsonErrorMap[path]
  // 删的是当前打开文件 → 切回 SKILL.md（入口恒存，安全兜底）。
  if (activeFilePath.value === path) {
    activeFilePath.value = ENTRY_PATH
  }
  // Q2 删后 diff：仅确有工具被移出才给可关闭 info/warning，无变动只普通 success。
  // 铁律（与 shouldReplaceRefs 一致）：只有后端确实发来新的 referencedTools（refsChanged !== false 且 != null）
  // 才做 diff；否则视为「引用集未变」→ removed=[]，不弹移出提示（修复纯目录/删 .json·.txt 时 refsChanged=false、
  // referencedTools=null 被当空集 → 已有工具全被误判「已移出」的误报 toast）。缺省 undefined 的老后端仍走 diff，兼容不变。
  const removed =
    saveVO?.refsChanged !== false && saveVO?.referencedTools
      ? diffRemovedTools(beforeTools, saveVO.referencedTools)
      : []
  if (removed.length) {
    const names = removed.map((t) => t.bizName || t.code).join('、')
    ElMessage({ type: 'warning', message: `工具 ${names} 已移出本技能运行时白名单`, showClose: true })
  } else {
    ElMessage.success('已删除')
  }
}

function migrateKey(obj, from, to) {
  if (from in obj) {
    obj[to] = obj[from]
    delete obj[from]
  }
}

/* ---------- 结构操作回吐（文件夹新建/改名/删除、文件或文件夹移动；端点 9~12） ----------
 * SkillFileTree 发起原子请求后 emit('tree-changed', saveVO, meta)，此处据回吐刷新页面态：
 * - 一律 applyFileSaveVO 刷新树 + referencedTools/category；
 * - meta.pathMap（改名/移动）：迁移每个 fromPath→toPath 的缓存键 + 同步当前打开文件选中态；
 * - meta.removedPrefix（删文件夹）：清该子树全部缓存键，若当前打开文件落在内则切回 SKILL.md；
 * - Q2：据回吐 referencedTools diff 出被移出白名单的工具给可关闭提示。
 */
async function onTreeChanged(saveVO, meta = {}) {
  const id = skill.value?.skillId
  const beforeTools = skill.value?.referencedTools || []
  applyFileSaveVO(saveVO)
  if (skill.value?.skillId !== id) return

  // 改名 / 移动：迁移缓存键、迁移当前选中态。
  if (meta.pathMap && Object.keys(meta.pathMap).length) {
    for (const [from, to] of Object.entries(meta.pathMap)) {
      if (from === to) continue
      migrateKey(contentCache, from, to)
      migrateKey(savedCache, from, to)
      migrateKey(dirtyMap, from, to)
      migrateKey(jsonErrorMap, from, to)
      if (activeFilePath.value === from) activeFilePath.value = to
    }
  }

  // 删文件夹：清子树全部缓存键，当前打开文件在子树内则切回 SKILL.md。
  if (meta.removedPrefix) {
    const pfx = meta.removedPrefix + '/'
    for (const k of Object.keys(contentCache)) {
      if (k === meta.removedPrefix || k.startsWith(pfx)) {
        delete contentCache[k]
        delete savedCache[k]
        delete dirtyMap[k]
        delete jsonErrorMap[k]
      }
    }
    if (activeFilePath.value === meta.removedPrefix || activeFilePath.value.startsWith(pfx)) {
      activeFilePath.value = ENTRY_PATH
    }
  }

  // Q2：删文件夹可能移出 .md 引用的工具 → diff 给提示（移动/改名不删 .md，diff 通常为空）。
  // 铁律（与 shouldReplaceRefs 一致）：纯目录操作（建夹/删空夹/删 .json·.txt）后端回吐 refsChanged=false、
  // referencedTools=null（引用集未变、沿用现值）。此时**不能**把 null 当空集去 diff，否则已有工具全被误判「已移出」。
  // 仅 refsChanged !== false 且确有 referencedTools 时才 diff；否则视为未变、removed=[]。老后端缺省 undefined 仍走 diff。
  const removed =
    saveVO?.refsChanged !== false && saveVO?.referencedTools
      ? diffRemovedTools(beforeTools, saveVO.referencedTools)
      : []
  if (removed.length) {
    const names = removed.map((t) => t.bizName || t.code).join('、')
    ElMessage({ type: 'warning', message: `工具 ${names} 已移出本技能运行时白名单`, showClose: true })
  }
}

// .json 失焦校验结果（编辑器 → 页面）：维护 jsonErrorMap 供树节点叠加红色 △。
function onJsonError(path, msg) {
  if (msg) jsonErrorMap[path] = true
  else delete jsonErrorMap[path]
}

function onTreeRetry() {
  loadTree(currentSkillId.value)
}


/* ---------- 返回（#3：在当前标签路由回对应列表，不关页面） ---------- */
// 用户拍板改：「← 返回」= 路由回对应技能列表（平台→SysConfigSkills / FDE→AdminSkills），不再 window.close 关标签。
// 列表「新建/编辑」仍在新标签打开（不变）；此处仅改返回行为为同标签路由回列表。
function backToList() {
  // 治理页借用态（2026-09-01）：从审核中心 / 我的申请进来，返回对应治理列表页。
  if (route.query?.govReview) {
    router.push({ name: 'UnifiedReview' })
    return
  }
  if (route.query?.myApp) {
    router.push({ name: 'AdminMyApplications' })
    return
  }
  // N8：业务系统技能编辑器「← 返回」回到连接器「业务系统」Tab（无独立技能列表页）。
  if (isBizSystem.value) {
    router.push({ name: 'AdminConnector', query: { tab: 'bizsystem' } })
    return
  }
  router.push({ name: listRouteName.value })
}

/* ==================== 治理吸底操作栏（2026-09-01 PRD 对齐改造） ====================
 * 审核中心（?govReview=<id>）/ 我的申请（?myApp=<id>）把本页借用为 SKILL 类型的
 * 业务原生详情页：按 query 拉治理行数据，底部渲染吸底操作栏；动作完成后回治理列表页。 */
const govReviewRow = ref(null)
const myAppRow = ref(null)
const govBusyKey = ref('')
const govRejectVisible = ref(false)
const govRejecting = ref(false)

async function loadGovContext() {
  govReviewRow.value = null
  myAppRow.value = null
  try {
    if (route.query?.govReview) {
      const { getReview } = await import('@/api/reviews')
      govReviewRow.value = await getReview(route.query?.govReview)
    } else if (route.query?.myApp) {
      const { getMyApplication } = await import('@/api/myApplications')
      myAppRow.value = await getMyApplication(route.query?.myApp)
    }
  } catch (e) {
    /* 治理行取失败：不渲染吸底条，页面本体不受影响 */
  }
}

const govBarButtons = computed(() => {
  if (govReviewRow.value) {
    return [
      { key: 'close', label: '关闭' },
      { key: 'reject', label: '驳回', type: 'danger' },
      { key: 'approve', label: '通过', type: 'primary' }
    ]
  }
  const row = myAppRow.value
  if (!row) return []
  // 编辑路由（meta.readonly !== true）= 我的申请「重新提交/前往修改」编辑态：关闭|提交审核
  if (!readonly.value) {
    return [
      { key: 'close', label: '关闭' },
      { key: 'submit', label: '提交审核', type: 'primary' }
    ]
  }
  const buttons = [{ key: 'close', label: '关闭' }]
  if (row.result === 'PENDING') buttons.push({ key: 'withdraw', label: '撤回申请', type: 'danger' })
  if (row.result === 'REJECTED' || row.result === 'WITHDRAWN') {
    buttons.push({ key: 'modify', label: '前往修改' })
    buttons.push({ key: 'resubmit', label: '重新提交', type: 'primary' })
  }
  return buttons
})

async function onGovBarAction(key) {
  const review = govReviewRow.value
  const app = myAppRow.value
  if (key === 'close') {
    await onClose()
    return
  }
  if (review) {
    if (key === 'approve') {
      if (!(await confirmApproveReview(review))) return
      govBusyKey.value = 'approve'
      try {
        const { approveReview } = await import('@/api/reviews')
        await approveReview(review)
        ElMessage.success(review.requestAction === 'DELIST' ? '已通过停用申请' : '已通过审核')
        router.push({ name: 'UnifiedReview' })
      } catch (e) {
        ElMessage.error(e?.message || '审核失败')
      } finally {
        govBusyKey.value = ''
      }
    } else if (key === 'reject') {
      govRejectVisible.value = true
    }
    return
  }
  if (!app) return
  if (key === 'withdraw') {
    if (!(await confirmWithdrawMyApp(app.objectName))) return
    govBusyKey.value = 'withdraw'
    try {
      const { withdrawMyApplication } = await import('@/api/myApplications')
      await withdrawMyApplication(app.id)
      ElMessage.success('申请已撤回')
      router.push({ name: 'AdminMyApplications' })
    } catch (e) {
      ElMessage.error(e?.message || '撤回失败')
    } finally {
      govBusyKey.value = ''
    }
  } else if (key === 'modify') {
    // 前往修改：切到编辑路由（保留 myApp query，吸底条转 关闭|提交审核）
    router.replace({
      name: 'SysConfigSkillEdit',
      params: { id: String(currentSkillId.value) },
      query: { myApp: String(app.id) }
    })
  } else if (key === 'resubmit' || key === 'submit') {
    govBusyKey.value = key
    try {
      const { resubmitMyApplication } = await import('@/api/myApplications')
      await resubmitMyApplication(app.id)
      router.push({ name: 'AdminMyApplications' })
      alertResubmitSuccess(app.objectName)
    } catch (e) {
      ElMessage.error(e?.message || '提交失败')
    } finally {
      govBusyKey.value = ''
    }
  }
}

async function submitGovReject(reason) {
  const review = govReviewRow.value
  if (!review) return
  govRejecting.value = true
  try {
    const { rejectReview } = await import('@/api/reviews')
    await rejectReview(review, reason)
    ElMessage.success('已驳回审核')
    govRejectVisible.value = false
    router.push({ name: 'UnifiedReview' })
  } catch (e) {
    ElMessage.error(e?.message || '驳回失败')
  } finally {
    govRejecting.value = false
  }
}

async function onClose() {
  // 离开=自动保存触发点：尽力 flush 全部未保存，再返回。flush 期间给 loading 态（避免点了无反馈像卡死）。
  await flushAllDirty()
  backToList()
}

/* ---------- 组①：flush 全部未保存 + 失败重试 + 离开拦截 ---------- */
// flush 全部有未保存改动的文件（entry + 各非 entry）。flushing=true 让状态灯转「保存中…」。
// 返回是否「全部已落盘」（无残留 dirty）。竞态护栏沿用各 autoSave/autoSaveFile 内部 (skillId,path) 校验。
async function flushAllDirty() {
  if (!hasUnsaved.value) return true
  // P3：取消挂起的 debounce（entry/文件各一个），避免「立即 flush」与「2s 后又触发一次」冗余请求。
  clearTimeout(saveTimer)
  clearTimeout(fileSaveTimer)
  flushing.value = true
  try {
    // 先 flush 当前激活文件（保证用户正在看的那个最先落），再 flush 其余未保存文件。
    const cur = activeFilePath.value
    if (dirtyMap[cur]) await flushCurrentFile(cur)
    // entry 走文档区自动保存（只落 SKILL.md 正文）。
    if (dirtyMap[ENTRY_PATH] && cur !== ENTRY_PATH) await autoSaveEntry()
    // 其余非 entry 未保存文件。
    const rest = Object.keys(dirtyMap).filter(
      (p) => dirtyMap[p] && p !== ENTRY_PATH && p !== cur
    )
    for (const p of rest) await autoSaveFile(p)
  } finally {
    flushing.value = false
  }
  return !hasUnsaved.value
}

// 失败重试（状态灯「重试」按钮）：立即 flush 全部未保存/失败文件，不靠继续打字碰运气。
async function retrySave() {
  await flushAllDirty()
}

// 离开拦截：路由守卫（onBeforeRouteLeave）+ beforeunload。
// 文档区（SKILL.md/文件）走自动保存 → 离开前尽力 flush 落盘；配置区改为手动保存 → 离开只提示不自动存
// （2026-07-08，避免绕过「配置须手动保存」把未确认的配置静默提交）。
const LEAVE_CONFIRM_DOC = '有未保存的内容，确定离开吗？离开前我们会尝试为你保存。'
const LEAVE_CONFIRM_CONFIG = '技能配置有未保存改动（配置需手动点「保存配置」，不会自动保存）。确定离开吗？未保存的配置改动将丢失。'
onBeforeRouteLeave(async () => {
  if (readonly.value) return true   // 只读态：无写入、无脏，直接放行
  if (!hasUnsaved.value && !configDirty.value) return true
  // 先尽力 flush 文档区；文档全落盘且配置无未保存 → 放行。
  const docOk = await flushAllDirty()
  if (docOk && !configDirty.value) return true
  try {
    await ElMessageBox.confirm(configDirty.value ? LEAVE_CONFIRM_CONFIG : LEAVE_CONFIRM_DOC, '未保存提醒', {
      type: 'warning',
      confirmButtonText: '仍然离开',
      cancelButtonText: '留下继续编辑'
    })
    return true // 用户确认带未保存离开
  } catch {
    return false // 取消 → 留在编辑器
  }
})

// beforeunload：刷新/关标签时，浏览器原生「有未保存改动」拦截（文档或配置任一未保存都拦）。
function onBeforeUnloadGuard(e) {
  if (readonly.value) return   // 只读态：无未保存改动，不拦
  if (!hasUnsaved.value && !configDirty.value) return
  e.preventDefault()
  e.returnValue = '' // 触发浏览器原生确认弹窗
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnloadGuard))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnloadGuard))

/* ---------- 组④：🧪 试跑此技能（先存再试 + 效果测试台抽屉嵌入） ----------
 * 试跑走 loadConfig 读已落库配置，未保存编辑态不会被试跑看到 → 点试跑前先 flushAllDirty（复用 2a），
 * 避免「我改了为啥没生效」。游离技能（positionId==null）由 SkillFocusEditor 前置禁用入口（此处不会被触发）；
 * 平台只读态不渲染试跑入口。 */
const testVisible = ref(false)
const testFlushing = ref(false)
async function onTrialRun() {
  if (skill.value?.skillId == null || positionId.value == null) return
  // 配置区未保存不随试跑自动提交（配置须手动保存）——提示用户，试跑读的是已落库配置。
  if (configDirty.value) {
    ElMessage.warning('技能配置有未保存改动（需手动点「保存配置」）。试跑读的是已保存配置，不含未保存的配置改动。')
  }
  // 先存再试：文档区尽力 flush（给短暂 loading），再开测试台。
  testFlushing.value = true
  try {
    await flushAllDirty()
  } finally {
    testFlushing.value = false
  }
  testVisible.value = true
}
function closeTest() {
  testVisible.value = false
}
// 浮层关闭便利（CR，模态惯例）：点遮罩空白关闭（EffectTestStage 内部已有 ✕ 显式关闭按钮）。
// 不响应 Esc——输入法候选态按 Esc 取消输入会连带关掉浮层（全局弹窗约定，见 main.js）。
function onTestMaskClick(e) {
  // 仅点到遮罩本身（非卡片内部）才关闭。
  if (e.target === e.currentTarget) closeTest()
}
</script>

<template>
  <div class="se-shell">
    <AdminRail />

    <div class="se-container">
      <!-- 单行融合（去掉独立 topbar band）：返回/技能名/类别/保存态 全在 SkillFocusEditor 的极简顶行一行内。
           AdminSkillEditPage 不再单画顶栏——把「返回(emit back)」「自动保存提示」下沉/透传进 topline。
           整页编辑器无删除入口（show-close=false → SkillFocusEditor 的删除 ⋯ 仅工作台 show-close=true 渲染）。 -->
      <!-- 编辑舞台：为 SkillFocusEditor 提供铺满的定位父级 -->
      <div class="se-stage">
        <SkillFocusEditor
          :skill="skill"
          :loading="loading"
          :load-error="loadError"
          :position-name="positionName"
          :position-id="positionId"
          :show-close="false"
          :readonly="readonly"
          :back-label="backLabel"
          :save-status="saveStatus"
          :skill-source="fileSource"
          :hide-market-fields="isSystemChannel"
          :files="files"
          :active-file-path="activeFilePath"
          :active-file-type="activeFileType"
          :active-editable="activeEditable"
          :active-file-content="activeFileContent"
          :dirty-map="dirtyMap"
          :json-error-map="jsonErrorMap"
          :content-cache="contentCache"
          :tree-loading="treeLoading"
          :tree-load-error="treeLoadError"
          :publications="publications"
          :category-options="categoryOptions"
          :config-dirty="configDirty"
          :config-saving="configSaving"
          :admin-context="!isBizSystem"
          :publish-readiness="publishReadiness"
          @update:skill="onUpdateSkill"
          @update:display-category="onUpdateDisplayCategory"
          @update:active-file-content="onUpdateActiveContent"
          @close="onClose"
          @back="onClose"
          @retry="loadSkill(currentSkillId)"
          @select-file="onSelectFile"
          @download-file="onDownloadFile"
          @file-created="onFileCreated"
          @file-renamed="onFileRenamed"
          @file-deleted="onFileDeleted"
          @tree-changed="onTreeChanged"
          @json-error="onJsonError"
          @retry-save="retrySave"
          @save-config="saveConfig"
          @trial-run="onTrialRun"
          @tree-retry="onTreeRetry"
          @open-version="openVersionDialog"
        />
      </div>

      <!-- 只读元信息条（2026-09-01 清单22，对齐原型 skill-editor-meta.page-time）：
           创建时间 / 最近更新时间 / 最近发布时间 / 最新版本 -->
      <div v-if="!isBizSystem && skill" class="se-meta">
        <span>创建时间：{{ skill.createdAt || '—' }}</span>
        <span>最近更新时间：{{ skill.updatedAt || skill.createdAt || '—' }}</span>
        <span>最近发布时间：{{ skill.lastPublishedAt || '—' }}</span>
        <span>最新版本：{{ skill.versionLabel || '—' }}</span>
      </div>

      <!-- 治理吸底操作栏（2026-09-01 PRD 对齐改造）：审核中心/我的申请借用本页作 SKILL 详情时渲染 -->
      <div v-if="govBarButtons.length" class="se-gov-bar">
        <el-button
          v-for="b in govBarButtons"
          :key="b.key"
          :type="b.type || ''"
          :plain="b.type === 'danger'"
          :loading="govBusyKey === b.key"
          :disabled="!!govBusyKey && govBusyKey !== b.key"
          @click="onGovBarAction(b.key)"
        >
          {{ b.label }}
        </el-button>
      </div>
    </div>

    <!-- 治理借用态 · 驳回弹窗（与审核中心同组件同文案） -->
    <ReviewRejectDialog v-model="govRejectVisible" :submitting="govRejecting" @confirm="submitGovReject" />

    <!-- 版本管理抽屉（统一 VersionDrawer，与列表页同一组件）。2026-09-01：三类技能同构挂载
         （岗位私有已接入统一状态机；业务系统技能无版本概念不挂）。
         适配器把独立的 publications ref 并进 skill 以派生发布态；成功 @done 重拉详情刷新发布态与锁定态。 -->
    <VersionDrawer
      v-if="versionAdapter"
      v-model="versionVisible"
      :adapter="versionAdapter"
      @done="onVersionDone"
    />

    <!-- 组④：效果测试台浮层（先存再试 → 已落库配置试跑）。游离技能入口已在 SkillFocusEditor 前置禁用、不会到这。
         flush 期间 v-loading 给反馈；关闭走 v-if（组件 onUnmounted abort SSE）。
         模态惯例：点遮罩空白 / Esc 关闭（组件内另有 ✕ 显式按钮）。 -->
    <div
      v-if="testVisible || testFlushing"
      class="se-test-stage"
      v-loading="testFlushing"
      @click="onTestMaskClick"
    >
      <EffectTestStage
        v-if="testVisible"
        mode="skill"
        :skill="skill || {}"
        :skill-id="skill?.skillId"
        :position-id="positionId"
        @close="closeTest"
      />
    </div>
  </div>
</template>

<style scoped>
.se-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-app);
}
.se-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* 单行融合收口：原独立 .topbar band 已拆除——返回/技能名/类别/保存态 全在 SkillFocusEditor 极简顶行一行内。
   整页编辑器无删除入口（show-close=false），删除溢出菜单仅工作台模式渲染，不涉及本页样式。 */
/* 编辑舞台（#1 去周边灰边、平铺）：无内边距/无灰底，让 flush 态编辑器铺满整个区域、贴边无外框 */
.se-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  background: var(--bg-app);
}
/* 只读元信息条（2026-09-01 清单22，对齐原型 .skill-editor-meta.page-time）：底部常驻单行，可横向滚动 */
.se-meta {
  flex-shrink: 0;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 8px 24px;
  padding: 0 var(--space-6);
  border-top: 1px solid var(--border-soft);
  background: var(--bg-elevated);
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
  overflow-x: auto;
}
.se-meta span {
  white-space: nowrap;
}
/* 治理吸底操作栏（2026-09-01）：容器纵向 flex 末位常驻，不遮编辑区内容 */
.se-gov-bar {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border-soft);
}
/* 组④：效果测试台浮层（覆盖视口居中承载 EffectTestStage，自带居中卡 + zoomIn） */
.se-test-stage {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-6) var(--space-6);
  background: var(--mask);
}
/* 异步加载/失败占位（弱网兜底）：居中提示，不空白 */
.se-test-fallback {
  margin: auto;
  padding: var(--space-5) var(--space-6);
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
</style>
