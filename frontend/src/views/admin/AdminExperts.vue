<script setup>
/**
 * 「专家」列表页（系统配置员 SYS_CONFIG；2026-09-01 PRD 对齐改造，基准=prd md + 交互原型 v2
 * renderExperts 覆写区 L1042 / expertActions 覆写区 L967）。
 *
 * 【本轮对齐要点】
 * - 措辞：全模块「平台技能」→「市场技能」；subtitle 照原型。
 * - 工具栏：搜索覆盖专家名+描述+分类（回车/【查询】触发）、专家分类筛选（8 类，选项同源字段字典）、
 *   状态筛选三态（未发布/审核中/已发布）。
 * - 列表列：状态标签并入专家名列（图标 avatar + 名称 + 三态标签同格）；列序 专家名|专家描述|分类|
 *   技能数|最新版本(无版本「-」)|最近更新时间(排序,默认降序)|操作。
 * - 状态三态为**展示层映射**（同岗位 Q6 手法：不改共享 publishState 语义）：草稿→未发布、
 *   各审核中→审核中、已发布→已发布。
 * - 操作列（照原型 expertActions）：查看 + 编辑（审核中 disabled）恒显；按状态给
 *   发布/删除（未发布）、撤回（审核中）、停用/版本管理（已发布）。
 * - 强确认降级：删除/停用改普通二次确认（文案照原型 modal）；删除引用数 N 直接取行 skillCount
 *   （Z7 拍板：不再前置调 delete-impact，接口函数保留）。
 * - 版本管理侧栏：统一 VersionDrawer，专家词表（启用/禁用、专家名称、historySubtitle 等）经 adapter 传入。
 * - 数据走 domainExpertMock（api 层分流，VITE_EXPERT_MOCK=0 关闭）。分页保持固定 ListPagination（Z1 不实施动态分页）。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import {
  listExperts,
  deleteExpert,
  unpublishExpert,
  publishExpert,
  withdrawExpert,
  getExpertNextVersionLabel,
  listExpertPublications,
  delistExpertPublication,
  relistExpertPublication
} from '@/api/domainExpert'
import { getFieldOptionNames } from '@/api/fieldDictMock'
import '@/assets/connector.css'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import { KIND, derivePublishView } from '@/utils/publishState'
import { fmtTime } from '@/utils/docMeta'
import ExpertEditor from '@/components/admin/ExpertEditor.vue'
import VersionDrawer from '@/components/admin/VersionDrawer.vue'
import { iconIsUrl } from '@/utils/iconDisplay'

// sort：最近更新时间排序方向（原型 expertSort，默认降序）
const query = reactive({ keyword: '', category: '', status: '', sort: 'desc' })

// 专家分类筛选选项：同源字段字典（fieldDictMock.expertCategory，8 类），不本页硬编码
const CATEGORY_OPTIONS = getFieldOptionNames('expertCategory')

// 状态筛选选项：三态展示口径（原型 expertStatus 下拉：全部状态/未发布/审核中/已发布）
const STATE_OPTIONS = [
  { value: 'draft', label: '未发布' },
  { value: 'review', label: '审核中' },
  { value: 'published', label: '已发布' }
]

// 取数编排统一走 useAdminList（见 docs/frontend/规范-管理后台列表页.md）
const list = useAdminList(listExperts, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload
const reload = list.search

onMounted(fetchList)

// 「最近更新时间」列排序（el-table sortable="custom" → mock 排序）；order=null 回落默认降序
function onSortChange({ prop, order }) {
  if (prop !== 'updatedAt') return
  query.sort = order === 'ascending' ? 'asc' : 'desc'
  fetchList()
}

/* ---------- 状态三态展示映射（展示层做，不改共享 publishState 语义；同 AdminPositions displayView） ---------- */
// 草稿(INITIAL)→未发布；REVIEWING / PUBLISHED_REVIEWING / PUBLISHED_DELISTING →审核中；PUBLISHED→已发布。
function displayView(row) {
  const v = derivePublishView(KIND.DOMAIN_EXPERT, { status: row.status, pendingAction: row.pendingAction })
  if (row.pendingAction) return { ...v, label: '审核中', tagType: 'warning' }
  if (v.state === 'PUBLISHED') return { ...v, label: '已发布', tagType: 'success' }
  return { ...v, label: '未发布', tagType: 'info' }
}
// 审核中（任一在途待审动作）→ 编辑置灰、操作列只给撤回
function isReviewing(row) {
  return !!row.pendingAction
}

