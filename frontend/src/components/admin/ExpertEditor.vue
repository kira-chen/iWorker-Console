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
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import IconPickerPopover from '@/components/position/IconPickerPopover.vue'
import SkillMilkdownEditor from '@/components/position/SkillMilkdownEditor.vue'
import { KIND, derivePublishView, isLocked } from '@/utils/publishState'
import {
  getExpert,
  createExpert,
  updateExpert,
  listExpertSkillCandidates
} from '@/api/domainExpert'
import { getFieldOptionNames } from '@/api/fieldDictMock'
import { fmtTime } from '@/utils/docMeta'

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

/* ==================== 表单 ==================== */
const form = reactive({
  name: '',
  category: '',
  avatar: '',
  intro: '',
  roleDesc: '',
  exampleQuestions: ['', '', ''],
  skillIds: []
})

const errors = reactive({ name: '', category: '', avatar: '', intro: '', roleDesc: '', examples: '', skills: '' })

function clearErrors() {
  for (const k of Object.keys(errors)) errors[k] = ''
}

function resetForm(d) {
  form.name = d?.name || ''
  form.category = d?.category || ''
  form.avatar = d?.avatar || ''
  form.intro = d?.intro || ''
  form.roleDesc = d?.roleDesc || ''
  form.exampleQuestions = [0, 1, 2].map((i) => String((d?.exampleQuestions || [])[i] || ''))
  form.skillIds = (d?.skillIds || (d?.skills || []).map((s) => s.skillId)).slice()
  clearErrors()
}

// 图标走岗位配置同款 IconPickerPopover（图标库 / 上传 / AI 生成），选中回吐仅取 icon 值。
function onPickIcon({ icon }) {
  form.avatar = icon || ''
  if (form.avatar) errors.avatar = ''
}

// 职责描述软上限与后端 @Size(max=2000) 对齐：仅提示不拦截（超限由校验兜底）。
const SOUL_SOFT_LIMIT = 2000
const soulLen = computed(() => (form.roleDesc || '').length)

/* ==================== 「专家帮你做」AI 生成（Z2：本地模板随机 + toast） ==================== */
const AI_QUESTION_TEMPLATES = [
  ['帮我生成一份行业调研报告', '帮我分析最近的市场趋势', '帮我制定一份工作计划'],
  ['帮我查一下本周的工作进展', '帮我总结今天的工作日志', '帮我安排明天的会议日程'],
  ['帮我梳理这个业务的关键风险', '帮我对比两套方案的优劣', '帮我整理一份汇报提纲']
]

function aiGenerateQuestions() {
  const pick = AI_QUESTION_TEMPLATES[Math.floor(Math.random() * AI_QUESTION_TEMPLATES.length)]
  form.exampleQuestions = [...pick]
  errors.examples = ''
  ElMessage.success('已生成示例问题')
}

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

/* ==================== 加载 ==================== */
async function load() {
  loadCandidates()
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
  // 示例问题：固定 3 条全填（每条 ≤60 字由 maxlength 把守，原型 expert-save 校验口径）
  if (!form.exampleQuestions.every((q) => String(q || '').trim())) {
    errors.examples = '请填写 3 条不超过 60 个字符的示例问题'
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
    intro: form.intro,
    roleDesc: form.roleDesc,
    exampleQuestions: form.exampleQuestions.map((q) => String(q || '').trim()),
    skillIds: [...form.skillIds]
  }
}

