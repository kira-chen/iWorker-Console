<script setup>
/**
 * 专家团编辑器（抽屉式；新建 / 编辑 / 只读查看三态共用）。
 * 规则依据：docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家团.md §三（以下简称 md）。
 *
 * 五个区块自上而下：基本信息 → 团队成员与团长 → 团队协作关系 → 团队帮你做（示例问题）→ 时间信息。
 * 抽屉外壳、四态、图标行、AI 实况生成、发布态派生全部复用专家编辑器同一批公共件，
 * 本文件只写团自己的东西：成员候选 / 已选列表 / 团长 / 试跑拆解。
 *
 * 【成员候选范围】由团类型决定（md §三.3.1）：三类团都可放通用专家和市场专家，岗位私有专家只能进岗位私有团。
 * 团类型未选时成员区块置灰；候选实时读专家模块（已发布才算），已选成员即使后来被停用 / 回收也仍显示在已选列表里，
 * 带红色原因标签——这是「缺员」在编辑器里的样子。
 *
 * 【发布】编辑态底部【发布】= 先校验并静默保存，再收抽屉，交给列表页做发布前检查并打开版本管理侧栏（emit publish）。
 * 发布前检查（成员均已发布、岗位匹配、没团长时的试跑提醒）在列表页统一处理，列表【发布】与本处走同一条路。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import RevokedBanner from '@/components/admin/RevokedBanner.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import IconField from '@/components/common/IconField.vue'
import { KIND, deriveTriView, isLocked } from '@/utils/publishState'
import {
  getTeam,
  createTeam,
  updateTeam,
  listTeamMemberCandidates,
  trialTeam
} from '@/api/expertTeam'
import { useAiLiveGenerate, teamIntroText, teamLeaderDutyText, teamCollabText, teamQuestionSet } from '@/utils/aiLiveGenerate'
import { getFieldOptionNames } from '@/api/fieldDictMock'
import { EXPERT_TYPE, EXPERT_TYPE_OPTIONS } from '@/api/expertTypes'
import { fmtTime } from '@/utils/docMeta'
import { iconIsUrl } from '@/utils/iconDisplay'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 团 id；null = 新建。 */
  teamId: { type: [Number, String], default: null },
  /** 只读查看（列表【查看】入口 / 审核中心）。 */
  readonly: { type: Boolean, default: false },
  /** 审核版本快照的 detail：有值即以它渲染，不向 getTeam 取实时数据（审核中心只读查看用）。 */
  snapshotDetail: { type: Object, default: null },
  /** 打开后自动弹出试跑窗口（发布前提醒里点【去试跑】进来）。 */
  autoTrial: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved', 'publish'])

/** 团类型文案（与专家类型同值，名称带「团」）。 */
const TEAM_TYPE_OPTIONS = EXPERT_TYPE_OPTIONS.map((o) => ({
  value: o.value,
  label: { [EXPERT_TYPE.POSITION]: '岗位私有', [EXPERT_TYPE.PLATFORM]: '市场专家团', [EXPERT_TYPE.SYSTEM_DEFAULT]: '通用专家团' }[o.value]
}))

const MEMBER_MAX = 20
const MEMBER_MIN = 2
const BACKGROUND_COLORS = ['#FAE9DF', '#DCECF7', '#DCF5E4', '#E7E4F7', '#F7E6F2', '#F7EFCD', '#DDF0EF']
const BACKGROUND_FALLBACK = '#DCF5E4'
const safeBackground = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : BACKGROUND_FALLBACK)

