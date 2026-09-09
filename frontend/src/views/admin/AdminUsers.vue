<script setup>
/**
 * 用户管理页（ADMIN 专属，P5）。
 *
 * 表格（服务端分页 + 关键字搜索 + 角色过滤 + 状态过滤），列：用户名/显示名/邮箱/角色/状态/最近登录时间。
 * 操作：建用户 / 编辑（displayName/email/启停）/ 物理删（二次确认，不可恢复）/ 设置角色（多选弹窗）/ 重置密码（二次确认）。
 * 护栏错误（如删最后一个 ADMIN）走 message 提示（写接口 skipGlobalError）。
 *
 * 2026-09-01 PRD 对齐（原型 renderUsers L228）：第六列「创建时间」→「最近登录时间」（从未登录显
 * 「从未登录」、列头可排序默认倒序、从未登录恒排最后——mock 侧比较器口径）；每页条数按窗口高度
 * 动态计算（2026-09-08 原型复刻批次 1，原每页 10 条废止）；「更多」删除项文案「删除用户」；重置密码确认带独立一行「默认密码：wemate123」。
 * 其余交互（Y1-Y8）保持现状。数据走 adminUserMock（api 层分流，VITE_ORG_MOCK=0 关闭）。
 *
 * 2026-09-08 原型复刻批次 2A（G#1/#3/#4，原型 renderUsers L238）：工具栏补【查询】（回第 1 页）、搜索占位
 * 「搜索用户名、显示名或邮箱」（0908 md §一.1）、【＋ 新建用户】文案；两种空态（无筛选「还没有用户 · 点「＋ 新建用户」
 * 创建第一个」= md 口径 / 有筛选「没有符合条件的用户」= 原型）；用户名加粗、角色灰标签、状态「圆点 + 文字」；
 * 列头排序回第 1 页（原型 user-sort 置 userPage=1）。
 *
 * 页面骨架照抄连接器范式（conn.css 共享类 + 单行 toolbar）；取数编排走 useAdminList，
 * 失败/空态走 ListStates、分页走 ListPagination（列表页规范，2026-08-22 统一）。
 */
