<script setup>
/**
 * 专家编辑器（抽屉式；2026-09-01 PRD 对齐重构，基准=prd md + 交互原型 v2 openExpertEditor 覆写链
 * L680+L699/L1044/L1092/L1379 与 openExpertViewer L681+L701/L1048/L1094/L1381）。
 *
 * 【三个入口共用】新建（expertId=null）、编辑、只读查看（readonly，原型 openExpertViewer 形态）。
 *
 * 【本轮对齐要点】
 * - 顶部说明条（原型 expert-editor-note）：专家由市场技能组成、引用关系同步更新。
 * - 基本信息：专家名 / 分类（必选，8 类同源字段字典）/ 图标（必填，沿用 IconPickerPopover——2026-09-02
 *   起组件按 PRD 图标统一规则升级 5MB/方形裁剪流，本消费方零改动）/ 简介（maxlength 2000，Z3 拍板
 *   不写「最多 200 字」）/ 职责描述（Markdown，2000 字）。
 * - 「专家帮你做（示例问题）」：必填固定 3 条（每条 60 字）+ 区标题右侧【AI 生成】（Z2 拍板：
 *   一次生成填满 3 行，本地模板随机 + toast，不走接口）。
 * - 市场技能引用**内嵌**（不再弹选择器）：搜索（按名称/描述/分类）+「已选择 X 个 · 共 Y 个市场技能」+
 *   卡片勾选 + 默认收起前 2 个、【展开更多（N）】；新建态即可勾选（选择随 create/update 一次性落库，
 *   不再依赖先建后挂的 add/remove 接口——那两个接口保留在 api 层）。
 * - 底部时间条（编辑/查看）：创建时间/最近更新时间/最近发布时间/最新版本。
 * - 底部按钮：新建=【取消】【创建专家】；编辑=【取消】【发布】【保存】。【发布】先校验并**静默自动保存**，
 *   再收抽屉、通知父页打开版本管理侧栏（emit publish）。
 * - toast：创建「专家已创建」、保存「专家配置已保存」。
 *
 * 【发布动作仍不在这里】版本管理（提交发布/撤回/版本启停）在统一 VersionDrawer（列表页持有）；
 * 本抽屉的【发布】只是「保存 + 转交」入口。审核期读发布态用于锁编辑（审核对象=提交那刻的快照）。
 *
 * 【2026-09-04 PRD-20260903 对齐（基准=新交互原型最终覆写态）】
 * - 基本信息字段顺序重排（finalizeExpertLayout）：专家名 → 分类 → 图标 → 背景色 → 简介 → 职责描述；
 * - 新增「背景色」必填字段（固定 7 色板单选 + 选中打勾，默认 #DCF5E4；选色实时同步图标预览背景）；
 * - 「专家帮你做」区级【AI 生成】改统一 AI 实况生成机制（utils/aiLiveGenerate：源=简介，
 *   空简介禁用 + 生成中… + 本地模板 3 条 + toast「AI 内容已生成，请确认后保存」）；
 * - 示例问题校验收紧：3 条必须全填，空则标红 + toast『请填写 3 条"专家帮你做"示例问题』+
 *   focus 首个空输入框；区块标题补必填红星；
 * - 技能引用区后新增只读「知识库」区块（当前专家可见范围内的知识库：搜索 + 默认露 2 行 +
 *   展开更多（N）；数据走 api/knowledgeBase.listKnowledgeBases 既有只读接口，按专家可见范围过滤——
 *   mock 侧映射种子见 domainExpertMock.getExpertKbScopeRefId；查看/检索测试跳知识库模块路由带参）。
 *
 * 【2026-09-09 原型复刻批次 3C · E1–E6（静态布局照原型 html，逻辑按 md + 代码现状）】
 * - E1 分区卡片化：四个 `.ee-sec` 换 `.section-card`（样式在 assets/admin-shell.css，本文件不重写卡样式），
 *   「专家帮你做」并入「基本信息」卡末尾作子分区 `.ee-basic-subsection`（原型 L1111
 *   `.expert-basic-subsection`：上边框 + margin-top 26 + padding-top 24）；DrawerEditor 不改（只消费）。
 * - E2 基本信息两列栅格（原型 L690 `.form-grid` + L16 `.section-card .form-grid{repeat(2,1fr)}`）：
 *   专家名｜分类、图标｜背景色 各占半列，简介 / 职责描述通栏（`.ee-full`）；label 置顶（label-position=top）；
 *   图标行换 `components/common/IconField.vue`（预览 + 【从图标库选择】【上传图标】，原型 L1331 decorateEditor）；
 *   职责描述编辑器高度 320→282（原型 L675：工具栏 52 + 文本域 min-height 230）。
 * - E3 市场技能卡：min-height 84 / padding 16 15 14 44 / checkbox 绝对定位左上 / 选中态左侧 4px 绿条，
 *   【展开更多】改 plain 按钮居中 34px（原型 L1096–L1101、L686–L688）。
 * - E4 知识库卡交互流照原型 L4174–L4175：【检索测试】**不收抽屉**，就地叠 KnowledgeSearchDialog；
 *   【查看】收抽屉 + 深链落知识库查看态（深链键名统一走 utils/knowledgeDeepLink，不改该工具）。
 * - E5 知识库表格：搜索框 ⌕ 前缀、表头 36px、行 padding 11/10、12px 字（原型 L4113–L4130）。
 * - E6 抽屉宽 min(780px,88vw)：DrawerEditor 默认已是 780（批次 1 落地），本文件不额外传 size；
 *   遮罩点击 toast 属 DrawerEditor 共用行为 → 记「需共享层跟进」，本批不改。
 * - E7 示例问题【AI 生成】保持区级一枚（md §三.3 写"每行一个" ↔ 原型/代码区级一枚，按口径保持 md 现状不动）。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import StatusTag from '@/components/StatusTag.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import IconField from '@/components/common/IconField.vue'
import KnowledgeSearchDialog from '@/components/admin/KnowledgeSearchDialog.vue'
import SkillMilkdownEditor from '@/components/position/SkillMilkdownEditor.vue'
import { KIND, derivePublishView, isLocked } from '@/utils/publishState'
import {
  getExpert,
  createExpert,
  updateExpert,
  listExpertSkillCandidates,
  getExpertKbScopeRefId
} from '@/api/domainExpert'
import { listKnowledgeBases } from '@/api/knowledgeBase'
import { stateMeta as kbStateMeta, sourcesText as kbSourcesText, hasUploadSource as kbHasUploadSource } from '@/utils/knowledgeBaseMeta'
import { useAiLiveGenerate, expertQuestionSet } from '@/utils/aiLiveGenerate'
import { getFieldOptionNames } from '@/api/fieldDictMock'
import { fmtTime } from '@/utils/docMeta'
import { kbRouteLocation } from '@/utils/knowledgeDeepLink'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 专家 id；null = 新建。 */
  expertId: { type: [Number, String], default: null },
  /** 只读查看（列表【查看】入口）：原型 openExpertViewer 展示形态，底部只留「关闭」。 */
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved', 'publish'])

