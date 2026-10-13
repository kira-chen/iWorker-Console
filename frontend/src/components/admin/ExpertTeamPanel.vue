<script setup>
/**
 * 「专家团」列表面板（嵌在 AdminExperts.vue 的「专家 | 专家团」视图切换里）。
 * 规则依据：docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家团.md §一–§五（以下简称 md）。
 *
 * 与专家列表同构（工具栏 → 表格 → 分页 → 编辑抽屉 → 版本管理侧栏），差异：
 * - 列：团类型、成员（头像叠放）、团长（未设显示「未设团长」）、引用情况只对岗位私有团有值；
 * - 状态列在「已发布」旁追加红色「缺员 N」（成员专家被停用 / 回收 / 删除，实时算，md §四）；
 * - 【发布】点击后先做发布前检查（md §三.8）：必填 / 成员均已发布 / 岗位匹配不通过就阻断提示；
 *   （试跑提醒本期不做，见 prd.专家团.md §三.9）列表【发布】与编辑抽屉【发布】走同一条路。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import RevokedTag from '@/components/admin/RevokedTag.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import ExpertTeamEditor from '@/components/admin/ExpertTeamEditor.vue'
import VersionDrawer from '@/components/admin/VersionDrawer.vue'
import DeactivateDialog from '@/components/admin/DeactivateDialog.vue'
import {
  listTeams,
  getTeam,
  deleteTeam,
  unpublishTeam,
  publishTeam,
  withdrawTeam,
  getTeamNextVersionLabel,
  listTeamPublications,
  delistTeamPublication,
  relistTeamPublication,
  checkTeamPublishable
} from '@/api/expertTeam'
import { getFieldOptionNames } from '@/api/fieldDictMock'
import { EXPERT_TYPE } from '@/api/expertTypes'
import { COL, opsWidth, NA } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import { KIND, derivePublishView, deriveTriView, isLocked } from '@/utils/publishState'
import { fmtTime } from '@/utils/docMeta'
import { iconIsUrl } from '@/utils/iconDisplay'
import '@/assets/connector.css'

const TEAM_TYPE_LABEL = {
  [EXPERT_TYPE.POSITION]: '岗位团',
  [EXPERT_TYPE.PLATFORM]: '市场团',
  [EXPERT_TYPE.SYSTEM_DEFAULT]: '通用团'
}
const TYPE_OPTIONS = Object.entries(TEAM_TYPE_LABEL).map(([value, label]) => ({ value, label }))
const CATEGORY_OPTIONS = getFieldOptionNames('expertCategory')
const STATE_OPTIONS = [
  { value: 'draft', label: '未发布' },
  { value: 'review', label: '审核中' },
  { value: 'published', label: '已发布' }
]

const query = reactive({ keyword: '', type: '', category: '', status: '', sort: 'desc' })
const list = useAdminList(listTeams, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload
const reload = list.search

onMounted(fetchList)

const sortArrow = computed(() => (query.sort === 'desc' ? '↓' : '↑'))
function toggleSort() {
  query.sort = query.sort === 'desc' ? 'asc' : 'desc'
  fetchList()
}

// 三态展示映射：与专家共用同一套（草稿→未发布、在途→审核中、已发布→已发布）
function displayView(row) {
  const tri = deriveTriView(KIND.DOMAIN_EXPERT, row)
  return { label: tri.label, tagType: tri.type }
}
const isReviewing = (row) => isLocked(KIND.DOMAIN_EXPERT, row)

/* ---------- 编辑 / 查看抽屉 ---------- */
const editorVisible = ref(false)
const editingId = ref(null)
const editorReadonly = ref(false)

function openCreate() {
  editingId.value = null
  editorReadonly.value = false
  editorVisible.value = true
}
function openEdit(row) {
  if (isReviewing(row)) return
  editingId.value = row.id
  editorReadonly.value = false
  editorVisible.value = true
}
function openView(row) {
  editingId.value = row.id
  editorReadonly.value = true
  editorVisible.value = true
}
function onEditorSaved(created) {
  if (created?.id != null) editingId.value = created.id
  fetchList()
}

/* ---------- 发布：发布前检查 → 版本管理侧栏 ---------- */
const versionDlgVisible = ref(false)
const versionRow = ref(null)

/** 未发布的团走【发布】的发布前检查；已发布的团走【版本管理】直接开侧栏（md §三.3：检查针对首次发布，迭代同样在提交时由数据层兜底）。 */
async function startPublish(rowOrDetail) {
  let team = rowOrDetail
  if (!Array.isArray(team.members)) {
    try {
      team = await getTeam(rowOrDetail.id)
    } catch (e) {
      ElMessage.error(e?.message || '加载失败')
      return
    }
  }
  const blocked = checkTeamPublishable(team)
  if (blocked) {
    ElMessage.warning(blocked.message)
    return
  }
  openVersionDrawer(rows.value.find((r) => r.id === team.id) || team)
}
function openVersionDrawer(row) {
  versionRow.value = row
  versionDlgVisible.value = true
}
// 编辑抽屉【发布】：已静默保存并收抽屉，detail 为保存后的最新数据
async function onEditorPublish(detail) {
  await fetchList()
  startPublish(detail)
}
// 【发布】（未发布行）/【版本管理】（已发布行）
function onPublishClick(row) {
  if (row.status === 'published') openVersionDrawer(row)
  else startPublish(row)
}

