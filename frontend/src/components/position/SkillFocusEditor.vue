<script setup>
/**
 * 技能聚焦大编辑区（交互规格 §1.4/§1.5/§4.2/§4.3/§5）。
 *
 * 职责：聚焦态占据画布主体的技能大编辑区。
 * - 顶部面包屑：岗位 / [Agent 下拉跳] / 当前技能（§1.4/§1.5 主推下拉跳，不退聚焦）；
 *   面包屑右侧 sib-switch（同 Agent 技能快速切换）+ 返回总览；
 * - 左元信息（窄）：技能名 / 触发词 chip（≤10·≤20字）/ 已引用工具回显（健康点+code+写类⚠+移除）/ 删除此技能；
 * - 右宽 skill.md 编辑器（复用 admin/MarkdownEditor，fullscreen），字符软提示 ≤8000；
 * - 工具引用：右侧内嵌抽屉（ToolDock）「+ 插入」→ 插入回光标处 → 左栏徽标随正文解析联动（决议 6 / 打磨 §3；
 *   2026-07-08 布局调整：取消拖拽插入，仅保留「插入」按钮）。
 *
 * 删工具徽标（§5.4）：单处直删 / 多处弹「全删 + 只读定位列表」。白名单由正文是否还有引用推导。
 *
 * 本组件不直接调后端保存（混合保存由父级编排：debounce / 切技能 / 退聚焦 / 显式保存）；
 * 通过 v-model 把技能编辑态回吐给父级。
 */
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, Delete, MoreFilled, Menu as MenuIcon, Document, DataLine, Memo, EditPen, InfoFilled, Download, Files } from '@element-plus/icons-vue'
import SkillMilkdownEditor from '@/components/position/SkillMilkdownEditor.vue'
import CodeTextEditor from '@/components/position/CodeTextEditor.vue'
import SkillFileTree from '@/components/position/SkillFileTree.vue'
import ToolDock from '@/components/position/ToolDock.vue'
import IconPickerPopover from '@/components/position/IconPickerPopover.vue'
import { generateExampleQuestion, PUBLISH_READY_TIP, publishDisabledTitle } from '@/api/unifiedSkill'
import SaveStatusIndicator from '@/components/position/SaveStatusIndicator.vue'
import { EFFECT_TEST_ENABLED } from '@/utils/featureFlags'
import {
  ENTRY_PATH,
  fileIconName,
  splitFrontmatter,
  joinFrontmatter,
  balanceCodeFences,
  detectFrontmatterBareSeparator
} from '@/utils/skillFileTree'
import { analyzeFrontmatter } from '@/utils/yamlLint'
import StatusTag from '@/components/StatusTag.vue'
import { categoryLabel, categoryTagType, hasCategory, CATEGORY_TOOLTIP } from '@/utils/skillCategory'
import {
  parseSkillMdTools,
  mergeReferencedView,
  locateToolRefs,
  removeToolRefs,
  tableToolOpAliases,
  LIMITS
} from '@/utils/positionModel'
import {
  TERMS,
  DESCRIPTION_HINT,
  TRIAL_HINT,
  TRIAL_DISABLED_NO_SKILL,
  TRIAL_DISABLED_NO_POSITION
} from '@/utils/skillTerms'
import { estimateTokens, formatTokenEstimate } from '@/utils/tokenEstimate'
import { isLocked as isPubLocked } from '@/utils/skillPublication'
import { iconIsUrl } from '@/utils/iconDisplay'

const props = defineProps({
  // 当前技能编辑态：{ skillId, name, triggers[], skillMd, referencedTools[], agentId }
  skill: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  loadError: { type: Boolean, default: false },
  positionName: { type: String, default: '岗位' },
  positionId: { type: [Number, String], default: null },
  // 关闭/返回入口文案（默认工作台「返回总览」；技能菜单整页可传「返回技能列表」）
  closeLabel: { type: String, default: '↩ 返回总览' },
  // 是否在面包屑右侧渲染「返回」按钮（默认 true）。
  // 整页编辑（AdminSkillEditPage）已有 topbar 主返回入口，传 false 隐藏此处冗余返回；
  // 工作台（PositionWorkbench）不传，照常显示「↩ 返回总览」，向后兼容。
  showClose: { type: Boolean, default: true },
  // 数据源（V34 切片2 修补）：透传给 ToolDock 决定工具坞调 FDE 还是平台 tool-picker、显几个 tab。
  // 默认 'fde'：工作台/FDE 技能编辑器字节级不变；平台技能整页编辑器传 'platform'。
  skillSource: { type: String, default: 'fde' },
  // V89 系统默认技能：隐藏市场用户面字段（默认安装开关 / 技能分类选择器）——系统默认技能不进市场，
  // 这两项对其无语义。仅系统默认技能整页编辑器（AdminSkillEditPage skillChannel='system'）传 true。
  hideMarketFields: { type: Boolean, default: false },

  /* ---------- 技能包多文件（切片3，F1/F2） ---------- */
  // 后端扁平 files[]（SkillFileTreeVO.files）。非空 → 启用包模式三栏（目录树/中栏/ToolDock）+ 多文件编辑；
  // 空 → 退化为既有单 SKILL.md 两栏（中栏/ToolDock）（向后兼容，存量未接入页面零变化）。
  files: { type: Array, default: () => [] },
  // 当前激活文件 path（受控）。默认 SKILL.md（入口）。
  activeFilePath: { type: String, default: ENTRY_PATH },
  // 当前激活文件类型（md/json/txt/…），决定中栏编辑器。
  activeFileType: { type: String, default: 'md' },
  // 当前激活文件是否可在线编辑（完整保真，2026-07-29）。false=二进制/只读文件 → 中栏走「下载态」而非编辑器。
  activeEditable: { type: Boolean, default: true },
  // 当前激活文件内容（受控，per-path 由页面层缓存装载）。.md 走 skill.skillMd 渲染；非 .md 走此。
  activeFileContent: { type: String, default: '' },
  // 各文件脏态 / .json 错态 / 内容缓存（透传给 SkillFileTree 渲染脏点/△/删前解析工具名）。
  dirtyMap: { type: Object, default: () => ({}) },
  jsonErrorMap: { type: Object, default: () => ({}) },
  contentCache: { type: Object, default: () => ({}) },
  treeLoading: { type: Boolean, default: false },
  treeLoadError: { type: Boolean, default: false },
  // 平台技能发布态（PlatformSkillDetailVO.publications）：用于「审核中锁定」判定（isLocked）。
  // 仅 skillSource==='platform' 有意义；FDE / 业务系统技能恒空 → 不锁定。
  publications: { type: Array, default: () => [] },
  // 整页编辑器（showClose=false）下沉进顶行的「← 返回」文案与自动保存提示——单行融合，不再由 AdminSkillEditPage 单画一条 topbar。
  // 工作台（showClose=true）不用这两项（左侧走岗位/Agent 导航、保存态由工作台容器自管）。
  backLabel: { type: String, default: '← 返回' },
  // 组① 四态保存灯：聚合保存态对象 { phase, dirtyCount?, savedAt?, flushing? }，由父级据 dirtyMap/在途保存/失败聚合。
  // 工作台/整页两种模式都渲染（常驻可见）。缺省 idle → 不渲染（向后兼容：未接入的父级零变化）。
  saveStatus: { type: Object, default: () => ({ phase: 'idle' }) },
  // 只读态（平台技能 Tab 只读详情，设计 §4.2 组件级只读关闭清单）：
  // 本组件自身写入口（技能名/描述/触发词 input、frontmatter 编辑）v-if 不渲染、改为只读展示；
  // readonly 链式透传至 SkillFileTree / ToolDock / SkillMilkdownEditor / CodeTextEditor，逐处关写入口。
  readonly: { type: Boolean, default: false },
  // N3 展示分类选项（客户端会谈 R2）：[{ id, name }]，由页面拉取存活分类后传入。
  // 仅 FDE 技能编辑时渲染「展示分类」选择器（平台技能不涉及展示分类，传空即不渲染）。
  categoryOptions: { type: Array, default: () => [] },
  // 配置区手动保存（2026-07-08）：文档区自动保存、配置区（名称/描述/触发词/示例问题/默认安装/展示分类）
  // 改动只标脏，须点「保存」提交。configDirty=有未保存配置（按钮文本旁加 ● 提示；按钮本身常驻绿色
  // 主按钮、任何时刻可点，2026-08-17 起不再据此变色/置灰，仅 configSaving 提交中禁用防连点）；configSaving=提交中。
  configDirty: { type: Boolean, default: false },
  configSaving: { type: Boolean, default: false },
  /**
   * 2026-09-01 PRD 对齐：技能编辑器语境开关（仅 AdminSkillEditPage 传 true；岗位工作台 /
   * 审核详情页不传，现状表现零变化）。启用后：
   * - 信息区首行加「图标」必填字段（IconPickerPopover 复用站内范式，疑点4 处置）；
   * - 描述 2000 字计数 + 新占位（疑点6）；示例问题必填 + 新占位 +【AI 生成】按钮（疑点5）；
   * - 技能分类三类技能均显示（固定 8 类 fieldDict 同源，必选，疑点8）；
   * - 顶栏按钮改【发布】+ 完整发布门（publishReadiness）；只读态顶行加「只读查看」标记；
   * - ToolDock 页签收敛 MCP / API / 业务系统 + 空态「去连接器接入」链接；插入 toast「已插入工具引用」。
   */
  adminContext: { type: Boolean, default: false },
  /**
   * 发布就绪门（与列表页共用 skillPublishReadiness 谓词，由页面层计算传入）：
   * { ready, missing[] }。仅 adminContext 下消费——缺失/未就绪时【发布】置灰并 title 列缺项。
   */
  publishReadiness: { type: Object, default: null },
  // V94 用户技能审核只读预览态：右栏改为「客户端安全检测结果 + 工具引用」手风琴（安全检测结果默认展开），
  // 顶栏「保存配置」换成「审核」。仅审核详情页传 true，正常技能编辑不受影响。
  reviewMode: { type: Boolean, default: false },
  // 客户端上报的风险项 [{ typeName, levelName, description }]，全量（含通过项），仅展示。
  riskItems: { type: Array, default: () => [] }
})
const emit = defineEmits([
  'update:skill',
  'update:display-category', // N3：技能挂展示分类改动 (categoryId|null)，页面据此调 setSkillCategory
  'close',
  'back', // 整页顶行「← 返回」（由 AdminSkillEditPage 执行 window.close + 兜底路由）
  'delete-skill', // (skillId)
  'retry',
  /* 技能包多文件（切片3） */
  'select-file', // (path) 切文件（组③查找命中跳转也复用此切文件，行定位在本组件内做）
  'download-file', // (path) 二进制/只读文件下载（完整保真）
  'update:activeFileContent', // 非 .md 文件内容回吐
  'file-created', // (path, saveVO)
  'file-renamed', // (fromPath, toPath, saveVO)
  'file-deleted', // (path, saveVO)
  'tree-changed', // (saveVO, meta) 文件夹新建/改名/删除、文件或文件夹移动等结构操作统一回吐
  'json-error', // (path, msg) .json 失焦校验结果
  'retry-save', // 组①：保存失败「重试」→ 父级立即 flush
  'save-config', // 配置区手动保存：顶栏「保存配置」按钮 → 父级 saveConfig 提交配置字段+展示分类
  'trial-run', // 组④：🧪 试跑此技能 → 父级先 flush 再开效果测试台
  'tree-retry',
  'review', // V94：审核详情页顶栏「审核」按钮 → 父级开审核弹窗
  'open-version' // 2026-08-14：顶栏「版本发布」按钮 → 父级壳打开版本发布弹窗
])