const isEdit = computed(() => props.expertId != null)

const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const detail = ref(null)

// 专家分类选项：同源字段字典（8 类），不本组件硬编码
const CATEGORY_OPTIONS = getFieldOptionNames('expertCategory')

/* ==================== 背景色（2026-09-04 新增必填字段，原型 expert-background-color 覆写） ====================
 * 固定 7 色板单选（不提供自定义取色），默认 #DCF5E4；选色实时同步图标预览背景 +
 * 专家列表头像按行背景色着色（列表侧见 AdminExperts.vue）。 */
const BACKGROUND_COLORS = ['#FAE9DF', '#DCECF7', '#DCF5E4', '#E7E4F7', '#F7E6F2', '#F7EFCD', '#DDF0EF']
const BACKGROUND_FALLBACK = '#DCF5E4'
const safeBackground = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : BACKGROUND_FALLBACK)

/* ==================== 表单 ==================== */
const form = reactive({
  name: '',
  category: '',
  avatar: '',
  backgroundColor: BACKGROUND_FALLBACK,
  intro: '',
  roleDesc: '',
  exampleQuestions: ['', '', ''],
  skillIds: []
})

const errors = reactive({ name: '', category: '', avatar: '', backgroundColor: '', intro: '', roleDesc: '', examples: '', skills: '' })

function clearErrors() {
  for (const k of Object.keys(errors)) errors[k] = ''
}

function resetForm(d) {
  form.name = d?.name || ''
  form.category = d?.category || ''
  form.avatar = d?.avatar || ''
  form.backgroundColor = safeBackground(d?.backgroundColor)
  form.intro = d?.intro || ''
  form.roleDesc = d?.roleDesc || ''
  form.exampleQuestions = [0, 1, 2].map((i) => String((d?.exampleQuestions || [])[i] || ''))
  form.skillIds = (d?.skillIds || (d?.skills || []).map((s) => s.skillId)).slice()
  clearErrors()
}

// 选色：单选即落值并清红框（选中打勾样式在模板/CSS；图标预览背景经 --ee-bg 变量实时联动）
function pickBackground(color) {
  if (disabled.value) return
  form.backgroundColor = safeBackground(color)
  errors.backgroundColor = ''
}

// 图标走 IconField（预览块 + 显式双按钮，2026-09-09 批次 3C · E2；图标库 / 上传裁剪链路仍是
// IconPickerPopover 的 headless 复用），选中回吐仅取 icon 值。
function onPickIcon({ icon }) {
  form.avatar = icon || ''
  if (form.avatar) errors.avatar = ''
}

// 职责描述软上限与后端 @Size(max=2000) 对齐：仅提示不拦截（超限由校验兜底）。
const SOUL_SOFT_LIMIT = 2000
const soulLen = computed(() => (form.roleDesc || '').length)

/* ==================== 「专家帮你做」AI 生成（2026-09-04：统一 AI 实况生成机制） ====================
 * 取代旧「固定文案即填」实现：源=专家简介（空则禁用 + title「请先填写专家简介」），
 * 点击进「生成中…」约 420ms，按简介本地模板生成 3 条『请围绕"…"给出专业分析』式问题（60 字截断），
 * 完成 toast「AI 内容已生成，请确认后保存」。机制细节见 utils/aiLiveGenerate.js。 */
const {
  disabled: aiQuestionsDisabled,
  title: aiQuestionsTitle,
  label: aiQuestionsLabel,
  run: aiGenerateQuestions
} = useAiLiveGenerate({
  getSourceText: () => form.intro,
  sourceLabel: '专家简介',
  generate: expertQuestionSet,
  apply: (questions) => {
    form.exampleQuestions = [...questions]
    errors.examples = ''
  },
  isReadonly: () => disabled.value
})

/* ==================== 发布态 ==================== */
// 审核中锁编辑（安全兜底：列表已把审核中行的「编辑」置灰，此处防直开）。
const locked = computed(() => isLocked(KIND.DOMAIN_EXPERT, detail.value || {}))
const disabled = computed(() => props.readonly || locked.value)

// 三态展示映射（同列表页 displayView：草稿→未发布、各审核中→审核中、已发布→已发布）
const view = computed(() => {
  const d = detail.value || {}
  const v = derivePublishView(KIND.DOMAIN_EXPERT, { status: d.status, pendingAction: d.pendingAction })
  if (d.pendingAction) return { ...v, label: '审核中', tagType: 'warning' }
  if (v.state === 'PUBLISHED') return { ...v, label: '已发布', tagType: 'success' }
  return { ...v, label: '未发布', tagType: 'info' }
})

/* ==================== 市场技能引用（内嵌选择器） ==================== */
const candidates = ref([])
const candidatesLoading = ref(false)
const skillKeyword = ref('')
const skillExpanded = ref(false)

async function loadCandidates() {
  candidatesLoading.value = true
  try {
    const data = await listExpertSkillCandidates()
    candidates.value = Array.isArray(data) ? data : data?.list || []
  } catch {
    candidates.value = []
  } finally {
    candidatesLoading.value = false
  }
}