const versionAdapter = computed(() => {
  const row = versionRow.value
  if (!row) return null
  return {
    entityLabel: '专家团',
    entityKey: '专家团名称',
    name: row.name,
    id: row.id,
    title: '版本管理',
    deriveView: () => derivePublishView(KIND.DOMAIN_EXPERT, { status: row.status, pendingAction: row.pendingAction }),
    nextVersionLabel: getTeamNextVersionLabel,
    publish: publishTeam,
    withdraw: withdrawTeam,
    listVersions: listTeamPublications,
    mapRow: (p) => ({ ...p, verLabel: p.versionLabel || `v${p.version}`, releaseNotes: p.releaseNotes || '' }),
    delist: (r) => delistTeamPublication(row.id, r.id),
    relist: (r) => relistTeamPublication(row.id, r.id),
    bumpOptions: [
      { value: 'NONE', label: '修订更新', hint: '修复问题或小幅调整' },
      { value: 'MINOR', label: '功能更新', hint: '新增成员或调整分工' },
      { value: 'MAJOR', label: '重大更新', hint: '重大改动或不兼容变更' }
    ],
    historySubtitle: '每次审核通过生成一版专家团配置快照；同一时间只能启用一个版本',
    delistTerm: '禁用',
    relistTerm: '启用',
    activeLabel: '已启用',
    delistConfirmText: (r, ver) => `禁用「${row.name}」的 ${ver}？`,
    relistConfirmText: (r, ver) => `启用「${row.name}」的 ${ver}？`,
    guardLastActive: true,
    lastActiveTip: '当前版本是该专家团最后一个启用版本。如需停止对外提供，请先整体下架专家团。',
    exclusiveActive: true,
    withdrawText: () => '撤回本次提交后将回到修改前状态。确认撤回？'
  }
})
async function onVersionDone() {
  await fetchList()
  const id = versionRow.value?.id
  if (id) versionRow.value = rows.value.find((r) => r.id === id) || versionRow.value
}

/* ---------- 撤回 / 删除 / 停用（含强制回收勾选） ---------- */
const busyId = ref(null)

async function withdrawFromList(row) {
  if (busyId.value != null) return
  try {
    await ElMessageBox.confirm(`「${row.name}」当前处于审核中。撤回后回到修改前状态。`, '撤回审核申请', {
      type: 'warning',
      confirmButtonText: '撤回申请'
    })
  } catch {
    return
  }
  busyId.value = row.id
  try {
    await withdrawTeam(row.id)
    ElMessage.success('审核申请已撤回')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  } finally {
    busyId.value = null
  }
}

