<script setup>
/**
 * 岗位管理列表页（2026-09-01 PRD 对齐改造，基准=prd md + 交互原型 v2 renderPositions 区）。
 *
 * 【本轮对齐要点】
 * - 工具栏：搜索覆盖岗位名称+岗位描述（回车/【查询】触发）、状态筛选三态（未发布/审核中/已发布）、
 *   【＋ 新建岗位】文案照原型。
 * - 列表列：状态标签并入岗位名称列；列序 岗位名称|岗位描述|技能数|Agent 数|领用数|最新版本|
 *   最近更新时间(排序,默认降序)|操作；三个计数列表头与单元格带 title 悬停口径提示。
 * - 状态三态为**展示层映射**（Q6：不改共享 publishState 语义）：草稿→未发布、三种审核中→审核中。
 * - 操作列（照原型 positionActions）：编辑（审核中 disabled）+ 按状态给 发布/删除、撤回、停用/版本管理；
 *   【查看】暂不实现（Q4 待拍板）；测试按钮维持 EFFECT_TEST_ENABLED flag 现状。
 * - 强确认降级（Q5）：停用/删除改普通二次确认（文案照原型 modal）。
 * - 发布（Q3）：不弹确认窗，先校验技能数（空→toast）再直接打开版本管理侧栏。
 * - 数据走 positionMock（api 层分流，VITE_POS_MOCK=0 关闭）；新建/编辑仍走现有流程
 *   （新建小弹窗→工作台整页，Q4 不拆不删）。
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import { KIND, derivePublishView, canDelete } from '@/utils/publishState'
import { fmtTime } from '@/utils/docMeta'
import VersionDrawer from '@/components/admin/VersionDrawer.vue'
import { EFFECT_TEST_ENABLED } from '@/utils/featureFlags'
import {
  listPositions,
  createPosition,
  unpublishPosition,
  deletePosition,
  getPosition,
  publishPosition,
  withdrawPosition,
  getNextVersionLabel,
  listPositionPublications,
  delistPositionPublication,
  relistPositionPublication
} from '@/api/position'
import { listDataTables } from '@/api/dataTable'
import { iconIsUrl } from '@/utils/iconDisplay'

// 效果测试台异步加载：仅在点「测试」打开时拉取，避免把对话链路（ChatMarkdown / api 等）提前并入列表页首屏，
// 同时保持现有测试 import 图不变（与 AdminSkills / PositionWorkbench 同款做法）。
const EffectTestStage = defineAsyncComponent(() => import('@/components/test/EffectTestStage.vue'))

const router = useRouter()

// sort：最近更新时间排序方向（原型 positionSort，默认降序）
const query = reactive({ keyword: '', status: 'all', sort: 'desc' })
const busyId = ref(null)

/* ---------- 服务端分页：取数编排统一走 useAdminList（见 docs/frontend/规范-管理后台列表页.md） ---------- */
// 分页保持现有 ListPagination 固定分页（动态分页 Q1 待拍板）。每页 12 沿用本页原值。
const list = useAdminList(listPositions, {
  pageSize: 12,
  params: () => ({ keyword: query.keyword.trim(), status: query.status || 'all', sort: query.sort })
})
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload
const reload = list.search

// 延迟 loading 遮罩（闪烁修复）：仅当拉取持续 >250ms 才显 v-loading，避免快响应/缓存时
// 白色遮罩一闪而过的闪屏感（尤其从白板返回列表瞬间 refetch）。本页特有，故保留。
const showLoading = ref(false)
let loadingTimer = null
watch(loading, (v) => {
  clearTimeout(loadingTimer)
  if (v) loadingTimer = setTimeout(() => { showLoading.value = true }, 250)
  else showLoading.value = false
})
onBeforeUnmount(() => clearTimeout(loadingTimer))
onMounted(() => fetchList())

// 状态筛选选项：三态展示口径（原型 positionStatus 下拉：全部状态/未发布/审核中/已发布）。
const STATE_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'draft', label: '未发布' },
  { value: 'reviewing', label: '审核中' },
  { value: 'published', label: '已发布' }
]
// 切状态筛选立即刷新（保留）；下拉 clearable 清空给 '' → 归一回 'all'。
function onStatusChange(v) {
  query.status = v || 'all'
  reload()
}

// 关键词搜索：回车 / 【查询】按钮触发（原型口径，2026-09-01 起不再实时防抖）。
// 清空（clearable ×）后也刷新一次，避免残留旧结果。