/* ---------- 工具引用抽屉折叠态（规格 §3，内嵌第三栏 + localStorage 记忆） ---------- */
const DOCK_COLLAPSE_KEY = 'skillDockCollapsed'
const dockCollapsed = ref(
  (() => {
    try {
      return localStorage.getItem(DOCK_COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })()
)
watch(dockCollapsed, (v) => {
  try {
    localStorage.setItem(DOCK_COLLAPSE_KEY, v ? '1' : '0')
  } catch {
    /* localStorage 不可用时静默降级，不影响功能 */
  }
})
// V94 审核详情右栏手风琴：'risk'=展开安全检测结果（默认）/ 'tools'=展开工具引用。同一时刻只展开一个。
const reviewRightPanel = ref('risk')
function toggleReviewPanel(which) {
  reviewRightPanel.value = reviewRightPanel.value === which ? (which === 'risk' ? 'tools' : 'risk') : which
}
// 风险等级 → StatusTag 语义色（高风险=danger / 通过=success / 其余=warning）。仅展示。
function riskLevelType(levelName) {
  if (!levelName) return 'info'
  if (levelName.includes('高')) return 'danger'
  if (levelName.includes('通过')) return 'success'
  return 'warning'
}

// ToolDock 内插入 → 直接插到编辑器光标处 + 轻提示（原由父级 onDockInsert 承担）。
// 2026-09-01：技能编辑器语境 toast 改「已插入工具引用」（对齐原型 skill-tool-insert）；工作台保持旧文案。
function onDockInsert(code, bizName) {
  insertTool(code, bizName)
  ElMessage.success(props.adminContext ? '已插入工具引用' : '已在 skill.md 插入引用')
}

/* ---------- 2026-09-01 技能编辑器语境（adminContext）专属 ---------- */
// 技能编辑器语境工具坞页签收敛：MCP / API / 业务系统（岗位工作台语境不传 → 保持现状）。
const ADMIN_TOOL_TABS = ['MCP', 'API', 'BIZ_SYSTEM']

// 图标（发布必填集成员）：IconPickerPopover 回吐 { icon }，走 update:skill → 配置区手动保存链路。
const skillIcon = computed(() => props.skill?.icon || '')
function onIconPick(payload) {
  if (ro.value) return
  if (payload && typeof payload.icon === 'string') emitPatch({ icon: payload.icon })
}
const iconIsUrlFlag = computed(() => iconIsUrl(skillIcon.value))

// 【AI 生成】示例问题（疑点5）：mock 按名称和描述从固定例句生成填入、重复点击覆盖。
const aiExampleBusy = ref(false)
async function onAiExample() {
  if (ro.value || aiExampleBusy.value) return
  aiExampleBusy.value = true
  try {
    const res = await generateExampleQuestion({
      id: props.skill?.skillId,
      name: props.skill?.name || '',
      description: props.skill?.description || ''
    })
    if (res?.question) {
      emitPatch({ exampleQuestion: res.question })
      ElMessage.success('已生成示例问题')
    }
  } catch (e) {
    ElMessage.error(e?.message || '生成失败，请稍后重试')
  } finally {
    aiExampleBusy.value = false
  }
}

// 【发布】按钮就绪门（与列表共用同一 readiness 谓词，由页面层传入）。
const publishReady = computed(() => !props.publishReadiness || props.publishReadiness.ready === true)
const publishBtnTitle = computed(() => {
  if (!props.adminContext) return ''
  if (!props.publishReadiness) return PUBLISH_READY_TIP
  return props.publishReadiness.ready ? PUBLISH_READY_TIP : publishDisabledTitle(props.publishReadiness)
})

/* ---------- 受控字段（局部改 → 回吐父级，触发自动保存 debounce） ---------- */
function emitPatch(patch) {
  emit('update:skill', { ...props.skill, ...patch })
}

/* ---------- 技能包多文件语境（切片3，提前定义供 parsedRefs/mdBound 等引用） ---------- */
// 包模式：files 非空 → 启用目录树（包模式三栏）+ 多文件切换；空 → 退化为既有单 SKILL.md 两栏（向后兼容）。
// 注意：packageMode 只决定「编辑器内容语义」（SKILL.md 正文取 skill.skillMd 还是 activeFileContent、
// 是否显字数提示等），**不再**决定文件区（树/文件标签条/抽屉）是否渲染——那由 showFileArea 独立掌管（见下）。
const packageMode = computed(() => (props.files || []).length > 0)
// 文件区渲染开关（bug 修复：把「文件区是否渲染」与「files 是否为空」解耦）。
// 含义：当前处于技能编辑主体（ed-body 分支在渲染：技能详情已加载、非 loadError、非顶层 loading）
// → 文件区常驻。与 files 是否为空无关：即便树请求失败/未返回（files 仍空），文件区仍挂载，
// SkillFileTree 内部的 loading 骨架 / load-error 重试条得以显示，绝不整块静默消失。
// 条件与 <div class="ed-body" v-else> 分支的渲染条件（!loading && !loadError && skill）等价。
const showFileArea = computed(() => !props.loading && !props.loadError && !!props.skill)
// 当前激活文件是否为 .md（含 SKILL.md）→ 用 Milkdown；否则（json/txt/yaml）用 CodeTextEditor。
const activeIsMd = computed(() => String(props.activeFileType || 'md').toLowerCase() === 'md')
const activeIsEntry = computed(() => props.activeFilePath === ENTRY_PATH)
// 完整保真（2026-07-29）：当前激活文件不可编辑（二进制/只读，activeEditable=false）→ 中栏走下载态。入口 SKILL.md 恒可编辑，永不为二进制态。
const activeIsBinary = computed(() => !props.activeEditable && !activeIsEntry.value)
// 当前激活文件的后端节点（取 size 展示下载态）。
const activeFileNode = computed(() => (props.files || []).find((f) => f.path === props.activeFilePath) || null)
// 人类可读体积（下载态展示）。
const activeFileSizeText = computed(() => {
  const n = Number(activeFileNode.value?.size || 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
})

const skillName = computed({
  get: () => props.skill?.name || '',
  set: (v) => emitPatch({ name: v })
})
// 描述（§11.4-1 新增受管键）：面板权威，纳入 update:skill → autoSave 链路，随 PUT 提交。
const skillDescription = computed({
  get: () => props.skill?.description || '',
  set: (v) => emitPatch({ description: v })
})
const skillMd = computed({
  get: () => props.skill?.skillMd || '',
  set: (v) => emitPatch({ skillMd: v })
})
// N2 示例问题：单值必填。随技能 PUT 提交（走 update:skill → autoSave 链路，与 name/description 同源）。
const exampleQuestion = computed({
  get: () => props.skill?.exampleQuestion || '',
  set: (v) => emitPatch({ exampleQuestion: v })
})
// N9 默认安装：布尔开关，仅平台技能有意义。随技能 PUT 提交。
// V89：'system'（系统默认技能通道）与 'platform' 同为平台族——审核锁定/发布语义一致，
// 仅市场用户面字段由 hideMarketFields 另行隐藏；文件/工具端点前缀由 skillSource 原样下传分流。
const isPlatformSkill = computed(() => props.skillSource === 'platform' || props.skillSource === 'system')
// 审核中锁定：平台技能有在审提交（首发在审 / 已发布或已下架之上新版在审）时锁定编辑器。
const locked = computed(() => isPlatformSkill.value && isPubLocked(props.publications))
// 有效只读 = 外部只读态（平台 Tab 只读详情）或审核中锁定。写入口 v-if / 子组件 readonly 一律按它取。
const ro = computed(() => props.readonly || locked.value)
const showDefaultInstall = computed(() => !ro.value && isPlatformSkill.value && !props.hideMarketFields)
const defaultInstall = computed({
  get: () => !!props.skill?.defaultInstall,
  set: (v) => emitPatch({ defaultInstall: !!v })
})

// 「保存配置」点击：先让当前聚焦的输入框失焦再通知父级校验。输入法组合态（候选未上屏）的文本
// 要等 compositionend 才回写 v-model → skill 状态；点击引发的失焦提交时序因浏览器/输入法而异，
// 曾致「明明填了示例问题仍被拦『需补全』，快速连点又有几率通过」。显式 blur 后等一个宏任务
// （部分浏览器/输入法把 blur 触发的 compositionend/input 异步派发，微任务 nextTick 等不到），
// 把提交时机变成确定性的。注：触发词输入框中未回车的文本不在此提交，按约定丢弃（chip 以回车为准）。
async function onSaveConfigClick() {
  document.activeElement?.blur?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  emit('save-config')
}

// N3 技能分类：单值可空（''=未分类）。改动并入手动「保存配置」（父级 saveConfig 调 setSkillCategory 端点）。
// 是否渲染选择器：2026-07-20 起**仅平台技能**——分类只服务客户端市场归类筛选，而市场只上架平台技能，
// FDE 技能不进市场。除了「父级不给 FDE 加载分类选项」这一层，这里再显式按 skillSource 收一道：
// 选择器一旦渲染，改动就会走 setSkillCategory（SYS_CONFIG 专属门），FDE 调用必 403。
// 后续若 FDE 技能确需分类，另起一套 FDE 侧分类，不复用本控件与本端点。
// 2026-08-24：去掉「分类选项非空才渲染」——库里一个分类都没有时选择器整个消失，用户以为控件丢了；
// 现与「默认安装」同条件常驻，选项为空就是空下拉（Element 自带"无数据"），提示先去字段字典建分类。
// 2026-09-01（疑点8）：技能编辑器语境三类技能均显示分类（固定 8 类 fieldDict 同源、必选，
// 只读态改禁用而非隐藏）；岗位工作台等旧语境判据不变。
const showCategorySelect = computed(() =>
  props.adminContext ? true : !ro.value && isPlatformSkill.value && !props.hideMarketFields
)
// 分类列表为空（还没建过任何分类）：选择器仍常驻，但占位/悬浮提示切换为"暂无分类"引导语。
const categoryEmpty = computed(() => !(props.categoryOptions || []).length)
const displayCategoryId = computed({
  get: () => props.skill?.displayCategoryId || '',
  set: (v) => emit('update:display-category', v || null)
})
const mdLen = computed(() => (props.skill?.skillMd || '').length)
const mdOver = computed(() => mdLen.value > LIMITS.SKILL_MD_SOFT)
// 组②升级：token 量级软提示（数量级，非精确、非阻断）。基于当前编辑的 .md 正文估算。
const activeTokenEstimate = computed(() => estimateTokens(mdActiveText.value))
const mdNoteText = computed(() => `${mdLen.value} 字 · ${formatTokenEstimate(activeTokenEstimate.value)}`)
// 软上限粗判：字符数超 SKILL_MD_SOFT 或 token 量级超约 SKILL_MD_SOFT（同量级阈值，给 over 红字）。
const mdOverToken = computed(() => activeTokenEstimate.value > LIMITS.SKILL_MD_SOFT)

// 触发词（2026-08-13）：整块从技能详情页移除，不再展示；triggers 字段仅在数据层随技能只读透传（本组件不再消费）。

/* ---------- 已引用工具回显（解析正文，决议 6：左栏徽标） ---------- */
// 正文解析出的引用 code + 次数；与后端 referencedTools[] 的 checkStatus 合并（取健康态）。
// 解析对象 = 当前编辑器绑定的 .md 正文（mdActiveText）：非包模式/SKILL.md → skillMd；包模式其它 .md → activeFileContent。
// 非 .md（json/txt）当前文件无工具引用语境，解析空（左栏列表回落空提示）。
// referencedTools[] 仍由后端按「全包聚合」回吐（口径不变），checkStatus/bizName 取自其映射（refStatusMap）。
const mdActiveText = computed(() => {
  if (packageMode.value && !activeIsMd.value) return ''
  if (packageMode.value && !activeIsEntry.value) return props.activeFileContent || ''
  return props.skill?.skillMd || ''
})
// H1 降频：左栏「已引用工具」徽标解析（parseSkillMdTools 内含 maskCodeRegions 4 条全文 regex）
// 原为 computed → 每次按键即对全文重解析，长文档输入丢帧。改为对正文 debounce 350ms 后再解析：
// 维护 debouncedMdText（落后于 mdActiveText 350ms），parsedRefs 从它派生。
// 徽标延迟约半秒刷新对 FDE 无感（非编辑光标链路），换取编辑热路径不每帧跑 4 条全文 regex。
const DEBOUNCE_PARSE_MS = 350
const debouncedMdText = ref(mdActiveText.value)
let parseTimer = null
watch(
  mdActiveText,
  (val) => {
    clearTimeout(parseTimer)
    parseTimer = setTimeout(() => {
      debouncedMdText.value = val
    }, DEBOUNCE_PARSE_MS)
  },
  { flush: 'post' }
)
// 切文件/切技能/装载等「上下文跳变」需即时反映（不等 debounce），由下方 watch 同步刷新 debouncedMdText。
const parsedRefs = computed(() => parseSkillMdTools(debouncedMdText.value))
const refStatusMap = computed(() => {
  const map = {}
  for (const t of props.skill?.referencedTools || []) {
    map[t.code] = { checkStatus: t.checkStatus, requiresConfirmation: t.requiresConfirmation, bizName: t.bizName }
    // 存量兼容：数据表回显已归一为表级（table__X），旧文档里按操作插入的 table__X__op 引用
    // 挂展示别名（整表收敛：别名即表名，无操作后缀），徽标/状态照常显示，不退化成裸 code。
    for (const a of tableToolOpAliases(t.code, t.bizName)) {
      map[a.code] = { checkStatus: t.checkStatus, requiresConfirmation: t.requiresConfirmation, bizName: a.bizName }
    }
  }
  return map
})
// 本会话「刚插入的 code → 业务名」本地兜底（CR-P1 同思路）：
// referencedTools 是后端回显、需等保存刷新后才有；插入瞬间正文已解析出新 code 但回显未到，
// 若仅靠 refStatusMap 取 bizName 会回落显示 code，保存刷新后才变中文，造成「先 code 后中文」闪现。
// 故在插入入口（工具坞 + 列表）即把业务名写进此映射，referencedView 优先用回显、回落本地映射，
// 让左栏列表在 referencedTools 刷新前就用刚插入的业务名即时显示。切技能时清空（隔离跨技能串扰）。
const localInsertNames = reactive({})
// 合并 + 优先级回落逻辑抽至纯函数 mergeReferencedView（utils/positionModel）并上单测护栏，此处仅调用，行为等价。
const referencedView = computed(() =>
  mergeReferencedView(parsedRefs.value, refStatusMap.value, localInsertNames)
)

// 移除工具徽标（§5.4）：单处直删；多处弹「全删 + 只读定位列表」。
// 整表收敛：数据表行可能聚合了存量操作级引用（ref.codes 多个成员 code），一次移除全部清完。
async function removeRef(ref) {
  const codes = ref.codes && ref.codes.length ? ref.codes : [ref.code]
  if (ref.count >= 2) {
    const locs = codes
      .flatMap((c) => locateToolRefs(props.skill?.skillMd, c))
      .sort((a, b) => a.line - b.line)
    const list = locs.map((l) => `第 ${l.line} 行：${l.text}`).join('\n')
    try {
      await ElMessageBox.confirm(
        `正文有 ${ref.count} 处引用「${ref.bizName || ref.code}」：\n\n${list}\n\n移除将删除全部 ${ref.count} 处引用标记。`,
        '移除工具引用',
        {
          type: 'warning',
          confirmButtonText: `移除全部 ${ref.count} 处`,
          cancelButtonText: '取消',
          customClass: 'tool-remove-confirm'
        }
      )
    } catch {
      return
    }
  }
  let md = props.skill?.skillMd
  for (const c of codes) md = removeToolRefs(md, c)
  emitPatch({ skillMd: md })
}

// 点击「已引用工具」某行 → 定位正文中该 code 的引用 chip（滚动到位 + 短暂高亮，需求 #3）。
// 布局调整 #7（2026-07-08）：同一工具被引用多处时，每次点击跳到下一处，到末尾后循环回第一处。
// refJumpCycle 记录各 code 的下一跳序号；scrollToTool 返回该 code 的引用总数（0=未找到）。
// 行内「移除」X 用 @click.stop 避免触发本定位；找不到节点时编辑器侧静默不报错。
const refJumpCycle = reactive({})
function locateRef(ref) {
  if (!ref?.code) return
  // 整表收敛：数据表行聚合了存量操作级引用（ref.codes 多成员），循环跳转遍历全部成员 code 的 chip。
  const codes = ref.codes && ref.codes.length ? ref.codes : [ref.code]
  const idx = refJumpCycle[ref.code] || 0
  const total = mdRef.value?.scrollToTool(codes, idx) || 0
  refJumpCycle[ref.code] = total > 0 ? (idx + 1) % total : 0
}

/* ---------- 工具 code → 业务名 map（供 Milkdown chip 解析业务名） ---------- */
const toolNames = computed(() => {
  const map = {}
  for (const t of props.skill?.referencedTools || []) {
    if (t.code && t.bizName) {
      map[t.code] = t.bizName
      // 存量兼容：旧文档按操作插入的 table__X__op chip 显示表名（整表收敛，无操作后缀）。
      for (const a of tableToolOpAliases(t.code, t.bizName)) map[a.code] = a.bizName
    }
  }
  return map
})

/* ---------- 插入工具引用（工具坞 / 拖拽 → 光标处插 chip 节点） ---------- */
const mdRef = ref(null)
// bizName 优先取传入值（工具坞选中项），回落 refStatusMap，再回落空（chip 内部再回落 code）
function insertTool(code, bizName) {
  // 只读态纵深防御：写入口已 v-if 不渲染，此处兜底拦截任何残余调用（拖拽/暴露方法）。
  if (ro.value) return
  if (!code) return
  const biz = bizName || refStatusMap.value[code]?.bizName || ''
  // 记进本地兜底映射，供左栏列表在 referencedTools 回显刷新前即时显示业务名（消除「先 code 后中文」闪现）。
  // 插入唯一路径 onDockInsert 经此函数（#6 拖拽插入已移除），故只需在此写一次。
  if (biz) localInsertNames[code] = biz
  mdRef.value?.insertTool(code, biz)
}
defineExpose({ insertTool })

// 布局调整 #6（2026-07-08）：取消拖拽插入（原决议 13 的 drop/dragover 链路已移除），
// 工具只经 ToolDock「插入」按钮进入正文。

/* ---------- 面包屑（反馈 5：去掉「所属 Agent ▾」下拉 + 「同组」切换；归属切换在白板做） ---------- */
// 无岗位归属（技能未绑定岗位 / 游离技能整页编辑）时面包屑降级仅留「岗位（占位）/ 技能名」。
const noPosition = computed(() => props.positionId == null)

function onClose() {
  emit('close')
}
function onDelete() {
  // 二次确认逻辑沿用父级 onDeleteSkill（ElMessageBox.confirm）；此处仅触发，入口/视觉已降权（规格 §4）。
  emit('delete-skill', props.skill?.skillId)
}
function onMoreCommand(cmd) {
  if (cmd === 'delete') onDelete()
}

/**
 * 上下文跳变（切技能/切文件）共享重置体：清本会话插入名映射与循环跳转序号（会话隔离，CR-P1/#7）、
 * 重置 Milkdown 会话、frontmatter 折叠复位（P3）、立即同步徽标解析源并重灌编辑器快照（H1）。
 * 新增「须随上下文跳变复位」的状态一律加在这里，两个 watcher 自动继承。
 */
function resetEditingContext() {
  for (const k of Object.keys(localInsertNames)) delete localInsertNames[k]
  for (const k of Object.keys(refJumpCycle)) delete refJumpCycle[k]
  // Milkdown 实例存在时（.md 激活）重置会话；json/txt 下 mdRef 已卸载为 null，无需处理。
  mdRef.value?.resetSession()
  // 2026-08-18：默认展开（复位也回展开态，与进页初始态一致）
  fmCollapsed.value = false
  flushParseNow()
  reseedMdSnapshot()
}

// 切技能：共享重置体（触发词填写入口已下线，无输入态需清空）。
watch(
  () => props.skill?.skillId,
  () => {
    resetEditingContext()
  }
)

// 立即把当前正文同步给徽标解析源（取消挂起的 debounce）。上下文跳变（切技能/切文件）用。
function flushParseNow() {
  clearTimeout(parseTimer)
  debouncedMdText.value = mdActiveText.value
}

/* ============================================================
 * 技能包多文件（切片3，F1/F2/F5）—— packageMode/activeIsMd/activeIsEntry 已在上方定义
 * ============================================================ */
// 文件标签条：当前文件名 + 类型图标 + 入口徽标 + 脏点。
const activeFileName = computed(() => String(props.activeFilePath || '').split('/').pop() || ENTRY_PATH)
const TAB_ICONS = { Document, DataLine, Memo }
const activeFileIcon = computed(() => TAB_ICONS[fileIconName(props.activeFileType)] || Document)
const activeDirty = computed(() => !!props.dirtyMap?.[props.activeFilePath])

/* 布局调整 #3（2026-07-08）：文件标签条上「入口」徽标后的「?」说明与「是否直接喂给 AI」标注已移除。 */

// 组④：🧪 试跑禁用原因（游离技能无宿主岗位 → 禁用，设计 §5.3 口径）。空串 = 可试跑。文案集中在 skillTerms。
const trialDisabledReason = computed(() => {
  if (props.skill?.skillId == null) return TRIAL_DISABLED_NO_SKILL
  if (props.positionId == null) return TRIAL_DISABLED_NO_POSITION
  return ''
})
function onTrialRun() {
  if (trialDisabledReason.value) return
  emit('trial-run') // 父级负责「先 flush 再开效果测试台」
}

/* ---------- P3：entry SKILL.md 的 YAML frontmatter 拆分 / 折叠 / 拼回 ----------
 * 仅对 entry SKILL.md：把开头 frontmatter 从正文剥离，只把 body 喂 Milkdown（根治「frontmatter 被当正文渲染」）；
 * frontmatter 放默认折叠区可编辑原始 YAML；body/frontmatter 任一改动 → 拼回完整 skillMd 回吐父级（首字节 ---\n）。
 *
 * 真相源仍是 skill.skillMd（含 frontmatter+body）。这里按它派生「当前 frontmatter / body」，
 * 编辑时拼回写入 skill.skillMd —— 不新增持久态，切技能/切文件天然随 skill.skillMd 重新派生（不串内容）。 */
const entrySplit = computed(() => splitFrontmatter(props.skill?.skillMd || ''))
const entryHasFrontmatter = computed(() => entrySplit.value.hasFrontmatter)
const entryFrontmatter = computed(() => entrySplit.value.frontmatter)
const entryBody = computed(() => entrySplit.value.body)

// frontmatter 折叠态（默认折叠）。切技能/切文件时复位为折叠。
const fmCollapsed = ref(false) // 2026-08-18：访问页面默认展开基本信息区

// Milkdown 绑定内容的「原始正文」（未经 balanceCodeFences）：
//  - entry SKILL.md（含包/非包模式）→ 仅 body（frontmatter 已剥离，P3）；
//  - 包模式其它 .md → activeFileContent（页面 per-path 缓存装载）；
//  - 非包模式非 entry（理论不入此分支）→ skillMd。
const rawMd = computed(() => {
  if (activeIsEntry.value) return entryBody.value
  if (packageMode.value) return props.activeFileContent || ''
  return props.skill?.skillMd || ''
})

/* ---------- H1：balanceCodeFences「进入文件/装载时算一次灌入」，编辑期 get 直接回吐 ----------
 * 【#6 修复】未闭合代码围栏会把其后整段（含 ###/## 标题）吞进 code block。修法是喂 Milkdown 前
 *   balanceCodeFences（首个后续标题前补闭合围栏，幂等）。原实现把它放在 mdBound.get 里 → 每次按键
 *   round-trip（set→skillMd 变→entryBody 变→get 重算）都跑 4 条全文 regex，长文档输入丢帧。
 * 改造：snapshot 模型——
 *  - mdSnapshot：喂给 Milkdown 的内容；仅在「进入文件/上下文跳变/外部装载」时由 reseedMdSnapshot() 跑一次
 *    balanceCodeFences 算出；编辑期不重算（Milkdown 自身是真相源）。
 *  - mdBound.get 直接回吐 mdSnapshot（零 regex）；mdBound.set 在写回 raw 的同时记下 lastEditorMd
 *    并把 mdSnapshot 对齐为编辑器刚发出的值（不再 balance，避免回环 replaceAll / 光标跳）。
 *  - 外部装载（activeFileContent 异步到达、entry frontmatter 改动等）：watch rawMd，若新值 ≠ 编辑器
 *    刚发出的值（lastEditorMd）→ 属外部变更 → reseed（balance 一次）；若 == 则是按键回声 → 不动 snapshot。 */
const mdSnapshot = ref(balanceCodeFences(rawMd.value))
let lastEditorMd = rawMd.value // 编辑器最近一次发出的正文（防回声重 balance 基准）

function reseedMdSnapshot() {
  const balanced = balanceCodeFences(rawMd.value)
  mdSnapshot.value = balanced
  lastEditorMd = rawMd.value
}

// 外部装载/上下文派生导致 rawMd 变化时，仅对「非编辑器回声」的变化重灌（balance 一次）。
watch(rawMd, (val) => {
  if (val === lastEditorMd) return // 按键回声：snapshot 已由 set 对齐，不重 balance
  reseedMdSnapshot()
})

const mdBound = computed({
  get: () => mdSnapshot.value,
  set: (v) => {
    // 编辑期：v 来自 Milkdown，本身已是规范 markdown，不再 balance；对齐 snapshot 防外部 watch 误判为外部变更。
    lastEditorMd = v
    mdSnapshot.value = v
    if (activeIsEntry.value) {
      // body 改动 → 与当前 frontmatter 拼回完整 skillMd（首字节 ---\n，与后端口径一致）。
      emitPatch({ skillMd: joinFrontmatter(entryFrontmatter.value, v) })
    } else if (packageMode.value) {
      emit('update:activeFileContent', v)
    } else {
      emitPatch({ skillMd: v })
    }
  }
})

// frontmatter raw YAML 绑定（折叠区 CodeTextEditor）—— §12 解耦：纯 raw 编辑、不联动技能级。
// frontmatter 是「包作者的可移植元数据」，与技能级 name/description/triggers（头部区）完全独立、各管各。
// 改动 → 仅与当前 body 拼回完整 skillMd 原样回吐父级（不解析/不回写受管键、不碰头部字段）。
const fmBound = computed({
  get: () => entryFrontmatter.value,
  set: (v) => emitPatch({ skillMd: joinFrontmatter(v, entryBody.value) })
})

// 非 .md（json/txt）内容绑定 → activeFileContent。
const codeBound = computed({
  get: () => props.activeFileContent || '',
  set: (v) => emit('update:activeFileContent', v)
})

// 字数软提示：仅对 SKILL.md（entry）沿用既有 8000 软上限提示；其它文件不显字数提示（语义不同）。
const showMdNote = computed(() => activeIsEntry.value || !packageMode.value)

/* F2 切文件护栏：activeFilePath 变化 → 复用同一 Milkdown 实例须 resetSession + 清 localInsertNames，
 * 防 A 文件刚插入的工具业务名残留到 B 文件（同技能不同 .md 间的 chip 串扰，与切技能同源）。
 * 护栏键升级为 (skillId, activeFilePath)：activeFilePath 变即重置会话。
 * 注：仅当切到 .md 才需重置 Milkdown（切到 json/txt 时 Milkdown 被 v-if 卸载，切回再装载即新会话）。 */
watch(() => props.activeFilePath, resetEditingContext)

function onCodeJsonError(msg) {
  emit('json-error', props.activeFilePath, msg)
}

/* ---------- frontmatter 真解析格式校验 + 出错自动展开（非阻断，不拦自动保存） ----------
 * fmAnalysis：entryFrontmatter 300ms debounce 真解析（yaml 库）结果，只报确定的格式错误
 *（解析失败/超长/别名炸弹）。CodeTextEditor 失焦校验同口径（analyzeFrontmatter），不会两处打架。 */
const FM_EMPTY_ANALYSIS = Object.freeze({ errors: [] })
const fmAnalysis = ref(FM_EMPTY_ANALYSIS)
let fmAnalyzeTimer = null
watch(
  () => [entryFrontmatter.value, activeIsEntry.value, entryHasFrontmatter.value],
  () => {
    if (fmAnalyzeTimer) clearTimeout(fmAnalyzeTimer)
    if (!activeIsEntry.value || !entryHasFrontmatter.value) {
      fmAnalysis.value = FM_EMPTY_ANALYSIS
      return
    }
    fmAnalyzeTimer = setTimeout(() => {
      fmAnalysis.value = analyzeFrontmatter(entryFrontmatter.value)
    }, 300)
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  if (fmAnalyzeTimer) clearTimeout(fmAnalyzeTimer)
})

// 裸 --- 边界检测（组④补强）：升级为 error 级——它实际破坏元数据/正文边界，元数据会被当正文喂模型。
const fmBareSep = computed(() =>
  activeIsEntry.value ? detectFrontmatterBareSeparator(props.skill?.skillMd || '') : null
)
// E 级聚合：analyze 错误 + 裸 ---（按文案去重，防两路同报）。
const fmErrors = computed(() => {
  const list = [...fmAnalysis.value.errors]
  const bare = fmBareSep.value
  if (bare && !list.some((e) => e.message === bare.message)) {
    list.push({ line: bare.line, message: bare.message })
  }
  return list
})
// 出错自动展开一次：每 (skillId, activeFilePath) 会话仅一次，用户手动折回后不再弹开（防对抗感）。
let fmAutoExpandedKey = ''
watch(fmErrors, (errs) => {
  if (!errs.length || !fmCollapsed.value) return
  const key = `${props.skill?.skillId ?? ''}::${props.activeFilePath}`
  if (fmAutoExpandedKey === key) return
  fmAutoExpandedKey = key
  fmCollapsed.value = false
})

// 红条行号点击 → 定位 raw 编辑框对应行（CodeTextEditor 已 defineExpose scrollToLine）。
const fmEditorRef = ref(null)
function onFmLineJump(line) {
  fmEditorRef.value?.scrollToLine?.(line)
}

// ≤1100px 目录树折叠为左侧抽屉（§1.3）；选中文件后自动关闭。
const treeDrawer = ref(false)
function onDrawerSelect(p) {
  emit('select-file', p)
  treeDrawer.value = false
}

/* ---------- 组③：跨文件查找命中跳转（切文件 + 精确定位，组④增强落地） ----------
 * 命中点击 → 切到该文件（emit select-file，父级装载内容）；待内容就位后定位：
 *  - 非 .md（CodeTextEditor textarea）→ 按行号精确滚动 + 选中该行；
 *  - .md（Milkdown 富文本，无行号映射）→ 用命中**文本内容**在已渲染节点树里查找定位 + flash 高亮（scrollToText）；
 *    找不到（如命中在 frontmatter 已剥离段 / 工具 chip 内）才优雅兜底 toast「用 Ctrl/⌘+F 查关键词」。 */
const codeRef = ref(null)
let pendingJump = false
let pendingJumpLine = null
let pendingJumpKeyword = ''
function onSearchJump(path, lineNo, keyword) {
  treeDrawer.value = false
  pendingJump = true
  pendingJumpLine = lineNo
  pendingJumpKeyword = keyword || ''
  if (path !== props.activeFilePath) {
    emit('select-file', path)
    // 切文件后内容异步装载；由下方 watch 在内容就位后执行定位。
  } else {
    nextTick(() => applyJump())
  }
}
function applyJump() {
  if (!pendingJump) return
  const line = pendingJumpLine
  const kw = pendingJumpKeyword
  pendingJump = false
  pendingJumpLine = null
  pendingJumpKeyword = ''
  if (activeIsMd.value) {
    // 富文本：先尝试按命中文本精确定位（含 flash 高亮）；找不到再兜底提示。
    const located = kw ? mdRef.value?.scrollToText?.(kw) : false
    if (!located) {
      ElMessage.info(kw ? `已打开该文件，请用浏览器查找（Ctrl/⌘+F）关键词「${kw}」` : '已打开该文件')
    }
  } else if (line) {
    // 纯文本：精确滚动并选中该行。
    codeRef.value?.scrollToLine?.(line)
  }
}
// 切文件后内容就位（activeFileContent 变化）→ 执行挂起的定位。需等 Milkdown replaceAll 重渲，多一拍。
watch(
  () => [props.activeFilePath, props.activeFileContent],
  () => {
    if (pendingJump) nextTick(() => setTimeout(applyJump, 60))
  }
)

// H7：卸载清理 debounce 定时器，防切技能/离开页时回调打到已销毁组件态。
onBeforeUnmount(() => {
  clearTimeout(parseTimer)
})
</script>

<template>
  <!-- flush（整页编辑器 showClose=false）：去卡片边框/圆角/阴影/居中留白，铺满整个区域、贴边、无外灰框 -->
  <div class="focus-editor" :class="{ flush: !showClose }">
    <!-- 极简顶行（极简融合布局 §2，单行融合，~48px、与主区域同底、仅下边框，非悬浮 band）：
         左：[整页 ← 返回] 或 [工作台 🧑‍💼岗位 / Agent▾ 导航] · 技能名(inline 可编辑+✎) [类别只读]
         …弹性… 右：自动保存提示 + [同组切换] + ⋯(删除)。
         整页/工作台共用这一行——AdminSkillEditPage 不再单画 topbar，返回/保存态经 prop/emit 下沉至此。 -->
    <div v-if="!loading && !loadError && skill" class="ed-topline">
      <!-- 整页编辑器（showClose=false）：左侧「← 返回」，由父级执行 window.close + 兜底路由 -->
      <span v-if="!showClose" class="topline-back" @click="emit('back')">{{ backLabel }}</span>

      <!-- 工作台（showClose=true）：左侧岗位回返（反馈 5：去掉「所属 Agent ▾」下拉——技能归属在白板做，本页不需要） -->
      <template v-else-if="!noPosition">
        <span class="crumb-link" @click="onClose">🧑‍💼 {{ positionName }}</span>
      </template>

      <!-- 弱分隔：仅当左侧有「返回/导航」段时出现，避免无左段时成前导竖线 -->
      <span v-if="!showClose || !noPosition" class="topline-div">|</span>

      <!-- #3：技能名前固定 label「技能名称：」；技能名仍 inline 可编辑 -->
      <span class="eh-name-label">技能名称：</span>
      <!-- 技能名 inline 可编辑：input + ✎（点字或点 ✎ 进编辑），borderless 透明底保持标题感。
           只读态（平台技能 Tab）：写入口 input + ✎ 不渲染，改为纯文本只读展示。 -->
      <span v-if="!ro" class="eh-name-wrap">
        <input
          v-model="skillName"
          class="eh-name"
          placeholder="技能名"
          aria-label="技能名（点击编辑）"
        />
        <el-icon class="eh-name-pen" title="可编辑技能名"><EditPen /></el-icon>
      </span>
      <span v-else class="eh-name-ro" :title="skillName">{{ skillName || '未命名技能' }}</span>
      <!-- 类别只读标签：全页唯一一处（面包屑/信息条均无） -->
      <el-tooltip
        v-if="hasCategory(skill?.category)"
        :content="CATEGORY_TOOLTIP"
        placement="bottom"
        effect="dark"
      >
        <StatusTag :type="categoryTagType(skill.category)" class="eh-category">
          {{ categoryLabel(skill.category) }}
        </StatusTag>
      </el-tooltip>
      <span class="topline-sp"></span>

      <!-- 2026-09-01：只读态顶行「只读查看」标记（技能编辑器语境，对齐原型 editor-save-state） -->
      <span v-if="adminContext && ro" class="topline-ro-mark">只读查看</span>

      <!-- N3 技能分类（顶栏，平台技能专属）：「技能分类：」前置文字 + 下拉框。
           2026-08-14 由信息条还原回顶栏；2026-08-18 挪到右侧「默认安装」左邻——
           原居中位会被技能名/描述的校验错误提示框遮挡。 -->
      <template v-if="showCategorySelect">
        <span class="eh-cat-l">技能分类<em v-if="!ro" class="ib-req">*</em>：</span>
        <el-tooltip
          :content="categoryEmpty
            ? '分类列表为空：请先到「字段字典」页新建分类，再回来选择。'
            : '给技能挂一个技能分类，客户端市场按此归类筛选。不选=暂不归类。'"
          placement="bottom"
          effect="dark"
        >
          <el-select
            v-model="displayCategoryId"
            :placeholder="adminContext ? '请选择技能分类' : categoryEmpty ? '暂无分类' : '未分类'"
            clearable
            size="small"
            class="eh-cat-select"
            :class="{ 'eh-cat-empty': categoryEmpty }"
            :disabled="adminContext && ro"
            aria-label="技能分类"
            no-data-text="暂无分类，请到「字段字典」页新建"
          >
            <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-tooltip>
      </template>

      <!-- N9 默认安装（顶栏，平台技能专属）：label + 开关同行，贴按钮组左侧。2026-08-14 由信息条还原回顶栏。 -->
      <el-tooltip
        v-if="showDefaultInstall"
        content="打开后，客户端初始化时会默认安装该技能；关闭则由终端用户自行选择安装。"
        placement="bottom"
        effect="dark"
      >
        <span class="eh-di">
          <span class="eh-di-l">默认安装</span>
          <el-switch v-model="defaultInstall" size="small" />
        </span>
      </el-tooltip>

      <!-- V94 审核详情：顶栏「审核」按钮（替代「保存」）。点开审核弹窗，由父级承接。 -->
      <button
        v-if="reviewMode"
        type="button"
        class="topline-savecfg"
        @click="emit('review')"
      >审核</button>

      <!-- 【发布】（2026-09-01 技能编辑器语境）：三类技能统一入口，完整发布门——任一必填缺失或
           SKILL.md 空 → 置灰 + title 列缺项；就绪 → title「发布将提交审核…」。点击打开统一版本管理抽屉。
           旧语境（isPlatformSkill 且非 adminContext）保持原「版本发布」按钮不变。 -->
      <!-- 审核中锁定态（locked）仍保留本按钮：打开版本管理抽屉可「撤回提交」；仅只读查看（readonly）隐藏。 -->
      <button
        v-if="adminContext ? !readonly && !reviewMode : isPlatformSkill && !reviewMode"
        type="button"
        class="topline-verpub"
        :class="{ 'is-disabled': adminContext && !locked && !publishReady }"
        :disabled="adminContext && !locked && !publishReady"
        :title="locked ? '审核中：可在版本管理中撤回本次提交' : publishBtnTitle"
        @click="emit('open-version')"
      >{{ adminContext ? '发布' : '版本发布' }}</button>

      <!-- 配置区手动保存（2026-07-08）：名称/描述/示例问题/默认安装/展示分类改动须点此提交。
           2026-08-17：按钮常驻绿色主按钮、任何时刻可点（无脏改动点了也保存成功，幂等）；
           仅提交中禁用防连点。有未保存配置在文本旁加 ●（● 保存）作脏提示。只读态（平台只读 Tab）不渲染。 -->
      <el-tooltip
        v-if="!ro && !reviewMode"
        content="保存技能配置（名称/描述/示例问题/技能分类等）与 SKILL.md 未保存正文。"
        placement="bottom"
        effect="dark"
      >
        <button
          type="button"
          class="topline-savecfg"
          :disabled="configSaving"
          @click="onSaveConfigClick"
        >{{ configSaving ? '保存中…' : (configDirty ? '● 保存' : '保存') }}</button>
      </el-tooltip>

      <!-- 组④：🧪 试跑此技能（先存再试由父级 flush；游离技能无宿主岗位 → 禁用 + 提示；只读态不渲染）。
           执行链路未就绪，入口另由 EFFECT_TEST_ENABLED 统一隐藏（utils/featureFlags.js）。 -->
      <el-tooltip
        v-if="EFFECT_TEST_ENABLED && !readonly"
        :content="trialDisabledReason || TRIAL_HINT"
        placement="bottom"
        effect="dark"
      >
        <button
          type="button"
          class="topline-trial"
          :class="{ 'is-disabled': !!trialDisabledReason }"
          :disabled="!!trialDisabledReason"
          @click="onTrialRun"
        >🧪 试跑此技能</button>
      </el-tooltip>

      <!-- 反馈 5：去掉「同组」技能快速切换 chip（与系统配置员技能编辑器对齐，归属切换在白板做） -->
      <!-- 工作台独立用时若还想保留「↩ 返回总览」文字入口（向后兼容 PositionWorkbench 现状） -->
      <span v-if="showClose && closeLabel" class="ed-close" @click="onClose">{{ closeLabel }}</span>

      <!-- #4 删除溢出菜单 ⋯：仅工作台（showClose=true，PositionWorkbench）保留；整页编辑器（showClose=false）不要删除入口。 -->
      <el-dropdown v-if="showClose" trigger="click" placement="bottom-end" @command="onMoreCommand">
        <button type="button" class="crumb-more" title="更多操作" aria-label="更多操作">
          <el-icon><MoreFilled /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="delete" class="more-del">
              <el-icon><Delete /></el-icon> 删除此技能
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 信息条（布局 2026-08-14 统一）：上下结构、全宽拉通——上「描述」（3 行多行框）、下「示例问题」（单行框）。
         仅这两个字段（4 场景通用），故 4 场景（平台/FDE/系统内置/用户审核）此区域呈现一致；只读态退化为文本 + `—` 占位。
         技能分类 / 默认安装为平台技能专属，已还原到顶栏标题行，不在本区域。 -->
    <div v-if="!loading && !loadError && skill" class="ed-infobar">
      <!-- 图标（2026-09-01 疑点4：原型级实现，交互复用站内 IconPickerPopover 范式；
           2026-09-02 起该组件已按 PRD 图标统一规则升级为 5MB/方形裁剪流，本消费方零改动）。
           发布必填集成员；仅技能编辑器语境渲染（岗位工作台不变）。 -->
      <div v-if="adminContext" class="ib-field ib-icon">
        <span class="ib-l">图标<em v-if="!ro" class="ib-req">*</em></span>
        <div class="ib-icon-row">
          <span class="ib-icon-preview" :class="{ 'is-empty': !skillIcon }">
            <img v-if="iconIsUrlFlag" :src="skillIcon" alt="" class="ib-icon-img" />
            <span v-else>{{ skillIcon || '—' }}</span>
          </span>
          <IconPickerPopover
            v-if="!ro"
            :icon="skillIcon"
            :position-name="skillName"
            @pick="onIconPick"
          />
        </div>
      </div>

      <div class="ib-field ib-desc">
        <!-- P2-3：描述 label 挂说明——description 也参与「是否选用本技能」的判断，建议写清适用场景。必填。 -->
        <el-tooltip :content="DESCRIPTION_HINT" placement="top" effect="dark">
          <span class="ib-l ib-l-help">描述<em v-if="!ro" class="ib-req">*</em></span>
        </el-tooltip>
        <!-- 描述：3 行多行文本框、全宽拉通，1000 字上限 + 右下角计数器。只读态改只读文本展示。 -->
        <!-- 2026-09-01（疑点6）：技能编辑器语境描述上限 2000 + 计数、占位对齐原型；旧语境 1000 不变 -->
        <el-input
          v-if="!ro"
          v-model="skillDescription"
          type="textarea"
          :rows="3"
          :maxlength="adminContext ? 2000 : 1000"
          show-word-limit
          resize="none"
          class="ib-input"
          :placeholder="adminContext ? '描述这个技能能做什么、怎么用、适合什么场景' : '一句话说明这个技能办什么事，并写清适用场景'"
        />
        <span v-else class="ib-ro-text">{{ skillDescription || '—' }}</span>
      </div>

      <!-- N2 示例问题：单行文本框、全宽拉通。2026-09-01（疑点5）：技能编辑器语境必填 + 原型占位 +
           输入框旁【AI 生成】按钮（mock 按名称和描述从固定例句生成、重复点击覆盖）；旧语境保持选填。 -->
      <div class="ib-field ib-eq">
        <el-tooltip
          :content="adminContext
            ? '给技能配 1 个示例问题，客户端会展示「这个技能可以这样问」，引导终端用户上手。必填。'
            : '给技能配 1 个示例问题，客户端会展示「这个技能可以这样问」，引导终端用户上手。选填。'"
          placement="top"
          effect="dark"
        >
          <span class="ib-l ib-l-help">示例问题<em v-if="adminContext && !ro" class="ib-req">*</em></span>
        </el-tooltip>
        <el-input
          v-if="!ro"
          v-model="exampleQuestion"
          class="ib-input"
          :maxlength="60"
          :placeholder="adminContext
            ? '输入 1 个终端用户会问的问题，如「帮我记一条今天的客户拜访」'
            : '选填：填 1 个终端用户会问的问题，如「帮我记一条今天的客户拜访」'"
        />
        <el-button
          v-if="adminContext && !ro"
          class="ib-eq-ai"
          :loading="aiExampleBusy"
          @click="onAiExample"
        >AI 生成</el-button>
        <span v-if="ro" class="ib-ro-text">{{ exampleQuestion || '—' }}</span>
      </div>
    </div>

    <!-- 审核中锁定：技能有在审提交时编辑器只读锁定，顶部明确提示（等待结论或先撤回提交）。 -->
    <div
      v-if="!loading && !loadError && skill && locked"
      class="ed-lock-notice"
      role="alert"
    >
      <el-icon class="ln-icon"><InfoFilled /></el-icon>
      <span class="ln-text">技能审核中，已锁定不可修改；请等待审核结论或先撤回提交。</span>
    </div>

    <!-- 加载 / 错误态 -->
    <div v-if="loadError" class="ed-state">
      <p>加载失败</p>
      <div class="ed-state-actions">
        <el-button @click="emit('retry')">重试</el-button>
        <el-button @click="onClose">返回</el-button>
      </div>
    </div>
    <div v-else-if="loading" class="ed-state">
      <el-skeleton :rows="6" animated />
    </div>

    <!-- 编辑主体：目录树 + 中编辑器 + 右工具抽屉（§12 三栏；技能级元信息已移上方头部区通栏；包模式启用树栏） -->
    <div
      v-else
      class="ed-body"
      :class="{ 'dock-collapsed': dockCollapsed, 'pkg-mode': showFileArea }"
    >
      <!-- 第一栏：目录树（文件区常驻——只要在编辑主体就渲染，与 files 是否为空解耦；
           ≤1100 折叠为抽屉，由 CSS + drawer 控制）。SkillFileTree 内部承载 loading 骨架 / load-error 重试条，
           故加载中/加载失败时也须挂载，绝不整块静默消失（bug 修复核心）。 -->
      <SkillFileTree
        v-if="showFileArea"
        class="ed-tree"
        :skill-id="skill?.skillId"
        :files="files"
        :source="skillSource"
        :active-path="activeFilePath"
        :dirty-map="dirtyMap"
        :json-error-map="jsonErrorMap"
        :content-cache="contentCache"
        :loading="treeLoading"
        :load-error="treeLoadError"
        :readonly="ro"
        @select="(p) => emit('select-file', p)"
        @search-jump="onSearchJump"
        @file-created="(p, vo) => emit('file-created', p, vo)"
        @file-renamed="(f, t, vo) => emit('file-renamed', f, t, vo)"
        @file-deleted="(p, vo) => emit('file-deleted', p, vo)"
        @tree-changed="(vo, m) => emit('tree-changed', vo, m)"
        @retry="emit('tree-retry')"
      />

      <!-- §12：.ed-meta 左栏解散——技能名/描述/触发词移入头部区（上方通栏），已引用工具移入右侧 ToolDock 顶部。 -->

      <!-- 中栏：文件标签条（包模式语境锚点）+ Q3 重审条 + 按 fileType 切编辑器 -->
      <!-- #6：编辑区不再作为拖拽落点（drop/dragover 绑定已随拖拽插入功能移除） -->
      <div class="ed-md">
        <!-- 文件标签条（文件区常驻，与 files 是否为空解耦）：「我在编哪个文件」语境锚点 + ☰ 文件抽屉入口，§1.2 注。 -->
        <div v-if="showFileArea" class="ed-filebar">
          <!-- ≤1100 折叠态：☰ 文件 触发抽屉（CSS 媒体查询控制显隐） -->
          <button
            type="button"
            class="ed-drawer-trigger"
            title="文件"
            aria-label="打开文件目录"
            @click="treeDrawer = true"
          >
            <el-icon><MenuIcon /></el-icon> 文件
          </button>
          <el-icon class="fb-icon"><component :is="activeFileIcon" /></el-icon>
          <span class="fb-name">{{ activeFileName }}</span>
          <!-- 入口徽标（#3：徽标后的「?」说明与「直接喂给 AI」标注已移除） -->
          <span v-if="activeIsEntry" class="fb-entry">入口</span>
          <span v-if="activeDirty" class="fb-dirty" title="未保存"></span>
          <!-- 组① 四态保存灯（2026-07-08 反馈 #3 移入此处）：紧贴文件名，只反映文档区自动保存态，
               与顶栏「保存配置」（配置区手动保存）明确区隔。 -->
          <SaveStatusIndicator
            class="fb-save"
            :status="saveStatus"
            @retry="emit('retry-save')"
          />
          <span class="fb-spacer"></span>
        </div>

        <!-- §12：entry SKILL.md 的「基本信息（元数据）」——默认折叠区，纯 raw YAML 直接编辑（与技能级解耦、不联动）。
             无 frontmatter 的 SKILL.md 不显此区（不提供「+添加」入口，本期定）。
             格式校验升级为真解析（yaml 库）：仅确定的格式错误报红条（行号可点击定位），非阻断、不拦自动保存。 -->
        <div v-if="activeIsEntry && entryHasFrontmatter" class="ed-fm" :class="{ open: !fmCollapsed }">
          <button
            type="button"
            class="ed-fm-head"
            :aria-expanded="!fmCollapsed"
            @click="fmCollapsed = !fmCollapsed"
          >
            <span class="ed-fm-caret">▸</span>
            <!-- 文案微调③：中文主名「基本信息」，英文 frontmatter 仅作括号补充，不裸显英文术语。 -->
            <span class="ed-fm-title">基本信息（名称、描述等）</span>
            <!-- 组②：文案复用 TERMS.frontmatter（单一真相）——「不作为正文喂给 AI」明示。 -->
            <span class="ed-fm-note">{{ TERMS.frontmatter }}</span>
            <!-- 折叠态也提示格式写坏（红点），引导展开修。 -->
            <span v-if="fmErrors.length" class="ed-fm-errdot" title="基本信息格式有误，展开查看"></span>
          </button>
          <div v-show="!fmCollapsed" class="ed-fm-body">
            <!-- 格式错误红条：YAML 解析失败 / 裸 --- 边界 / 超长（行号可点击定位；非阻断，照常自动保存） -->
            <div v-for="(e, i) in fmErrors" :key="'fme' + i" class="ed-fm-err" role="alert">
              <span class="fw-icon">✕</span>
              <span class="fw-text">
                <a v-if="e.line" class="fm-lineref" @click.prevent="onFmLineJump(e.line)">第 {{ e.line }} 行</a>
                {{ e.message }}
              </span>
            </div>
            <div class="ed-fm-editor">
              <CodeTextEditor
                ref="fmEditorRef"
                v-model="fmBound"
                file-type="yaml"
                :readonly="ro"
                placeholder="基本信息：每行写成「键: 值」，冒号后留一个空格。例如：&#10;name: 我的技能&#10;description: 帮你办某件事"
              />
            </div>
          </div>
        </div>

        <!-- 完整保真（2026-07-29）：二进制/只读文件 → 下载态（不加载编辑器），保持三栏布局不变 -->
        <div v-if="activeIsBinary" class="ed-binary">
          <el-icon class="ed-binary-ic"><Files /></el-icon>
          <div class="ed-binary-name">{{ activeFileName }}</div>
          <div class="ed-binary-meta">{{ activeFileType ? '.' + activeFileType : '文件' }} · {{ activeFileSizeText }}</div>
          <div class="ed-binary-tip">此文件类型不支持在线编辑，可下载后查看。</div>
          <el-button type="primary" :icon="Download" @click="emit('download-file', activeFilePath)">
            下载文件
          </el-button>
        </div>
        <!-- .md（含 SKILL.md）→ Milkdown 所见即所得（复用同一实例，F2）；.json/.txt/.yaml → CodeTextEditor -->
        <SkillMilkdownEditor
          v-else-if="activeIsMd"
          ref="mdRef"
          v-model="mdBound"
          :tool-names="toolNames"
          :readonly="ro"
          height="100%"
          placeholder="写技能的办事流程（skill.md）…"
        >
          <template #bar-right>
            <!-- 组②升级：字符数 + token 量级软提示（数量级估算，非精确、非阻断）。超软上限标红。 -->
            <el-tooltip
              v-if="showMdNote"
              content="token 是模型计费/上下文的计量单位，这里是粗略估算（数量级参考，非精确值）。内容越长越占上下文。"
              placement="top"
              effect="dark"
            >
              <span class="md-note" :class="{ over: mdOver || mdOverToken }">{{ mdNoteText }}</span>
            </el-tooltip>
          </template>
        </SkillMilkdownEditor>
        <CodeTextEditor
          v-else
          ref="codeRef"
          v-model="codeBound"
          :file-type="activeFileType"
          :readonly="ro"
          :placeholder="`编辑 ${activeFileName}…`"
          @json-error="onCodeJsonError"
        />
      </div>

      <!-- V94 审核详情：右栏改「客户端安全检测结果 + 工具引用」手风琴（安全检测结果默认展开，点工具引用则互换）。
           工具引用入口保留（不丢功能），只是默认收起。-->
      <div v-if="reviewMode" class="ed-review-right">
        <!-- 安全检测结果面板 -->
        <div class="rr-panel" :class="{ 'is-open': reviewRightPanel === 'risk' }">
          <button type="button" class="rr-head" @click="toggleReviewPanel('risk')">
            <span class="rr-title">🛡 客户端安全检测结果</span>
            <span class="rr-caret">{{ reviewRightPanel === 'risk' ? '▾' : '▸' }}</span>
          </button>
          <div v-show="reviewRightPanel === 'risk'" class="rr-body">
            <div v-if="!riskItems.length" class="rr-empty">客户端未上报风险项</div>
            <div v-for="(item, i) in riskItems" :key="i" class="rr-card">
              <div class="rr-card-head">
                <span class="rr-type">{{ item.typeName || '未知类型' }}</span>
                <StatusTag :type="riskLevelType(item.levelName)" class="rr-level">{{ item.levelName || '—' }}</StatusTag>
              </div>
              <div class="rr-desc">{{ item.description || '—' }}</div>
            </div>
          </div>
        </div>
        <!-- 工具引用（默认收起，点开则安全检测结果收起） -->
        <div class="rr-panel" :class="{ 'is-open': reviewRightPanel === 'tools' }">
          <button type="button" class="rr-head" @click="toggleReviewPanel('tools')">
            <span class="rr-title">🔧 工具引用</span>
            <span class="rr-caret">{{ reviewRightPanel === 'tools' ? '▾' : '▸' }}</span>
          </button>
          <div v-show="reviewRightPanel === 'tools'" class="rr-body rr-body-dock">
            <ToolDock
              :collapsed="false"
              class="ed-dock rr-dock"
              :position-id="positionId"
              :skill-source="skillSource"
              :referenced-view="referencedView"
              :readonly="true"
              @locate="locateRef"
            />
          </div>
        </div>
      </div>

      <!-- 工具引用抽屉（右栏，内嵌常驻，规格 §3）：§12 顶部并入「本技能已引用」分区。
           已引用 referencedView 由父级合并好传入；定位/移除 emit 上抛、由父级操作 Milkdown/skillMd。 -->
      <!-- 2026-09-01：技能编辑器语境页签收敛为 MCP / API / 业务系统 + 空态「去连接器接入」链接
           （props 驱动；岗位工作台语境不传，保持现状） -->
      <ToolDock
        v-else
        v-model:collapsed="dockCollapsed"
        class="ed-dock"
        :position-id="positionId"
        :skill-source="skillSource"
        :referenced-view="referencedView"
        :readonly="ro"
        :tabs="adminContext ? ADMIN_TOOL_TABS : null"
        :connector-empty-link="adminContext"
        @insert="onDockInsert"
        @locate="locateRef"
        @remove-ref="removeRef"
      />
    </div>

    <!-- ≤1100px 目录树折叠抽屉（§1.3）：文件区常驻，与 files 是否为空解耦，复用同一 SkillFileTree，选中文件后自动关闭 -->
    <el-drawer
      v-if="showFileArea"
      v-model="treeDrawer"
      title="文件"
      direction="ltr"
      size="260px"
      append-to-body
      class="ed-tree-drawer"
    >
      <SkillFileTree
        :skill-id="skill?.skillId"
        :files="files"
        :source="skillSource"
        :active-path="activeFilePath"
        :dirty-map="dirtyMap"
        :json-error-map="jsonErrorMap"
        :content-cache="contentCache"
        :loading="treeLoading"
        :load-error="treeLoadError"
        :readonly="ro"
        @select="onDrawerSelect"
        @search-jump="onSearchJump"
        @file-created="(p, vo) => emit('file-created', p, vo)"
        @file-renamed="(f, t, vo) => emit('file-renamed', f, t, vo)"
        @file-deleted="(p, vo) => emit('file-deleted', p, vo)"
        @tree-changed="(vo, m) => emit('tree-changed', vo, m)"
        @retry="emit('tree-retry')"
      />
    </el-drawer>
  </div>
</template>

<style scoped>
.focus-editor {
  /* 抽屉宽度变量（规格 §2.2/§3）：展开 320px / 收起 44px，由 .ed-body.dock-collapsed 切换 */
  --dock-w: 320px;
  width: 100%;
  /* §12 三栏（树 240 + ToolDock 320 = 560 固定 + 中栏 1fr）；放宽上限避免中栏被挤过窄。 */
  max-width: min(98vw, 1640px);
  margin: 0 auto;
  height: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: zoomIn var(--dur-slow) var(--ease-out) both;
}
/* 整页编辑器：铺满、贴边、无卡片外框（#1 去周边灰边） */
.focus-editor.flush {
  max-width: none;
  margin: 0;
  border: none;
  border-radius: 0;
  box-shadow: none;
  animation: none;
}
@keyframes zoomIn {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(14px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
/* 极简顶行（~48px）：导航/技能名/类别/同组/删除一行；与主区域同底融合、仅下边框 */
.ed-topline {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 48px;
  padding: var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-app);
  /* 单行不换行：技能名过长省略号截断（.eh-name 已 ellipsis），左右两端 flex-shrink:0 不被挤掉 */
  flex-wrap: nowrap;
}
.topline-div {
  flex-shrink: 0;
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}
.topline-sp {
  flex: 1;
}
/* 整页「← 返回」（下沉进顶行左侧，替代原独立 .topbar 的 tb-back） */
.topline-back {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  color: var(--c-text-muted);
  padding: 5px 10px;
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.topline-back:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
/* 组① 四态保存灯（文件标签条内，文件名右侧；2026-07-08 反馈 #3 从顶栏移入） */
.fb-save {
  flex-shrink: 0;
  margin-left: var(--space-2);
}
/* 配置区手动保存按钮（2026-08-17 R2）：常驻绿色主按钮、任何时刻可点——不随 configDirty 变色/置灰，
   有未保存配置仅在文本旁加 ● 提示（模板 label）；hover 用 accent-hover 加深（勿用 --bg-hover 覆盖绿底，
   会出「近白底 + 白字」不可见）；仅提交中（:disabled=configSaving）降透明度防连点。 */
.topline-savecfg {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--c-accent);
  border-radius: var(--radius-sm);
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}
.topline-savecfg:hover:not(:disabled) {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
}
.topline-savecfg:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
/* 版本发布按钮（2026-08-14）：描边次按钮，常驻可点，与主「保存」按钮区分 */
.topline-verpub {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  margin-right: var(--space-2);
  border: 1px solid var(--c-accent);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-accent);
  font-size: var(--fs-xs);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.topline-verpub:hover {
  background: var(--c-accent-fill);
}
/* 组④：🧪 试跑此技能按钮 */
.topline-trial {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--c-accent);
  border-radius: var(--radius-sm);
  background: var(--c-accent-soft);
  color: var(--c-accent);
  font-size: var(--fs-xs);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.topline-trial:hover:not(.is-disabled) {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}
.topline-trial.is-disabled {
  border-color: var(--border-base);
  background: transparent;
  color: var(--c-text-faint);
  cursor: not-allowed;
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
/* 反馈 5：已移除「所属 Agent ▾」下拉（.crumb-agent/.agent-dropdown/.ad-*）与「同组」切换（.sib-*）相关样式 */
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
.ed-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-8);
  color: var(--c-text-muted);
}
.ed-state-actions {
  display: flex;
  gap: var(--space-2);
}
/* #3 技能名前固定 label「技能名称：」 */
.eh-name-label {
  flex-shrink: 0;
  font-size: var(--fs-lg, 18px);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  white-space: nowrap;
}
/* 技能名 inline 可编辑（顶行内）：input + ✎ 铅笔；静止态虚下划线暗示可编辑，borderless 透明底保持标题感 */
.eh-name-wrap {
  flex: 0 1 auto;
  min-width: 60px;
  max-width: 420px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  border-bottom: 1px dashed var(--border-base);
}
.eh-name-wrap:hover {
  background: var(--bg-hover);
  border-bottom-color: var(--border-strong);
}
.eh-name-wrap:focus-within {
  background: var(--bg-hover);
  border-bottom-color: var(--c-accent);
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
.eh-name {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--c-text-strong);
  font-size: var(--fs-lg, 18px);
  font-weight: var(--fw-semibold);
  padding: 0;
  text-overflow: ellipsis;
}
.eh-name:focus {
  outline: none;
}
.eh-name::placeholder {
  color: var(--c-text-faint);
  font-weight: var(--fw-regular, 400);
}
/* ✎ 铅笔：默认弱化、hover/聚焦时显，强化可编辑暗示 */
.eh-name-pen {
  flex-shrink: 0;
  color: var(--c-text-faint);
  font-size: 14px;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.eh-name-wrap:hover .eh-name-pen,
.eh-name-wrap:focus-within .eh-name-pen {
  opacity: 1;
}
.eh-category {
  flex-shrink: 0;
  cursor: default;
}
/* 只读态技能名展示（平台技能 Tab）：保持标题感、无编辑底纹/铅笔，超长省略 */
.eh-name-ro {
  flex: 0 1 auto;
  min-width: 60px;
  max-width: 420px;
  font-size: var(--fs-lg, 18px);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 只读态描述/触发词文本展示 */
.ib-ro-text {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--c-text);
  line-height: 1.6;
  word-break: break-word;
}

/* 信息条（布局 2026-08-14 统一）：上下结构、全宽拉通——上「描述」（3 行多行框）、下「示例问题」（单行框）。
   仅这两个 4 场景通用字段，故各场景此区域一致。技能分类 / 默认安装为平台专属，已回顶栏，不在此。 */
.ed-infobar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-app);
}
.ib-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
/* 描述（信息条上行，全宽）：多行框 → label 顶对齐首行 */
.ib-desc {
  align-items: flex-start;
}
/* 示例问题（信息条下行，全宽，单行） */

/* N3 技能分类选择器（顶栏，2026-08-18 挪至「默认安装」左邻）：「技能分类：」前置文字 + 下拉框，克制宽度 */
.eh-cat-l {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
}
.eh-cat-select {
  width: 112px;
  flex-shrink: 0;
  margin-left: 4px;
  margin-right: var(--space-3);
}
/* 分类列表为空：占位文字提到警示色，让"暂无分类"不点开也一眼可见 */
.eh-cat-select.eh-cat-empty :deep(.el-select__placeholder) {
  color: var(--el-color-warning);
}
/* N9 默认安装（顶栏，2026-08-14 还原回顶栏）：label + 开关同行，贴按钮组左侧 */
.eh-di {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  margin-right: var(--space-3);
}
.eh-di-l {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
}
/* 2026-09-01 技能编辑器语境新增元素 ---------------------------------- */
/* 只读态顶行「只读查看」标记（对齐原型 editor-save-state） */
.topline-ro-mark {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  padding: 2px 8px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-pill);
  white-space: nowrap;
  margin-right: var(--space-2);
}
/* 【发布】按钮置灰态（发布门未就绪） */
.topline-verpub:disabled,
.topline-verpub.is-disabled {
  border-color: var(--border-base);
  color: var(--c-text-faint);
  background: transparent;
  cursor: not-allowed;
}
/* 图标行：预览 + 选择入口（IconPickerPopover 自带触发器） */
.ib-icon-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.ib-icon-preview {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  font-size: 20px;
  overflow: hidden;
}
.ib-icon-preview.is-empty {
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}
.ib-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 示例问题旁【AI 生成】按钮（常规字重，紧贴输入框右侧） */
.ib-eq-ai {
  flex-shrink: 0;
  margin-left: var(--space-2);
  font-weight: var(--fw-regular, 400);
  white-space: nowrap;
}

/* label 固定宽左对齐 + 不换行；描述/示例问题 label 统一 64px 使左缘对齐。 */
.ib-l {
  flex-shrink: 0;
  width: 64px;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 描述 label 顶对齐 textarea 首行（textarea 内边距 ~5px） */
.ib-desc .ib-l {
  padding-top: 6px;
}
.ib-l-help {
  cursor: help;
  border-bottom: 1px dotted var(--border-base);
}
.ib-input {
  flex: 1;
  min-width: 0;
}
/* 描述 textarea：占满整行宽（多显字），自适应高度由 :autosize 控制，禁手动拖拽 resize */
.ib-input :deep(.el-textarea__inner) {
  font-size: var(--fs-sm);
  line-height: 1.6;
}
/* 触发词相关样式（.ib-trig-body/.ib-trig-input/.ib-trig .field-err）已随触发词整块移除删除（2026-08-13）。 */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: var(--fs-xs);
  background: var(--bg-active);
  color: var(--c-text);
  border-radius: var(--radius-pill);
}
.chip .x {
  cursor: pointer;
  color: var(--c-text-faint);
  font-size: 12px;
}
.chip .x:hover {
  color: var(--c-danger);
}
.field-err {
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
/* 必填标识（描述/示例问题/触发词 label 后的红星，2026-07-08 反馈 #1 统一） */
.ib-req {
  color: var(--c-danger);
  font-style: normal;
  margin-left: 2px;
}
/* 信息条常驻提示样式（.ib-route-hint/.ib-trig-req/.ib-soft-warn）已随冗余提示文案删除（2026-07-08 反馈 #2） */

.ed-body {
  flex: 1;
  min-height: 0;
  display: grid;
  /* 非包模式（向后兼容）：中编辑器弹性 / 右工具抽屉 --dock-w（§12 .ed-meta 已解散） */
  grid-template-columns: minmax(0, 1fr) var(--dock-w);
  transition: grid-template-columns var(--dur-base) var(--ease-out);
}
/* 三栏（包模式，§12）：目录树 240 / 中编辑器 1fr / ToolDock --dock-w */
.ed-body.pkg-mode {
  grid-template-columns: 240px minmax(0, 1fr) var(--dock-w);
}
.ed-body.dock-collapsed {
  --dock-w: 44px;
}
.ed-tree {
  min-width: 0;
}
.ed-dock {
  min-width: 0;
}
/* V94 审核详情右栏手风琴（安全检测结果 + 工具引用）：复用编辑器令牌，与右坞同宽同边框语言。 */
.ed-review-right {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-soft);
  background: var(--bg-app);
  overflow: hidden;
}
.rr-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid var(--border-soft);
}
.rr-panel.is-open {
  flex: 1;
  min-height: 0;
}
.rr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-app);
  border: none;
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  text-align: left;
}
.rr-head:hover {
  background: var(--bg-hover);
}
.rr-caret {
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.rr-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3) var(--space-4) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.rr-body-dock {
  padding: 0;
}
.rr-dock {
  height: 100%;
}
.rr-empty {
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
  padding: var(--space-4) 0;
  text-align: center;
}
.rr-card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  background: var(--bg-surface);
}
.rr-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}
.rr-type {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.rr-level {
  margin-left: auto;
}
.rr-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.ed-md {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
/* #6：拖拽落点高亮（.ed-md.drop-target）已随拖拽插入功能移除 */

/* 二进制/只读文件下载态（完整保真，2026-07-29）：居中的图标 + 文件名 + 体积 + 下载按钮，替代编辑器占据中栏 */
.ed-binary {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--c-text);
}
.ed-binary-ic {
  font-size: 44px;
  color: var(--c-text-faint);
  margin-bottom: var(--space-2);
}
.ed-binary-name {
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  word-break: break-all;
  max-width: 480px;
}
.ed-binary-meta {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
}
.ed-binary-tip {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  margin-bottom: var(--space-2);
}

.md-note {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  white-space: nowrap;
}
.md-note.over {
  color: var(--c-warning);
}

/* 文件标签条（包模式语境锚点，§1.2） */
.ed-filebar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-sunken);
}
.fb-icon {
  color: var(--c-text-faint);
  font-size: 15px;
}
.fb-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 入口 pill：inline-flex + 显式 height 居中，避免 line-height 撑高竖直错位（B1） */
.fb-entry {
  display: inline-flex;
  align-items: center;
  height: 16px;
  font-size: 11px;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  border-radius: var(--radius-pill);
  padding: 0 6px;
}
.fb-dirty {
  align-self: center;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-warning);
}
/* #3：「是否进 prompt」标注（.fb-prompt）已随入口「?」说明一并移除 */
.fb-spacer {
  flex: 1;
}
/* ☰ 文件 抽屉触发：仅 ≤1100px 出现（默认隐藏） */
.ed-drawer-trigger {
  display: none;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border-base);
  background: var(--bg-surface);
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  padding: 3px 8px;
  font-size: var(--fs-xs);
  cursor: pointer;
}
.ed-drawer-trigger:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}