const isEdit = computed(() => props.teamId != null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const detail = ref(null)
const CATEGORY_OPTIONS = getFieldOptionNames('expertCategory')

/* ==================== 表单 ==================== */
const form = reactive({
  name: '',
  type: '',
  positionIds: [],
  avatar: '',
  backgroundColor: BACKGROUND_FALLBACK,
  category: '',
  intro: '',
  members: [], // [{ expertId, duty }]，顺序即团内排位
  leaderId: null,
  leaderDuty: '',
  collab: '',
  exampleQuestions: ['', '', '']
})
const errors = reactive({
  name: '', type: '', avatar: '', backgroundColor: '', category: '', intro: '',
  members: '', leaderDuty: '', collab: '', examples: ''
})
/** 当前表单对应的配置是否试跑过（结构变了就清零，见下方 watch）。 */
const trialed = ref(false)

function clearErrors() {
  for (const k of Object.keys(errors)) errors[k] = ''
}

function resetForm(d) {
  form.name = d?.name || ''
  form.type = d?.type || ''
  form.positionIds = Array.isArray(d?.positionIds) ? [...d.positionIds] : []
  form.avatar = d?.avatar || ''
  form.backgroundColor = safeBackground(d?.backgroundColor)
  form.category = d?.category || ''
  form.intro = d?.intro || ''
  form.members = (d?.members || []).map((m) => ({ expertId: m.expertId, duty: m.duty || '' }))
  form.leaderId = d?.leaderId ?? null
  form.leaderDuty = d?.leaderDuty || ''
  form.collab = d?.collab || ''
  form.exampleQuestions = [0, 1, 2].map((i) => String((d?.exampleQuestions || [])[i] || ''))
  trialed.value = !!d?.trialed
  memberInfo.clear()
  ;(d?.members || []).forEach((m) => memberInfo.set(String(m.expertId), { ...m }))
  clearErrors()
}

/* ==================== 发布态 ==================== */
const locked = computed(() => isLocked(KIND.DOMAIN_EXPERT, detail.value || {}))
const disabled = computed(() => props.readonly || locked.value)
const view = computed(() => {
  const tri = deriveTriView(KIND.DOMAIN_EXPERT, detail.value || {})
  return { label: tri.label, tagType: tri.type }
})

/* ==================== 所属岗位（仅岗位私有团） ==================== */
const publishedPositions = ref([])
async function loadPublishedPositions() {
  try {
    // 动态引：避免 api/position → api/request → router 链条进入引用本组件的单测模块图（同 ExpertEditor）
    const { listPositions } = await import('@/api/position')
    const res = await listPositions({ status: 'published' })
    publishedPositions.value = res.list || []
  } catch {
    publishedPositions.value = []
  }
}

/* ==================== 成员候选 / 已选 ==================== */
const candidates = ref([])
const candidatesLoading = ref(false)
const memberKeyword = ref('')
const memberCategory = ref('')
/** 专家 id → 展示信息（名称 / 图标 / 分类 / 带团说明 / 不可用原因）；候选与已存成员两处来源合并。 */
const memberInfo = reactive(new Map())

let candSeq = 0
async function loadCandidates() {
  const seq = ++candSeq
  if (!form.type) {
    candidates.value = []
    return
  }
  candidatesLoading.value = true
  try {
    const list = await listTeamMemberCandidates({ type: form.type })
    if (seq !== candSeq) return
    candidates.value = Array.isArray(list) ? list : []
    candidates.value.forEach((x) => {
      const old = memberInfo.get(String(x.id)) || {}
      memberInfo.set(String(x.id), { ...old, expertId: x.id, name: x.name, avatar: x.avatar, backgroundColor: x.backgroundColor, category: x.category, leadGuide: x.leadGuide, unavailable: '' })
    })
  } catch {
    if (seq === candSeq) candidates.value = []
  } finally {
    if (seq === candSeq) candidatesLoading.value = false
  }
}
watch(() => form.type, loadCandidates)

const categoryChips = computed(() => {
  const counts = new Map()
  candidates.value.forEach((x) => counts.set(x.category, (counts.get(x.category) || 0) + 1))
  return [...counts.entries()].map(([name, n]) => ({ name, n }))
})
const shownCandidates = computed(() => {
  const kw = memberKeyword.value.trim().toLowerCase()
  return candidates.value.filter(
    (x) =>
      (!memberCategory.value || x.category === memberCategory.value) &&
      (!kw || [x.name, x.intro, x.category].some((v) => String(v || '').toLowerCase().includes(kw)))
  )
})

const selectedIds = computed(() => new Set(form.members.map((m) => String(m.expertId))))
const isSelected = (id) => selectedIds.value.has(String(id))
const infoOf = (id) => memberInfo.get(String(id)) || { name: `专家 ${id}`, category: '', avatar: '', leadGuide: '', unavailable: '' }

function toggleMember(x) {
  if (disabled.value) return
  if (isSelected(x.id)) return removeMember(x.id)
  if (form.members.length >= MEMBER_MAX) {
    ElMessage.warning(`成员最多 ${MEMBER_MAX} 位`)
    return
  }
  form.members.push({ expertId: x.id, duty: '' })
  if (form.members.length >= MEMBER_MIN) errors.members = ''
}
function removeMember(id) {
  if (disabled.value) return
  form.members = form.members.filter((m) => String(m.expertId) !== String(id))
  // 团长被移除 → 团长清空；已填的职责文本留在草稿里，重新设团长时回填（md §三.3.2）
  if (String(form.leaderId) === String(id)) form.leaderId = null
}
function moveMember(i, delta) {
  const j = i + delta
  if (disabled.value || j < 0 || j >= form.members.length) return
  const arr = [...form.members]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  form.members = arr
}

/** 设 / 取消团长；设上时若团长职责为空，自动回填该专家的「带团分工说明」（md §三.3.3）。 */
function toggleLeader(id) {
  if (disabled.value) return
  if (String(form.leaderId) === String(id)) {
    form.leaderId = null
    return
  }
  form.leaderId = id
  errors.leaderDuty = ''
  if (!form.leaderDuty.trim()) form.leaderDuty = infoOf(id).leadGuide || ''
}

/** 团介绍首次自动填入：成员凑满 2 位且团介绍为空时填一版，之后不再自动覆盖。 */
let hydrating = false
watch(
  () => form.members.length,
  (n, old) => {
    if (hydrating || disabled.value || n < MEMBER_MIN || old >= n || form.intro.trim()) return
    form.intro = teamIntroText(aiCtx())
    errors.intro = ''
  }
)

/** 成员或团长、职责、协作关系变了 → 已试跑状态清零（md §三.9）。 */
const structureKey = computed(() =>
  JSON.stringify([form.members.map((m) => [m.expertId, m.duty]), form.leaderId, form.leaderDuty, form.collab])
)
watch(structureKey, () => {
  if (!hydrating) trialed.value = false
})

/* ==================== 背景色 / 图标 ==================== */
function pickBackground(color) {
  if (disabled.value) return
  form.backgroundColor = safeBackground(color)
  errors.backgroundColor = ''
}
function onPickIcon({ icon }) {
  form.avatar = icon || ''
  if (form.avatar) errors.avatar = ''
}

/* ==================== AI 生成（四处，规则见 md §三.7） ==================== */
const memberViews = () => form.members.map((m) => ({ name: infoOf(m.expertId).name, category: infoOf(m.expertId).category, duty: m.duty }))
const aiCtx = () => {
  const leader = form.leaderId != null ? infoOf(form.leaderId) : null
  return { name: form.name, intro: form.intro, members: memberViews(), leader: leader ? { name: leader.name, category: leader.category } : null, memberNames: memberViews().map((m) => m.name) }
}
const NEED_MEMBERS = '请先选择至少 2 位成员'
const enoughMembers = () => (form.members.length >= MEMBER_MIN ? 'ok' : '')
const aiOptsBase = { isReadonly: () => disabled.value, resetOn: () => [props.visible, props.teamId] }

const aiIntro = useAiLiveGenerate({
  ...aiOptsBase, getSourceText: enoughMembers, sourceLabel: '成员', emptyTitle: NEED_MEMBERS,
  getSourceContext: aiCtx, generate: teamIntroText,
  apply: (text) => { form.intro = text; errors.intro = '' }
})
const aiLeaderDuty = useAiLiveGenerate({
  ...aiOptsBase, getSourceText: () => (form.leaderId != null ? 'ok' : ''), sourceLabel: '团长', emptyTitle: '请先设置团长',
  getSourceContext: aiCtx, generate: teamLeaderDutyText,
  apply: (text) => { form.leaderDuty = text; errors.leaderDuty = '' }
})
const aiCollab = useAiLiveGenerate({
  ...aiOptsBase, getSourceText: enoughMembers, sourceLabel: '成员', emptyTitle: NEED_MEMBERS,
  getSourceContext: aiCtx, generate: teamCollabText,
  apply: (text) => { form.collab = text; errors.collab = '' }
})
const aiQuestions = useAiLiveGenerate({
  ...aiOptsBase, getSourceText: () => (form.name.trim() && form.intro.trim() ? 'ok' : ''), sourceLabel: '团名称和团介绍',
  getSourceContext: aiCtx, generate: teamQuestionSet,
  apply: (qs) => { form.exampleQuestions = [...qs]; errors.examples = '' }
})

/* ==================== 试跑拆解（md §三.9） ==================== */
const trialVisible = ref(false)
const trialTask = ref('')
const trialRunning = ref(false)
const trialError = ref('')
const trialResult = ref(null)

const trialDisabledReason = computed(() => {
  if (form.members.length < MEMBER_MIN) return NEED_MEMBERS
  if (form.leaderId == null && !form.collab.trim()) return '请先填写团队协作关系'
  return ''
})
function openTrial() {
  if (trialDisabledReason.value) return
  trialTask.value = trialTask.value || form.exampleQuestions[0] || ''
  trialResult.value = null
  trialError.value = ''
  trialVisible.value = true
}
async function runTrial() {
  if (!trialTask.value.trim()) {
    trialError.value = '请输入试跑任务描述'
    return
  }
  trialRunning.value = true
  trialError.value = ''
  try {
    trialResult.value = await trialTeam({
      members: form.members, leaderId: form.leaderId, leaderDuty: form.leaderDuty, collab: form.collab, task: trialTask.value.trim()
    })
    trialed.value = true
  } catch (e) {
    trialResult.value = null
    trialError.value = e?.message || '试跑失败，请稍后重试'
  } finally {
    trialRunning.value = false
  }
}

/* ==================== 加载 ==================== */
let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  loadPublishedPositions()
  hydrating = true
  try {
    if (!isEdit.value) {
      detail.value = null
      resetForm(null)
      loadCandidates()
      return
    }
    if (props.snapshotDetail) {
      loading.value = false
      loadError.value = ''
      detail.value = props.snapshotDetail
      resetForm(props.snapshotDetail)
      return
    }
    loading.value = true
    loadError.value = ''
    detail.value = null
    try {
      const d = await getTeam(props.teamId)
      if (seq !== loadSeq) return
      detail.value = d
      resetForm(d)
      await loadCandidates()
      if (props.autoTrial && !props.readonly) openTrial()
    } catch (e) {
      if (seq !== loadSeq) return
      loadError.value = e?.message || '加载失败'
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  } finally {
    // 等 reactive 回调（structureKey / members.length）跑完再放开，避免回填被当作用户改动
    Promise.resolve().then(() => { hydrating = false })
  }
}

/* ==================== 校验 / 保存 / 发布 ==================== */
function validate() {
  clearErrors()
  let ok = true
  const fail = (k, msg) => { errors[k] = msg; ok = false }
  if (!form.name.trim()) fail('name', '请填写团名称')
  if (!form.type) fail('type', '请选择团类型')
  if (!form.category) fail('category', '请选择专家分类')
  if (!form.avatar.trim()) fail('avatar', '请选择图标')
  if (!BACKGROUND_COLORS.includes(form.backgroundColor)) fail('backgroundColor', '请选择背景色')
  if (!form.intro.trim()) fail('intro', '请填写团介绍')
  if (!form.exampleQuestions.every((q) => q.trim())) fail('examples', '请填写 3 条"团队帮你做"示例问题')
  if (form.members.length < MEMBER_MIN) fail('members', '至少 2 位成员')
  else if (form.members.some((m) => !m.duty.trim())) fail('members', '请填写每位成员在团里负责什么')
  if (form.leaderId != null) {
    if (!form.leaderDuty.trim()) fail('leaderDuty', '请填写团长职责')
  } else if (!form.collab.trim()) {
    fail('collab', '请填写团队协作关系')
  }
  return ok
}

function buildPayload() {
  return {
    name: form.name.trim(),
    type: form.type,
    positionIds: form.type === EXPERT_TYPE.POSITION ? [...form.positionIds] : [],
    avatar: form.avatar,
    backgroundColor: safeBackground(form.backgroundColor),
    category: form.category,
    intro: form.intro,
    members: form.members.map((m) => ({ expertId: m.expertId, duty: m.duty.trim() })),
    leaderId: form.leaderId,
    leaderDuty: form.leaderId != null ? form.leaderDuty : '',
    collab: form.collab,
    exampleQuestions: form.exampleQuestions.map((q) => q.trim()),
    trialed: trialed.value
  }
}

const questionInputRefs = ref([])
function warnInvalid() {
  if (errors.examples) {
    ElMessage.warning('请填写 3 条"团队帮你做"示例问题')
    const i = form.exampleQuestions.findIndex((q) => !q.trim())
    if (i >= 0) questionInputRefs.value[i]?.focus?.()
  } else {
    ElMessage.warning('请先补齐必填项')
  }
}

function applyServerError(e) {
  const map = { examples: 'examples', leaderId: 'members' }
  const key = map[e?.field] || e?.field
  if (key && key in errors) errors[key] = e.message
  else ElMessage.error(e?.message || '保存失败')
}

async function save() {
  if (disabled.value) return
  if (!validate()) return warnInvalid()
  saving.value = true
  try {
    if (isEdit.value) {
      detail.value = await updateTeam(props.teamId, buildPayload())
      ElMessage.success('专家团配置已保存')
      emit('saved')
    } else {
      const created = await createTeam(buildPayload())
      ElMessage.success('专家团已创建')
      emit('saved', created)
    }
    close()
  } catch (e) {
    applyServerError(e)
  } finally {
    saving.value = false
  }
}

/** 编辑态【发布】：静默保存 → 收抽屉 → 交列表页做发布前检查并开版本管理侧栏。 */
async function publishFromEditor() {
  if (disabled.value || !isEdit.value) return
  if (!validate()) return warnInvalid()
  saving.value = true
  try {
    const d = await updateTeam(props.teamId, buildPayload())
    detail.value = d
    close()
    emit('publish', d)
  } catch (e) {
    applyServerError(e)
  } finally {
    saving.value = false
  }
}

function close() {
  emit('update:visible', false)
}

watch(
  () => [props.visible, props.teamId],
  ([open]) => {
    if (open) load()
    else {
      memberKeyword.value = ''
      memberCategory.value = ''
      trialVisible.value = false
    }
  },
  { immediate: true }
)

const metaItems = computed(() => {
  const d = detail.value
  if (!d) return []
  const t = (v) => (v ? fmtTime(v) : '—')
  return [`创建时间：${t(d.createdAt)}`, `最近更新时间：${t(d.updatedAt)}`, `最近发布时间：${t(d.publishedAt)}`, `最新版本：${d.latestVersionLabel || '—'}`]
})
</script>

<template>
  <DrawerEditor
    :visible="visible"
    entity="专家团"
    :is-edit="isEdit"
    :readonly="props.readonly"
    :loading="loading"
    :error="loadError"
    :saving="saving"
    @update:visible="emit('update:visible', $event)"
    @retry="load"
    @save="save"
  >
    <template #title-extra>
      <StatusTag v-if="isEdit && detail" :type="view.tagType">{{ view.label }}</StatusTag>
    </template>

    <template #default>
      <RevokedBanner v-if="isEdit && detail?.revoked" label="专家团" :info="detail.revoked" />
      <el-alert
        v-if="locked"
        type="warning"
        :closable="false"
        show-icon
        title="审核中，专家团已锁定不可修改"
        description="需要继续编辑，请先在列表撤回本次审核申请。"
      />

      <div class="et-note">专家团由多位已发布的专家组成。专家保持引用关系，专家更新后团同步使用最新内容。</div>

      <!-- ① 基本信息 -->
      <section class="section-card">
        <h3 class="section-title">基本信息</h3>
        <el-form label-position="top" class="et-grid">
          <el-form-item label="团名称" required :error="errors.name">
            <el-input v-model="form.name" maxlength="64" show-word-limit :disabled="disabled" placeholder="如 合同会审团" />
          </el-form-item>
          <el-form-item label="分类" required :error="errors.category">
            <el-select v-model="form.category" placeholder="请选择分类" :disabled="disabled" style="width: 100%" @change="errors.category = ''">
              <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
            </el-select>
            <div class="et-hint">仅用于客户端「专家团 · 市场」的分类筛选，不在团卡片上展示</div>
          </el-form-item>
          <el-form-item label="团类型" required :error="errors.type">
            <el-select
              v-model="form.type"
              placeholder="请选择团类型"
              :disabled="disabled || isEdit"
              style="width: 100%"
              @change="errors.type = ''; if (form.type !== EXPERT_TYPE.POSITION) form.positionIds = []"
            >
              <el-option v-for="t in TEAM_TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
            <div class="et-hint">团类型创建后不可更改，并决定下方成员的候选范围</div>
          </el-form-item>
          <el-form-item v-if="form.type === EXPERT_TYPE.POSITION" label="所属岗位">
            <el-select
              v-model="form.positionIds"
              multiple
              collapse-tags
              collapse-tags-tooltip
              clearable
              placeholder="选择已发布的岗位（可多选）"
              :disabled="disabled"
              style="width: 100%"
            >
              <el-option v-for="pos in publishedPositions" :key="pos.positionId" :label="pos.name" :value="pos.positionId" />
            </el-select>
            <div v-if="isEdit && !form.positionIds.length" class="et-hint">未绑定岗位</div>
          </el-form-item>
          <el-form-item label="图标" required :error="errors.avatar">
            <span class="et-icon-wrap" :style="{ '--et-bg': form.backgroundColor }">
              <IconField :icon="form.avatar" :name="form.name" :readonly="disabled" placeholder="—" @pick="onPickIcon" />
            </span>
          </el-form-item>
          <el-form-item label="背景色" required :error="errors.backgroundColor">
            <div class="et-bg-picker" role="radiogroup" aria-label="背景色">
              <label v-for="(c, i) in BACKGROUND_COLORS" :key="c" class="et-bg-swatch" :title="c">
                <input
                  type="radio"
                  name="teamBackgroundColor"
                  :value="c"
                  :checked="form.backgroundColor === c"
                  :disabled="disabled"
                  :aria-label="`背景色 ${i + 1}，${c}`"
                  @change="pickBackground(c)"
                />
                <span class="et-bg-chip" :style="{ '--swatch': c }"></span>
              </label>
            </div>
          </el-form-item>
          <el-form-item label="团介绍" required :error="errors.intro" class="et-full">
            <template #label>
              <span class="et-label-row">
                <span><span class="et-req">*</span>团介绍</span>
                <el-button
                  v-if="!disabled"
                  plain
                  size="small"
                  class="et-ai"
                  :disabled="aiIntro.disabled.value"
                  :title="aiIntro.title.value || undefined"
                  @click="aiIntro.run"
                >{{ aiIntro.label.value }}</el-button>
              </span>
            </template>
            <el-input
              v-model="form.intro"
              type="textarea"
              :rows="3"
              maxlength="2000"
              show-word-limit
              :disabled="disabled"
              placeholder="介绍这个团能解决什么问题（只讲能力，不用写怎么协作）"
              @input="errors.intro = ''"
            />
          </el-form-item>
        </el-form>
      </section>

      <!-- ② 团队成员与团长 -->
      <section class="section-card" data-testid="team-members-card">
        <h3 class="section-title">
          团队成员与团长
          <span class="section-sub">至少 2 位，最多 {{ MEMBER_MAX }} 位已发布的专家</span>
        </h3>

        <div v-if="!form.type" class="et-empty">请先选择团类型</div>
        <template v-else>
          <!-- 候选区：只读态不展示 -->
          <div v-if="!disabled" class="et-picker">
            <div class="et-pick-head">
              <el-input v-model="memberKeyword" class="et-pick-search" placeholder="搜索专家名、简介或分类" clearable />
              <span class="et-count">已选 {{ form.members.length }}/{{ MEMBER_MAX }}</span>
            </div>
            <div v-if="categoryChips.length" class="et-chips">
              <button type="button" class="et-chip" :class="{ on: !memberCategory }" @click="memberCategory = ''">全部（{{ candidates.length }}）</button>
              <button
                v-for="c in categoryChips"
                :key="c.name"
                type="button"
                class="et-chip"
                :class="{ on: memberCategory === c.name }"
                @click="memberCategory = c.name"
              >{{ c.name }}（{{ c.n }}）</button>
            </div>
            <div v-loading="candidatesLoading" class="et-cand-grid">
              <label
                v-for="x in shownCandidates"
                :key="x.id"
                class="et-cand"
                :class="{ checked: isSelected(x.id) }"
                :data-testid="`team-cand-${x.id}`"
              >
                <input type="checkbox" :checked="isSelected(x.id)" @change="toggleMember(x)" />
                <span class="et-cand-body">
                  <span class="et-cand-title">
                    <span class="et-avatar" :style="{ backgroundColor: x.backgroundColor }">
                      <img v-if="iconIsUrl(x.avatar)" :src="x.avatar" alt="" />
                      <span v-else>{{ x.avatar || '☆' }}</span>
                    </span>
                    <strong>{{ x.name }}</strong>
                    <span class="et-cand-cat">{{ x.category }}</span>
                    <span v-if="x.leadGuide" class="et-lead-badge">可带团</span>
                  </span>
                  <small>{{ x.intro || '暂无简介' }}</small>
                </span>
              </label>
              <div v-if="!candidatesLoading && !shownCandidates.length" class="et-empty et-cand-empty">
                {{ candidates.length ? '没有匹配的专家' : '没有可选的已发布专家' }}
              </div>
            </div>
          </div>

          <!-- 已选列表：排位 / 团内负责什么 / 团长 / 上下移 / 移除 -->
          <div class="et-selected" data-testid="team-selected">
            <div v-if="!form.members.length" class="et-empty">还没有选择成员</div>
            <div
              v-for="(m, i) in form.members"
              :key="m.expertId"
              class="et-row"
              :class="{ leader: String(form.leaderId) === String(m.expertId) }"
              :data-testid="`team-member-${m.expertId}`"
            >
              <span class="et-row-index">{{ i + 1 }}</span>
              <div class="et-row-main">
                <div class="et-row-name">
                  <strong>{{ infoOf(m.expertId).name }}</strong>
                  <span class="et-cand-cat">{{ infoOf(m.expertId).category }}</span>
                  <span v-if="infoOf(m.expertId).leadGuide" class="et-lead-badge">可带团</span>
                  <span v-if="String(form.leaderId) === String(m.expertId)" class="et-leader-badge">团长</span>
                  <span v-if="infoOf(m.expertId).unavailable" class="et-warn-tag">{{ infoOf(m.expertId).unavailable }}</span>
                </div>
                <el-input
                  v-model="m.duty"
                  maxlength="200"
                  :disabled="disabled"
                  placeholder="这位专家在团里负责什么，如：条款风险与合规口径"
                  @input="errors.members = ''"
                />
              </div>
              <div v-if="!disabled" class="et-row-ops">
                <el-button
                  size="small"
                  :type="String(form.leaderId) === String(m.expertId) ? 'primary' : ''"
                  :plain="String(form.leaderId) !== String(m.expertId)"
                  @click="toggleLeader(m.expertId)"
                >{{ String(form.leaderId) === String(m.expertId) ? '取消团长' : '设为团长' }}</el-button>
                <el-button size="small" link :disabled="i === 0" @click="moveMember(i, -1)">上移</el-button>
                <el-button size="small" link :disabled="i === form.members.length - 1" @click="moveMember(i, 1)">下移</el-button>
                <el-button size="small" link type="danger" @click="removeMember(m.expertId)">移除</el-button>
              </div>
            </div>
          </div>
          <div v-if="errors.members" class="et-err">{{ errors.members }}</div>

          <div class="et-leader-tip">
            设了团长，由团长按其专业口径拆解、分发、把关、汇总，员工无需确认安排；不设团长，由系统按「团队协作关系」拆解，员工确认安排后开始。
          </div>

          <!-- 团长职责：设了团长才出现 -->
          <div v-if="form.leaderId != null" class="et-leader-duty" data-testid="team-leader-duty">
            <div class="et-label-row">
              <span><span class="et-req">*</span>团长职责</span>
              <el-button
                v-if="!disabled"
                plain
                size="small"
                class="et-ai"
                :disabled="aiLeaderDuty.disabled.value"
                :title="aiLeaderDuty.title.value || undefined"
                @click="aiLeaderDuty.run"
              >{{ aiLeaderDuty.label.value }}</el-button>
            </div>
            <el-input
              v-model="form.leaderDuty"
              type="textarea"
              :rows="3"
              maxlength="2000"
              show-word-limit
              :disabled="disabled"
              placeholder="描述这个团按团长的口径怎么拆、怎么分，谁先谁后"
              :class="{ 'et-invalid': errors.leaderDuty }"
              @input="errors.leaderDuty = ''"
            />
            <div v-if="errors.leaderDuty" class="et-err">{{ errors.leaderDuty }}</div>
          </div>
        </template>
      </section>

      <!-- ③ 团队协作关系 -->
      <section class="section-card" data-testid="team-collab-card">
        <div class="et-sec-headrow">
          <h3 class="section-title et-sub-title">
            <span v-if="form.leaderId == null" class="et-req">*</span>
            团队协作关系
            <span class="section-sub">{{ form.leaderId == null ? '没设团长时必填' : '选填' }}，拆解依据，员工端不展示</span>
          </h3>
          <div class="et-head-ops">
            <el-button
              v-if="!props.readonly"
              plain
              size="small"
              class="et-ai"
              :disabled="!!trialDisabledReason || locked"
              :title="trialDisabledReason || undefined"
              data-testid="team-trial-btn"
              @click="openTrial"
            >试跑拆解</el-button>
            <el-button
              v-if="!disabled"
              plain
              size="small"
              class="et-ai"
              :disabled="aiCollab.disabled.value"
              :title="aiCollab.title.value || undefined"
              @click="aiCollab.run"
            >{{ aiCollab.label.value }}</el-button>
          </div>
        </div>
        <el-input
          v-model="form.collab"
          type="textarea"
          :rows="5"
          maxlength="2000"
          show-word-limit
          :disabled="disabled"
          placeholder="任务到了这个团后怎么分工？谁先谁后，谁要看谁的结果？如：先由法律专家看条款风险，税务专家同时看付款与发票，两边都出结论后供应链专家再核对履约可行性"
          :class="{ 'et-invalid': errors.collab }"
          @input="errors.collab = ''"
        />
        <div v-if="errors.collab" class="et-err">{{ errors.collab }}</div>
        <div v-if="isEdit && detail && !form.leaderId && !props.readonly" class="et-hint" data-testid="team-trial-state">
          {{ trialed ? '已试跑：当前成员与协作关系已试跑过拆解' : '未试跑：没设团长的团建议发布前试跑一次' }}
        </div>
      </section>

      <!-- ④ 团队帮你做（示例问题） -->
      <section class="section-card">
        <div class="et-sec-headrow">
          <h3 class="section-title et-sub-title">
            <span class="et-req">*</span>
            团队帮你做
            <span class="section-sub">必填，3 条示例问题，员工点击后带着团回到输入框</span>
          </h3>
          <el-button
            v-if="!disabled"
            plain
            size="small"
            class="et-ai"
            :disabled="aiQuestions.disabled.value"
            :title="aiQuestions.title.value || undefined"
            @click="aiQuestions.run"
          >{{ aiQuestions.label.value }}</el-button>
        </div>
        <div class="et-q-list">
          <div v-for="(q, i) in form.exampleQuestions" :key="i" class="et-q-row">
            <span class="et-row-index">{{ i + 1 }}</span>
            <el-input
              :ref="(el) => (questionInputRefs[i] = el)"
              v-model="form.exampleQuestions[i]"
              maxlength="300"
              :disabled="disabled"
              :class="{ 'et-invalid': errors.examples && !String(form.exampleQuestions[i] || '').trim() }"
              :placeholder="i === 0 ? '把这份合同交给团队看一遍' : '请输入示例问题'"
              @input="errors.examples = ''"
            />
          </div>
        </div>
        <div v-if="errors.examples" class="et-err">{{ errors.examples }}</div>
      </section>

      <!-- ⑤ 时间信息 -->
      <div v-if="isEdit && detail" class="et-meta">
        <span v-for="m in metaItems" :key="m">{{ m }}</span>
      </div>
    </template>

    <template #footer>
      <el-button :disabled="saving" @click="close">{{ props.readonly ? '关闭' : '取消' }}</el-button>
      <template v-if="!props.readonly && !locked">
        <el-button v-if="isEdit" :loading="saving" @click="publishFromEditor">发布</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ isEdit ? '保存' : '创建专家团' }}</el-button>
      </template>
    </template>

    <!-- 试跑弹窗挂 #extra（抽屉子树内），层级压在抽屉之上 -->
    <template #extra>
      <el-dialog v-model="trialVisible" title="试跑拆解" width="560px" append-to-body data-testid="team-trial-dialog">
        <el-form label-position="top">
          <el-form-item label="试跑任务描述" :error="trialError">
            <el-input v-model="trialTask" maxlength="300" show-word-limit placeholder="输入一句员工会对这个团说的话" />
          </el-form-item>
        </el-form>
        <div v-loading="trialRunning" class="et-trial-result">
          <template v-if="trialResult">
            <div class="et-trial-mode">
              {{ trialResult.mode === 'leader' ? `由团长 ${trialResult.leaderName} 按其职责拆解` : '由系统按团队协作关系拆解' }}
            </div>
            <div v-for="p in trialResult.plan" :key="p.expertId" class="et-trial-row">
              <strong>{{ p.name }}</strong>
              <span class="et-trial-duty">{{ p.duty }}</span>
              <span class="et-trial-order">{{ p.order }}</span>
            </div>
          </template>
        </div>
        <div class="et-hint">仅为拆解预览，不会真正执行，不产生任务记录。</div>
        <template #footer>
          <el-button @click="trialVisible = false">关闭</el-button>
          <el-button type="primary" :loading="trialRunning" data-testid="team-trial-run" @click="runTrial">开始试跑</el-button>
        </template>
      </el-dialog>
    </template>
  </DrawerEditor>