// 「最近更新时间」列排序（el-table sortable="custom" → 服务端/mock 排序）。
// Element 三态循环里 order=null（取消排序）时回落默认降序。
function onSortChange({ prop, order }) {
  if (prop !== 'updatedAt') return
  query.sort = order === 'ascending' ? 'asc' : 'desc'
  fetchList()
}

/* ---------- 状态三态展示映射（Q6：展示层做，不改共享 publishState 语义） ---------- */
// 草稿(INITIAL)→未发布；REVIEWING / PUBLISHED_REVIEWING / PUBLISHED_DELISTING →审核中；PUBLISHED→已发布。
function displayView(row) {
  const v = derivePublishView(KIND.POSITION, { status: row.status, pendingAction: row.pendingAction })
  if (row.pendingAction) return { ...v, label: '审核中', tagType: 'warning' }
  if (v.state === 'PUBLISHED') return { ...v, label: '已发布', tagType: 'success' }
  return { ...v, label: '未发布', tagType: 'info' }
}
// 审核中（任一在途待审动作）→ 编辑置灰、操作列只给撤回
function isReviewing(row) {
  return !!row.pendingAction
}

// 图标 URL/dataURL 判断收口至 utils/iconDisplay（W-3 图标统一规则配套）

// 计数列悬停口径提示（照原型 L1181 表头/单元格 title）
const COUNT_TIPS = {
  skill: '当前岗位关联的岗位私有技能总数。',
  agent: '基于该岗位创建的 Agent 总数。',
  claim: '当前已领用该岗位的用户总数。'
}

/* ---------- 新建：先弹窗填【岗位名称】+【岗位定位】，创建成功后再进工作台（Q4：流程不动） ---------- */
const createVisible = ref(false)
const creating = ref(false)
const createFormRef = ref(null)
const createForm = reactive({ name: '', intro: '', description: '' })
// 服务端字段级错误（如重名 1005）→ 通过 :error 红框内联回显到名称项（沿用 McpEditor/ApiEditor 范式）
const nameError = ref('')
const createRules = {
  name: [
    { required: true, message: '请填写岗位名称', trigger: 'blur' },
    { max: 64, message: '岗位名称不超过 64 字', trigger: 'blur' }
  ]
}

function openCreateDialog() {
  createForm.name = ''
  createForm.intro = ''
  createForm.description = ''
  nameError.value = ''
  createVisible.value = true
  nextTick(() => createFormRef.value?.clearValidate?.())
}

async function submitCreate() {
  nameError.value = '' // 重新提交前清掉上一次的服务端红框
  try {
    await createFormRef.value.validate()
  } catch {
    return // 校验未过：表单内红框提示
  }
  creating.value = true
  try {
    const data = await createPosition({
      name: createForm.name.trim(),
      intro: createForm.intro.trim() || undefined,
      // 岗位描述（2026-08-26 开放编辑入口）：可空；空则不上送（后端部分更新语义）
      description: createForm.description.trim() || undefined
    })
    createVisible.value = false
    // 2026-09-04 PRD-20260903 对齐：新建保存后跳详情页 toast 照新原型
    ElMessage.success('岗位已创建，请完善必填项后发布')
    router.push({ name: 'PositionWorkbench', params: { id: data.positionId } })
  } catch (e) {
    // 名称重复(1005 唯一冲突)等字段级错误：在名称输入框内联红框回显，不弹全局 toast、不跳转
    if (e?.field === 'name') {
      nameError.value = e?.message || '已存在同名岗位'
    } else {
      ElMessage.error(e?.message || '新建失败')
    }
  } finally {
    creating.value = false
  }
}

function goConfig(row) {
  router.push({ name: 'PositionWorkbench', params: { id: row.positionId } })
}

// 【查看】（2026-09-04 PRD-20260903 对齐）：进入岗位详情页只读态（工作台 query.view=1 →
// 全页签只读、顶部无保存/发布）。所有状态可用（md 三.二.3.1 固定操作）。
function goView(row) {
  router.push({ name: 'PositionWorkbench', params: { id: row.positionId }, query: { view: '1' } })
}

/* ---------- 效果测试台（纯前端 demo，就地扮演终端用户试跑该岗位） ---------- */
// 与技能列表行的「🧪 测试」对称。打开时用现有只读接口拉一次岗位详情喂给组件 props（不新增后端接口）；
// 列表行通常只有摘要（name/intro/agentCount/skillCount），详情接口补齐 persona/agents/intakeSchema/数据表数。
// 详情/表数拉取失败或字段缺：沿用组件已有 mock 兜底，保证 demo 永远渲染好看。
const testVisible = ref(false)
const testLoading = ref(false)
const testProp = ref(null) // { basic, agents, tableCount }
const testRowId = ref(null) // 竞态护栏：await 期间又点了别的行 / 关了，丢弃过期详情

