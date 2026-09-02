<script setup>
/**
 * 任务详情页（PRD §6，US-03/04/10）。
 *
 * 上方：任务概览 + 操作（立即执行 / 启停 / 编辑 / 删除）。
 * 下方：执行记录时间轴（el-timeline，倒序），每条 = ExecutionCard；
 *       最新一条默认展开（defaultOpen），其余折叠；分页「加载更多」。
 * 运行中：单条执行 5s 轮询刷新（收敛在 store），无 RUNNING/RETRYING 即停。
 */
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTaskStore } from '@/stores/task'
import { getExecution } from '@/api/task'
import { taskStatusMeta, fmtDateTime } from '@/utils/taskStatus'
import ExecutionCard from '@/components/task/ExecutionCard.vue'
import PageHeader from '@/components/PageHeader.vue'

const route = useRoute()
const router = useRouter()
const store = useTaskStore()
const {
  detail,
  detailLoading,
  detailError,
  executions,
  execTotal,
  execLoading,
  execError
} = storeToRefs(store)

const id = computed(() => route.params.id)
const statusBadge = computed(() =>
  detail.value ? taskStatusMeta(detail.value.status, detail.value) : null
)
const hasMore = computed(() => executions.value.length < execTotal.value)
const enabled = computed(() => detail.value?.status === 'ENABLED')

// el-timeline 节点色：成功绿 / 失败红 / 运行中蓝 / 其余灰
function nodeColor(exec) {
  switch (exec.status) {
    case 'SUCCEEDED':
      return 'var(--c-success)'
    case 'FAILED':
      return 'var(--c-danger)'
    case 'RUNNING':
    case 'RETRYING':
      return 'var(--c-accent)'
    default:
      return 'var(--c-text-faint)'
  }
}

async function loadAll() {
  await store.fetchDetail(id.value)
  await store.fetchExecutions(id.value, { reset: true })
  // run-now 跳转携带 exec：置顶并轮询
  const execId = route.query.exec
  if (execId) {
    await store.afterRunNow(id.value, Number(execId))
  }
}

// 某条卡片展开请求 trace：调 §4.2 拉单条详情并回填
async function onLoadTrace(exec) {
  if (exec.trace || exec.traceLoading) return
  exec.traceLoading = true
  try {
    const fresh = await getExecution(id.value, exec.id)
    const idx = executions.value.findIndex((e) => e.id === exec.id)
    if (idx !== -1) executions.value[idx] = { ...executions.value[idx], ...fresh, traceLoading: false }
  } catch (e) {
    exec.traceLoading = false
    ElMessage.error('执行过程加载失败')
  }
}

function loadMore() {
  store.loadMoreExecutions(id.value)
}

function goEdit() {
  router.push({ name: 'TaskEdit', params: { id: id.value } })
}
function goBack() {
  router.push({ name: 'Tasks' })
}