/* ---------- 编辑 / 查看抽屉（新建 / 编辑 / 只读查看共用 ExpertEditor） ---------- */
const editorVisible = ref(false)
const editingId = ref(null)
const editorReadonly = ref(false)

function openCreate() {
  editingId.value = null
  editorReadonly.value = false
  editorVisible.value = true
}

// 编辑：进抽屉配置本专家（基本信息 / 专家帮你做 / 市场技能引用全在里面）。专家名点击同入口。
function openEdit(row) {
  if (isReviewing(row)) return
  editingId.value = row.id
  editorReadonly.value = false
  editorVisible.value = true
}

// 只读查看抽屉（原型 openExpertViewer：标题「查看专家」，footer 仅【关闭】）
function openView(row) {
  editingId.value = row.id
  editorReadonly.value = true
  editorVisible.value = true
}

/**
 * 抽屉内保存成功 → 刷新列表。新建保存会带回创建出的详情：就地把 editingId 切过去，
 * 抽屉从「新建」翻成「编辑」（连续动作，不用关掉再点开）。
 */
function onEditorSaved(created) {
  if (created?.id != null) editingId.value = created.id
  fetchList()
}

/**
 * 抽屉底部【发布】：编辑器已静默自动保存并收抽屉，此处接住 detail 打开版本管理侧栏。
 * detail 为刚保存后的最新数据（含 skillCount），发布门（≥1 市场技能）由编辑器把守。
 */
async function onEditorPublish(detail) {
  await fetchList()
  const row = rows.value.find((r) => r.id === detail.id) || detail
  versionRow.value = row
  versionDlgVisible.value = true
}

/* ---------- 版本管理侧栏（统一 VersionDrawer，专家词表经 adapter 传入） ---------- */
const versionDlgVisible = ref(false)
const versionRow = ref(null)

/**
 * 专家版本适配器（喂给统一 VersionDrawer）。
 * 注意 delist/relist 走 **publicationId=pub.id**（专家端点口径，与技能按 version、岗位按 version 都不同），
 * 故此处原样封装、不让抽屉自行拼参。
 * 2026-09-01 PRD 对齐：抽屉标题「版本管理」、历史区副标题、状态词 已启用 + 动作词 启用/禁用、
 * 确认文案「启用|禁用「名」的 vX.Y.Z？」、最后一个启用版本禁用置灰、启用互斥、entityKey「专家名称」。
 */
const versionAdapter = computed(() => {
  const row = versionRow.value
  if (!row) return null
  return {
    entityLabel: '专家',
    entityKey: '专家名称',
    name: row.name,
    id: row.id,
    title: '版本管理',
    deriveView: () => derivePublishView(KIND.DOMAIN_EXPERT, { status: row.status, pendingAction: row.pendingAction }),
    nextVersionLabel: getExpertNextVersionLabel,
    publish: publishExpert,
    withdraw: withdrawExpert,
    listVersions: listExpertPublications,
    mapRow: (p) => ({ ...p, verLabel: p.versionLabel || `v${p.version}`, releaseNotes: p.releaseNotes || '' }),
    delist: (r) => delistExpertPublication(row.id, r.id),
    relist: (r) => relistExpertPublication(row.id, r.id),
    // 更新类型词与 hint（原型 expertVersionManager bumpHint：MINOR 是「新增能力、技能或职责范围」）
    bumpOptions: [
      { value: 'NONE', label: '修订更新', hint: '修复问题或小幅调整' },
      { value: 'MINOR', label: '功能更新', hint: '新增能力、技能或职责范围' },
      { value: 'MAJOR', label: '重大更新', hint: '重大改动或不兼容变更' }
    ],
    historySubtitle: '每次审核通过生成一版专家配置快照；同一时间只能启用一个版本',
    delistTerm: '禁用',
    relistTerm: '启用',
    activeLabel: '已启用',
    delistConfirmText: (r, ver) => `禁用「${row.name}」的 ${ver}？`,
    relistConfirmText: (r, ver) => `启用「${row.name}」的 ${ver}？`,
    guardLastActive: true,
    lastActiveTip: '当前版本是该专家最后一个启用版本。如需停止对外提供，请先整体下架专家。',
    exclusiveActive: true,
    withdrawText: () => '撤回本次提交后将回到修改前状态。确认撤回？'
  }
})