async function openTest(row) {
  testRowId.value = row.positionId
  // 先用列表行摘要兜底渲染（即便详情接口失败，左栏也有岗位名/定位/Agent·技能数）。
  testProp.value = {
    basic: { name: row.name, intro: row.intro, persona: '', intakeSchema: [] },
    agents: [],
    tableCount: 0
  }
  testVisible.value = true
  testLoading.value = true
  try {
    // 岗位详情（含 agents[].skills[]）+ 数据表数并行拉；表数失败不阻断（component 自带兜底）。
    const [detail, tables] = await Promise.all([
      getPosition(row.positionId),
      listDataTables(row.positionId).catch(() => null)
    ])
    // 竞态护栏：期间切换行 / 关闭 → 丢弃。
    if (testRowId.value !== row.positionId || !testVisible.value) return
    testProp.value = {
      // 详情 VO 字段为扁平结构（name/intro/persona/intakeSchema）；component 用 p.basic||p 读取，直接喂 detail 即可。
      basic: detail || { name: row.name, intro: row.intro },
      agents: Array.isArray(detail?.agents) ? detail.agents : [],
      tableCount: (tables?.list || []).length
    }
  } catch {
    // 详情拉取失败：保留上面的摘要兜底，组件再用 mock 补齐缺字段（不打扰，不弹错）。
  } finally {
    if (testRowId.value === row.positionId) testLoading.value = false
  }
}

function closeTest() {
  testVisible.value = false
  testProp.value = null
  testRowId.value = null
  testLoading.value = false
}

/* ---------- 版本管理侧栏（与技能/专家共用 VersionDrawer，岗位词表经 adapter 参数化传入） ---------- */
const versionDlgVisible = ref(false)
const versionDlgRow = ref(null)
function openVersionDialog(row) {
  versionDlgRow.value = row
  versionDlgVisible.value = true
}

// 【发布】入口（Q3：不弹确认窗）：先校验技能数，为空 toast 拦下；否则直接打开版本管理侧栏。
function onPublish(row) {
  const skillCount = row.skillCount ?? (Array.isArray(row.skillIds) ? row.skillIds.length : 0)
  if (!skillCount) {
    ElMessage.warning('至少关联 1 个岗位私有技能才能发布')
    return
  }
  openVersionDialog(row)
}

/**
 * 岗位版本适配器（喂给统一 VersionDrawer）。
 * delist/relist 按 **version** 定位（与专家按 publicationId 不同），故此处原样封装。
 * 2026-09-01 PRD 对齐：抽屉标题「版本管理」、更新类型词 修订版本/功能更新/重大更新 + 岗位 hint、
 * 历史区副标题、状态词 已启用/已禁用 + 动作词 启用/禁用、确认文案「启用|禁用「名」的 vX.Y.Z？」、
 * 最后一个启用版本禁用置灰、启用互斥；版本行不再带「pin N 技能」（Q9：原型无）。
 */
const versionAdapter = computed(() => {
  const row = versionDlgRow.value
  if (!row) return null
  const pid = row.positionId
  return {
    entityLabel: '岗位',
    entityKey: '岗位名称',
    name: row.name,
    id: pid,
    title: '版本管理',
    deriveView: () => derivePublishView(KIND.POSITION, { status: row.status, pendingAction: row.pendingAction }),
    nextVersionLabel: getNextVersionLabel,
    publish: publishPosition,
    withdraw: withdrawPosition,
    listVersions: listPositionPublications,
    mapRow: (p) => ({
      ...p,
      verLabel: p.versionLabel || `v${p.version}`,
      releaseNotes: p.releaseNotes || ''
    }),
    delist: (r) => delistPositionPublication(pid, r.version),
    relist: (r) => relistPositionPublication(pid, r.version),
    // 更新类型词与 hint（原型 positionPublishHtml / positionBumpHint）
    bumpOptions: [
      { value: 'NONE', label: '修订版本', hint: '修复问题或小幅配置调整' },
      { value: 'MINOR', label: '功能更新', hint: '新增岗位能力或岗位技能' },
      { value: 'MAJOR', label: '重大更新', hint: '岗位职责或流程发生不兼容变更' }
    ],
    historySubtitle: '每次审核通过生成一版岗位配置快照；同一时间只能启用一个版本',
    delistTerm: '禁用',
    relistTerm: '启用',
    activeLabel: '已启用',
    delistConfirmText: (r, ver) => `禁用「${row.name}」的 ${ver}？`,
    relistConfirmText: (r, ver) => `启用「${row.name}」的 ${ver}？`,
    guardLastActive: true,
    lastActiveTip: '当前版本是该岗位最后一个启用版本。如需停止对外提供，请先整体下架岗位。',
    exclusiveActive: true,
    // 侧栏内「撤回提交」确认文案（原型 withdrawPositionVersion；toast「已撤回提交」由抽屉统一给）
    withdrawText: () => '撤回本次提交后将回到修改前状态。确认撤回？'
  }
})