async function onToggle() {
  const target = enabled.value ? 'DISABLED' : 'ENABLED'
  try {
    await store.toggleStatus(id.value, target)
    ElMessage.success(target === 'ENABLED' ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败，请稍后重试')
  }
}

async function onRunNow() {
  try {
    await ElMessageBox.confirm('立即执行一次该任务？', '立即执行', {
      type: 'info',
      confirmButtonText: '执行',
      cancelButtonText: '取消'
    })
  } catch (e) {
    return
  }
  try {
    const execId = await store.triggerRunNow(id.value)
    ElMessage.success('已经开始执行，正在为你查看结果')
    await store.afterRunNow(id.value, execId)
    await store.refreshDetailSilent(id.value)
  } catch (e) {
    ElMessage.error(e?.message || '触发失败，请稍后重试')
  }
}

async function onDelete() {
  try {
    await ElMessageBox.confirm(
      '删除后任务及其历史执行记录将一并移除，不可恢复。确定删除吗？',
      '删除任务',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  try {
    await store.removeTask(id.value)
    ElMessage.success('已删除')
    router.push({ name: 'Tasks' })
  } catch (e) {
    ElMessage.error(e?.message || '删除失败，请稍后重试')
  }
}

onMounted(loadAll)
onBeforeUnmount(() => store.resetDetail())
</script>

<template>
  <div class="td-page">
    <div class="td-back-row">
      <el-button link class="td-back" @click="goBack">
        <el-icon><ArrowLeft /></el-icon> 返回任务列表
      </el-button>
    </div>

    <!-- 概览 loading -->
    <div v-if="detailLoading" class="td-state">
      <el-skeleton :rows="4" animated />
    </div>
    <div v-else-if="detailError" class="td-state center">
      <el-empty description="任务加载失败" :image-size="96">
        <el-button @click="loadAll">重试</el-button>
      </el-empty>
    </div>

    <template v-else-if="detail">
      <!-- 页头：任务名 + 状态徽标 -->
      <PageHeader :title="detail.name">
        <template #actions>
          <el-tag v-if="statusBadge" size="small" :type="statusBadge.type" effect="light" round>
            {{ statusBadge.label }}
          </el-tag>
        </template>
      </PageHeader>

      <!-- 任务概览 -->
      <section class="td-overview">
        <div class="td-ov-main">
          <p v-if="detail.remark" class="td-remark">{{ detail.remark }}</p>
          <div class="td-meta">
            <span class="td-meta-item td-meta-accent">{{ detail.scheduleSummary || '—' }}</span>
            <span class="td-meta-item">执行 {{ detail.runCount ?? 0 }} 次</span>
            <span class="td-meta-item">
              最近 {{ detail.lastRunAt ? fmtDateTime(detail.lastRunAt) : '尚未执行' }}
            </span>
            <span v-if="detail.nextRunAt" class="td-meta-item">
              下次 {{ fmtDateTime(detail.nextRunAt) }}
            </span>
          </div>
        </div>
        <div class="td-ov-ops">
          <el-button type="primary" @click="onRunNow">
            <el-icon><VideoPlay /></el-icon> 立即执行
          </el-button>
          <el-button @click="onToggle">
            {{ enabled ? '停用' : '启用' }}
          </el-button>
          <el-button @click="goEdit">编辑</el-button>
          <el-button class="td-del" @click="onDelete">删除</el-button>
        </div>
      </section>

      <!-- 执行记录时间轴 -->
      <section class="td-execs">
        <div class="td-execs-head">执行记录</div>

        <div v-if="execLoading && !executions.length" class="td-state">
          <el-skeleton :rows="4" animated />
        </div>
        <div v-else-if="execError && !executions.length" class="td-state center">
          <el-empty description="执行记录加载失败" :image-size="96">
            <el-button @click="store.fetchExecutions(id, { reset: true })">重试</el-button>
          </el-empty>
        </div>
        <div v-else-if="!executions.length" class="td-state center">
          <el-empty description="该任务还没有执行过 · 立即执行一次看看结果" :image-size="96">
            <el-button type="primary" @click="onRunNow">立即执行一次验证</el-button>
          </el-empty>
        </div>

        <template v-else>
          <el-timeline class="td-timeline">
            <el-timeline-item
              v-for="(exec, i) in executions"
              :key="exec.id"
              :color="nodeColor(exec)"
              :hollow="exec.status === 'RUNNING' || exec.status === 'RETRYING'"
              placement="top"
            >
              <ExecutionCard
                :exec="exec"
                :default-open="i === 0"
                @load-trace="onLoadTrace"
              />
            </el-timeline-item>
          </el-timeline>

          <div v-if="hasMore" class="td-more">
            <el-button :loading="execLoading" @click="loadMore">加载更多</el-button>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.td-page {
  max-width: 880px;
  margin: 0 auto;
}
.td-back-row {
  margin-bottom: var(--space-2);
}
.td-back {
  color: var(--c-text-muted);
}
.td-back:hover {
  color: var(--c-accent);
}
.td-state {
  padding: var(--space-6);
}
.td-state.center {
  display: flex;
  justify-content: center;
  padding: var(--space-10) var(--space-6);
}

.td-overview {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  margin-bottom: var(--space-5);
}
.td-ov-main {
  flex: 1;
  min-width: 0;
}
.td-remark {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.td-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-3);
}
.td-meta-item {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.td-meta-accent {
  color: var(--c-accent);
  font-weight: var(--fw-medium);
}
.td-ov-ops {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  flex-shrink: 0;
}
.td-del:hover {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.td-execs {
  padding: var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.td-execs-head {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-5);
}
.td-timeline {
  padding-left: var(--space-1);
}
.td-timeline :deep(.el-timeline-item__wrapper) {
  padding-left: var(--space-5);
}
.td-more {
  display: flex;
  justify-content: center;
  margin-top: var(--space-3);
}
</style>
