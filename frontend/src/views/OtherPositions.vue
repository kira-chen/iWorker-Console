<script setup>
/**
 * 「搭子」页（员工端，列出其他可对话的搭子）。
 *
 * 数据源：positionStore.fetchPositions() 已上架岗位列表，过滤掉当前绑定岗位。
 * 交互：点击卡片 = 每次都新开一个会话，以该岗位为本会话提问对象，跳转对话页。
 *   实现：router.push 到 Chat 并带 query { positionId, new: 1 }，由 Chat.vue 进入时
 *   重置为新会话 + 将 activePosition 设为该岗位（复用既有 reset / setActivePosition）。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserPositionStore } from '@/stores/userPosition'
import { useUserStore } from '@/stores/user'
import { excludeBoundPosition } from '@/utils/positionBinding'
import StatusTag from '@/components/StatusTag.vue'
import PageHeader from '@/components/PageHeader.vue'

const router = useRouter()
const positionStore = useUserPositionStore()
const userStore = useUserStore()

const loadError = ref(false)

async function load() {
  loadError.value = false
  try {
    await positionStore.fetchPositions()
  } catch (e) {
    loadError.value = true
  }
}

onMounted(load)

// 过滤掉当前绑定岗位（按 id 排除）。绑定 id 取值优先级：内存态 currentPosition.id →
// 登录态持久化 boundPositionId 兜底（详见 excludeBoundPosition 注释：覆盖直接进本页/刷新
// 停本页时 currentPosition 为 null 的场景，避免绑定岗位被一并列出）。
const otherPositions = computed(() =>
  excludeBoundPosition(
    positionStore.positions,
    positionStore.currentPosition?.id,
    userStore.userInfo?.boundPositionId
  )
)

// 我的搭子：当前绑定搭子的完整信息。绑定 id 优先内存态 currentPosition → 登录态兜底；
// 优先从列表全量记录取（以拿到 intro/expertise），拿不到则退化为 currentPosition。
const myPosition = computed(() => {
  const boundId = positionStore.currentPosition?.id ?? userStore.userInfo?.boundPositionId
  if (!boundId) return null
  return positionStore.positions.find((e) => e.id === boundId) || positionStore.currentPosition
})

function avatarChar(name) {
  return (name || '岗')[0]
}

// 点击卡片 → 新开会话进入对话（带 query，由 Chat.vue 落地为新会话 + 该岗位）
function openChatWith(position) {
  router.push({ name: 'Chat', query: { positionId: position.id, new: '1' } })
}

// 个性化：复用 Settings.vue 的 goPersonalize 同款跳转（Personalize 路由需 positionId 参数）
function goPersonalize(positionId) {
  router.push({ name: 'Personalize', params: { positionId } })
}
</script>

<template>
  <div class="other-positions page-shell">
    <PageHeader
      title="搭子"
      subtitle="挑选一位搭子向其发起新对话，每次点击都会新开一个会话。"
    />

    <!-- 我的搭子：展示当前绑定搭子（无绑定不渲染） -->
    <section v-if="myPosition" class="my-position np-card">
      <div class="my-position-label">我的搭子</div>
      <div class="my-position-body">
        <el-avatar :size="56" :src="myPosition.avatar">
          {{ avatarChar(myPosition.name) }}
        </el-avatar>
        <div class="my-position-meta">
          <div class="my-position-name-row">
            <span class="my-position-name" :title="myPosition.name">{{ myPosition.name }}</span>
            <StatusTag v-if="myPosition.jobTag" type="success">{{ myPosition.jobTag }}</StatusTag>
          </div>
          <div class="my-position-intro">{{ myPosition.intro || '暂无简介' }}</div>
          <div v-if="myPosition.expertise" class="my-position-skill">
            专长：{{ myPosition.expertise }}
          </div>
        </div>
        <div class="my-position-actions">
          <el-button type="primary" plain @click="goPersonalize(myPosition.id)">个性化</el-button>
        </div>
      </div>
    </section>

    <el-alert
      v-if="loadError"
      type="error"
      title="搭子列表加载失败"
      description="请检查网络或稍后重试。"
      show-icon
      :closable="false"
      class="oe-alert"
    >
      <template #default>
        <el-button @click="load">重试</el-button>
      </template>
    </el-alert>

    <div v-if="myPosition" class="oe-group-title">全部搭子</div>

    <div v-loading="positionStore.loading" class="oe-grid">
      <el-empty
        v-if="!positionStore.loading && !loadError && otherPositions.length === 0"
        :image-size="96"
        description="还没有其他可对话的搭子 · 绑定后即可在此切换"
      />
      <div
        v-for="position in otherPositions"
        :key="position.id"
        class="np-card np-card--hover oe-card"
        @click="openChatWith(position)"
      >
        <div class="oe-card-top">
          <el-avatar :size="48" :src="position.avatar">
            {{ avatarChar(position.name) }}
          </el-avatar>
          <div class="oe-card-meta">
            <div class="oe-card-name" :title="position.name">{{ position.name }}</div>
            <StatusTag v-if="position.jobTag" type="info">{{ position.jobTag }}</StatusTag>
          </div>
        </div>
        <div class="oe-card-desc">{{ position.intro || '暂无简介' }}</div>
        <div v-if="position.expertise" class="oe-card-skill">专长：{{ position.expertise }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 宽度/居中/内边距统一由 .page-shell 提供 */

/* 我的搭子：高亮卡（accent 左竖条 + 面板），与下方网格区分 */
.my-position {
  position: relative;
  padding: var(--space-5);
  padding-left: calc(var(--space-5) + 4px);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-6);
}
.my-position::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  background: var(--c-accent);
}
.my-position-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--c-accent);
  margin-bottom: var(--space-3);
}
.my-position-body {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}
.my-position :deep(.el-avatar) {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  flex-shrink: 0;
}
.my-position-meta {
  flex: 1;
  min-width: 0;
}
.my-position-name-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.my-position-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.my-position-intro {
  margin-top: var(--space-2);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}
.my-position-skill {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.my-position-actions {
  flex-shrink: 0;
}

.oe-group-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-4);
}
.oe-alert {
  margin-bottom: var(--space-4);
}
.oe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
  min-height: 120px;
}
/* 卡片走共享 .np-card / --hover；这里仅补内边距与排版 */
.oe-card {
  padding: var(--space-4);
  cursor: pointer;
}
.oe-card-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.oe-card :deep(.el-avatar) {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  flex-shrink: 0;
}
.oe-card-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
}
.oe-card-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oe-card-desc {
  margin-top: var(--space-3);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  min-height: 40px;
}
.oe-card-skill {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