/* ---------- 列表【撤回】（审核中行，原型 position-withdraw modal） ---------- */
async function withdrawFromList(row) {
  if (busyId.value != null) return
  try {
    // md 三.二.3.4：确认窗口说明撤回后恢复提交审核前的状态
    await ElMessageBox.confirm(
      `「${row.name}」当前处于审核中。撤回后恢复提交审核前的状态。`,
      '撤回审核申请',
      { type: 'warning', confirmButtonText: '撤回申请' }
    )
  } catch {
    return
  }
  busyId.value = row.positionId
  try {
    // mock 侧同步清 pendingVersion / pendingReleaseNotes
    await withdrawPosition(row.positionId)
    // md 三.二.3.4：撤回成功提示「已撤回」（2026-09-04 PRD-20260903 对齐）
    ElMessage.success('已撤回')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  } finally {
    busyId.value = null
  }
}

/* ---------- 停用（Q5 降级：普通二次确认；领用数>0 先拦，原型 position-stop） ---------- */
async function stopPosition(row) {
  if (busyId.value != null) return
  const claimCount = row.claimedUserCount ?? 0
  if (claimCount > 0) {
    // 有领用：提示窗（单按钮「知道了」，不执行停用；文案照新 md 三.二.3.5，2026-09-04 对齐）
    await ElMessageBox.alert(
      `该岗位已被 ${claimCount} 个用户领用，需先解除领用后再停用`,
      '停用岗位',
      { confirmButtonText: '知道了' }
    ).catch(() => {})
    return
  }
  try {
    // md 三.二.3.5：确认文案与按钮逐字
    await ElMessageBox.confirm(
      `停用「${row.name}」需提交停用审核。审核通过前客户端仍可正常使用。`,
      '停用岗位',
      { type: 'warning', confirmButtonText: '提交停用审核', confirmButtonClass: 'el-button--warning' }
    )
  } catch {
    return
  }
  busyId.value = row.positionId
  try {
    await unpublishPosition(row.positionId)
    ElMessage.success('已提交停用审核')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '提交停用失败')
  } finally {
    busyId.value = null
  }
}

// 弹窗内任一动作（提交发布/撤回）成功后 emit('done') → 刷新列表（更新状态/最新版本列）。
async function onVersionDone() {
  await fetchList()
  // 回写抽屉持有的行（同专家：否则抽屉发布态停留在旧值，可能重复提交）。
  const id = versionDlgRow.value?.positionId
  if (id) versionDlgRow.value = rows.value.find((r) => r.positionId === id) || versionDlgRow.value
}

