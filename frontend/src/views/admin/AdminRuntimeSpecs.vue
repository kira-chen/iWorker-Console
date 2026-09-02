<script setup>
/**
 * 运行规格列表页（04运行 › 运行规格，2026-09-02 启动轮）。
 *
 * 基准 = 负责人提供的交互截图（04运行 无 prd md 与原型 render）；标准件拼装：
 * PageHeader + 说明条（D17 口径）+ ListToolbar（右侧新建）+ ListStates + el-table（COL 列宽）
 * + 底部汇总「N 个规格 · M 个用户已配置」+ ListPagination + RuntimeSpecEditor 抽屉（DrawerEditor 收壳）。
 *
 * 列（照截图 + 2026-09-02 修正：绑定对象=用户、不设默认规格）：规格（名称+能力边界说明两行）|
 * CPU / 内存 | 临时磁盘 | 任务超时 | 空闲回收 | 并发 | 出网（允许绿/禁止红）|
 * 在用用户（数量 + 需审批/已审批 标签，悬停用户名单）| 操作。短期版本为每个用户分配 Pod。
 *
 * 删除护栏（mock 同口径）：被用户使用不可删（提示窗携用户名单）。
 */
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import RuntimeSpecEditor from '@/components/admin/RuntimeSpecEditor.vue'
import { listRuntimeSpecs, deleteRuntimeSpec } from '@/api/runtimeSpec'
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import '@/assets/connector.css'

const list = useAdminList(listRuntimeSpecs)
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list
const fetchList = list.reload

// 底部汇总（mock 出参 summary；读失败降级隐藏）
const summary = ref(null)
async function loadSummary() {
  try {
    const data = await listRuntimeSpecs()
    summary.value = data?.summary || null
  } catch (e) {
    summary.value = null
  }
}

function refresh() {
  fetchList()
  loadSummary()
}

onMounted(refresh)

/* ---------- 抽屉（新建 / 编辑共用 RuntimeSpecEditor） ---------- */
const editorVisible = ref(false)
const editingId = ref(null)

function openCreate() {
  editingId.value = null
  editorVisible.value = true
}
function openEdit(row) {
  editingId.value = row.id
  editorVisible.value = true
}

/* ---------- 删除（护栏拦截 → 提示窗；可删 → 危险确认） ---------- */
const busyId = ref(null)

