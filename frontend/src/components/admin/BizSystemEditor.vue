<script setup>
/**
 * 业务系统连接编辑器（2026-09-01 对齐 PRD-20260828 交互原型 v2 renderBizEditor L750 + 覆写态）。
 *
 * 抽屉结构：顶部提示行 → 基本信息（名称/图标/描述/连接方式只读/登录地址 + 自动化操作配置占位）
 * → 业务页（默认收起，标题右侧展开/收起，B12）→ 示例问题（固定 3 条 + AI 生成，B11/BQ4）
 * → 业务系统专属技能（BQ1 保留）→ 被技能引用（只读）→ 底部弱化时间行（B13）。
 *
 * 2026-09-01 PRD 对齐改造取代旧口径：
 * - 名称 ≤64（原 20）；新增「图标」必填（BQ5：复用 McpEditor 的 IconPickerPopover 范式）。
 * - 描述改必填、≤2000 + 字数统计，占位「一句话描述该系统用途」（BQ3）。
 * - 「登录地址」必填、标签去「（可选）」；连接方式改只读展示「登录态托管」；
 *   删「状态」启用/停用 radio；原「连接」分区并入基本信息卡（B10）。
 * - 业务页默认收起，添加行自动展开；删除单条业务页一律二次确认 modal（B12）。
 * - 保存提示：新建「业务系统已创建」、编辑「业务系统已保存」（B14）。
 *
 * 安全：本编辑器仅配置「系统级连接定义」，绝不涉及任何用户登录态凭据。
 * operationMeta（无头浏览器操作元信息）真实执行排后期，本期为占位（BQ1 保留不动）。
 *
 * 打磨说明（CR 落地，沿用）：
 * - 业务页行用稳定本地 uid（_uid）作 v-model/red-box key，避免删中间行索引复用导致 DOM 短暂错位。
 * - 删行后若已有校验错误则即时重跑校验重建 fieldErrors（保留其它行红框、修正索引）。
 */
import { ref, reactive, computed, watch, nextTick } from 'vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import IconPickerPopover from '@/components/position/IconPickerPopover.vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fmtTime } from '@/utils/docMeta'
import {
  createBizSystem,
  updateBizSystem,
  getBizSystem,
  listBizSystemSkills,
  createBizSystemOwnedSkill,
  deleteBizSystemOwnedSkill,
  aiGenerateBizExampleQuestions
} from '@/api/admin'
import {
  validateBizSystemForm,
  BIZ_NAME_MAX,
  BIZ_DESC_MAX,
  BIZ_PAGES_MAX,
  BIZ_QUESTION_MAX
} from '@/utils/defValidate'
import { iconIsUrl } from '@/utils/iconDisplay'

const router = useRouter()

// 业务页行本地自增 uid 分配器（仅前端用作稳定 key，不进 payload）。
let _uidSeq = 0
function nextUid() {
  return ++_uidSeq
}