/* 审核中锁定提示条（不可关；技能有在审提交时常驻，编辑器同时进入只读锁定态）。 */
.ed-lock-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: var(--space-2) var(--space-4);
  background: var(--c-warning-soft);
  color: var(--c-warning);
  border-bottom: 1px solid var(--border-soft);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.ln-icon {
  flex-shrink: 0;
  font-size: 14px;
}
.ln-text {
  flex: 1;
}

/* P3：frontmatter 折叠区（置于 Milkdown 上方，默认折叠） */
.ed-fm {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-sunken);
}
.ed-fm-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: var(--space-2) var(--space-4);
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: var(--fs-xs);
  text-align: left;
}
.ed-fm-head:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.ed-fm-caret {
  display: inline-block;
  transition: transform var(--dur-base) var(--ease-out);
  color: var(--c-text-faint);
}
.ed-fm.open .ed-fm-caret {
  transform: rotate(90deg);
}
.ed-fm-title {
  font-weight: var(--fw-medium);
}
/* §12：折叠头右侧小注，说明 frontmatter 与技能级独立 */
.ed-fm-note {
  margin-left: auto;
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}
/* 组④：基本信息(YAML)写坏 → 折叠头右侧红点提示 */
.ed-fm-errdot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-danger);
  margin-left: 6px;
}
/* 组④补强：裸 --- 边界软提示（非阻断，黄底警示） */
.ed-fm-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--c-warning-soft);
  color: var(--c-warning);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.fw-icon {
  flex-shrink: 0;
}
.fw-text {
  word-break: break-word;
}
.ed-fm-body {
  /* 2026-08-18：左右 space-4 → space-3，随正文区统一收窄文本缩进 */
  padding: 0 var(--space-3) var(--space-3);
  animation: fmExpand var(--dur-base) var(--ease-out);
}
@keyframes fmExpand {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.ed-fm-editor {
  /* 2026-08-18 收窄：5 行完整展示（fs-sm×1.6 行高 ≈ 21px×5 + 上下 padding 16px） */
  height: 120px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}
/* 格式错误红条（真解析确定的错误；黄条 .ed-fm-warn 保留给其它软提示场景） */
.ed-fm-err {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--c-danger-soft);
  color: var(--c-danger);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.fm-lineref {
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
  margin-right: 4px;
}

/* 面包屑溢出菜单触发器（规格 §4.2）：默认中性，hover 浅底 */
.crumb-more {
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
}
.crumb-more:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.crumb-more:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}