</template>

<style scoped>
.section-card > .section-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 24px;
}
.et-note {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.et-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--space-4);
}
.et-full {
  grid-column: 1 / -1;
}
.et-hint {
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 18px;
}
.et-req {
  color: var(--c-danger);
  margin-right: 2px;
}
.et-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  margin-bottom: var(--space-1);
}
.et-sec-headrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.et-head-ops {
  display: flex;
  gap: var(--space-2);
}
/* 【AI 生成】/【试跑拆解】：常规字重（一览表附录「AI 生成按钮样式」） */
.et-ai {
  font-weight: var(--fw-regular, 400);
  white-space: nowrap;
}
.et-sub-title {
  margin: 0;
}
.et-err {
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.et-invalid :deep(.el-input__wrapper),
.et-invalid :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.et-empty {
  padding: var(--space-4);
  text-align: center;
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}

/* 图标预览底色随背景色联动（同专家抽屉 --ee-bg 手法） */
.et-icon-wrap :deep(.icon-preview) {
  background: var(--et-bg);
  color: #1f1f1f;
}
.et-bg-picker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-height: 32px;
}
.et-bg-swatch {
  position: relative;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  cursor: pointer;
}
.et-bg-swatch input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
  pointer-events: none;
}
.et-bg-chip {
  width: 30px;
  height: 30px;
  display: block;
  border: 1px solid var(--border-base);
  border-radius: 7px;
  background: var(--swatch);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.72);
}
.et-bg-swatch input:checked + .et-bg-chip {
  border-color: var(--c-primary, #409eff);
  box-shadow: inset 0 0 0 2px #fff, 0 0 0 2px var(--c-primary, #409eff);
}
.et-bg-swatch input:checked + .et-bg-chip::after {
  content: '\2713';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #26342d;
  font-size: 14px;
  font-weight: 700;
}
.et-bg-swatch input:disabled + .et-bg-chip {
  cursor: not-allowed;
  opacity: 0.6;
}

/* —— 成员候选 —— */
.et-pick-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin-bottom: var(--space-2);
}
.et-count {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  white-space: nowrap;
}
.et-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.et-chip {
  padding: 2px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  background: var(--bg-base);
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.et-chip.on {
  border-color: var(--c-accent, #409eff);
  color: var(--c-accent, #409eff);
  background: var(--c-accent-soft, var(--bg-hover));
}
.et-cand-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  min-height: 40px;
}
@media (max-width: 900px) {
  .et-cand-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.et-cand {
  position: relative;
  display: flex;
  min-height: 76px;
  margin: 0;
  padding: 12px 12px 10px 34px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: var(--bg-surface, var(--bg-base));
  cursor: pointer;
}
.et-cand:hover {
  border-color: var(--c-accent, #409eff);
}
.et-cand.checked {
  border-color: var(--c-accent, #409eff);
  background: var(--c-accent-soft, var(--bg-hover));
  box-shadow: 0 0 0 1px var(--c-accent, #409eff);
}
.et-cand input {
  position: absolute;
  top: 13px;
  left: 11px;
  margin: 0;
  accent-color: var(--c-accent, #409eff);
}
.et-cand-body {
  min-width: 0;
  display: block;
}
.et-cand-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.et-cand-title strong {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.et-cand-cat {
  flex: none;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.et-cand-body small {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
}
.et-cand-empty {
  grid-column: 1 / -1;
}
.et-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  font-size: 13px;
  border-radius: 6px;
  overflow: hidden;
  color: #1f1f1f;
}
.et-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.et-lead-badge,
.et-leader-badge,
.et-warn-tag {
  flex: none;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  line-height: 18px;
}
.et-lead-badge {
  background: var(--c-accent-soft, var(--bg-hover));
  color: var(--c-accent, #409eff);
}
.et-leader-badge {
  background: var(--c-accent, #409eff);
  color: #fff;
}
.et-warn-tag {
  background: var(--c-danger-soft, rgba(245, 108, 108, 0.12));
  color: var(--c-danger);
}

/* —— 已选列表 —— */
.et-selected {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.et-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: var(--bg-base);
}
.et-row.leader {
  border-color: var(--c-accent, #409eff);
}
.et-row-index {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
}
.et-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.et-row-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.et-row-ops {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.et-leader-tip {
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.et-leader-duty {
  margin-top: var(--space-3);
}

.et-q-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.et-q-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

/* —— 试跑弹窗 —— */
.et-trial-result {
  min-height: 60px;
  margin-bottom: var(--space-2);
}
.et-trial-mode {
  margin-bottom: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.et-trial-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-soft);
  font-size: var(--fs-sm);
}
.et-trial-duty {
  color: var(--c-text-muted);
}
.et-trial-order {
  color: var(--c-accent, #409eff);
  white-space: nowrap;
}

.et-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3) 2px 2px;
  border-top: 1px solid var(--border-soft);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.et-meta span {
  white-space: nowrap;
}
</style>
