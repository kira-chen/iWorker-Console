<script setup>
/**
 * 岗位详情 · 「业务系统」页签
 *
 * 展示当前岗位引用的已发布业务系统列表。
 * - 字段：业务系统、登录地址、业务页、最近更新时间、操作
 * - 行内操作：【查看】（右侧抽屉，只读模式）
 * - 新增引用：点击【＋ 新业务系统】打开引用弹窗
 * - 发布规则：业务系统不参与发布阻断校验
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import { listBizSystems } from '@/api/admin'
import { NA } from '@/utils/tableLayout'
import BizSystemEditor from '@/components/admin/BizSystemEditor.vue'

const props = defineProps({
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()

// 所有已发布的业务系统列表（用于引用弹窗）
const allBizSystems = ref([])
const allBizLoading = ref(false)

// 当前岗位引用的业务系统详细信息
const referencedBizSystems = ref([])
const loading = ref(false)

// 排序
const sortOrder = ref('descending') // 'ascending' | 'descending'

// 排序箭头显示
const sortArrow = computed(() => sortOrder.value === 'descending' ? '↓' : '↑')

// 切换排序
function toggleSort() {
  sortOrder.value = sortOrder.value === 'descending' ? 'ascending' : 'descending'
  // 重新排序当前列表
  referencedBizSystems.value = sortBizSystems(referencedBizSystems.value)
}

// 引用弹窗
const refDialogVisible = ref(false)
const refDialogKeyword = ref('')
const selectedBizIds = ref([])

// 查看详情抽屉
const viewerVisible = ref(false)
const viewingId = ref(null)

// 加载所有已发布的业务系统
async function loadAllBizSystems() {
  allBizLoading.value = true
  try {
    const data = await listBizSystems({ status: 'PUBLISHED' })
    allBizSystems.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    ElMessage.error(e?.message || '加载业务系统失败')
  } finally {
    allBizLoading.value = false
  }
}

// 加载当前岗位引用的业务系统详情
async function loadReferencedBizSystems() {
  const bizIds = store.basic?.businessSystemIds || []
  if (!bizIds.length) {
    referencedBizSystems.value = []
    return
  }

  loading.value = true
  try {
    // 从所有业务系统中筛选出已引用的
    const data = await listBizSystems({ status: 'PUBLISHED' })
    const allList = Array.isArray(data) ? data : data?.list || []
    let filtered = allList.filter(item => bizIds.includes(item.id))

    // 按更新时间排序
    filtered = sortBizSystems(filtered)
    referencedBizSystems.value = filtered
  } catch (e) {
    ElMessage.error(e?.message || '加载引用列表失败')
  } finally {
    loading.value = false
  }
}

// 排序业务系统列表
function sortBizSystems(list) {
  return [...list].sort((a, b) => {
    const timeA = a.updatedAt || ''
    const timeB = b.updatedAt || ''
    return sortOrder.value === 'descending'
      ? timeB.localeCompare(timeA)
      : timeA.localeCompare(timeB)
  })
}

// 初始加载
loadReferencedBizSystems()

// 打开引用弹窗
async function openRefDialog() {
  if (props.isReadonly) return

  refDialogKeyword.value = ''
  selectedBizIds.value = []
  refDialogVisible.value = true

  // 加载所有已发布的业务系统
  await loadAllBizSystems()
}

// 引用弹窗中可选择的业务系统（已发布且未被当前岗位引用）
const availableBizSystems = computed(() => {
  const currentIds = store.basic?.businessSystemIds || []
  const kw = refDialogKeyword.value.trim().toLowerCase()

  return allBizSystems.value.filter(item => {
    // 排除已引用的
    if (currentIds.includes(item.id)) return false
    // 按名称搜索过滤
    if (kw && !item.name.toLowerCase().includes(kw)) return false
    return true
  })
})

// 确认引用
function confirmRef() {
  if (!selectedBizIds.value.length) {
    ElMessage.warning('请选择要引用的业务系统')
    return
  }

  // 更新 store.basic.businessSystemIds
  const currentIds = store.basic?.businessSystemIds || []
  const newIds = [...currentIds, ...selectedBizIds.value]
  store.basic = { ...store.basic, businessSystemIds: newIds }

  refDialogVisible.value = false

  // 重新加载引用列表
  loadReferencedBizSystems()

  ElMessage.success('引用成功')
}

// 打开查看详情抽屉（只读模式）
function viewBizSystem(row) {
  viewingId.value = row.id
  viewerVisible.value = true
}

// 业务页数量文本
function bizPagesText(row) {
  const count = row.bizPagesCount || 0
  return count > 0 ? `${count} 个` : NA
}

// 格式化更新时间（统一格式：2026-08-24 14:12）
function formatTime(time) {
  if (!time) return NA
  const d = new Date(time)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}
</script>

<template>
  <div class="pd-pane">
    <!-- 区块头 -->
    <div class="pd-list-head">
      <div class="pd-list-title">
        业务系统
        <span class="pd-list-sub">该岗位引用的已发布业务系统列表</span>
      </div>
      <el-button v-if="!isReadonly" type="primary" @click="openRefDialog">
        ＋ 新业务系统
      </el-button>
    </div>

    <!-- 引用列表 -->
    <el-table
      v-loading="loading"
      :data="referencedBizSystems"
      class="pd-table"
      empty-text="暂无引用的业务系统"
    >
      <el-table-column label="业务系统" min-width="180">
        <template #default="{ row }">
          <div class="biz-name-cell">
            <span class="biz-icon">{{ row.icon }}</span>
            <span class="biz-name">{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="登录地址" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <a :href="row.loginUrl" target="_blank" class="biz-link">{{ row.loginUrl }}</a>
        </template>
      </el-table-column>

      <el-table-column label="业务页" width="100" align="center">
        <template #default="{ row }">{{ bizPagesText(row) }}</template>
      </el-table-column>

      <el-table-column width="160">
        <!-- 自定义列头：文字按钮「最近更新时间 ↓ / ↑」，点击切换正倒序 -->
        <template #header>
          <button type="button" class="time-sort" :title="sortArrow === '↓' ? '倒序' : '正序'" @click="toggleSort">
            最近更新时间 <span class="time-sort-arrow">{{ sortArrow }}</span>
          </button>
        </template>
        <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
      </el-table-column>

      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="viewBizSystem(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 引用业务系统弹窗 -->
    <el-dialog
      v-model="refDialogVisible"
      title="引用业务系统"
      width="700px"
      :close-on-click-modal="false"
    >
      <div class="ref-dialog-content">
        <el-input
          v-model="refDialogKeyword"
          placeholder="搜索业务系统名称"
          clearable
          class="ref-search"
        />

        <div v-loading="allBizLoading" class="ref-list">
          <el-checkbox-group v-model="selectedBizIds">
            <div
              v-for="item in availableBizSystems"
              :key="item.id"
              class="ref-item"
            >
              <el-checkbox :label="item.id">
                <span class="ref-item-icon">{{ item.icon }}</span>
                <span class="ref-item-name">{{ item.name }}</span>
              </el-checkbox>
              <div class="ref-item-desc">{{ item.description }}</div>
            </div>
          </el-checkbox-group>

          <div v-if="!allBizLoading && !availableBizSystems.length" class="ref-empty">
            {{ refDialogKeyword ? '未找到匹配的业务系统' : '暂无可引用的业务系统' }}
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="refDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmRef">确认引用</el-button>
      </template>
    </el-dialog>

    <!-- 查看详情抽屉（复用连接器的 BizSystemEditor，只读模式） -->
    <BizSystemEditor
      v-model:visible="viewerVisible"
      :editing-id="viewingId"
      :readonly="true"
    />
  </div>
</template>

<style scoped>
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.pd-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.pd-list-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.pd-list-sub {
  font-size: var(--fs-sm);
  /* 2026-09-12 审计 K43：原 --fw-normal 未定义（副标题继承成粗体），令牌名为 --fw-regular */
  font-weight: var(--fw-regular);
  color: var(--c-text-muted);
}