/* ---------- 删除（2026-09-04 PRD-20260903 对齐：领用护栏 + 确认文案照新 md 三.二.3.6） ---------- */
async function remove(row) {
  if (busyId.value != null) return
  const claimCount = row.claimedUserCount ?? 0
  if (claimCount > 0) {
    // 有领用：不可删除，提示先解除领用（文案照新 md）
    await ElMessageBox.alert(
      `该岗位已被 ${claimCount} 个用户领用，需先解除领用后再删除`,
      '删除岗位',
      { confirmButtonText: '知道了' }
    ).catch(() => {})
    return
  }
  try {
    await ElMessageBox.confirm(
      `删除后「${row.name}」将不可用，确认删除？`,
      '删除岗位',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  busyId.value = row.positionId
  try {
    await deletePosition(row.positionId, row.name)
    ElMessage.success('岗位已删除')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    busyId.value = null
  }
}

// 操作列按钮数上限（2026-09-04 PRD-20260903 对齐补【查看】）：未发布行 查看/编辑/[测试]/发布/删除
const OPS_MAX = EFFECT_TEST_ENABLED ? 5 : 4
</script>

<template>
  <div class="list-page">
    <PageHeader
      title="岗位"
      subtitle="管理岗位定义、岗位私有技能与版本管理状态"
    />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索岗位名称或岗位描述"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <!-- 状态筛选三态（未发布/审核中/已发布）：切换立即刷新；clearable 清空 → 归 'all'。 -->
      <el-select
        v-model="query.status"
        placeholder="全部状态"
        class="lt-filter"
        @change="onStatusChange"
      >
        <el-option v-for="o in STATE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreateDialog">＋ 新建岗位</el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="没有符合条件的岗位"
        @retry="fetchList"
      >
        <el-table
          v-loading="showLoading"
          :data="rows"
          row-key="positionId"
          :default-sort="{ prop: 'updatedAt', order: 'descending' }"
          @sort-change="onSortChange"
        >
          <!-- 岗位名称：图标 + 名称 + 状态标签同格（原型 position-primary，独立状态列已并入） -->
          <el-table-column label="岗位名称" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="pos-primary">
                <span class="pos-icon">
                  <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="pos-icon-img" />
                  <span v-else>{{ row.icon || '🧑‍💼' }}</span>
                </span>
                <span class="pos-name">{{ row.name }}</span>
                <StatusTag :type="displayView(row).tagType">{{ displayView(row).label }}</StatusTag>
              </span>
            </template>
          </el-table-column>

          <!-- 岗位描述（取 description；Q7：intro 字段保留现状，仅列展示改口径） -->
          <el-table-column label="岗位描述" :min-width="COL.DESC_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.description">{{ row.description }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!-- 三个计数列：表头与单元格 title 悬停口径提示（照原型）；领用数 0 直接显 0 -->
          <el-table-column :width="COL.COUNT" align="center">
            <template #header><span :title="COUNT_TIPS.skill">技能数</span></template>
            <template #default="{ row }">
              <span :title="COUNT_TIPS.skill">{{ row.skillCount ?? 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column :width="COL.COUNT" align="center">
            <template #header><span :title="COUNT_TIPS.agent">Agent 数</span></template>
            <template #default="{ row }">
              <span :title="COUNT_TIPS.agent">{{ row.agentCount ?? 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column :width="COL.COUNT" align="center">
            <template #header><span :title="COUNT_TIPS.claim">领用数</span></template>
            <template #default="{ row }">
              <span :title="COUNT_TIPS.claim">{{ row.claimedUserCount ?? 0 }}</span>
            </template>
          </el-table-column>

          <!-- 最新版本：普通文本（不再用 tag）；无版本 → 「—」 -->
          <el-table-column label="最新版本" :width="104" align="center">
            <template #default="{ row }">
              <span v-if="row.latestVersion">{{ row.latestVersion }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!-- 最近更新时间（精确到分钟）：可排序，默认降序（服务端/mock 排序） -->
          <el-table-column label="最近更新时间" prop="updatedAt" sortable="custom" :width="COL.TIME">
            <template #default="{ row }">
              <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!-- 操作列（2026-09-04 PRD-20260903 对齐 md 三.二.3.1）：查看/编辑固定恒显（审核中编辑置灰——Q口径冻结保持展示型置灰）；
               审核中→撤回；未发布→发布+删除（带悬停提示）；已发布→停用+版本管理（版本管理按钮为冻结区保留）。 -->
          <el-table-column label="操作" :width="opsWidth(OPS_MAX)" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <el-button link type="primary" @click="goView(row)">查看</el-button>
                <el-button
                  link
                  type="primary"
                  :disabled="isReviewing(row)"
                  :title="isReviewing(row) ? '审核中不可编辑' : undefined"
                  @click="goConfig(row)"
                >
                  编辑
                </el-button>
                <!-- 执行链路未就绪，测试入口统一由 EFFECT_TEST_ENABLED 隐藏（utils/featureFlags.js），保留现状 -->
                <el-button v-if="EFFECT_TEST_ENABLED" link type="primary" @click="openTest(row)">
                  测试
                </el-button>

                <!-- 审核中：仅撤回 -->
                <el-button
                  v-if="isReviewing(row)"
                  link
                  type="warning"
                  :loading="busyId === row.positionId"
                  @click="withdrawFromList(row)"
                >
                  撤回
                </el-button>

                <!-- 未发布：发布（先校验技能数，Q3 不弹确认窗）+ 删除；悬停提示照 md 三.二.3.1 -->
                <template v-else-if="row.status === 'draft'">
                  <el-button
                    link
                    type="primary"
                    title="发布将提交审核，审核通过后生成版本快照并上线"
                    @click="onPublish(row)"
                  >
                    发布
                  </el-button>
                  <el-button
                    v-if="canDelete(KIND.POSITION, { status: row.status, pendingAction: row.pendingAction })"
                    link
                    type="danger"
                    title="删除前需二次确认"
                    :loading="busyId === row.positionId"
                    @click="remove(row)"
                  >
                    删除
                  </el-button>
                </template>

                <!-- 已发布：停用 + 版本管理 -->
                <template v-else>
                  <el-button
                    link
                    type="warning"
                    :loading="busyId === row.positionId"
                    @click="stopPosition(row)"
                  >
                    停用
                  </el-button>
                  <el-button link type="primary" @click="openVersionDialog(row)">版本管理</el-button>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>

      <!-- 底部分页（自造说明行已删，2026-09-01 PRD 对齐；ListPagination 单页时自动不渲染） -->
      <div v-if="rows.length" class="pos-foot">
        <ListPagination
          v-model:page="page"
          :page-size="pageSize"
          :total="total"
          @change="fetchList"
        />
      </div>
    </div>

    <!-- 效果测试台（聚焦舞台浮层，复刻 AdminSkills 做法：fixed inset:0、z-modal、mask 背景；关闭走 v-if，组件 onUnmounted 兜底 cancel） -->
    <div v-if="testVisible" class="focus-stage" v-loading="testLoading">
      <EffectTestStage
        mode="position"
        :position="testProp || {}"
        :position-id="testRowId"
        @close="closeTest"
      />
    </div>

    <!-- 新建岗位弹窗：先填名称+定位，创建成功再进工作台（Q4/Q7：现有流程与字段不动） -->
    <el-dialog
      v-model="createVisible"
      title="新建岗位"
      width="460px"
      :close-on-click-modal="false"
      append-to-body
    >
      <el-form
        ref="createFormRef"
        :model="createForm"
        :rules="createRules"
        label-position="top"
        @submit.prevent
      >
        <el-form-item label="岗位名称" prop="name" :error="nameError">
          <el-input
            v-model="createForm.name"
            placeholder="如：销售助理 / HR 小赫"
            maxlength="64"
            show-word-limit
            clearable
            @input="nameError = ''"
            @keyup.enter="submitCreate"
          />
        </el-form-item>
        <el-form-item label="岗位定位">
          <el-input
            v-model="createForm.intro"
            type="textarea"
            :rows="2"
            maxlength="100"
            show-word-limit
            placeholder="一句话说明这个岗位是做什么的（可稍后在详情页修改）"
          />
        </el-form-item>
        <!-- 岗位描述（2026-09-04 PRD-20260903 对齐：500 字上限+计数与人格页签/mock 全链同口径；
             发布必填在详情页发布校验时兜底，新建时可留空稍后补） -->
        <el-form-item label="岗位描述">
          <el-input
            v-model="createForm.description"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="说明该岗位负责什么、可以帮助用户完成哪些工作（可稍后在详情页修改）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建并配置</el-button>
      </template>
    </el-dialog>

    <!-- 版本管理侧栏（统一 VersionDrawer：发布新版本 + 版本历史双区，岗位词表经 adapter 传入）。
         按发布态驱动；任一动作成功 emit done → 刷新列表。 -->
    <VersionDrawer
      v-model="versionDlgVisible"
      :adapter="versionAdapter"
      @done="onVersionDone"
    />

  </div>
</template>

<style scoped>
/* 效果测试台浮层：覆盖视口居中承载 EffectTestStage（自带 .et-stage 居中卡 + zoomIn）。与 AdminSkills 一致。 */
.focus-stage {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-6) var(--space-6);
  background: var(--mask);
}
/* ---------- 表格单元 ---------- */
/* 岗位名称列：图标 + 名称 + 状态标签同格（原型 position-primary） */
.pos-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
/* 图标：定宽定高，emoji 与上传图片共用同一视觉框，避免不同形态导致行高参差
   （与 MCP 页 .mc-icon 同构，仅前缀不同）。岗位用圆形——沿用工牌证件照的圆头像语义。 */
.pos-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  font-size: 15px;
  line-height: 1;
  vertical-align: middle;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  overflow: hidden;
}
.pos-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pos-name {
  color: var(--c-text-strong);
  vertical-align: middle;
}

/* 底部分页 */
.pos-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: var(--space-4);
}
</style>