// 【发布】（未发布行）/【版本管理】（已发布行）：首发前置门（≥1 市场技能）在【发布】上把守。
function openVersion(row) {
  const isDraft = row.status !== 'published' && !row.pendingAction
  if (isDraft && !(row.skillCount > 0)) {
    ElMessage.warning('至少引用 1 个市场技能才能发布')
    return
  }
  versionRow.value = row
  versionDlgVisible.value = true
}

// 侧栏内任一动作（提交发布/撤回/版本启停）成功 → 刷新列表并回写抽屉持有的行
// （否则抽屉按 status+pendingAction 派生的发布态停留在旧值，可能重复提交）。
async function onVersionDone() {
  await fetchList()
  const id = versionRow.value?.id
  if (id) versionRow.value = rows.value.find((r) => r.id === id) || versionRow.value
}

/* ---------- 列表【撤回】（审核中行，原型 openExpertVersion pendingAction 分支） ---------- */
const busyId = ref(null)

async function withdrawFromList(row) {
  if (busyId.value != null) return
  try {
    await ElMessageBox.confirm(
      `「${row.name}」当前处于审核中。撤回后回到修改前状态。`,
      '撤回审核申请',
      { type: 'warning', confirmButtonText: '撤回申请' }
    )
  } catch {
    return
  }
  busyId.value = row.id
  try {
    // mock 侧同步清 pendingAction / pendingVersion / pendingReleaseNotes
    await withdrawExpert(row.id)
    ElMessage.success('审核申请已撤回')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  } finally {
    busyId.value = null
  }
}