async function save() {
  if (disabled.value) return
  if (!validate()) {
    ElMessage.warning('请先补齐必填项')
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
    ElMessage.warning('请先补齐必填项')
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
        <section class="ee-sec">
          <h3 class="ee-sec-head">基本信息</h3>
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

        <section class="ee-sec">
          <h3 class="ee-sec-head">专家帮你做</h3>
          <div class="ee-view-questions">
            <div
              v-for="(q, i) in detail?.exampleQuestions || []"
              :key="i"
              class="ee-view-question"
            >{{ i + 1 }}. {{ q }}</div>
          </div>
        </section>

        <section class="ee-sec">
          <h3 class="ee-sec-head">
            市场技能引用
            <span class="ee-sec-sub">{{ viewSkills.length }} 个技能</span>
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

        <!-- ① 基本信息 -->
        <section class="ee-sec">
          <h3 class="ee-sec-head">基本信息</h3>

          <el-form label-width="88px" label-position="left">
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
              <!-- 沿用现有 IconPickerPopover（图标库 / 上传裁剪 / AI 生成；2026-09-02 组件已升级 PRD 统一规则）。 -->
              <IconPickerPopover
                v-if="!disabled"
                :icon="form.avatar"
                :position-name="form.name"
                @pick="onPickIcon"
              />
              <span v-else class="ee-avatar-ro">{{ form.avatar || '—' }}</span>
            </el-form-item>
            <el-form-item label="简介" required :error="errors.intro">
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
            <!-- 职责描述：Markdown 编辑器就地内嵌，字数计数浮在编辑框右下角内 -->
            <el-form-item label="职责描述" required :error="errors.roleDesc">
              <div class="ee-soul">
                <div class="ee-soul-mde">
                  <SkillMilkdownEditor
                    :model-value="form.roleDesc"
                    height="320px"
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
        </section>

        <!-- ② 专家帮你做（示例问题，必填固定 3 条；区标题右侧【AI 生成】——Z2 拍板） -->
        <section class="ee-sec">
          <div class="ee-sec-headrow">
            <h3 class="ee-sec-head">
              专家帮你做
              <span class="ee-sec-sub">必填，最多填写 3 条示例问题</span>
            </h3>
            <el-button v-if="!disabled" plain size="small" @click="aiGenerateQuestions">AI 生成</el-button>
          </div>
          <div class="ee-q-list">
            <div v-for="(q, i) in form.exampleQuestions" :key="i" class="ee-q-row">
              <span class="ee-q-index">{{ i + 1 }}</span>
              <el-input
                v-model="form.exampleQuestions[i]"
                maxlength="60"
                :disabled="disabled"
                :placeholder="i === 0 ? '帮我生成一份行业调研报告' : '请输入示例问题'"
                @input="errors.examples = ''"
              />
            </div>
          </div>
          <div v-if="errors.examples" class="ee-field-err">{{ errors.examples }}</div>
        </section>

        <!-- ③ 市场技能引用（内嵌卡片勾选；新建态即可勾选） -->
        <section class="ee-sec">
          <h3 class="ee-sec-head">
            市场技能引用
            <span class="ee-sec-sub">仅展示可引用的市场技能，至少添加 1 个</span>
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
          <div v-if="showMoreRow" class="ee-sk-more-row">
            <el-button link type="primary" @click="skillExpanded = !skillExpanded">
              {{ skillExpanded ? '收起' : `展开更多（${hiddenCount}）` }}
            </el-button>
          </div>
          <div v-if="errors.skills" class="ee-field-err">{{ errors.skills }}</div>
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
  </DrawerEditor>
</template>

<style scoped>
/* 三级间距节奏：段与段 20px（DrawerEditor 的 .de-body gap）> 段标题与内容 12px > 字段之间 16px。 */
.ee-sec {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.ee-sec-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  line-height: 1.4;
}
.ee-sec-headrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.ee-sec-sub {
  font-weight: var(--fw-normal);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ee-field-err {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.ee-sec :deep(.el-form) {
  padding-left: var(--space-4);
}
.ee-sec :deep(.el-form-item) {
  margin-bottom: var(--space-4);
}
.ee-sec :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}
.ee-empty {
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  padding: var(--space-3) 0;
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
  width: 220px;
}
.ee-avatar-ro {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
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

/* —— 专家帮你做（编号 + 输入行，原型 fixed-entry-row） —— */
.ee-q-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-left: var(--space-4);
}
.ee-q-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2);
}
.ee-q-index {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
}

/* —— 市场技能引用（内嵌选择器） —— */
.ee-sk-pickhead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  padding-left: var(--space-4);
}
.ee-sk-summary {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  white-space: nowrap;
}
.ee-sk-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  padding-left: var(--space-4);
}
@media (max-width: 720px) {
  .ee-sk-grid {
    grid-template-columns: 1fr;
  }
}
.ee-skill-check {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.ee-skill-check:hover {
  border-color: var(--c-primary, #409eff);
}
.ee-skill-check.checked {
  border-color: var(--c-primary, #409eff);
  background: var(--c-accent-soft, var(--bg-hover));
}
.ee-skill-check.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.ee-skill-check input {
  margin-top: 3px;
  accent-color: var(--c-primary, #409eff);
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
  padding-left: var(--space-4);
}

/* —— 只读查看态 —— */
.ee-view-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3) var(--space-4);
  padding-left: var(--space-4);
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
  padding-left: var(--space-4);
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

/* —— 底部时间条（原型 page-time） —— */
.ee-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-soft);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ee-meta span {
  white-space: nowrap;
}

/* 空态/错误同样跟随字段缩进 */
.ee-sec .ee-empty,
.ee-sec .ee-field-err {
  padding-left: var(--space-4);
}
</style>