import { h, ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/composables/useConfirm'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import UserEditor from '@/components/admin/UserEditor.vue'
import UserRoleDialog from '@/components/admin/UserRoleDialog.vue'
import { listUsers, deleteUser, resetUserPassword, listRoles } from '@/api/adminUser'
import { fmtTime } from '@/utils/docMeta'
import '@/assets/connector.css'
// 操作列宽走共享 opsWidth；数据列宽照原型 colgroup（见模板注释，2026-09-08 原型复刻批次 2A）
import { opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'

// sort：最近登录时间排序方向（原型 userSort，默认倒序；「从未登录」恒排最后由 mock 承担）
const query = reactive({ keyword: '', roleCode: '', status: '', sort: 'desc' })

// 取数编排统一走 useAdminList（列表页规范，见 docs/frontend/规范-管理后台列表页.md）：
// 四态 / 分页 / 空筛选项过滤 / 防空页回退 / 竞态防护均由其承担，本页只描述「取什么」。
// 每页条数按窗口高度动态计算（2026-09-08 原型复刻批次 1 · G#2，原「每页 10 条」覆盖已移除，全站统一）
const list = useAdminList(listUsers, { params: () => ({ ...query }) })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list

// 角色选项（供过滤下拉 + 编辑/设置角色弹窗复用）
const roleOptions = ref([])

const editorVisible = ref(false)
const editingUser = ref(null)
const roleDlgVisible = ref(false)
const roleDlgUser = ref(null)
const delBusy = ref(null)
const resetBusy = ref(null)
// 当前展开【更多】菜单的行 id：驱动箭头 ▾/▴ 翻转（md §二.2.4）
const moreOpenId = ref(null)

// 取数 / 回第 1 页 / 翻页均由 useAdminList 提供：fetchList=list.reload、reload=list.search、翻页=list.goPage
const fetchList = list.reload
const reload = list.search

async function loadRoles() {
  try {
    const data = await listRoles()
    // 兼容：list 或直接数组
    roleOptions.value = (Array.isArray(data) ? data : data?.list || []).map((r) => ({
      code: r.code,
      name: r.name || r.code
    }))
  } catch (e) {
    /* 角色选项读失败：过滤/多选降级为空，不阻断用户列表 */
  }
}

onMounted(() => {
  fetchList()
  loadRoles()
})

// 关键词实时搜索：300ms 防抖 → reload
let kwTimer = null
watch(
  () => query.keyword,
  () => {
    if (kwTimer) clearTimeout(kwTimer)
    kwTimer = setTimeout(reload, 300)
  }
)
onBeforeUnmount(() => {
  if (kwTimer) clearTimeout(kwTimer)
})

// 角色名映射：把行上的 roleCodes[] 渲染成中文角色名标签
function roleLabel(code) {
  return roleOptions.value.find((r) => r.code === code)?.name || code
}
function rowRoleCodes(row) {
  // 后端序列化字段恒为 roles(string[])（camelCase 裸数组），无 snake_case / 对象形态
  return Array.isArray(row.roles) ? row.roles : []
}

function openCreate() {
  editingUser.value = null
  editorVisible.value = true
}
function openEdit(row) {
  editingUser.value = { ...row, roleCodes: rowRoleCodes(row) }
  editorVisible.value = true
}
function openRoleDialog(row) {
  roleDlgUser.value = { ...row, roleCodes: rowRoleCodes(row) }
  roleDlgVisible.value = true
}
function onSaved() {
  editorVisible.value = false
  // 新建常在首页，回第 1 页刷新
  reload()
}
function onRoleSaved() {
  fetchList()
}

// 删除：文案照 md §二.2.6 / 原型 L261（显示名为空时用用户名）；统一 440px 无图标确认框，确认键保留 danger 红档（md 要求危险样式）
async function remove(row) {
  const ok = await confirmDialog(
    `删除「${row.displayName || row.username}」后，其角色、登录会话、个人文档、任务、记忆及凭证将被永久删除，且无法恢复。`,
    '删除用户',
    { confirmText: '删除', danger: true }
  )
  if (!ok) return
  delBusy.value = row.id
  try {
    await deleteUser(row.id)
    ElMessage.success('用户已删除')
    // 末页删最后一条时的页码回退由 useAdminList 内部处理（防空页），此处直接重拉
    fetchList()
  } catch (e) {
    // 护栏错误（如删最后一个 ADMIN）按后端 message 提示
    ElMessage.error(e?.message || '删除失败')
  } finally {
    delBusy.value = null
  }
}

async function resetPassword(row) {
  // 2026-09-01 对齐原型 user-reset modal：正文 + 独立一行「默认密码：wemate123」（.password-copy 灰底行），按钮【重置密码】。
  // 用 VNode 构造两行内容（不用 dangerouslyUseHTMLString——显示名是用户数据，避免注入）。统一 440px 无图标确认框。
  const ok = await confirmDialog(
    h('div', null, [
      h('p', { style: 'margin:0' }, `确认将「${row.displayName || row.username}」的密码重置为默认密码？`),
      h('p', { class: 'users-reset-pwd' }, ['默认密码：', h('code', null, 'wemate123')])
    ]),
    '重置密码',
    { confirmText: '重置密码' }
  )
  if (!ok) return
  resetBusy.value = row.id
  try {
    await resetUserPassword(row.id)
    ElMessage.success('密码已重置为 wemate123')
  } catch (e) {
    ElMessage.error(e?.message || '重置失败')
  } finally {
    resetBusy.value = null
  }
}

// 「更多」下拉命令分发：重置密码 / 删除用户
function onMoreCommand(cmd, row) {
  if (cmd === 'reset') resetPassword(row)
  else if (cmd === 'delete') remove(row)
}

// 「最近登录时间」列排序（el-table sortable="custom" → mock 排序）；order=null 回落默认倒序。
// 切换排序回第 1 页（原型 L261 user-sort：state.userPage=1）
function onSortChange({ prop, order }) {
  if (prop !== 'lastLogin') return
  query.sort = order === 'ascending' ? 'asc' : 'desc'
  reload()
}

// 两种空态（原型只有「没有符合条件的用户」一种；md §一.3 / §二.4 只定义「还没有用户 · …」）：
// 有任一搜索 / 筛选条件 → 原型文案（是条件问题，不是没数据）；无条件 → md 引导文案
const hasFilter = computed(() => !!(query.keyword.trim() || query.roleCode || query.status))
const emptyText = computed(() =>
  hasFilter.value ? '没有符合条件的用户' : '还没有用户 · 点「＋ 新建用户」创建第一个'
)
</script>

<template>
  <div class="list-page">
    <PageHeader title="用户" subtitle="管理平台账号、角色分配与密码重置" />

    <!-- 单行 toolbar（原型 L238 .module-toolbar）：搜索 → 角色筛选 → 状态筛选 → 【查询】 → spacer → 【＋ 新建用户】 -->
    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索用户名、显示名或邮箱"
        clearable
        class="lt-search"
        @keyup.enter="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <!-- 角色筛选占位文案：md §一.1「默认展示"全部用户分类"」（2026-09-09 PRD-20260908
           复核批次 0 · G7 改正，原写「全部角色」） -->
      <el-select
        v-model="query.roleCode"
        placeholder="全部用户分类"
        clearable
        class="lt-filter"
        @change="reload"
      >
        <el-option
          v-for="r in roleOptions"
          :key="r.code"
          :label="r.name"
          :value="r.code"
        />
      </el-select>
      <el-select
        v-model="query.status"
        placeholder="全部状态"
        clearable
        class="lt-filter"
        @change="reload"
      >
        <el-option label="启用" value="active" />
        <el-option label="停用" value="disabled" />
      </el-select>
      <!-- 【查询】（原型 L720 user-query：回第 1 页刷新；与输入防抖 / 下拉即刷新并存） -->
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">＋ 新建用户</el-button>
      </template>
    </ListToolbar>

    <div v-loading="loading" class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        :empty-text="emptyText"
        @retry="fetchList"
      >
        <!-- 列宽照原型 L238 <colgroup> 140/120/220/230/90/165/210（用户名 / 显示名 / 邮箱 / 角色 取 min-width 伸缩） -->
        <el-table
          :data="rows"
          class="users-table"
          :default-sort="{ prop: 'lastLogin', order: 'descending' }"
          @sort-change="onSortChange"
        >
          <!-- 用户名加粗（原型 td.user-name 600） -->
          <el-table-column label="用户名" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="users-name">{{ row.username }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="displayName" label="显示名" min-width="120" show-overflow-tooltip />
          <el-table-column prop="email" label="邮箱" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.email || '—' }}</template>
          </el-table-column>
          <!-- 角色：灰标签（原型 .tag.gray），多角色横排换行 -->
          <el-table-column label="角色" min-width="230">
            <template #default="{ row }">
              <span v-if="!rowRoleCodes(row).length" class="users-muted">—</span>
              <div v-else class="users-role-tags">
                <StatusTag v-for="code in rowRoleCodes(row)" :key="code" type="info">
                  {{ roleLabel(code) }}
                </StatusTag>
              </div>
            </template>
          </el-table-column>
          <!-- 状态：前置 7px 圆点 + 文字（原型 .status-switch，启用绿 / 停用灰），不是标签 -->
          <el-table-column label="状态" :width="90">
            <template #default="{ row }">
              <span class="users-status" :class="{ 'is-disabled': row.status !== 'active' }">
                {{ row.status === 'active' ? '启用' : '停用' }}
              </span>
            </template>
          </el-table-column>
          <!-- 最近登录时间（2026-09-01 原「创建时间」）：可排序默认倒序；从未登录显「从未登录」且恒排最后 -->
          <el-table-column label="最近登录时间" prop="lastLogin" sortable="custom" :width="165">
            <template #default="{ row }">
              <span v-if="row.lastLogin" class="users-time">{{ fmtTime(row.lastLogin) }}</span>
              <span v-else class="users-time">从未登录</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="opsWidth(3)" fixed="right">
            <template #default="{ row }">
              <div class="users-actions">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="primary" @click="openRoleDialog(row)">设置角色</el-button>
              <!-- 重操作（重置密码/删除）收进「更多」下拉，避免常显平铺误触 -->
              <el-dropdown
                trigger="click"
                placement="bottom-end"
                @command="(cmd) => onMoreCommand(cmd, row)"
                @visible-change="(v) => (moreOpenId = v ? row.id : null)"
              >
                <el-button link type="primary" class="users-more-btn">
                  <!-- md §二.2.4：收起 ▾ / 展开 ▴ -->
                  更多<el-icon class="el-icon--right">
                    <ArrowUp v-if="moreOpenId === row.id" />
                    <ArrowDown v-else />
                  </el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="reset" :disabled="resetBusy === row.id">
                      重置密码
                    </el-dropdown-item>
                    <el-dropdown-item
                      command="delete"
                      divided
                      class="users-more-del"
                      title="删除前需二次确认"
                      :disabled="delBusy === row.id"
                    >
                      删除用户
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <ListPagination
          v-model:page="page"
          :page-size="pageSize"
          :total="total"
          @change="fetchList"
        />
      </ListStates>
    </div>

    <UserEditor
      v-model:visible="editorVisible"
      :user="editingUser"
      :role-options="roleOptions"
      @saved="onSaved"
    />
    <UserRoleDialog
      v-model:visible="roleDlgVisible"
      :user="roleDlgUser"
      :role-options="roleOptions"
      @saved="onRoleSaved"
    />
  </div>
</template>

<style scoped>
.users-table {
  width: 100%;
}
.users-muted {
  color: var(--c-text-faint);
}
/* 用户名加粗（原型 .user-name{font-weight:600;color:#26302b}） */
.users-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
/* 角色灰标签横排（原型 .role-tags{flex;gap 5;wrap}） */
.users-role-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
/* 状态圆点 + 文字（原型 .status-switch:before 7px 圆点，启用 #11a16d / 停用 #a7afab） */
.users-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.users-status::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-success);
}
.users-status.is-disabled::before {
  background: var(--c-text-faint);
}
.users-time {
  white-space: nowrap;
}
/* 操作列三个元素（编辑/设置角色/更多下拉）垂直居中对齐——
   「更多」包在 el-dropdown（inline-block 基线对齐）里，默认会比并排的 el-button 偏高，
   用 flex + align-items:center 统一压平，间距用 gap 取代原 margin。 */
.users-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.users-more-btn {
  margin-left: 0;
}
</style>

<!-- el-dropdown 菜单 / MessageBox teleport 到 body，scoped 够不到，用全局类：
     删除项危险色（默认中性，hover 才红）+ 重置密码弹窗的「默认密码」独立行 -->
<style>
/* 原型 .password-copy：margin-top 10、padding 10 12、圆角 7、灰底；code 绿色加粗 */
.users-reset-pwd {
  margin: 10px 0 0;
  padding: 10px 12px;
  background: var(--bg-sunken, #f4f6f5);
  border-radius: 7px;
  color: var(--c-text-muted);
}
.users-reset-pwd code {
  color: var(--c-accent);
  font-weight: var(--fw-bold);
}
.el-dropdown-menu__item.users-more-del {
  color: var(--c-danger);
}
.el-dropdown-menu__item.users-more-del:not(.is-disabled):hover,
.el-dropdown-menu__item.users-more-del:not(.is-disabled):focus {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
</style>
