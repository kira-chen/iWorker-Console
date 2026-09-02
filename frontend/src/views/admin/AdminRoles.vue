<script setup>
/**
 * 角色与权限页（ADMIN 专属；2026-09-01 PRD 对齐改造，基准=prd md + 交互原型 v2 renderRoles L305）。
 *
 * 【本轮对齐要点】
 * - 页面说明：「…就能进入哪些页面」。
 * - 工具栏补「搜索角色名称」搜索框 + 【查询】（回车同效）。角色量级恒小且不分页，搜索为**本地过滤**
 *   （点查询/回车才生效，输入不实时过滤——与原型 role-query 口径一致）。
 * - 列：角色名称 / 用户数量（「N 个用户」）/ 页面权限 / 最近更新时间（排序，默认倒序）/ 操作；
 *   删「创建时间」列；userCount 由 mock 提供。
 * - 页面权限列（原型 roleScopeLines）：用户端整支勾中即「√ 用户端」无明细；管理端明细＝**纯页面名**
 *   「、」串接（去分组前缀与 /）。权限树加载失败 → 权限列统一显「未开通任何页面」（不再显裸 code）。
 * - 删除分流（原型 role-delete）：userCount>0 → 提示窗「无法删除角色」单按钮【知道了】；
 *   否则普通二次确认【删除】(danger)；toast「角色已删除」。
 * - 空态「还没有角色，点击「新建角色」创建第一个」。
 * - 权限模型 2026-09-01 起为页面名绑定（见 adminUserMock.js 头注释），树形态=原型 permissionGroups。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import RoleEditor from '@/components/admin/RoleEditor.vue'
import { listRoles, getPermissionTree, deleteRole } from '@/api/adminUser'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import { fmtTime } from '@/utils/docMeta'

// 取数编排统一走 useAdminList（列表页规范）。角色量级恒定极小（个位数）且 mock 已按
// 更新时间倒序返回全量，故 paged:false —— 不分页也不下发 page/size（Y/J 拍板：角色页保持不分页）。
const list = useAdminList(listRoles, {
  paged: false,
  mapRow: (rows) => rows.map((r) => ({ ...r, modules: (r.modules || []).filter(Boolean) }))
})
const { rows, loading, loadError, isEmpty } = list
const fetchList = list.reload

/* ---------- 本地搜索（点【查询】/回车才生效）+ 最近更新时间排序（默认倒序） ---------- */
const keyword = ref('')
const appliedKeyword = ref('')
const sortDir = ref('desc')

function applySearch() {
  appliedKeyword.value = keyword.value.trim().toLowerCase()
}
function onClearSearch() {
  keyword.value = ''
  applySearch()
}
function onSortChange({ prop, order }) {
  if (prop !== 'updatedAt') return
  sortDir.value = order === 'ascending' ? 'asc' : 'desc'
}

const displayRows = computed(() => {
  const kw = appliedKeyword.value
  const filtered = kw ? rows.value.filter((r) => String(r.name || '').toLowerCase().includes(kw)) : rows.value
  return [...filtered].sort((a, b) =>
    sortDir.value === 'desc'
      ? String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      : String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
  )
})
// 「真的没数据」与「筛选无结果」共用同一引导空态（本页统一文案）
const showEmpty = computed(() => isEmpty.value || (!loading.value && !loadError.value && !displayRows.value.length))

/* ---------- 权限树（原型 permissionGroups 形态：[{ scope, groups:[{ name, pages[] }] }]） ---------- */
const permissionTree = ref([])

async function loadPermissionTree() {
  try {
    const data = await getPermissionTree()
    permissionTree.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    // 权限树读失败：列表仍可列角色。权限列因无树可对照 → scopeLines 恒空 → 统一显「未开通任何页面」
    // （2026-09-01 拍板：不再回显裸权限标识）；编辑抽屉内保持其自身失败态文案。
    permissionTree.value = []
  }
}

onMounted(() => {
  fetchList()
  loadPermissionTree()
})

/**
 * 页面权限列（原型 roleScopeLines）：按权限树顺序聚合成分支列表。
 * - 用户端：整支任一页面勾中即「√ 用户端」，无明细（原型口径：用户端不展开子页面）；
 * - 管理端：明细＝已开通**纯页面名**「、」串接（去分组前缀与 /）。
 */
function scopeLines(modules) {
  const owned = new Set(modules || [])
  const lines = []
  for (const scope of permissionTree.value) {
    const pages = (scope.groups || []).flatMap((g) => g.pages || []).filter((p) => owned.has(p))
    if (!pages.length) continue
    if (scope.scope === '管理端') lines.push({ scope: scope.scope, detail: pages.join('、') })
    else lines.push({ scope: scope.scope, detail: '' })
  }
  return lines
}

/* ---------- 编辑抽屉 ---------- */
const editorVisible = ref(false)
const editingRole = ref(null)