async function onDelete(row) {
  if (busyId.value != null) return
  try {
    await ElMessageBox.confirm(
      `删除「${row.name}」后会解除 ${row.memberCount ?? 0} 位成员专家的引用，专家本体不受影响。确认删除？`,
      '删除专家团',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  busyId.value = row.id
  try {
    await deleteTeam(row.id)
    ElMessage.success('专家团已删除')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    busyId.value = null
  }
}

/* ---------- 停用（点【停用】开 DeactivateDialog；强制回收是弹窗里的勾选项，同走审核，PRD §二.3.5 / §二.3.6） ---------- */
const stopTarget = ref(null) // 当前停用弹窗对应的行；null = 弹窗关闭
const stopDialogVisible = computed({
  get: () => stopTarget.value != null,
  set: (v) => { if (!v) stopTarget.value = null }
})
function stopTeam(row) {
  if (busyId.value != null) return
  stopTarget.value = row
}
async function confirmStop({ forceRevoke, reason }) {
  const row = stopTarget.value
  if (!row || busyId.value != null) return
  busyId.value = row.id
  try {
    await unpublishTeam(row.id, { forceRevoke, reason })
    ElMessage.success(forceRevoke ? '已提交强制回收审核' : '已提交停用审核')
    stopTarget.value = null
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || (forceRevoke ? '提交强制回收失败' : '提交停用失败'))
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="etp" data-testid="expert-team-panel">
    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索团名、介绍或分类"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.type" placeholder="全部团类型" clearable class="lt-filter" @change="reload">
        <el-option v-for="t in TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <el-select v-model="query.category" placeholder="全部分类" clearable class="lt-filter" @change="reload">
        <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
      </el-select>
      <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter" @change="reload">
        <el-option v-for="o in STATE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" data-testid="team-create-btn" @click="openCreate">＋ 新建专家团</el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap" v-loading="loading">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="还没有专家团，点击「新建专家团」创建第一个"
        @retry="fetchList"
      >
        <el-table :data="rows" style="width: 100%" row-key="id">
          <el-table-column label="团名" :min-width="COL.NAME_MIN">
            <template #default="{ row }">
              <span class="etp-primary">
                <span class="etp-avatar">
                  <img v-if="iconIsUrl(row.avatar)" :src="row.avatar" alt="" class="etp-avatar-img" />
                  <span v-else>{{ row.avatar || '☆' }}</span>
                </span>
                <a class="etp-name" :title="row.name" @click="openEdit(row)">{{ row.name }}</a>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" :width="COL.STATUS + 110" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <StatusTag :type="displayView(row).tagType">{{ displayView(row).label }}</StatusTag>
              <RevokedTag :info="row.revoked" />
              <!-- 缺员：已发布且有成员不再可用（md §四）；悬停列出成员名与原因 -->
              <el-tooltip
                v-if="row.status === 'published' && row.missingCount > 0"
                :content="row.missing.map((m) => `${m.name}：${m.reason}`).join('；')"
                placement="top"
              >
                <span class="etp-missing" data-testid="team-missing-tag">缺员 {{ row.missingCount }}</span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="团类型" :width="COL.TAG + 16" align="center" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">{{ TEAM_TYPE_LABEL[row.type] || row.type }}</template>
          </el-table-column>
          <el-table-column label="团介绍" :min-width="COL.DESC_MIN" show-overflow-tooltip>
            <template #default="{ row }">{{ row.intro || '—' }}</template>
          </el-table-column>
          <el-table-column label="分类" :width="COL.TAG" align="center" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <span v-if="row.category">{{ row.category }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>
          <el-table-column label="专家数" :width="COL.COUNT" align="center" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">{{ row.memberCount }}</template>
          </el-table-column>
          <el-table-column label="引用情况" :width="COL.COUNT + 24" align="center" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <template v-if="row.type === EXPERT_TYPE.POSITION">
                <span v-if="row.positionCount > 0">{{ row.positionCount }}个岗位引用</span>
                <span v-else class="cell-na">暂无引用</span>
              </template>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>
          <el-table-column label="最新版本" :width="COL.TAG" align="center" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #default="{ row }">
              <span v-if="row.latestVersionLabel">{{ row.latestVersionLabel }}</span>
              <span v-else class="cell-na">{{ NA }}</span>
            </template>
          </el-table-column>
          <el-table-column :width="COL.TIME" class-name="col-nowrap" label-class-name="col-nowrap">
            <template #header>
              <button type="button" class="etp-time-sort" @click="toggleSort">
                最近更新时间 <span class="etp-sort-arrow">{{ sortArrow }}</span>
              </button>
            </template>
            <template #default="{ row }">
              <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>
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

                <el-button v-if="isReviewing(row)" link type="warning" :loading="busyId === row.id" @click="withdrawFromList(row)">撤回</el-button>

                <template v-else-if="row.status === 'draft'">
                  <el-button link type="primary" data-testid="team-publish-btn" @click="onPublishClick(row)">发布</el-button>
                  <el-button link type="danger" title="删除前需二次确认" :loading="busyId === row.id" @click="onDelete(row)">删除</el-button>
                </template>

                <template v-else>
                  <el-button link type="warning" :loading="busyId === row.id" @click="stopTeam(row)">停用</el-button>
                  <el-button link type="primary" @click="onPublishClick(row)">版本管理</el-button>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" @change="fetchList" />

    <ExpertTeamEditor
      v-model:visible="editorVisible"
      :team-id="editingId"
      :readonly="editorReadonly"
      @saved="onEditorSaved"
      @publish="onEditorPublish"
    />

    <!-- 停用确认弹窗：含「强制回收」勾选项，两种停用都走审核（PRD §二.3.5 / §二.3.6） -->
    <DeactivateDialog
      v-model="stopDialogVisible"
      type-label="专家团"
      holder-text="已召唤该专家团的员工"
      :name="stopTarget?.name || ''"
      :plain-message="`停用「${stopTarget?.name || ''}」需提交审核。审核通过前客户端仍可使用。`"
      confirm-text="提交停用审核"
      :ref-count="0"
      :submitting="busyId != null && busyId === stopTarget?.id"
      @confirm="confirmStop"
    />

    <VersionDrawer v-model="versionDlgVisible" :adapter="versionAdapter" @done="onVersionDone" />
  </div>
</template>

<style scoped>
/* 面板根只是个挂载点：display:contents 让工具栏 / 表格 / 分页直接成为 .list-page 的 flex 子项，间距与专家视图一致 */
.etp {
  display: contents;
}
.etp-primary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.etp-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  font-size: 18px;
  line-height: 1;
  border-radius: 8px;
  background: var(--bg-sunken);
  overflow: hidden;
}
.etp-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.etp-name {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--c-primary, #409eff);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.etp-name:hover {
  text-decoration: underline;
}
.etp-missing {
  display: inline-flex;
  align-items: center;
  margin-left: var(--space-1);
  padding: 0 var(--space-2);
  font-size: var(--fs-xs);
  line-height: 20px;
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  background: var(--c-danger-soft, rgba(245, 108, 108, 0.12));
  cursor: default;
}
.etp-time-sort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: none;
  color: var(--c-text-base);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  cursor: pointer;
}
.etp-time-sort:hover {
  color: var(--c-accent);
}
.etp-sort-arrow {
  font-size: 12px;
}
</style>