// 过滤（按名称/描述/分类，原型 renderExpertSkillChoices 同口径）
const filteredCandidates = computed(() => {
  const kw = skillKeyword.value.trim().toLowerCase()
  if (!kw) return candidates.value
  return candidates.value.filter((s) =>
    [s.name, s.description, s.category].some((v) => String(v || '').toLowerCase().includes(kw))
  )
})
// 默认收起只展示前 2 个；搜索中或已展开时全量
const collapsed = computed(() => !skillKeyword.value.trim() && !skillExpanded.value)
const shownCandidates = computed(() =>
  collapsed.value ? filteredCandidates.value.slice(0, 2) : filteredCandidates.value
)
const hiddenCount = computed(() => Math.max(0, filteredCandidates.value.length - shownCandidates.value.length))
const showMoreRow = computed(() => !skillKeyword.value.trim() && filteredCandidates.value.length > 2)

function isChecked(id) {
  return form.skillIds.includes(id)
}
function toggleSkill(id, checked) {
  if (disabled.value) return
  if (checked && !form.skillIds.includes(id)) form.skillIds.push(id)
  if (!checked) form.skillIds = form.skillIds.filter((x) => x !== id)
  if (form.skillIds.length) errors.skills = ''
}

// 查看态：已引用技能明细（详情 skills[] 实时取市场技能本体——引用非复制）
const viewSkills = computed(() => detail.value?.skills || [])

/* ==================== 只读「知识库」区块（2026-09-04 原型 expert-knowledge-card-module） ====================
 * 技能引用区后；副标题「当前专家可见范围内的知识库」。数据走 api/knowledgeBase.listKnowledgeBases
 * 既有只读接口（签名不动），按专家可见范围过滤：企业级全可见 + 本专家专属（EXPERT 型且
 * scopeRefId 命中——mock 数据里知识库用自己的专家 id（ex_1/ex_2），与本模块 201-204 不同源，
 * 桥接映射种子见 domainExpertMock.getExpertKbScopeRefId）。
 * 默认露 2 行 + 【展开更多（N）】（N=总数-2）；搜索时显示全部匹配、隐藏展开钮（原型 filterRows 口径）。 */
const router = useRouter()
const kbRows = ref([])
const kbLoading = ref(false)
const kbKeyword = ref('')
const kbExpanded = ref(false)

async function loadKnowledge() {
  if (props.readonly) return // 原型只在编辑器挂本区块，openExpertViewer 查看态不挂
  kbLoading.value = true
  try {
    const data = await listKnowledgeBases({ page: 1, size: 200 })
    const all = Array.isArray(data) ? data : data?.list || []
    const scopeRefId = isEdit.value ? getExpertKbScopeRefId(props.expertId) : null
    kbRows.value = all.filter(
      (r) => r.kbType === 'ENTERPRISE' || (r.kbType === 'EXPERT' && scopeRefId && r.scopeRefId === scopeRefId)
    )
  } catch {
    kbRows.value = []
  } finally {
    kbLoading.value = false
  }
}

const kbFiltered = computed(() => {
  const q = kbKeyword.value.trim().toLowerCase()
  if (!q) return kbRows.value
  return kbRows.value.filter((r) =>
    [r.name, r.description].some((v) => String(v || '').toLowerCase().includes(q))
  )
})
const kbCollapsed = computed(() => !kbKeyword.value.trim() && !kbExpanded.value)
const kbShown = computed(() => (kbCollapsed.value ? kbFiltered.value.slice(0, 2) : kbFiltered.value))
// N=总行数-2（原型 extra 口径：与搜索过滤无关）
const kbExtraCount = computed(() => Math.max(0, kbRows.value.length - 2))
const kbShowMore = computed(() => !kbKeyword.value.trim() && kbExtraCount.value > 0)

// 文档数量：仅引用了启用中上传源的库有意义，否则「—」（同知识库列表页口径）
function kbDocText(row) {
  return kbHasUploadSource(row) ? Number(row.docCount || 0).toLocaleString('en-US') : '—'
}

/**
 * 【查看】→ 收抽屉、跳知识库模块路由（带 action=view/kbId 深链参数），由知识库列表页直开查看态。
 * 键名与消费端 KnowledgeBaseList 同源于 utils/knowledgeDeepLink（2026-09-08 原型复刻批次 1 · C-H2：
 * 此前发 kbAction 与消费端 action 不对齐，跳过去查看抽屉不会打开，已修）。
 * 对应原型 L4174：`closeDrawer(); state.module='knowledge'; render(); openKbViewer(kb)`。
 */
function viewKnowledge(row) {
  close()
  router.push(kbRouteLocation({ action: 'view', kbId: row.id }))
}

/**
 * 【检索测试】→ **不收抽屉**，就地在专家抽屉之上叠检索测试弹窗（原型 L4175：`openSearch(kb)` 不 closeDrawer）。
 * 2026-09-09 原型复刻批次 3C · E4：此前与【查看】同走 close() + 深链跳转，一点就丢失编辑中的表单，
 * 与原型「叠在抽屉之上、测完回到原处继续编」的交互不符。
 * 弹窗挂在 DrawerEditor 的 #extra 插槽内（抽屉子树）以保证层级压在抽屉之上。
 */
const searchKb = ref(null)
const searchVisible = ref(false)
function testKnowledge(row) {
  searchKb.value = row
  searchVisible.value = true
}

