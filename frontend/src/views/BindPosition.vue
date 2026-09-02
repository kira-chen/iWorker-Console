<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserPositionStore } from '@/stores/userPosition'
import { useUserStore } from '@/stores/user'
import StatusTag from '@/components/StatusTag.vue'
import IntakeFormDialog from '@/components/intake/IntakeFormDialog.vue'
import { getIntakeSchema } from '@/api/myPosition'
import { hasIntakeSchema } from '@/utils/intakeForm'

const router = useRouter()
const positionStore = useUserPositionStore()
const userStore = useUserStore()

// 后台账号（admin / FDE / SYS_CONFIG）兜底出口：正常情况下守卫会按三路分流放行进后台，
// 万一落到本页（如手动输入 URL），给一个进入管理后台的入口，避免卡死。
// 用 /admin 父路由 + 守卫三路分流落地，纯 SYS_CONFIG 也能正确落系统配置首页。
function goAdmin() {
  router.replace('/admin')
}

const selectedId = ref(null)
const binding = ref(false)
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

function pick(position) {
  selectedId.value = position.id
}

// 领用采集弹窗态：有采集字段的岗位领用时弹出动态采集表单
const intakeVisible = ref(false)
const selectedPosition = computed(() =>
  positionStore.positions.find((e) => e.id === selectedId.value) || null
)

async function handleBind() {
  if (!selectedId.value) {
    ElMessage.warning('请先选择一个搭子')
    return
  }
  binding.value = true
  try {
    // 先取该岗位采集字段定义：有字段 → 弹采集表单（claim 走弹窗）；无字段 → 直接绑定（零额外步骤）
    let schema = []
    try {
      const data = await getIntakeSchema(selectedId.value)
      schema = Array.isArray(data?.intakeSchema) ? data.intakeSchema : []
    } catch (e) {
      // schema 读取失败：降级为既有直接绑定路径（零回归），不阻断领用
      schema = []
    }
    if (hasIntakeSchema(schema)) {
      // 有采集字段：打开弹窗收集 intakeValues，由弹窗内 claim 提交
      intakeVisible.value = true
      return
    }
    // 无采集定义：沿用既有直接绑定路径，零额外步骤
    await positionStore.bind(selectedId.value)
    ElMessage.success('绑定成功')
    router.replace({ name: 'Chat' })
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    binding.value = false
  }
}

// 领用采集弹窗提交成功（claim 已带 intakeValues）→ 同步本地绑定态 → 进对话页
function onClaimed() {
  positionStore.markClaimed(selectedId.value)
  router.replace({ name: 'Chat' })
}
</script>

<template>
  <div class="bind-page">
    <div class="bind-container">
      <div class="bind-head">
        <h2>选择你的搭子</h2>
        <p>请从以下公司发布的搭子中挑选一位，培养为你的专属搭子。</p>
      </div>

      <el-alert
        v-if="userStore.isBackstage"
        type="info"
        title="你是后台账号，无需绑定搭子"
        show-icon
        :closable="false"
        class="bind-alert"
      >
        <template #default>
          <el-button type="primary" @click="goAdmin">进入管理后台</el-button>
        </template>
      </el-alert>

      <el-alert
        v-if="loadError"
        type="error"
        title="搭子列表加载失败"
        description="请检查网络或稍后重试。"
        show-icon
        :closable="false"
        class="bind-alert"
      >
        <template #default>
          <el-button @click="load">重试</el-button>
        </template>
      </el-alert>

      <div v-loading="positionStore.loading" class="position-grid">
        <el-empty
          v-if="!positionStore.loading && positionStore.positions.length === 0 && !loadError"
          :image-size="96"
          description="还没有可绑定的搭子 · 请联系管理员发布岗位"
        />
        <div
          v-for="position in positionStore.positions"
          :key="position.id"
          class="np-card np-card--hover position-card"
          :class="{ 'np-card--selected': selectedId === position.id }"
          @click="pick(position)"
        >
          <div class="position-top">
            <el-avatar :size="48" :src="position.avatar">
              {{ (position.name || '岗')[0] }}
            </el-avatar>
            <div class="position-meta">
              <div class="position-name">{{ position.name }}</div>
              <StatusTag v-if="position.jobTag" type="info">{{ position.jobTag }}</StatusTag>
            </div>
            <el-icon v-if="selectedId === position.id" class="check"><CircleCheckFilled /></el-icon>
          </div>
          <div class="position-desc">{{ position.intro || '暂无简介' }}</div>
          <div v-if="position.expertise" class="position-skill">
            专长：{{ position.expertise }}
          </div>
        </div>
      </div>

      <div class="bind-actions">
        <el-button
          type="primary"
          size="large"
          :loading="binding"
          :disabled="!selectedId"
          @click="handleBind"
        >
          绑定并开始
        </el-button>
      </div>
    </div>

    <!-- 领用采集表单（有采集字段的岗位领用时弹出） -->
    <IntakeFormDialog
      v-model:visible="intakeVisible"
      mode="claim"
      :position-id="selectedId"
      :position-name="selectedPosition?.name || ''"
      :position-icon="selectedPosition?.avatar || ''"
      @done="onClaimed"
    />
  </div>
</template>

<style scoped>
.bind-page {
  min-height: 100vh;
  background: var(--bg-app);
  padding: var(--space-10) var(--space-5);
  display: flex;
  justify-content: center;
}
.bind-container {
  width: 100%;
  max-width: 880px;
}
.bind-head {
  text-align: center;
  margin-bottom: var(--space-8);
}
.bind-head h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-bold);
  color: var(--c-text-strong);
}
.bind-head p {
  margin: 0;
  color: var(--c-text-muted);
}
.bind-alert {
  margin-bottom: var(--space-4);
}
.position-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
  min-height: 120px;
}
/* 岗位卡走共享 .np-card / --hover / --selected；这里仅补内边距与排版 */
.position-card {
  padding: var(--space-4);
}
.position-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  position: relative;
}
.position-card :deep(.el-avatar) {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}
.position-meta {
  flex: 1;
}
.position-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-1);
}
.check {
  color: var(--c-accent);
  font-size: var(--fs-xl);
}
.position-desc {
  margin-top: var(--space-3);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  min-height: 40px;
}
.position-skill {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.bind-actions {
  text-align: center;
  margin-top: var(--space-8);
}
</style>
