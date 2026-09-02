<script setup>
/**
 * 任务列表页（PRD §5，US-02/05/06/07）。
 *
 * 展示当前用户自己的任务卡片：名称 / 周期人话 / 状态徽标 / 执行次数 / 最近执行 / 下次执行；
 * 行内操作：进详情 / 立即执行一次 / 启停 / 编辑 / 删除；顶部新建。
 * 四态全覆盖（loading 骨架 / empty / error / success）。
 * 列表轮询：存在「运行中」行时 5s 重拉列表刷新 lastRunStatus（收敛在 store）。
 */
import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTaskStore } from '@/stores/task'
import { taskStatusMeta, execStatusMeta, fmtDateTime } from '@/utils/taskStatus'
import StatusTag from '@/components/StatusTag.vue'
import PageHeader from '@/components/PageHeader.vue'

// el-tag type → StatusTag type 映射（沿用 taskStatus 既有语义色，仅做组件外观统一）
const STATUS_TAG_TYPE = { success: 'success', warning: 'warning', danger: 'danger', info: 'info', primary: 'accent', '': 'info' }
function tagType(t) {
  return STATUS_TAG_TYPE[t] || 'info'
}

const router = useRouter()
const store = useTaskStore()
const { tasks, total, page, size, listLoading, listError } = storeToRefs(store)

async function load(p) {
  await store.fetchList(p)
  store.syncListPolling()
}

function goNew() {
  router.push({ name: 'TaskNew' })
}
function goDetail(t) {
  router.push({ name: 'TaskDetail', params: { id: t.id } })
}
function goEdit(t) {
  router.push({ name: 'TaskEdit', params: { id: t.id } })
}

async function onToggle(t) {
  const target = t.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  try {
    await store.toggleStatus(t.id, target)
    ElMessage.success(target === 'ENABLED' ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败，请稍后重试')
  }
}

async function onRunNow(t) {
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
    const execId = await store.triggerRunNow(t.id)
    ElMessage.success('已经开始执行，正在为你查看结果')
    // 先静默重拉列表：run-now 触发后该行 lastRunStatus 变 RUNNING，
    // refreshListSilent 内部 syncListPolling 据此自动起列表轮询（去重，不会重复 setInterval）。
    // 这样即便随后不跳详情、留在列表页，「运行中」徽标也会随轮询自动出现/收尾，无需手动刷新。
    store.refreshListSilent()
    router.push({ name: 'TaskDetail', params: { id: t.id }, query: { exec: execId } })
  } catch (e) {
    ElMessage.error(e?.message || '触发失败，请稍后重试')
  }
}

async function onDelete(t) {
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
    await store.removeTask(t.id)
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败，请稍后重试')
  }
}

onMounted(() => load(1))
onBeforeUnmount(() => store.stopListPolling())
</script>

<template>
  <div class="tasks-page page-shell">
    <PageHeader title="定时任务" subtitle="到点自动执行，结果推回对话">
      <template #actions>
        <el-button type="primary" @click="goNew">
          <el-icon><Plus /></el-icon> 新建任务
        </el-button>
      </template>
    </PageHeader>

    <!-- loading -->
    <div v-if="listLoading && !tasks.length" class="tk-state">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- error -->
    <div v-else-if="listError" class="tk-state center">
      <el-empty description="加载失败" :image-size="96">
        <el-button @click="load(page)">重试</el-button>
      </el-empty>
    </div>

    <!-- empty -->
    <div v-else-if="!tasks.length" class="tk-state center">
      <el-empty description="还没有定时任务 · 新建第一个开始" :image-size="96">
        <el-button type="primary" @click="goNew">让搭子定时帮你办事</el-button>
      </el-empty>
    </div>

    <!-- success -->
    <template v-else>
      <ul class="tk-list">
        <li
          v-for="t in tasks"
          :key="t.id"
          class="np-row np-row--hover tk-card"
          @click="goDetail(t)"
        >
          <div class="tk-icon">
            <el-icon><Timer /></el-icon>
          </div>
          <div class="tk-main">
            <div class="tk-name-row">
              <span class="tk-name">{{ t.name }}</span>
              <StatusTag :type="tagType(taskStatusMeta(t.status, t).type)">
                {{ taskStatusMeta(t.status, t).label }}
              </StatusTag>
            </div>
            <div class="tk-schedule">{{ t.scheduleSummary || '—' }}</div>
            <div class="tk-stats">
              <span class="tk-stat">
                <el-icon><Histogram /></el-icon>
                执行 {{ t.runCount ?? 0 }} 次
              </span>
              <span class="tk-stat">
                <el-icon><Clock /></el-icon>
                最近 {{ t.lastRunAt ? fmtDateTime(t.lastRunAt) : '尚未执行' }}
              </span>
              <StatusTag v-if="t.lastRunStatus" :type="tagType(execStatusMeta(t.lastRunStatus).type)">
                {{ execStatusMeta(t.lastRunStatus).label }}
              </StatusTag>
              <span v-if="t.nextRunAt" class="tk-stat tk-next">
                <el-icon><Timer /></el-icon>
                下次 {{ fmtDateTime(t.nextRunAt) }}
              </span>
            </div>
          </div>

          <div class="np-row-actions tk-ops" @click.stop>
            <el-button link class="op" title="立即执行一次" @click="onRunNow(t)">
              <el-icon><VideoPlay /></el-icon>
            </el-button>
            <el-button link class="op" :title="t.status === 'ENABLED' ? '停用' : '启用'" @click="onToggle(t)">
              <el-icon><component :is="t.status === 'ENABLED' ? 'VideoPause' : 'CaretRight'" /></el-icon>
            </el-button>
            <el-button link class="op" title="编辑" @click="goEdit(t)">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-button link class="op op-danger" title="删除" @click="onDelete(t)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </li>
      </ul>

      <div v-if="total > size" class="tk-pager">
        <el-pagination
          layout="prev, pager, next"
          :total="total"
          :page-size="size"
          :current-page="page"
          @current-change="load"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 宽度/居中/内边距统一由 .page-shell 提供（960px） */
.tk-state {
  padding: var(--space-6);
}
.tk-state.center {
  display: flex;
  justify-content: center;
  padding: var(--space-12) var(--space-6);
}

.tk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
/* 行卡基底走共享 .np-row / .np-row--hover；这里仅补行内排版 */
.tk-card {
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-5); /* 统一卡内 padding 20px（三页一致） */
  cursor: pointer;
}
.tk-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 18px;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  margin-top: 2px;
}
.tk-main {
  flex: 1;
  min-width: 0;
}
.tk-name-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.tk-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tk-schedule {
  margin-top: var(--space-1);
  font-size: var(--fs-sm);
  color: var(--c-accent);
}
.tk-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-2);
}
.tk-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.tk-next {
  color: var(--c-text-faint);
}

.tk-ops {
  flex-shrink: 0;
  align-self: center;
}
.op {
  color: var(--c-text-muted);
  padding: var(--space-2);
}
.op:hover {
  color: var(--c-accent);
  background: var(--bg-hover);
}
.op-danger:hover {
  color: var(--c-danger);
}
.tk-pager {
  display: flex;
  justify-content: center;
  margin-top: var(--space-5);
}
</style>