/* ==================== 加载 ==================== */
async function load() {
  loadCandidates()
  loadKnowledge()
  if (!isEdit.value) {
    detail.value = null
    resetForm(null)
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const d = await getExpert(props.expertId)
    detail.value = d
    resetForm(d)
  } catch (e) {
    loadError.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

/* ==================== 校验 / 保存 / 发布 ==================== */
function validate() {
  clearErrors()
  let ok = true
  if (!String(form.name || '').trim()) {
    errors.name = '请填写专家名'
    ok = false
  }
  if (!String(form.category || '').trim()) {
    errors.category = '请选择专家分类'
    ok = false
  }
  if (!String(form.avatar || '').trim()) {
    errors.avatar = '请选择图标'
    ok = false
  }
  // 背景色必填（固定 7 色板；默认 #DCF5E4，正常交互不会为空，兜底防持久化脏数据）
  if (!BACKGROUND_COLORS.includes(form.backgroundColor)) {
    errors.backgroundColor = '请选择背景色'
    ok = false
  }
  if (!String(form.intro || '').trim()) {
    errors.intro = '请填写简介'
    ok = false
  }
  if (!String(form.roleDesc || '').trim()) {
    errors.roleDesc = '请填写职责描述'
    ok = false
  } else if (soulLen.value > SOUL_SOFT_LIMIT) {
    errors.roleDesc = `职责描述不超过 ${SOUL_SOFT_LIMIT} 字，当前 ${soulLen.value} 字`
    ok = false
  }
  // 示例问题校验收紧（2026-09-04 原型 expert-final-layout-required-module）：3 条必须全填，
  // 空则标红（空输入框红框，见模板 ee-q-invalid）+ 专用 toast + focus 首个空输入框（toast/focus 在 save 侧）。
  if (!form.exampleQuestions.every((q) => String(q || '').trim())) {
    errors.examples = '请填写 3 条"专家帮你做"示例问题'
    ok = false
  }
  // 市场技能：新建态即可勾选，创建/保存均要求 ≥1（原型 validateExpert 同口径）
  if (!form.skillIds.length) {
    errors.skills = '请至少添加 1 个技能'
    ok = false
  }
  return ok
}

function buildPayload() {
  return {
    name: String(form.name).trim(),
    category: form.category,
    avatar: form.avatar,
    backgroundColor: safeBackground(form.backgroundColor),
    intro: form.intro,
    roleDesc: form.roleDesc,
    exampleQuestions: form.exampleQuestions.map((q) => String(q || '').trim()),
    skillIds: [...form.skillIds]
  }
}

/* 示例问题输入框 ref（v-for 收集）：校验失败 focus 首个空输入框（原型 validateExpert 覆写行为） */
const questionInputRefs = ref([])
function setQuestionRef(el, i) {
  questionInputRefs.value[i] = el
}
function focusFirstEmptyQuestion() {
  const i = form.exampleQuestions.findIndex((q) => !String(q || '').trim())
  if (i >= 0) questionInputRefs.value[i]?.focus?.()
}

// 校验失败提示分流：示例问题缺 → 专用 toast + focus 首个空输入框（原型逐字）；其余走通用「请先补齐必填项」。
function warnInvalid() {
  if (errors.examples) {
    ElMessage.warning('请填写 3 条"专家帮你做"示例问题')
    focusFirstEmptyQuestion()
  } else {
    ElMessage.warning('请先补齐必填项')
  }
}

async function save() {
  if (disabled.value) return
  if (!validate()) {
    warnInvalid()
    return
  }
  saving.value = true
  try {
    if (isEdit.value) {
      detail.value = await updateExpert(props.expertId, buildPayload())
      ElMessage.success('专家配置已保存')
      emit('saved')
    } else {
      const created = await createExpert(buildPayload())
      ElMessage.success('专家已创建')
      emit('saved', created)
    }
    close()
  } catch (e) {
    // 服务端字段级错误就地红框（重名等），非字段错误退化为 toast。
    if (e?.field && e.field in errors) errors[e.field] = e.message
    else ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

/**
 * 【发布】（编辑态 footer）：先静默自动保存（不弹「已保存」toast）再收抽屉，
 * 由父页打开版本管理侧栏（原型 drawerFoot expert-version：自动保存 → 关抽屉 → openExpertVersion）。
 */
async function publishFromEditor() {
  if (disabled.value || !isEdit.value) return
  // 发布门先行：0 技能给发布专用文案（原型 openExpertVersion 口径），不淹没在「补齐必填项」里
  if (!form.skillIds.length) {
    errors.skills = '请至少添加 1 个技能'
    ElMessage.warning('至少引用 1 个市场技能才能发布')
    return
  }
  if (!validate()) {
    warnInvalid()
    return
  }
  saving.value = true
  try {
    const d = await updateExpert(props.expertId, buildPayload())
    detail.value = d
    close()
    emit('publish', d)
  } catch (e) {
    if (e?.field && e.field in errors) errors[e.field] = e.message
    else ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

/* ==================== 生命周期 ==================== */
function close() {
  emit('update:visible', false)
}

// immediate：抽屉若以 visible=true 直接挂载也能触发首次 load。
watch(
  () => props.visible,
  (open) => {
    if (open) {
      load()
    } else {
      skillKeyword.value = ''
      skillExpanded.value = false
      kbKeyword.value = ''
      kbExpanded.value = false
    }
  },
  { immediate: true }
)

/* ==================== 底部时间条（编辑/查看；原型 metaHtml） ==================== */
const metaItems = computed(() => {
  const d = detail.value
  if (!d) return []
  const t = (v) => (v ? fmtTime(v) : '-')
  return [
    `创建时间：${t(d.createdAt)}`,
    `最近更新时间：${t(d.updatedAt)}`,
    `最近发布时间：${t(d.publishedAt)}`,
    `最新版本：${d.latestVersionLabel || '-'}`
  ]
})
</script>

<template>
  <DrawerEditor
    :visible="visible"
    entity="专家"
    :is-edit="isEdit"
    :readonly="props.readonly"
    :loading="loading"
    :error="loadError"
    :saving="saving"
    @update:visible="emit('update:visible', $event)"
    @retry="load"
    @save="save"
  >
    <!-- 标题行的发布态标签（三态映射，与列表页一致） -->
    <template #title-extra>
      <StatusTag v-if="isEdit && detail" :type="view.tagType">{{ view.label }}</StatusTag>
    </template>

    <template #default>
      <!-- ======== 只读查看态（原型 openExpertViewer 形态） ======== -->
      <template v-if="props.readonly">
        <section class="section-card">
          <h3 class="section-title">基本信息</h3>
          <div class="ee-view-grid">
            <div class="ee-view-field">
              <span class="ee-view-label">专家名</span>
              <span class="ee-view-value">{{ detail?.name || '—' }}</span>
            </div>
            <div class="ee-view-field">
              <span class="ee-view-label">状态</span>
              <span class="ee-view-value"><StatusTag :type="view.tagType">{{ view.label }}</StatusTag></span>
            </div>
            <div class="ee-view-field">
              <span class="ee-view-label">分类</span>
              <span class="ee-view-value">{{ detail?.category || '—' }}</span>
            </div>
            <div class="ee-view-field ee-view-full">
              <span class="ee-view-label">简介</span>
              <span class="ee-view-value">{{ detail?.intro || '—' }}</span>
            </div>
            <div class="ee-view-field ee-view-full">
              <span class="ee-view-label">职责描述</span>
              <span class="ee-view-value ee-view-pre">{{ detail?.roleDesc || '—' }}</span>
            </div>
          </div>
        </section>

        <section class="section-card">
          <h3 class="section-title">专家帮你做</h3>
          <div class="ee-view-questions">
            <div
              v-for="(q, i) in detail?.exampleQuestions || []"
              :key="i"
              class="ee-view-question"
            >{{ i + 1 }}. {{ q }}</div>
          </div>
        </section>

        <section class="section-card">
          <h3 class="section-title">
            市场技能引用
            <span class="section-sub">{{ viewSkills.length }} 个技能</span>
          </h3>
          <div v-if="viewSkills.length" class="ee-sk-grid">
            <div v-for="s in viewSkills" :key="s.skillId" class="ee-sk-card">
              <div class="ee-sk-main">
                <div class="ee-sk-name" :title="s.name">{{ s.name }}</div>
                <div class="ee-sk-desc" :title="s.description || ''">{{ s.description || '—' }}</div>
              </div>
            </div>
          </div>
          <div v-else class="ee-empty">暂无技能引用</div>
        </section>

        <div class="ee-meta">
          <span v-for="m in metaItems" :key="m">{{ m }}</span>
        </div>
      </template>

      <!-- ======== 新建 / 编辑态 ======== -->
      <template v-else>
        <!-- 审核锁定提示（兜底：列表已把审核中行的编辑置灰） -->
        <el-alert
          v-if="locked"
          type="warning"
          :closable="false"
          show-icon
          title="审核中，专家已锁定不可修改"
          description="需要继续编辑，请先在列表撤回本次审核申请。"
        />

        <!-- 顶部说明条（原型 expert-editor-note） -->
        <div class="ee-note">专家由多个市场技能组成。技能保持引用关系，市场技能更新后专家会同步使用最新内容。</div>

        <!-- ① 基本信息（E1 卡片化 + E2 两列栅格：专家名｜分类、图标｜背景色，简介 / 职责描述通栏；
             「专家帮你做」并入本卡末尾作子分区） -->
        <section class="section-card">
          <h3 class="section-title">基本信息</h3>

          <el-form label-position="top" class="ee-form-grid">
            <el-form-item label="专家名" required :error="errors.name">
              <el-input
                v-model="form.name"
                maxlength="64"
                show-word-limit
                :disabled="disabled"
                placeholder="如 经营分析专家"
              />
            </el-form-item>
            <el-form-item label="分类" required :error="errors.category">
              <el-select
                v-model="form.category"
                placeholder="请选择分类"
                class="ee-category"
                :disabled="disabled"
                @change="errors.category = ''"
              >
                <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
            <el-form-item label="图标" required :error="errors.avatar">
              <!-- 图标行（E2/C5，原型 L1331 decorateEditor 后的 `.icon-row.compact-icon-row`）：
                   预览块 + 并排【从图标库选择】【上传图标】两枚 plain 按钮，链路仍是 IconPickerPopover
                   的图标库弹窗 / 上传裁剪（IconField 内部 headless 复用），只读态两按钮置灰。
                   外层 --ee-bg 变量把「背景色」实时同步到预览块背景（原型 syncEditorColor）。 -->
              <span class="ee-icon-wrap" :style="{ '--ee-bg': form.backgroundColor }">
                <IconField
                  :icon="form.avatar"
                  :name="form.name"
                  :readonly="disabled"
                  placeholder="—"
                  @pick="onPickIcon"
                />
              </span>
            </el-form-item>
            <!-- 背景色（2026-09-04 新增必填，字段顺序：图标之后、简介之前——原型 finalizeExpertLayout）：
                 固定 7 色板单选 + 选中打勾；hint 照原型逐字。 -->
            <el-form-item label="背景色" required :error="errors.backgroundColor">
              <div class="ee-bg-field">
                <div class="ee-bg-picker" role="radiogroup" aria-label="背景色">
                  <label
                    v-for="(c, i) in BACKGROUND_COLORS"
                    :key="c"
                    class="ee-bg-swatch"
                    :title="c"
                  >
                    <input
                      type="radio"
                      name="expertBackgroundColor"
                      :value="c"
                      :checked="form.backgroundColor === c"
                      :disabled="disabled"
                      :aria-label="`背景色 ${i + 1}，${c}`"
                      @change="pickBackground(c)"
                    />
                    <span class="ee-bg-chip" :style="{ '--swatch': c }"></span>
                  </label>
                </div>
                <div class="ee-bg-hint">用于专家图标和客户端卡片背景，固定提供 7 种颜色</div>
              </div>
            </el-form-item>
            <el-form-item label="简介" required :error="errors.intro" class="ee-full">
              <el-input
                v-model="form.intro"
                type="textarea"
                :rows="3"
                maxlength="2000"
                show-word-limit
                :disabled="disabled"
                placeholder="一句话说明该专家能解决什么问题"
              />
            </el-form-item>
            <!-- 职责描述：Markdown 编辑器就地内嵌，字数计数浮在编辑框右下角内。
                 高度 282 = 原型 L675 工具栏 52 + 文本域 min-height 230（E2③）。 -->
            <el-form-item label="职责描述" required :error="errors.roleDesc" class="ee-full">
              <div class="ee-soul">
                <div class="ee-soul-mde">
                  <SkillMilkdownEditor
                    :model-value="form.roleDesc"
                    height="282px"
                    :readonly="disabled"
                    placeholder="你是……专家，专注……。你擅长：1) … 2) …。回答风格：稳、细、主动、有分寸。支持 Markdown：# 标题、- 列表、**加粗**"
                    @update:model-value="form.roleDesc = $event"
                  />
                  <span class="ee-soul-count" :class="{ over: soulLen > SOUL_SOFT_LIMIT }">
                    {{ soulLen }} / {{ SOUL_SOFT_LIMIT }}
                  </span>
                </div>
              </div>
            </el-form-item>
          </el-form>

          <!-- ②「专家帮你做」（示例问题，必填固定 3 条）——E1：原型 L1111 把本段从独立卡移进
               「基本信息」卡内作子分区（上边框分隔）。区标题必填红星（2026-09-04 finalizeExpertLayout）；
               区级【AI 生成】走统一 AI 实况生成机制（源=简介，空则禁用 + title 引导）。
               md §三.3 写「每条输入行旁展示【AI 生成】」↔ 原型/代码为区级一枚 → 本批按口径保持现状（E7）。 -->
          <div class="ee-basic-subsection">
            <div class="ee-sec-headrow">
              <h3 class="section-title ee-sub-title">
                <span class="ee-req">*</span>
                专家帮你做
                <span class="section-sub">必填，最多填写 3 条示例问题</span>
              </h3>
              <el-button
                v-if="!disabled"
                plain
                size="small"
                :disabled="aiQuestionsDisabled"
                :title="aiQuestionsTitle || undefined"
                @click="aiGenerateQuestions"
              >{{ aiQuestionsLabel }}</el-button>
            </div>
            <div class="ee-q-list">
              <div v-for="(q, i) in form.exampleQuestions" :key="i" class="ee-q-row">
                <span class="ee-q-index">{{ i + 1 }}</span>
                <!-- 校验收紧（2026-09-04）：3 条全填；空输入框在校验失败时标红（ee-q-invalid） -->
                <el-input
                  :ref="(el) => setQuestionRef(el, i)"
                  v-model="form.exampleQuestions[i]"
                  maxlength="60"
                  :disabled="disabled"
                  :class="{ 'ee-q-invalid': errors.examples && !String(form.exampleQuestions[i] || '').trim() }"
                  :placeholder="i === 0 ? '帮我生成一份行业调研报告' : '请输入示例问题'"
                  @input="errors.examples = ''"
                />
              </div>
            </div>
            <div v-if="errors.examples" class="ee-field-err">{{ errors.examples }}</div>
          </div>
        </section>

        <!-- ③ 市场技能引用（内嵌卡片勾选；新建态即可勾选） -->
        <section class="section-card">
          <h3 class="section-title">
            市场技能引用
            <span class="section-sub">仅展示可引用的市场技能，至少添加 1 个</span>
          </h3>
          <div class="ee-sk-pickhead">
            <el-input
              v-model="skillKeyword"
              class="ee-sk-search"
              placeholder="搜索技能名称、描述或分类"
              clearable
              :disabled="candidatesLoading"
            />
            <span class="ee-sk-summary">已选择 {{ form.skillIds.length }} 个 · 共 {{ candidates.length }} 个市场技能</span>
          </div>
          <div v-loading="candidatesLoading" class="ee-sk-grid">
            <label
              v-for="s in shownCandidates"
              :key="s.id"
              class="ee-skill-check"
              :class="{ checked: isChecked(s.id), disabled }"
            >
              <input
                type="checkbox"
                :checked="isChecked(s.id)"
                :disabled="disabled"
                @change="toggleSkill(s.id, $event.target.checked)"
              />
              <span class="ee-skill-body">
                <span class="ee-skill-titlerow">
                  <strong>{{ s.name }}</strong>
                  <span class="ee-skill-cat">{{ s.category }}</span>
                </span>
                <small>{{ s.description || '暂无技能描述' }}</small>
              </span>
            </label>
            <div v-if="!candidatesLoading && !shownCandidates.length" class="ee-empty ee-sk-empty">
              没有匹配的市场技能
            </div>
          </div>
          <!-- 【展开更多（N）】：原型 L686–L688 `.expert-skill-more` = 34px 居中 plain 按钮（非文字链） -->
          <div v-if="showMoreRow" class="ee-sk-more-row">
            <el-button plain class="ee-more-btn" @click="skillExpanded = !skillExpanded">
              {{ skillExpanded ? '收起' : `展开更多（${hiddenCount}）` }}
            </el-button>
          </div>
          <div v-if="errors.skills" class="ee-field-err">{{ errors.skills }}</div>
        </section>

        <!-- ④ 只读「知识库」区块（2026-09-04 原型 expert-knowledge-card-module：技能引用区后）。
             列=知识库名称/数据源/文档数量/状态/操作；默认露 2 行 + 展开更多（N）；搜索时全量匹配。 -->
        <section class="section-card ee-kb-sec">
          <h3 class="section-title">
            知识库
            <span class="section-sub">当前专家可见范围内的知识库</span>
          </h3>
          <!-- 搜索框 ⌕ 前缀（E5，原型 L4116 `.expert-kb-search:before`） -->
          <div class="ee-kb-search">
            <el-input v-model="kbKeyword" placeholder="搜索知识库名称" clearable>
              <template #prefix><span class="ee-kb-search-icon">⌕</span></template>
            </el-input>
          </div>
          <div v-loading="kbLoading" class="ee-kb-tablewrap">
            <table class="ee-kb-table">
              <!-- 列宽照原型 L4158 colgroup（table-layout:fixed 依赖它） -->
              <colgroup>
                <col style="width: 34%" />
                <col style="width: 22%" />
                <col style="width: 10%" />
                <col style="width: 12%" />
                <col style="width: 22%" />
              </colgroup>
              <thead>
                <tr>
                  <th>知识库名称</th>
                  <th>数据源</th>
                  <th>文档数量</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in kbShown" :key="r.id" class="ee-kb-row">
                  <td>
                    <strong>{{ r.name }}</strong>
                    <small v-if="r.description" :title="r.description">{{ r.description }}</small>
                  </td>
                  <td><span class="ee-kb-source">{{ kbSourcesText(r) || '—' }}</span></td>
                  <td>{{ kbDocText(r) }}</td>
                  <td><span class="ee-kb-status">{{ kbStateMeta(r).label }}</span></td>
                  <!-- E4：【查看】收抽屉 + 深链落知识库查看态；【检索测试】不收抽屉、就地叠弹窗 -->
                  <td class="ee-kb-ops">
                    <el-button link type="primary" @click="viewKnowledge(r)">查看</el-button>
                    <el-button link type="primary" @click="testKnowledge(r)">检索测试</el-button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!kbLoading && !kbShown.length" class="ee-kb-empty">未找到匹配的知识库</div>
          </div>
          <!-- 【展开更多（N）】：原型 L4127 plain 居中、min-width 112 -->
          <div v-if="kbShowMore" class="ee-kb-more">
            <el-button plain class="ee-more-btn ee-kb-more-btn" @click="kbExpanded = !kbExpanded">
              {{ kbExpanded ? '收起' : `展开更多（${kbExtraCount}）` }}
            </el-button>
          </div>
        </section>

        <!-- 底部时间条（编辑态；原型 metaHtml：创建/最近更新/最近发布/最新版本） -->
        <div v-if="isEdit && detail" class="ee-meta">
          <span v-for="m in metaItems" :key="m">{{ m }}</span>
        </div>
      </template>
    </template>

    <!-- 底部按钮：查看=【关闭】；新建=【取消】【创建专家】；编辑=【取消】【发布】【保存】 -->
    <template #footer>
      <el-button :disabled="saving" @click="close">{{ props.readonly ? '关闭' : '取消' }}</el-button>
      <template v-if="!props.readonly && !locked">
        <el-button v-if="isEdit" :loading="saving" @click="publishFromEditor">发布</el-button>
        <el-button type="primary" :loading="saving" @click="save">
          {{ isEdit ? '保存' : '创建专家' }}
        </el-button>
      </template>
    </template>

    <!-- E4：检索测试弹窗叠在专家抽屉之上（原型 L4175 `openSearch(kb)` 不 closeDrawer）。
         挂 #extra（抽屉子树内）保证层级压在抽屉之上、且不被 .de-body 的滚动容器裁切。 -->
    <template #extra>
      <KnowledgeSearchDialog v-model:visible="searchVisible" :kb="searchKb" />
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* 分区卡（E1）：卡壳样式（白底/描边/圆角/灰底卡头）来自 assets/admin-shell.css 的 .section-card，
 * 本文件只补专家抽屉自己的排版，不重复写卡样式、不改共享层。
 * 卡标题在专家抽屉里提到 17px/700（原型 L1082 `.drawer.expert-editor-drawer .section-title`）。 */
.section-card > .section-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 24px;
}
.ee-sec-headrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
/* 子分区标题（.section-title 在卡内是贴边灰底条，子分区里要退回普通标题） */
.ee-sub-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  margin: 0;
  min-height: 0;
  padding: 0;
  background: transparent;
  border: 0;
}
.ee-field-err {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.section-card :deep(.el-form-item) {
  margin-bottom: var(--space-4);
}
.section-card :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}
.ee-empty {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  padding: var(--space-3) 0;
}

/* —— 基本信息两列栅格（E2，原型 L16 `.section-card .form-grid{repeat(2,minmax(0,1fr))}` + L51 gap 18/22） —— */
.ee-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 22px;
}
.ee-form-grid :deep(.el-form-item) {
  margin-bottom: 0;
  min-width: 0;
}
/* 通栏字段（简介 / 职责描述） */
.ee-full {
  grid-column: 1 / -1;
}
@media (max-width: 620px) {
  .ee-form-grid {
    grid-template-columns: 1fr;
  }
}

/* —— 「专家帮你做」子分区（E1，原型 L1102 `.expert-basic-subsection`：上边框 + 26/24 间距） —— */
.ee-basic-subsection {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: 26px;
  padding-top: 24px;
  border-top: 1px solid var(--border-soft);
}

/* 顶部说明条（原型 expert-editor-note） */
.ee-note {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--c-accent-soft, var(--bg-hover));
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
  line-height: 1.55;
}

.ee-category {
  width: 100%;
}

/* —— 必填红星（区块标题级，2026-09-04 原型 expert-required-mark） —— */
.ee-req {
  color: var(--c-danger);
  font-weight: var(--fw-normal);
}

/* —— 图标预览背景实时联动背景色（原型 syncEditorColor；--ee-bg 由模板落值）。
       2026-09-09 批次 3C · E2：图标行换 IconField 后预览块类名由 .ip-avatar 变为 .icon-preview。 —— */
.ee-icon-wrap :deep(.icon-preview) {
  background: var(--ee-bg, transparent);
  transition: background-color 0.15s ease;
}

/* —— 背景色 7 色板（原型 expert-background-color-style 移植，令牌化描边/勾选态） —— */
.ee-bg-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ee-bg-picker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-height: 32px;
}
.ee-bg-swatch {
  position: relative;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  cursor: pointer;
}
.ee-bg-swatch input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
  pointer-events: none;
}
.ee-bg-chip {
  width: 30px;
  height: 30px;
  display: block;
  border: 1px solid var(--border-base);
  border-radius: 7px;
  background: var(--swatch);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.72);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.ee-bg-swatch:hover .ee-bg-chip {
  transform: translateY(-1px);
  border-color: var(--c-text-faint);
}
.ee-bg-swatch input:focus-visible + .ee-bg-chip {
  outline: 2px solid var(--c-primary, #409eff);
  outline-offset: 2px;
}
.ee-bg-swatch input:checked + .ee-bg-chip {
  border-color: var(--c-primary, #409eff);
  box-shadow: inset 0 0 0 2px #fff, 0 0 0 2px var(--c-primary, #409eff);
}
/* 选中打勾（原型 :checked span:after content:"\2713"） */
.ee-bg-swatch input:checked + .ee-bg-chip::after {
  content: '\2713';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #26342d;
  font-size: 14px;
  font-weight: 700;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.85);
}
.ee-bg-swatch input:disabled + .ee-bg-chip {
  cursor: not-allowed;
  opacity: 0.6;
}
.ee-bg-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
}