async function remove(row) {
  if (busyId.value != null) return
  // 前置护栏与 mock 同口径（mock 仍兜底），拦截窗单按钮【知道了】
  if (row.usedCount > 0) {
    ElMessageBox.alert(
      `该规格正在被 ${row.usedCount} 个用户使用（${row.usedUsers.map((u) => u.name).join('、')}），需先为这些用户改配其他规格后再删除。`,
      '无法删除规格',
      { confirmButtonText: '知道了', type: 'warning' }
    ).catch(() => {})
    return
  }
  try {
    await ElMessageBox.confirm(
      `删除后规格「${row.name}」将不可再分配给用户，已运行实例不受影响。确认删除？`,
      '删除规格',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  busyId.value = row.id
  try {
    await deleteRuntimeSpec(row.id)
    ElMessage.success('规格已删除')
    refresh()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败，请稍后重试')
  } finally {
    busyId.value = null
  }
}

/* ---------- 展示派生 ---------- */
// 在用用户悬停名单（含审批态后缀）
function usedTip(row) {
  if (!row.usedCount) return ''
  return row.usedUsers
    .map((u) => (u.approval ? `${u.name}（${u.approval === 'APPROVED' ? '已审批' : '待审批'}）` : u.name))
    .join('、')
}
</script>

<template>
  <div class="list-page">
    <PageHeader title="运行规格" subtitle="管理员定义规格，FDE 只选规格、不填技术参数。" />

    <!-- 说明条（D17 口径）：能力边界说明是 FDE 唯一可见内容；短期版本按用户分配 Pod -->
    <div class="rs-note">
      管理员在这里定义规格，为每个用户分配 Pod 运行环境；FDE 只看到<b>规格名 + 能力边界说明</b>，看不到任何技术参数。「能力边界说明」是必填字段——它是 FDE 唯一能看到的内容。
    </div>

    <ListToolbar>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">＋ 新建规格</el-button>
      </template>
    </ListToolbar>

    <div class="rs-card">
      <div class="rs-card-title">运行规格模板</div>
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="还没有运行规格 · 点「新建规格」创建第一个"
        @retry="refresh"
      >
        <el-table v-loading="loading" :data="rows" row-key="id">
          <!-- 规格：名称 + 第二行能力边界说明（截图两行式主列） -->
          <el-table-column label="规格" :min-width="COL.DESC_MIN">
            <template #default="{ row }">
              <div class="rs-name">{{ row.name }}</div>
              <div class="rs-desc" :title="row.boundaryDesc">{{ row.boundaryDesc }}</div>
            </template>
          </el-table-column>
          <el-table-column label="CPU / 内存" width="110">
            <template #default="{ row }">
              <span class="rs-muted">{{ row.cpu }}c / {{ row.memoryGi }}Gi</span>
            </template>
          </el-table-column>
          <el-table-column label="临时磁盘" width="92">
            <template #default="{ row }"><span class="rs-muted">{{ row.diskGi }}Gi</span></template>
          </el-table-column>
          <el-table-column label="任务超时" width="92">
            <template #default="{ row }"><span class="rs-muted">{{ row.timeoutMin }} min</span></template>
          </el-table-column>
          <el-table-column label="空闲回收" width="92">
            <template #default="{ row }"><span class="rs-muted">{{ row.idleRecycleMin }} min</span></template>
          </el-table-column>
          <el-table-column label="并发" :width="COL.COUNT" align="center">
            <template #default="{ row }">{{ row.concurrency }}</template>
          </el-table-column>
          <el-table-column label="出网" :width="COL.STATUS">
            <template #default="{ row }">
              <StatusTag :type="row.egress === 'ALLOW' ? 'success' : 'danger'">
                {{ row.egress === 'ALLOW' ? '允许' : '禁止' }}
              </StatusTag>
            </template>
          </el-table-column>
          <!-- 在用用户：数量 + 需审批/已审批 标签，悬停用户名单 -->
          <el-table-column label="在用用户" width="132">
            <template #default="{ row }">
              <span class="rs-used-cell" :title="usedTip(row)">
                <span>{{ row.usedCount }}</span>
                <StatusTag v-if="row.approvalSummary === 'PENDING'" type="warning">需审批</StatusTag>
                <StatusTag v-else-if="row.approvalSummary === 'APPROVED'" type="success">已审批</StatusTag>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="opsWidth(2)" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" :loading="busyId === row.id" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 底部：左汇总「N 个规格 · M 个用户已配置」+ 标准分页 -->
        <div class="rs-foot">
          <span v-if="summary" class="rs-foot-sum">
            {{ summary.specCount }} 个规格 · {{ summary.userCount }} 个用户已配置
          </span>
          <span class="rs-foot-sp"></span>
          <ListPagination v-model:page="page" :page-size="pageSize" :total="total" @change="fetchList" />
        </div>
      </ListStates>
    </div>

    <RuntimeSpecEditor v-model:visible="editorVisible" :spec-id="editingId" @saved="refresh" />
  </div>
</template>

<style scoped>
/* 说明条：信息级提示（承接截图顶部 note 形态，用站内令牌） */
.rs-note {
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text-muted);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-left: 3px solid var(--c-success);
  border-radius: var(--radius-sm);
}
.rs-note b {
  color: var(--c-text-strong);
}
.rs-card {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  overflow: hidden;
}
.rs-card-title {
  padding: var(--space-3) var(--space-4);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  border-bottom: 1px solid var(--border-soft);
}
.rs-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.rs-desc {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-muted {
  color: var(--c-text-muted);
}
.rs-used-cell {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.rs-foot {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border-soft);
}
.rs-foot-sum {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.rs-foot-sp {
  flex: 1;
}
</style>