/* 窄屏降级（规格 §1.3 / §2.3）：
 *  ≤1280px 树栏收窄 + ToolDock 收细条；
 *  ≤1100px 树折叠为抽屉（树栏从 grid 移除，☰ 文件 触发）；
 *  ≤900px  四栏/三栏转单列。 */
@media (max-width: 1280px) {
  /* 包模式树栏收窄到 ~200px；ToolDock 前移收细条（§12 三栏：树/1fr/dock） */
  .ed-body.pkg-mode:not(.dock-collapsed) {
    grid-template-columns: 200px minmax(0, 1fr) 44px;
  }
  .ed-body:not(.pkg-mode):not(.dock-collapsed) {
    --dock-w: 44px;
  }
}
@media (max-width: 1100px) {
  .ed-body:not(.dock-collapsed) {
    --dock-w: 44px;
  }
  /* 包模式：树折叠为抽屉——常驻树栏隐藏，grid 退回「1fr/dock 细条」，☰ 文件 触发抽屉 */
  .ed-body.pkg-mode {
    grid-template-columns: minmax(0, 1fr) 44px;
  }
  .ed-body.pkg-mode .ed-tree {
    display: none;
  }
  .ed-drawer-trigger {
    display: inline-flex;
  }
  /* 信息条已恒为上下两行（#2），窄屏无需额外堆叠处理。 */
}
@media (max-width: 900px) {
  /* §12：三栏（树/中栏/dock）转单列纵向堆叠；头部区在 grid 之上、本就通栏，无需额外处理。 */
  .ed-body,
  .ed-body.dock-collapsed,
  .ed-body.pkg-mode {
    grid-template-columns: 1fr;
  }
  /* 包模式单列下：树作为第一个堆叠块，限高内滚（对齐既有 ≤900 单列范式） */
  .ed-body.pkg-mode .ed-tree {
    display: block;
    max-height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--border-soft);
  }
  /* B4：树已堆叠回来，隐藏「☰ 文件」抽屉触发，消除冗余双入口 */
  .ed-drawer-trigger {
    display: none;
  }
  /* 单列下抽屉收到底部细条，不再抢编辑器宽度（覆盖滑出留人工/后续增强） */
  .ed-dock {
    border-left: none;
    border-top: 1px solid var(--border-soft);
  }
}
</style>

<!-- el-dropdown 菜单 teleport 到 body，scoped 选择器够不到，用全局类降权删除项（规格 §4.2：默认中性，hover 才红） -->
<style>
.el-dropdown-menu__item.more-del {
  color: var(--c-text);
}
.el-dropdown-menu__item.more-del:not(.is-disabled):hover,
.el-dropdown-menu__item.more-del:not(.is-disabled):focus {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
.el-dropdown-menu__item.more-del .el-icon {
  color: inherit;
}
</style>