/* —— 示例问题校验红框（3 条未全填时的空输入框） —— */
.ee-q-invalid :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}

/* —— 职责描述内嵌编辑器 —— */
.ee-soul {
  width: 100%;
}
.ee-soul-mde {
  position: relative;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.ee-soul-count {
  position: absolute;
  right: var(--space-2);
  bottom: var(--space-1);
  padding: 0 var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  background: var(--bg-elevated, var(--bg-base));
  border-radius: var(--radius-sm);
  pointer-events: none;
}
.ee-soul-count.over {
  color: var(--c-warning);
}

/* —— 专家帮你做（编号 + 输入行；原型 L1090 抽屉内 `.fixed-entry-row` = 30px 轨 / gap 10 / 行距 14，
       编号块 28px、输入框 46px 高） —— */
.ee-q-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ee-q-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 2px 0;
}
.ee-q-row :deep(.el-input__wrapper) {
  height: 46px;
}
.ee-q-index {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
}

/* —— 市场技能引用（内嵌选择器）——
 * E3 照原型 L1093–L1101（抽屉 polish 层）：搜索框 42px 与摘要同行、卡两列 gap 12、
 * 卡 min-height 84 / padding 16 15 14 44、checkbox 绝对定位左上（15/14）、
 * 选中态左侧 4px 绿条 + 绿底 + 1px 绿描边、hover 上浮 2px。 */
