<script setup>
/**
 * 选新专家弹窗（更换专家流程第一步，PRD-06 §3.2）。
 *
 * 职责：列出可绑定专家（数据驱动），标识「当前专家」并禁用其更换动作（选回当前本地拦截），
 * 对非当前专家提供「换为此专家」。覆盖四态：loading / empty（无可换专家）/ error / 正常。
 * 选定后 emit('pick', positionId)，由父组件交给 useRebindFlow.start 走强确认。
 *
 * 本组件只负责「选目标」，不含强确认（强确认在 RebindConfirmDialog）。
 */
import { ref, computed, watch } from 'vue'
import { useUserPositionStore } from '@/stores/userPosition'
import { useUserStore } from '@/stores/user'
import StatusTag from '@/components/StatusTag.vue'

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'pick'])

const positionStore = useUserPositionStore()
const userStore = useUserStore()

const loadErr = ref(false)
const loading = computed(() => positionStore.loading)
const loadError = computed(() => loadErr.value)

const boundId = computed(() => userStore.userInfo?.boundPositionId ?? null)
const positions = computed(() => positionStore.positions)
// 可换目标 = 非当前绑定岗位。
// 注意：网格渲染用的是全量 positions（含当前岗位，当前岗位卡禁用「换为此搭子」做对照展示）；
// candidates 仅用于 empty 态判定——只看「可换目标」是否为空，避免「只有自己」时误判有候选。
const candidates = computed(() =>
  // 方案B/B2：岗位 id 已字符串化（ps_*），改字符串比较（Number() 会变 NaN）。
  positions.value.filter((e) => String(e.id) !== String(boundId.value))
)

async function load() {
  loadErr.value = false
  try {
    await positionStore.fetchPositions()
  } catch (e) {
    loadErr.value = true
  }
}

// 每次打开都刷新候选，确保上下架变更及时反映
watch(
  () => props.visible,
  (v) => {
    if (v) load()
  }
)

function isCurrent(exp) {
  return String(exp.id) === String(boundId.value)
}

function pick(exp) {
  if (isCurrent(exp)) return // 当前专家禁用（选回当前本地拦截）
  emit('pick', exp.id)
}

function onClose() {
  emit('update:visible', false)
}

function avatarChar(name) {
  return (name || '岗')[0]
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="更换搭子"
    width="640px"
    :close-on-click-modal="false"
    class="picker-dialog"
    @update:model-value="onClose"
  >
    <!-- loading -->
    <div v-if="loading" class="pk-state">
      <el-skeleton :rows="6" animated />
    </div>
    <!-- error -->
    <div v-else-if="loadError" class="pk-state pk-center">
      <el-empty description="搭子列表加载失败" :image-size="80">
        <el-button type="primary" @click="load">重试</el-button>
      </el-empty>
    </div>
    <!-- empty：无可换目标 -->
    <div v-else-if="candidates.length === 0" class="pk-state pk-center">
      <el-empty description="暂无可更换的其他搭子，请联系管理员配置" :image-size="80">
        <el-button @click="load">刷新</el-button>
      </el-empty>
    </div>
    <!-- 正常：候选卡片 -->
    <div v-else class="pk-grid">
      <div
        v-for="exp in positions"
        :key="exp.id"
        class="np-card pk-card"
        :class="{ 'is-current': isCurrent(exp), 'np-card--hover': !isCurrent(exp) }"
      >
        <div class="pk-top">
          <el-avatar :size="44" :src="exp.avatar">{{ avatarChar(exp.name) }}</el-avatar>
          <div class="pk-meta">
            <div class="pk-name">{{ exp.name }}</div>
            <StatusTag v-if="exp.jobTag" type="info">{{ exp.jobTag }}</StatusTag>
          </div>
          <StatusTag v-if="isCurrent(exp)" type="success" class="pk-cur-tag">当前搭子</StatusTag>
        </div>
        <div class="pk-desc">{{ exp.intro || '暂无简介' }}</div>
        <div class="pk-actions">
          <el-button
            v-if="isCurrent(exp)"
            disabled
          >已是当前搭子</el-button>
          <el-button
            v-else
            type="primary"
            @click="pick(exp)"
          >换为此搭子</el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="onClose">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pk-state {
  min-height: 200px;
}
.pk-center {
  display: flex;
  justify-content: center;
  align-items: center;
}
.pk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
  max-height: 60vh;
  overflow-y: auto;
}
/* 卡片基底走共享 .np-card / --hover；这里仅补内边距与排版 */
.pk-card {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
}
.pk-card.is-current {
  border-color: var(--c-success);
  background: var(--c-success-soft);
}
.pk-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.pk-card :deep(.el-avatar) {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  flex-shrink: 0;
}
.pk-meta {
  flex: 1;
  min-width: 0;
}
.pk-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-1);
}
.pk-cur-tag {
  flex-shrink: 0;
}
.pk-desc {
  margin-top: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
  flex: 1;
  min-height: 36px;
}
.pk-actions {
  margin-top: var(--space-3);
  display: flex;
  justify-content: flex-end;
}
</style>