const props = defineProps({
  visible: { type: Boolean, default: false },
  bizId: { type: [Number, String], default: null },
  // 只读查看（与 McpEditor / ApiEditor 的 readonly 同口径）：各表单区整体禁用、
  // 业务页/专属技能的增删入口隐藏、底部隐藏保存仅留「关闭」。审核锁定期与日常复核走查看，避免误改。
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved'])

const isEdit = computed(() => props.bizId != null)
const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)

const PAGES_MAX = BIZ_PAGES_MAX
const NAME_MAX = BIZ_NAME_MAX
const DESC_MAX = BIZ_DESC_MAX
const QUESTION_MAX = BIZ_QUESTION_MAX

const form = reactive({
  name: '',
  icon: '',
  description: '',
  loginUrl: '',
  connType: 'login_session', // 只读展示「登录态托管」（本期仅此一种）
  // 业务页列表：每项 { url, name, description }，整体选填（可 0 条）。
  bizPages: [],
  // 示例问题（BQ4）：固定 3 条，保存须均非空
  exampleQuestions: ['', '', '']
})
// 抽屉正文滚动容器（用于校验失败时滚动定位首个红框）
const bodyRef = ref(null)

// 业务页分区默认收起（B12）；添加行时自动展开
const pagesOpen = ref(false)

// 示例问题 AI 生成 busy 态
const aiBusy = ref(false)

// 被引用列表（只读）：[{ skillId, skillName }]
const referencedBySkills = ref([])
// 底部弱化时间行（B13）：创建/最近更新/最近发布（未发布 —）
const times = reactive({ createdAt: null, updatedAt: null, publishedAt: null })
const fieldErrors = reactive({})

/* ---------- N8（第三类，V72）：业务系统专属技能（BQ1 保留：本系统专用技能的列表 / 从零新建 / 编辑 / 删除） ----------
 * 业务系统专属技能是独立第三类技能，只服务本业务系统。这里只在业务系统配置里管理（无独立列表页）。
 * - 列表：listBizSystemSkills（本系统关联的技能句柄 [{ skillId, name }]）。
 * - 新建：从零建一条空白专属技能（createBizSystemOwnedSkill），拿到 skillId 后新标签打开整页编辑器续编。
 * - 编辑：新标签打开整页编辑器（复用 SkillFocusEditor，数据源切到业务系统技能端点）。
 * - 删除：软删本体 + 删绑定（deleteBizSystemOwnedSkill），二次确认。
 * 说人话，界面不出现任何内部黑话（origin/source 等）。 */
const ownedSkills = ref([]) // [{ skillId, name }]
const ownedLoading = ref(false)
const ownedLoadError = ref(false) // 读失败（与「真没有」空态区分，供「点此重试」）
const creating = ref(false) // 正在新建（禁重复点）
const delBusy = ref(null) // 正在删除的 skillId

// 新建取名弹窗（对齐 AdminSkills 新建范式：el-dialog + el-form 单「技能名」输入，回车提交、主/次按钮）。
const createVisible = ref(false)
const createName = ref('')

async function loadOwnedSkills() {
  if (!isEdit.value) return
  ownedLoading.value = true
  ownedLoadError.value = false
  try {
    const data = await listBizSystemSkills(props.bizId)
    ownedSkills.value = Array.isArray(data) ? data : []
  } catch (e) {
    // 读失败：置错误态（不阻断业务系统主表编辑），空态区显示「加载失败，点此重试」，
    // 与「真没有专属技能」空态区分开——避免读失败被误当成「暂无」。
    ownedSkills.value = []
    ownedLoadError.value = true
  } finally {
    ownedLoading.value = false
  }
}

// 新标签打开业务系统技能整页编辑器（复用 SkillFocusEditor，先有 skillId 再开、避免空标签）。
function openSkillEditorTab(skillId) {
  const href = router.resolve({
    name: 'BizSystemSkillEdit',
    params: { bizId: props.bizId, id: skillId }
  }).href
  window.open(href, '_blank')
}

// 打开新建取名弹窗（对齐 AdminSkills 新建范式：先弹 el-dialog 收技能名，再建空白专属技能）。
function openCreate() {
  createName.value = ''
  createVisible.value = true
}

// 从零新建：只收一个技能名，建空白专属技能后跳整页编辑器续编（触发词/办事流程/工具引用在编辑器里配）。
async function confirmCreateOwnedSkill() {
  if (creating.value) return
  const name = createName.value.trim()
  if (!name) {
    ElMessage.warning('请输入技能名')
    return
  }
  creating.value = true
  try {
    const data = await createBizSystemOwnedSkill(props.bizId, { name })
    createVisible.value = false
    ElMessage.success('已创建，已在新标签打开编辑器')
    await loadOwnedSkills()
    if (data?.skillId != null) openSkillEditorTab(data.skillId)
  } catch (e) {
    ElMessage.error(e?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function deleteOwnedSkill(skillId) {
  if (delBusy.value != null) return
  delBusy.value = skillId
  try {
    await deleteBizSystemOwnedSkill(props.bizId, skillId)
    ElMessage.success('已删除')
    await loadOwnedSkills()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    delBusy.value = null
  }
}

// 是否已达业务页条目上限（达上限禁用「添加」并提示）
const pagesAtMax = computed(() => form.bizPages.length >= PAGES_MAX)

// 图标：/api/public/icons/ 开头 = 上传的图片（<img> 直接 GET）；否则按 emoji/字符渲染
const iconIsUrlFlag = computed(() => iconIsUrl(form.icon))
/** IconPickerPopover 回吐 { icon, iconSource }；此处只取 icon（业务系统不需要来源标记）。 */
function onIconPick(payload) {
  if (payload && typeof payload.icon === 'string') {
    form.icon = payload.icon
    delete fieldErrors.icon
  }
}

function clearErrors() {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k])
}
function resetForm() {
  form.name = ''
  form.icon = ''
  form.description = ''
  form.loginUrl = ''
  form.connType = 'login_session'
  form.bizPages = []
  form.exampleQuestions = ['', '', '']
  pagesOpen.value = false
  referencedBySkills.value = []
  times.createdAt = null
  times.updatedAt = null
  times.publishedAt = null
  ownedSkills.value = []
  ownedLoadError.value = false
  clearErrors()
}

async function load() {
  clearErrors()
  if (!isEdit.value) {
    resetForm()
    return
  }
  loading.value = true
  loadError.value = false
  try {
    const d = await getBizSystem(props.bizId)
    form.name = d.name || ''
    form.icon = d.icon || ''
    form.description = d.description || ''
    form.loginUrl = d.loginUrl || ''
    form.connType = d.connType || 'login_session'
    // 回填业务页列表（详情 VO bizPages[]，逐项归一字段，防御 null）；分配本地 _uid 作稳定 key。
    form.bizPages = Array.isArray(d.bizPages)
      ? d.bizPages.map((p) => ({
          _uid: nextUid(),
          url: p?.url || '',
          name: p?.name || '',
          description: p?.description || ''
        }))
      : []
    form.exampleQuestions = [0, 1, 2].map((i) => d.exampleQuestions?.[i] || '')
    pagesOpen.value = false // 每次打开默认收起（B12）
    referencedBySkills.value = d.referencedBySkills || []
    times.createdAt = d.createdAt || null
    times.updatedAt = d.updatedAt || null
    times.publishedAt = d.publishedAt || null
    // N8：并行拉取该系统的专属技能（失败置错误态，不阻断主表编辑）。
    loadOwnedSkills()
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.bizId],
  ([vis]) => {
    if (vis) load()
  }
)

function close() {
  emit('update:visible', false)
}

function addPage() {
  if (pagesAtMax.value) {
    ElMessage.warning(`业务页最多 ${PAGES_MAX} 条`)
    return
  }
  form.bizPages.push({ _uid: nextUid(), url: '', name: '', description: '' })
  pagesOpen.value = true // 添加行时自动展开（B12）
}

// 当前 fieldErrors 是否存在任何 bizPages.* 行级错误（决定删行后是否需要重算红框）。
function hasBizPageErrors() {
  return Object.keys(fieldErrors).some((k) => k.startsWith('bizPages.'))
}

/** 删除单条业务页：一律二次确认 modal（B12，原型「删除业务页 / 删除这条业务页？/【删除】」）。 */
async function confirmRemovePage(idx) {
  try {
    await ElMessageBox.confirm('删除这条业务页？', '删除业务页', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger'
    })
  } catch (e) {
    return
  }
  removePage(idx)
}

function removePage(idx) {
  const hadErrors = hasBizPageErrors() || !!fieldErrors.bizPages
  form.bizPages.splice(idx, 1)
  // 删行只在「删前已有校验错误」时重跑校验——重建 bizPages.* 红框（保留其它行、修正索引偏移），
  // 避免删一行把别行红框也一并抹掉的糙感；删前无错误则不打扰（不平白触发整表校验）。
  if (!hadErrors) return
  Object.keys(fieldErrors).forEach((k) => {
    if (k === 'bizPages' || k.startsWith('bizPages.')) delete fieldErrors[k]
  })
  const { errors } = validateBizSystemForm(form)
  Object.keys(errors).forEach((k) => {
    if (k === 'bizPages' || k.startsWith('bizPages.')) fieldErrors[k] = errors[k]
  })
}

/** 示例问题 AI 生成（BQ4）：一次生成 3 条整组填充（demo 本地模板随机填充）。 */
async function generateQuestions() {
  if (aiBusy.value || props.readonly) return
  aiBusy.value = true
  try {
    const res = await aiGenerateBizExampleQuestions({
      name: form.name,
      description: form.description
    })
    const qs = Array.isArray(res?.questions) ? res.questions : []
    form.exampleQuestions = [0, 1, 2].map((i) => (qs[i] || '').slice(0, QUESTION_MAX))
    delete fieldErrors.exampleQuestions
    ElMessage.success('已生成 3 条示例问题，可直接修改')
  } catch (e) {
    ElMessage.error(e?.message || '生成失败，请稍后重试')
  } finally {
    aiBusy.value = false
  }
}

function buildPayload() {
  // 空业务页列表提交为 []；每项做 trim 归一。
  const pages = form.bizPages.map((p) => ({
    url: (p.url || '').trim(),
    name: (p.name || '').trim(),
    description: (p.description || '').trim()
  }))
  return {
    name: form.name.trim(),
    icon: form.icon || '',
    description: form.description.trim(),
    loginUrl: form.loginUrl.trim(),
    connType: 'login_session',
    bizPages: pages,
    exampleQuestions: form.exampleQuestions.map((q) => (q || '').trim()),
    operationMeta: null // 无头浏览器操作元信息占位（真实执行排后期，BQ1 保留）
  }
}

// 校验失败时滚动定位到第一个错误（按 DOM 出现顺序）：
// - 业务页单元格错误：输入框包 `.is-err`；
// - EP 表单项错误（name/icon/description/loginUrl）：`.el-form-item.is-error`；
// - 业务页整体 / 示例问题错误：`.bpe-error` / `.eq-error` 容器。
function scrollToFirstError() {
  nextTick(() => {
    const root = bodyRef.value || document
    const el = root.querySelector('.is-err, .el-form-item.is-error, .bpe-error, .eq-error')
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const input = el.querySelector('input, textarea')
    if (input) {
      try {
        input.focus({ preventScroll: true })
      } catch {
        /* 聚焦失败不影响滚动定位 */
      }
    }
  })
}

async function save() {
  clearErrors()
  const { ok, errors } = validateBizSystemForm(form)
  if (!ok) {
    Object.assign(fieldErrors, errors)
    // 业务页行错误藏在收起区里会看不见：有行级错误时自动展开（B12 体验补丁）
    if (errors.bizPages || Object.keys(errors).some((k) => k.startsWith('bizPages.'))) {
      pagesOpen.value = true
    }
    ElMessage.warning('请先修正标红项')
    scrollToFirstError()
    return
  }
  saving.value = true
  try {
    const payload = buildPayload()
    const data = isEdit.value
      ? await updateBizSystem(props.bizId, payload)
      : await createBizSystem(payload)
    // 保存提示（B14）：新建「业务系统已创建」、编辑「业务系统已保存」
    ElMessage.success(isEdit.value ? '业务系统已保存' : '业务系统已创建')
    emit('saved', { id: isEdit.value ? props.bizId : data?.id })
    close()
  } catch (e) {
    if (e?.field) {
      fieldErrors[e.field] = e.message || '校验未通过'
      ElMessage.error(e.message || '校验未通过')
      scrollToFirstError()
    } else {
      ElMessage.error(e?.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <DrawerEditor
    :visible="visible"
    entity="业务系统"
    :is-edit="isEdit"
    :readonly="readonly"
    :loading="loading"
    :error="loadError"
    :saving="saving"
    @update:visible="emit('update:visible', $event)"
    @retry="load"
    @save="save"
  >
    <!-- bodyRef 保留：scrollToFirstError 以此为根查询首个错误元素（回落 document 会跨出本抽屉） -->
    <div ref="bodyRef" class="ad-body">
      <!-- 顶部提示行（B9，原型 connector-editor-note 逐字） -->
      <div class="ad-note">业务系统通过登录态托管供技能执行办事操作，可配置最多 20 条业务页入口。</div>

      <!-- 基本信息（B10：原「连接」分区并入本卡；删「状态」radio；连接方式只读） -->
      <section class="ad-sec">
        <div class="ad-sec-title">基本信息</div>
        <el-form label-position="top" :disabled="readonly">
          <div class="ad-row2">
            <el-form-item label="系统名称" :error="fieldErrors.name" required class="ad-name-item">
              <el-input
                v-model="form.name"
                :maxlength="NAME_MAX"
                show-word-limit
                placeholder="如 客户管理系统 CRM"
              />
            </el-form-item>
            <!-- 图标（BQ5 指示：必填，复用 McpEditor 的 IconPickerPopover 范式） -->
            <el-form-item label="图标" :error="fieldErrors.icon" required class="ad-icon-item">
              <div class="ad-icon-row">
                <span class="ad-icon-preview" :class="{ 'is-empty': !form.icon }">
                  <img v-if="iconIsUrlFlag" :src="form.icon" alt="" class="ad-icon-img" />
                  <span v-else-if="form.icon">{{ form.icon }}</span>
                  <span v-else class="ad-icon-ph">—</span>
                </span>
                <IconPickerPopover
                  v-if="!readonly"
                  :icon="form.icon"
                  :position-name="form.name"
                  @pick="onIconPick"
                />
              </div>
            </el-form-item>
          </div>
          <!-- 描述（BQ3 指示：必填、≤2000 + 字数统计，占位去「选填」字样） -->
          <el-form-item label="系统描述" :error="fieldErrors.description" required>
            <el-input
              v-model="form.description"
              type="textarea"
              :rows="3"
              :maxlength="DESC_MAX"
              show-word-limit
              placeholder="一句话描述该系统用途"
            />
          </el-form-item>
          <el-form-item label="连接方式">
            <!-- 只读展示（B10）：本期仅登录态托管一种，不再给下拉 -->
            <div class="ad-readonly-value">登录态托管</div>
          </el-form-item>
          <el-form-item label="登录地址" :error="fieldErrors.loginUrl" required>
            <el-input v-model="form.loginUrl" placeholder="https://crm.example.com/login" />
          </el-form-item>
          <!-- 自动化操作配置占位（BQ1 指示：保留不动，可能是已拍板扩展） -->
          <el-form-item label="自动化操作配置">
            <el-input
              disabled
              type="textarea"
              :rows="2"
              placeholder="自动化操作配置 · 功能开发中，敬请期待"
            />
          </el-form-item>
        </el-form>
      </section>

      <!-- 业务页（B12：默认收起，标题右侧展开/收起；添加行自动展开） -->
      <section class="ad-sec">
        <div class="ad-sec-title ad-pages-title">
          <span>
            业务页
            <span class="ad-sec-sub">可选，办事操作入口；最多 {{ PAGES_MAX }} 条</span>
          </span>
          <el-button link type="primary" class="ad-pages-toggle" @click="pagesOpen = !pagesOpen">
            {{ pagesOpen ? '收起业务页' : '展开业务页' }}{{ form.bizPages.length ? `（${form.bizPages.length}）` : '' }}
          </el-button>
        </div>
        <div v-if="pagesOpen">
          <div v-if="fieldErrors.bizPages" class="ad-pages-err">{{ fieldErrors.bizPages }}</div>
          <div class="bpe" :class="{ 'bpe-error': !!fieldErrors.bizPages }">
            <div v-if="form.bizPages.length" class="bpe-head">
              <span class="col-url">URL <em class="req">*</em></span>
              <span class="col-name">名称 <em class="req">*</em></span>
              <span class="col-desc">描述</span>
              <span class="col-op"></span>
            </div>
            <div v-for="(row, idx) in form.bizPages" :key="row._uid" class="bpe-row">
              <div class="col-url">
                <el-input
                  v-model="row.url"
                  maxlength="1024"
                  placeholder="https://crm.example.com/workspace"
                  :disabled="readonly"
                  :class="{ 'is-err': fieldErrors[`bizPages.${idx}.url`] }"
                />
                <div v-if="fieldErrors[`bizPages.${idx}.url`]" class="cell-err">
                  {{ fieldErrors[`bizPages.${idx}.url`] }}
                </div>
              </div>
              <div class="col-name">
                <el-input
                  v-model="row.name"
                  maxlength="20"
                  placeholder="如 工作台"
                  :disabled="readonly"
                  :class="{ 'is-err': fieldErrors[`bizPages.${idx}.name`] }"
                />
                <div v-if="fieldErrors[`bizPages.${idx}.name`]" class="cell-err">
                  {{ fieldErrors[`bizPages.${idx}.name`] }}
                </div>
              </div>
              <div class="col-desc">
                <el-input
                  v-model="row.description"
                  maxlength="100"
                  placeholder="页面说明（可选）"
                  :disabled="readonly"
                  :class="{ 'is-err': fieldErrors[`bizPages.${idx}.description`] }"
                />
                <div v-if="fieldErrors[`bizPages.${idx}.description`]" class="cell-err">
                  {{ fieldErrors[`bizPages.${idx}.description`] }}
                </div>
              </div>
              <!-- 删除单条业务页一律二次确认 modal（B12）；查看态不出删除入口 -->
              <el-button
                v-if="!readonly"
                class="col-op"
                link
                type="danger"
                @click="confirmRemovePage(idx)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
              <span v-else class="col-op" aria-hidden="true"></span>
            </div>
            <div v-if="form.bizPages.length === 0" class="bpe-empty">
              暂无业务页，可不配置（留空表示不约束）
            </div>
            <div v-if="!readonly" class="bpe-foot">
              <el-button link type="primary" :disabled="pagesAtMax" @click="addPage">
                + 添加业务页
              </el-button>
              <span v-if="pagesAtMax" class="bpe-hint">已达上限 {{ PAGES_MAX }} 条</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 示例问题（B11/BQ4：固定 3 条带序号 + AI 生成一次 3 条；插在引用区之前） -->
      <section class="ad-sec" :class="{ 'eq-error': !!fieldErrors.exampleQuestions }">
        <div class="ad-sec-title ad-eq-title">
          <span>
            示例问题
            <span class="ad-sec-sub">必填，固定 3 条，用于帮助用户理解如何使用该连接器</span>
          </span>
          <el-button
            v-if="!readonly"
            class="ad-eq-ai"
            size="small"
            :loading="aiBusy"
            @click="generateQuestions"
          >
            AI 生成
          </el-button>
        </div>
        <div v-if="fieldErrors.exampleQuestions" class="ad-pages-err">{{ fieldErrors.exampleQuestions }}</div>
        <div class="ad-eq-list">
          <div v-for="i in 3" :key="i" class="ad-eq-row">
            <span class="ad-eq-index">{{ i }}</span>
            <el-input
              v-model="form.exampleQuestions[i - 1]"
              :maxlength="QUESTION_MAX"
              show-word-limit
              :disabled="readonly"
              :placeholder="i === 1 ? '帮我发起一个明天下午的请假审批' : '请输入示例问题'"
            />
          </div>
        </div>
      </section>

      <!-- N8：业务系统专属技能（BQ1 保留：第三类，从零新建/编辑/删除，仅编辑态）。
           只读查看态隐藏本区（纯管理入口，只读无意义，且避免误触发新建/删除）。 -->
      <section v-if="isEdit && !readonly" class="ad-sec">
        <div class="ad-sec-title">
          业务系统专属技能
          <span class="ad-sec-sub">本业务系统专用的技能，办事时优先调用</span>
        </div>

        <!-- 新建入口：从零建一条空白专属技能，再进编辑器填内容 -->
        <div class="ad-bind-row">
          <el-button type="primary" :loading="creating" @click="openCreate">
            + 新建专属技能
          </el-button>
          <span class="ad-owned-hint">从零新建本业务系统专用技能</span>
        </div>

        <!-- 专属技能列表 -->
        <div v-if="ownedLoading" class="ad-refs-empty">加载中…</div>
        <!-- 读失败态：与「暂无」空态区分，显式提示可重试（避免读失败被误读成没有） -->
        <div v-else-if="ownedLoadError" class="ad-bound-err">
          <span>专属技能加载失败</span>
          <el-button link type="primary" @click="loadOwnedSkills">点此重试</el-button>
        </div>
        <div v-else-if="ownedSkills.length" class="ad-bound-list">
          <div v-for="s in ownedSkills" :key="s.skillId" class="ad-bound-item">
            <span class="ad-bound-name">{{ s.name }}</span>
            <div class="ad-owned-ops">
              <el-button link type="primary" @click="openSkillEditorTab(s.skillId)">编辑</el-button>
              <!-- 删除二次确认（避免误点删掉专属技能）：说清删除后果 -->
              <el-popconfirm
                title="删除后这个业务系统专属技能将不可用，确定删除？"
                confirm-button-text="删除"
                cancel-button-text="取消"
                width="240"
                @confirm="deleteOwnedSkill(s.skillId)"
              >
                <template #reference>
                  <el-button
                    link
                    type="danger"
                    :loading="delBusy === s.skillId"
                    :disabled="delBusy != null && delBusy !== s.skillId"
                  >
                    删除
                  </el-button>
                </template>
              </el-popconfirm>
            </div>
          </div>
        </div>
        <div v-else class="ad-refs-empty">还没有专属技能，点上方「新建专属技能」添加</div>
      </section>

      <!-- 被技能引用（只读；副注按 B13 口径：软引用，停用/删除后技能仍可执行） -->
      <section v-if="isEdit" class="ad-sec">
        <div class="ad-sec-title">
          被技能引用
          <span class="ad-sec-sub">引用此业务系统的 Skill（只读；停用或删除后技能仍可执行，运行效果可能受限或出现报错）</span>
        </div>
        <div v-if="referencedBySkills.length" class="ad-refs">
          <el-tag
            v-for="s in referencedBySkills"
            :key="s.skillId"
            type="info"
            size="small"
          >
            {{ s.skillName }}
          </el-tag>
        </div>
        <div v-else class="ad-refs-empty">暂无技能引用</div>
      </section>

      <!-- 底部弱化时间行（B13：编辑与查看态；未发布显「—」） -->
      <div v-if="isEdit" class="ad-times">
        <span>创建时间：{{ times.createdAt ? fmtTime(times.createdAt) : '—' }}</span>
        <span>最近更新时间：{{ times.updatedAt ? fmtTime(times.updatedAt) : '—' }}</span>
        <span>最近发布时间：{{ times.publishedAt ? fmtTime(times.publishedAt) : '—' }}</span>
      </div>
    </div>


    <!-- 新建专属技能取名弹窗（对齐 AdminSkills 新建范式：单「技能名」输入 + 回车提交 + 主/次按钮） -->
    <el-dialog
      v-model="createVisible"
      title="新建专属技能"
      width="480px"
      append-to-body
    >
      <el-form @submit.prevent>
        <el-form-item label="技能名">
          <el-input
            v-model="createName"
            placeholder="给这个专属技能起个名字，建后进编辑器继续配置"
            maxlength="128"
            show-word-limit
            @keyup.enter="confirmCreateOwnedSkill"
          />
        </el-form-item>
        <p class="ad-create-hint">
          触发关键词、办事流程稍后在编辑器里填。
        </p>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="confirmCreateOwnedSkill">
          创建
        </el-button>
      </template>
    </el-dialog>
  </DrawerEditor>
</template>

<style scoped>
.ad-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
/* 顶部提示行（B9）：弱底说明条，不抢内容 */
.ad-note {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1.6;
}
.ad-sec-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-2);
}
.ad-sec-sub {
  font-weight: var(--fw-regular);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-left: var(--space-2);
}
.req {
  color: var(--c-danger);
  font-style: normal;
}
/* 名称 | 图标 同行（与 McpEditor 基本信息首行同构） */
.ad-row2 {
  display: grid;
  grid-template-columns: 1fr 200px;
  column-gap: var(--space-4);
}
.ad-icon-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ad-icon-preview {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  overflow: hidden;
}
.ad-icon-preview.is-empty,
.ad-icon-ph {
  color: var(--c-text-faint);
}
.ad-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 连接方式只读展示（B10） */
.ad-readonly-value {
  width: 100%;
  padding: 0 var(--space-3);
  min-height: 32px;
  display: flex;
  align-items: center;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.ad-refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.ad-refs-empty {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 底部弱化时间行（B13） */
.ad-times {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* ---- 业务页分区标题（B12：标题左、展开/收起按钮右） ---- */
.ad-pages-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.ad-pages-toggle {
  font-size: var(--fs-xs);
}

/* ---- 示例问题（B11/BQ4） ---- */
.ad-eq-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.ad-eq-ai {
  white-space: nowrap;
}
.ad-eq-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ad-eq-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ad-eq-index {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  border: 1px solid var(--border-base);
  border-radius: 50%;
  background: var(--bg-sunken);
}

/* ---- N8 业务系统专属技能（新建/编辑/删除） ---- */
.ad-bind-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.ad-owned-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 新建取名弹窗内的说明文案 */
.ad-create-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: 1.5;
}
.ad-owned-ops {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}
.ad-bound-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ad-bound-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}
.ad-bound-name {
  font-size: var(--fs-sm);
  color: var(--c-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* N8 读失败态：弱色文案 + 就地重试（与「暂无专属技能」空态视觉区分） */
.ad-bound-err {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

/* ---- 业务页行式编辑器（参考 SchemaFieldEditor 范式） ---- */
.ad-pages-err {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  margin-bottom: var(--space-2);
}
.bpe {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  background: var(--bg-sunken);
}
.bpe-error {
  border-color: var(--c-danger);
}
.bpe-head,
.bpe-row {
  display: grid;
  grid-template-columns: 1.8fr 1.1fr 1.6fr 36px;
  gap: var(--space-2);
  align-items: start;
}
.bpe-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
  padding: 0 2px;
  align-items: center;
}
.bpe-row {
  margin-bottom: var(--space-2);
}
.bpe-row .col-op {
  margin-top: 4px;
}
.cell-err {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
.is-err :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
.bpe-empty {
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  padding: var(--space-2) 0;
}
.bpe-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-1);
}
.bpe-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
</style>