.ee-sk-pickhead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.ee-sk-search :deep(.el-input__wrapper) {
  height: 42px;
}
.ee-sk-summary {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  white-space: nowrap;
}
.ee-sk-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 900px) {
  .ee-sk-grid {
    grid-template-columns: 1fr;
  }
}
.ee-skill-check {
  position: relative;
  display: flex;
  min-height: 84px;
  margin: 0;
  padding: 16px 15px 14px 44px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: var(--bg-surface, var(--bg-base));
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, background 0.2s ease;
}
.ee-skill-check:hover {
  border-color: var(--c-accent, #409eff);
  box-shadow: var(--shadow-md, 0 8px 20px rgba(27, 48, 39, 0.12));
  transform: translateY(-2px);
}
.ee-skill-check.checked {
  border-color: var(--c-accent, #409eff);
  background: var(--c-accent-soft, var(--bg-hover));
  box-shadow: 0 0 0 1px var(--c-accent, #409eff);
}
/* 选中态左侧 4px 竖条（原型 `.skill-check:has(input:checked)::before`） */
.ee-skill-check.checked::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 0 4px 4px 0;
  background: var(--c-accent, #409eff);
}
.ee-skill-check.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.ee-skill-check input {
  position: absolute;
  top: 15px;
  left: 14px;
  margin: 0;
  accent-color: var(--c-accent, #409eff);
  flex: none;
}
.ee-skill-body {
  min-width: 0;
  display: block;
}
.ee-skill-titlerow {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.ee-skill-titlerow strong {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ee-skill-cat {
  flex: none;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ee-skill-body small {
  display: block;
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
}
.ee-sk-empty {
  grid-column: 1 / -1;
}
.ee-sk-more-row {
  display: flex;
  justify-content: center;
  margin-top: 10px;
}
/* 【展开更多（N）】/【收起】统一 plain 按钮 34px（原型 `.expert-skill-more` L688 / `.expert-kb-more` L4127） */
.ee-more-btn {
  height: 34px;
  padding: 0 15px;
}
.ee-kb-more-btn {
  min-width: 112px;
}

/* —— 只读查看态 —— */
.ee-view-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3) var(--space-4);
}
.ee-view-full {
  grid-column: 1 / -1;
}
.ee-view-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.ee-view-label {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ee-view-value {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  line-height: 1.6;
  word-break: break-word;
}
.ee-view-pre {
  white-space: pre-wrap;
}
.ee-view-questions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ee-view-question {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

/* —— 技能卡（查看态复用） —— */
.ee-sk-card {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
}
.ee-sk-main {
  flex: 1;
  min-width: 0;
}
.ee-sk-name {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ee-sk-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 只读「知识库」区块（原型 expert-knowledge-card-style L4113–L4130 移植，令牌化） —— */
.ee-kb-search {
  position: relative;
  margin: 2px 0 12px;
}
/* ⌕ 前缀图标（原型 `.expert-kb-search:before`，此处用 el-input 的 #prefix 插槽承载） */
.ee-kb-search-icon {
  color: var(--c-text-faint);
  font-size: 15px;
  line-height: 1;
}
.ee-kb-tablewrap {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-base);
  overflow: hidden;
}
.ee-kb-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}
.ee-kb-table th {
  height: 36px;
  padding: 0 10px;
  text-align: left;
  color: var(--c-text-faint);
  background: var(--bg-sunken);
  font-weight: var(--fw-medium);
  white-space: nowrap;
}
.ee-kb-table td {
  padding: 11px 10px;
  border-top: 1px solid var(--border-soft);
  vertical-align: middle;
  color: var(--c-text-muted);
  line-height: 1.45;
}
.ee-kb-table td strong {
  display: block;
  color: var(--c-text-strong);
  font-size: 13px;
  font-weight: var(--fw-medium);
}
.ee-kb-table td small {
  display: block;
  margin-top: 2px;
  color: var(--c-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}
.ee-kb-source {
  color: var(--c-text-muted);
}
.ee-kb-status {
  display: inline-flex;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.ee-kb-ops {
  white-space: nowrap;
}
.ee-kb-empty {
  padding: 28px 16px;
  text-align: center;
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}
.ee-kb-more {
  display: flex;
  justify-content: center;
  padding-top: 12px;
}
/* 窄屏：表格横向滚动（原型 L4130 @media 720px） */
@media (max-width: 720px) {
  .ee-kb-tablewrap {
    overflow-x: auto;
  }
  .ee-kb-table {
    min-width: 720px;
  }
}

/* —— 底部时间条（原型 page-time；卡外独立成行，左右 2px 与卡对齐） —— */
.ee-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3) 2px 2px;
  border-top: 1px solid var(--border-soft);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ee-meta span {
  white-space: nowrap;
}
</style>