/* ---------- 删除（强确认降级：普通二次确认；N 直接取行 skillCount，Z7 拍板） ---------- */
async function onDelete(row) {
  if (busyId.value != null) return
  try {
    await ElMessageBox.confirm(
      `删除「${row.name}」后会解除 ${row.skillCount ?? 0} 条市场技能引用，技能本体不受影响。确认删除？`,
      '删除专家',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  busyId.value = row.id
  try {
    await deleteExpert(row.id)
    ElMessage.success('专家已删除')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    busyId.value = null
  }
}

/* ---------- 停用（强确认降级：普通二次确认；停用=提交停用审核） ---------- */
async function stopExpert(row) {
  if (busyId.value != null) return
  try {
    await ElMessageBox.confirm(
      `停用「${row.name}」需提交审核。审核通过前客户端仍可使用。`,
      '停用专家',
      { type: 'warning', confirmButtonText: '提交停用审核', confirmButtonClass: 'el-button--warning' }
    )
  } catch {
    return
  }
  busyId.value = row.id
  try {
    await unpublishExpert(row.id)
    ElMessage.success('已提交停用审核')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '提交停用失败')
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="list-page">
    <PageHeader
      title="专家"
      subtitle="把多个市场技能归类整合成一个可交付单元，只引用市场技能，与 FDE 技能互不影响"
    />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索专家名、描述或分类"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <!-- 专家分类筛选（8 类，同源字段字典）：切换立即刷新；clearable 清空 = 全部 -->
      <el-select v-model="query.category" placeholder="全部专家分类" clearable class="lt-filter" @change="reload">
        <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
      </el-select>
      <!-- 状态筛选三态（未发布/审核中/已发布） -->
      <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter" @change="reload">
        <el-option v-for="o in STATE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">＋ 新建专家</el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap" v-loading="loading">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="还没有专家，点击「新建专家」创建第一个"
        @retry="fetchList"
      >
        <el-table
          :data="rows"
          style="width: 100%"
          row-key="id"
          :default-sort="{ prop: 'updatedAt', order: 'descending' }"
          @sort-change="onSortChange"
        >
          <!-- 专家名：图标 avatar + 名称 + 三态状态标签同格（原型 expert-primary，独立状态列已并入） -->
          <el-table-column label="专家名" :min-width="COL.NAME_MIN" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ex-primary">
                <span class="ex-avatar">
                  <img v-if="iconIsUrl(row.avatar)" :src="row.avatar" alt="" class="ex-avatar-img" />
                  <span v-else>{{ row.avatar || '☆' }}</span>
                </span>
                <a class="ex-name" @click="openEdit(row)">{{ row.name }}</a>
                <StatusTag :type="displayView(row).tagType">{{ displayView(row).label }}</StatusTag>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="专家描述" :min-width="COL.DESC_MIN" show-overflow-tooltip>
            <template #default="{ row }">{{ row.intro || '—' }}</template>
          </el-table-column>
          <el-table-column label="分类" :width="COL.TAG" align="center">
            <template #default="{ row }">
              <span v-if="row.category" class="ex-category">{{ row.category }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>
          <el-table-column label="技能数" :width="COL.COUNT" align="center">
            <template #default="{ row }">{{ row.skillCount }}</template>
          </el-table-column>
          <!-- 最新版本：无版本「-」（原型 muted-value） -->
          <el-table-column label="最新版本" :width="COL.TAG" align="center">
            <template #default="{ row }">
              <span v-if="row.latestVersionLabel">{{ row.latestVersionLabel }}</span>
              <span v-else class="cell-na">-</span>
            </template>
          </el-table-column>
          <!-- 最近更新时间：可排序，默认降序（mock 排序） -->
          <el-table-column label="最近更新时间" prop="updatedAt" sortable="custom" :width="COL.TIME">
            <template #default="{ row }">
              <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>
          <!-- 操作列（照原型 expertActions）：查看 + 编辑（审核中置灰）恒显；
               审核中→撤回；未发布→发布+删除；已发布→停用+版本管理。 -->
          <el-table-column label="操作" :width="opsWidth(4)" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <el-button link type="primary" @click="openView(row)">查看</el-button>
                <el-button
                  link
                  type="primary"
                  :disabled="isReviewing(row)"
                  :title="isReviewing(row) ? '审核中不可编辑' : undefined"
                  @click="openEdit(row)"
                >编辑</el-button>

                <!-- 审核中：仅撤回 -->
                <el-button
                  v-if="isReviewing(row)"
                  link
                  type="warning"
                  :loading="busyId === row.id"
                  @click="withdrawFromList(row)"
                >撤回</el-button>

                <!-- 未发布：发布（≥1 市场技能前置门）+ 删除 -->
                <template v-else-if="row.status === 'draft'">
                  <el-button link type="primary" @click="openVersion(row)">发布</el-button>
                  <el-button
                    link
                    type="danger"
                    title="删除前需二次确认"
                    :loading="busyId === row.id"
                    @click="onDelete(row)"
                  >删除</el-button>
                </template>

                <!-- 已发布：停用 + 版本管理 -->
                <template v-else>
                  <el-button
                    link
                    type="warning"
                    :loading="busyId === row.id"
                    @click="stopExpert(row)"
                  >停用</el-button>
                  <el-button link type="primary" @click="openVersion(row)">版本管理</el-button>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination
      v-model:page="page"
      :page-size="pageSize"
      :total="total"
      @change="fetchList"
    />

    <!-- 专家编辑抽屉（新建 / 编辑 / 只读查看共用）。【发布】在抽屉底部：静默保存后收抽屉、开版本侧栏。 -->
    <ExpertEditor
      v-model:visible="editorVisible"
      :expert-id="editingId"
      :readonly="editorReadonly"
      @saved="onEditorSaved"
      @publish="onEditorPublish"
    />

    <!-- 版本管理侧栏（统一 VersionDrawer，与技能/岗位同一组件）。 -->
    <VersionDrawer
      v-model="versionDlgVisible"
      :adapter="versionAdapter"
      @done="onVersionDone"
    />
  </div>
</template>

<style scoped>
/* 专家名列：图标 + 名称 + 状态标签同格（原型 expert-primary） */
.ex-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
/* 图标：定宽定高小方块（原型 expert-avatar，与 MCP/岗位列表图标同构） */
.ex-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-sm);
}
.ex-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: none;
  font-size: 15px;
  line-height: 1;
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  overflow: hidden;
}
.ex-name {
  color: var(--c-primary, #409eff);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ex-name:hover {
  text-decoration: underline;
}
.ex-category {
  color: var(--c-text-muted);
}
</style>