function openCreate() {
  editingRole.value = null
  editorVisible.value = true
}
function openEdit(row) {
  editingRole.value = { ...row }
  editorVisible.value = true
}
function onSaved() {
  editorVisible.value = false
  fetchList()
}

/* ---------- 删除（原型 role-delete 分流：有绑定用户 → 提示窗；否则二次确认） ---------- */
const busy = ref({})

async function remove(row) {
  const userCount = row.userCount ?? 0
  if (userCount > 0) {
    // 有用户绑定：提示窗（单按钮【知道了】，不执行删除——J4 拍板按原型）
    await ElMessageBox.alert(
      `角色「${row.name}」仍绑定 ${userCount} 个用户。请先在用户页完成角色改绑。`,
      '无法删除角色',
      { confirmButtonText: '知道了' }
    ).catch(() => {})
    return
  }
  try {
    await ElMessageBox.confirm(
      `删除后角色「${row.name}」及其页面权限将不可恢复。确认删除？`,
      '删除角色',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  busy.value = { ...busy.value, [row.id]: 'delete' }
  try {
    await deleteRole(row.id)
    ElMessage.success('角色已删除')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    const next = { ...busy.value }
    delete next[row.id]
    busy.value = next
  }
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="角色与权限" subtitle="角色与页面绑定：勾中哪些页面，持该角色的用户就能进入哪些页面" />

    <!-- 工具栏：搜索角色名称 + 【查询】（回车同效，本地过滤）；右端「新建角色」 -->
    <ListToolbar>
      <el-input
        v-model="keyword"
        placeholder="搜索角色名称"
        clearable
        class="lt-search"
        @keyup.enter="applySearch"
        @clear="onClearSearch"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button @click="applySearch">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">＋ 新建角色</el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="showEmpty"
        empty-text="还没有角色，点击「新建角色」创建第一个"
        @retry="fetchList"
      >
        <el-table
          v-loading="loading"
          :data="displayRows"
          row-key="id"
          :default-sort="{ prop: 'updatedAt', order: 'descending' }"
          @sort-change="onSortChange"
        >
        <!-- 角色名称：主列。code 不展示——它只是系统内标识，创建/编辑都不填 -->
        <el-table-column label="角色名称" :min-width="COL.NAME_MIN" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="rl-name">{{ row.name }}</span>
          </template>
        </el-table-column>

        <!-- 用户数量（原型「N 个用户」口径；删除分流依据） -->
        <el-table-column label="用户数量" :width="COL.COUNT + 20" align="center">
          <template #default="{ row }">{{ row.userCount ?? 0 }} 个用户</template>
        </el-table-column>

        <!-- 页面权限：仅展示已开通项。用户端整支无明细；管理端明细=纯页面名「、」串接 -->
        <el-table-column label="页面权限" :min-width="360">
          <template #default="{ row }">
            <div v-if="scopeLines(row.modules).length" class="rl-perms">
              <div v-for="line in scopeLines(row.modules)" :key="line.scope" class="rl-perm-line">
                <span class="rl-perm-check" aria-hidden="true">√</span>
                <span class="rl-perm-scope">{{ line.scope }}</span>
                <span v-if="line.detail" class="rl-perm-detail">（{{ line.detail }}）</span>
              </div>
            </div>
            <span v-else class="cell-na">未开通任何页面</span>
          </template>
        </el-table-column>

        <!-- 最近更新时间：可排序，默认倒序（改名或改页面权限都刷新） -->
        <el-table-column label="最近更新时间" prop="updatedAt" sortable="custom" :width="COL.TIME">
          <template #default="{ row }">
            <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
            <span v-else class="cell-na">—</span>
          </template>
        </el-table-column>

        <!-- 操作：编辑 / 删除（删除前分流二次确认） -->
        <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
          <template #default="{ row }">
            <div class="tbl-ops">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <span class="tbl-ops-sep" aria-hidden="true"></span>
              <el-button
                link
                type="danger"
                title="删除前需二次确认"
                :loading="busy[row.id] === 'delete'"
                @click="remove(row)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
        </el-table>
      </ListStates>
    </div>

    <RoleEditor
      v-model:visible="editorVisible"
      :role="editingRole"
      :permission-tree="permissionTree"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.rl-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}

/* 页面权限单元格：一支一行（用户端 / 管理端），行内「√ 分支（页面、…）」 */
.rl-perms {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1) 0;
}
.rl-perm-line {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  line-height: 1.5;
  font-size: var(--fs-sm);
}
/* 勾号弱化为辅助色：它是「已开通」的标记，不该盖过页面名本身 */
.rl-perm-check {
  flex-shrink: 0;
  color: var(--c-success, #059669);
  font-weight: var(--fw-semibold);
}
.rl-perm-scope {
  flex-shrink: 0;
  color: var(--c-text-strong);
}
/* 明细（页面名）用弱色 + 允许换行：一个角色开十几页时不该把行撑爆 */
.rl-perm-detail {
  color: var(--c-text-faint);
  word-break: break-word;
}
</style>