.pd-table {
  background: var(--bg-base);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.biz-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.biz-icon {
  font-size: 18px;
  line-height: 1;
}

.biz-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}

.biz-link {
  color: var(--c-accent);
  text-decoration: none;
}

.biz-link:hover {
  text-decoration: underline;
}

/* 引用弹窗样式 */
.ref-dialog-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ref-search {
  width: 100%;
}

.ref-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

.ref-item {
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}

.ref-item:last-child {
  border-bottom: none;
}

.ref-item :deep(.el-checkbox) {
  width: 100%;
  align-items: flex-start;
}

.ref-item :deep(.el-checkbox__label) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: var(--fw-medium);
}

.ref-item-icon {
  font-size: 16px;
}

.ref-item-name {
  color: var(--c-text-strong);
}

.ref-item-desc {
  margin-left: 24px;
  margin-top: var(--space-1);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: 1.5;
}

.ref-empty {
  text-align: center;
  padding: var(--space-8) 0;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

/* 时间列排序按钮样式（对齐审核中心 UnifiedReview.vue） */
.time-sort {
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
  transition: color 0.2s;
}

.time-sort:hover {
  color: var(--c-accent);
}

.time-sort-arrow {
  font-size: 12px;
  color: var(--c-text-base);
  font-weight: var(--fw-medium);
}
</style>
