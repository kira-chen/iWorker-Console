<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useUserPositionStore } from '@/stores/userPosition'
import { useChatStore } from '@/stores/chat'
import { useSessionStore } from '@/stores/session'
import { useCompanionStore } from '@/stores/companion'
import ThemeToggle from '@/components/ThemeToggle.vue'
import ChangePasswordDialog from '@/components/admin/ChangePasswordDialog.vue'
import { FRONT_RUNTIME_ENABLED } from '@/utils/featureFlags'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const positionStore = useUserPositionStore()
const chatStore = useChatStore()
const sessionStore = useSessionStore()
const companionStore = useCompanionStore()

// 当前绑定的搭子：优先内存态 currentPosition；为空时按登录态 boundPositionId 从已加载的
// positions 列表兜底解析（覆盖「搭子/设置等页面 currentPosition 尚未被赋值」的场景，避免品牌副名丢失）。
const boundPosition = computed(() => {
  if (positionStore.currentPosition) return positionStore.currentPosition
  const id = userStore.userInfo?.boundPositionId
  // 方案B/B2：岗位 id 已字符串化（ps_*），改字符串归一比较（与 utils/positionBinding 同口径；Number() 会变 NaN）。
  return id != null ? positionStore.positions.find((e) => String(e.id) === String(id)) || null : null
})
// 品牌副名取当前绑定搭子的名称（回退岗位标签）；无绑定则只显示「我的搭子」。
const brandText = computed(() => {
  const exp = boundPosition.value
  const label = exp?.name || exp?.jobTag
  return label ? `我的搭子 · ${label}` : '我的搭子'
})

// 伙伴昵称（前端持久化，默认「小助」）。键含 userId + 当前岗位伙伴 id。
// 用于「能干啥」气泡标题；取不到时由气泡标题做不依赖昵称的兜底。
const companionName = computed(() =>
  companionStore.getNickname(
    userStore.userInfo?.userId ?? userStore.userInfo?.id,
    positionStore.currentPosition?.id
  )
)
const candoTitle = computed(() =>
  companionName.value ? `${companionName.value} 能帮你做这些 👇` : '能帮你做这些 👇'
)

// 「能干啥？」气泡四条能力（自对话头部迁入；通用化表述，不绑定具体岗位/行业术语）
const capabilities = [
  { icon: '📝', title: '帮你记', desc: '随口说一句，自动记进对应系统、攒成你要的素材' },
  { icon: '🔍', title: '帮你查', desc: '一句话查信息、出简报，带可追溯的信息来源' },
  { icon: '📊', title: '帮你析', desc: '梳理与分析手头的数据，给出结论 + 建议动作' },
  { icon: '⏰', title: '帮你盯', desc: '建定时任务，到点自动跑，结果推回对话' }
]

// 紧凑功能入口组（豆包式：新对话下方、历史列表上方）。
// 运行时页面封存期（FRONT_RUNTIME_ENABLED=false）隐藏定时任务/个人空间入口（utils/featureFlags.js）。
const entries = [
  { name: 'Tasks', label: '定时任务', icon: 'Timer' },
  { name: 'Space', label: '个人空间', icon: 'FolderOpened' },
  { name: 'OtherPositions', label: '搭子', icon: 'Avatar' },
  { name: 'Settings', label: '设置', icon: 'Setting' }
].filter((en) => FRONT_RUNTIME_ENABLED || !['Tasks', 'Space'].includes(en.name))

// 子页面（如任务新建/详情）通过 meta.activeMenu 归属父入口高亮
const activeEntry = computed(() => route.meta.activeMenu || route.name)
const userName = computed(() => userStore.userInfo?.name || '员工')

// 当前对话会话 id（用于侧栏会话项高亮）
const currentSessionId = computed(() => chatStore.sessionId)

function goEntry(name) {
  if (name !== route.name) router.push({ name })
}

// 新对话：清会话 → activePosition 兜底为当前绑定岗位（确保新会话可直接发消息）→ 跳对话页
function newChat() {
  chatStore.reset()
  const cur = positionStore.currentPosition
  if (cur) {
    chatStore.setActivePosition({
      positionId: cur.id,
      name: cur.name,
      avatar: cur.avatar,
      jobTag: cur.jobTag
    })
  }
  if (route.name !== 'Chat') router.push({ name: 'Chat' })
}

// ---------- 检索 ----------
const searchOpen = ref(false)
const searchRef = ref()
function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) {
    sessionStore.keyword = ''
  } else {
    // 展开后聚焦输入框
    requestAnimationFrame(() => searchRef.value?.focus?.())
  }
}

// ---------- 点击历史会话 → 在主对话区继续 ----------
async function openSession(s) {
  if (s.sessionId === currentSessionId.value && route.name === 'Chat') return
  const ok = await sessionStore.openInChat(s.sessionId)
  if (ok) router.push({ name: 'Chat' })
}

// ---------- 删除会话 ----------
async function onDelete(s) {
  try {
    await ElMessageBox.confirm(
      '删除后将无法在列表中查看该对话记录，确定删除吗？',
      '删除对话',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  try {
    await sessionStore.remove(s.sessionId)
    ElMessage.success('已删除')
    // 删的是当前正在对话的会话 → 清空对话区（回到新会话空态）
    if (s.sessionId === currentSessionId.value) newChat()
  } catch (e) {
    /* 拦截器已提示 */
  }
}

// ---------- 滚动加载更多 ----------
function onListScroll(e) {
  const el = e.target
  // 距底 48px 内触发下一页（loadMore 内部已对并发 / 无更多早退）
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
    sessionStore.loadMore()
  }
}

// 修改密码弹窗（用户菜单入口，普通改密态）
const pwdDialogVisible = ref(false)

async function handleUserCommand(command) {
  if (command === 'changePassword') {
    pwdDialogVisible.value = true
    return
  }
  if (command !== 'logout') return
  try {
    await ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' })
    // logout() 内部已集中重置 position/chat/session store
    userStore.logout()
    router.replace({ name: 'Login' })
  } catch (e) {
    /* 取消 */
  }
}

onMounted(() => {
  // 首屏拉会话列表第一页（四态由 store 维护）；运行时封存期后端无 /api/sessions 对端，跳过
  if (FRONT_RUNTIME_ENABLED) sessionStore.fetchFirst()
  // 已绑定但 positions 列表尚未加载时拉一次，确保侧栏品牌副名「我的搭子 · {名称}」
  // 在任意页面（含未经过对话/绑定流程直接进入的页面）都能解析出绑定搭子。失败静默。
  if (userStore.userInfo?.boundPositionId && !positionStore.positions.length) {
    positionStore.fetchPositions().catch(() => {})
  }
})
</script>

<template>
  <el-container class="layout">
    <el-aside width="260px" class="aside">
      <!-- 品牌 / 伙伴区（含「能干啥」hover 气泡） -->
      <div class="brand">
        <span class="brand-chip brand-mark">搭</span>
        <span class="brand-text">{{ brandText }}</span>

        <!-- 「能干啥？」hover 气泡：四条能力（窄侧栏用 ❓ 触发器，hover 出气泡）
             用 el-popover（teleport 到 body）规避侧栏 overflow:hidden 裁剪 -->
        <el-popover
          placement="bottom-start"
          trigger="hover"
          :width="300"
          :show-arrow="true"
          :offset="8"
          popper-class="cando-popper"
        >
          <template #reference>
            <span class="cando-trigger" aria-label="能干啥">❓</span>
          </template>
          <div class="cando-pop" role="tooltip">
            <div class="cando-title">{{ candoTitle }}</div>
            <ul class="cando-list">
              <li v-for="c in capabilities" :key="c.title">
                <span class="cando-icon">{{ c.icon }}</span>
                <span class="cando-text"><b>{{ c.title }}</b> —— {{ c.desc }}</span>
              </li>
            </ul>
            <div class="cando-foot">直接说话就行，或打 @ 切换搭子～</div>
          </div>
        </el-popover>
      </div>

      <!-- 新对话（运行时封存期隐藏：后端无对话链路） -->
      <button v-if="FRONT_RUNTIME_ENABLED" class="new-chat" type="button" @click="newChat">
        <el-icon><EditPen /></el-icon>
        <span>新对话</span>
      </button>

      <!-- 紧凑功能入口组 -->
      <nav class="entries">
        <button
          v-for="en in entries"
          :key="en.name"
          type="button"
          class="entry"
          :class="{ 'is-active': activeEntry === en.name }"
          @click="goEntry(en.name)"
        >
          <el-icon><component :is="en.icon" /></el-icon>
          <span>{{ en.label }}</span>
        </button>
      </nav>

      <!-- 历史对话分区头（运行时封存期隐藏） -->
      <div v-if="FRONT_RUNTIME_ENABLED" class="hist-head">
        <span class="hist-title">历史对话</span>
        <button
          type="button"
          class="hist-search-btn"
          :class="{ 'is-active': searchOpen }"
          aria-label="检索会话"
          @click="toggleSearch"
        >
          <el-icon><Search /></el-icon>
        </button>
      </div>
      <div v-if="searchOpen" class="hist-search">
        <el-input
          ref="searchRef"
          v-model="sessionStore.keyword"
          size="small"
          placeholder="搜索对话标题"
          clearable
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
      </div>

      <!-- 会话列表（四态 + 滚动加载更多；运行时封存期隐藏） -->
      <div v-if="FRONT_RUNTIME_ENABLED" class="hist-list" @scroll="onListScroll">
        <!-- loading 骨架 -->
        <div v-if="sessionStore.loading" class="hist-state">
          <el-skeleton :rows="5" animated />
        </div>
        <!-- error 重试 -->
        <div v-else-if="sessionStore.error" class="hist-state center">
          <span class="state-text">加载失败</span>
          <el-button @click="sessionStore.fetchFirst()">重试</el-button>
        </div>
        <!-- empty -->
        <div v-else-if="sessionStore.grouped.length === 0" class="hist-state center">
          <span class="state-text">
            {{ sessionStore.keyword ? '没有匹配的对话' : '还没有对话，点上方新对话开始' }}
          </span>
        </div>
        <!-- 分组列表 -->
        <template v-else>
          <div v-for="g in sessionStore.grouped" :key="g.key" class="sess-group">
            <div class="sess-group-label">{{ g.label }}</div>
            <button
              v-for="s in g.items"
              :key="s.sessionId"
              type="button"
              class="sess-item"
              :class="{ 'is-active': s.sessionId === currentSessionId }"
              :title="s.title || '未命名对话'"
              @click="openSession(s)"
            >
              <span class="sess-title">{{ s.title || '未命名对话' }}</span>
              <span class="sess-del" aria-label="删除" @click.stop="onDelete(s)">
                <el-icon><Delete /></el-icon>
              </span>
            </button>
          </div>
          <!-- 加载更多态 -->
          <div v-if="sessionStore.loadingMore" class="hist-more">加载中…</div>
        </template>
      </div>

      <!-- 底部：账号 + 退出 + 主题 -->
      <div class="aside-foot">
        <el-dropdown trigger="click" placement="top-start" @command="handleUserCommand">
          <span class="user">
            <el-avatar :size="26" class="user-avatar">{{ userName[0] }}</el-avatar>
            <span class="user-name">{{ userName }}</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <!-- 「管理后台」直链已移除：使用端仅 demo（EMPLOYEE）可入，不挂后台入口（设计 §5.2） -->
              <el-dropdown-item command="changePassword">修改密码</el-dropdown-item>
              <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <ThemeToggle />
      </div>
    </el-aside>

    <!-- 修改密码弹窗（普通改密态，可关闭）：入口在底部账号二级菜单 -->
    <ChangePasswordDialog v-model:visible="pwdDialogVisible" />

    <el-container>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
  background: var(--bg-app);
}

/* 侧栏：凹陷底、弱右边框、克制层级；纵向四段（品牌/入口/历史/底部账号） */
.aside {
  background: var(--bg-sunken);
  border-right: 1px solid var(--border-base);
  color: var(--c-text);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.brand-mark {
  width: 28px;
  height: 28px;
  font-size: 12px;
}
.brand-text {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 「能干啥？」触发器（品牌区右侧，窄侧栏用 ❓；气泡由 el-popover 承载） */
.cando-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  font-size: var(--fs-sm);
  line-height: 1;
  color: var(--c-text-faint);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-pill);
  cursor: help;
  transition: color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.cando-trigger:hover {
  color: var(--c-accent);
  border-color: var(--c-accent);
}

/* 新对话按钮：强调主行动 */
.new-chat {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin: var(--space-3) var(--space-3) var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--c-text-strong);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
  flex-shrink: 0;
}
.new-chat:hover {
  background: var(--bg-hover);
  border-color: var(--c-accent);
  color: var(--c-accent);
}

/* 紧凑功能入口组 */
.entries {
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-3) var(--space-2);
  flex-shrink: 0;
}
.entry {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 34px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--c-text-muted);
  font-size: var(--fs-base);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.entry:hover {
  background: var(--bg-hover);
  color: var(--c-text-strong);
}
.entry.is-active {
  background: var(--bg-active);
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}

/* 历史分区头 */
.hist-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5) var(--space-1);
  flex-shrink: 0;
}
.hist-title {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--c-text-faint);
  letter-spacing: 0.02em;
}
.hist-search-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-faint);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.hist-search-btn:hover,
.hist-search-btn.is-active {
  background: var(--bg-hover);
  color: var(--c-accent);
}
.hist-search {
  padding: 0 var(--space-3) var(--space-2);
  flex-shrink: 0;
}

/* 会话列表：占据剩余空间，可滚动 */
.hist-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-2) var(--space-2);
  min-height: 0;
}
.hist-state {
  padding: var(--space-4) var(--space-3);
}
.hist-state.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}
.state-text {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: var(--lh-base);
}
.sess-group {
  margin-bottom: var(--space-2);
}
.sess-group-label {
  padding: var(--space-2) var(--space-3) 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.sess-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 34px;
  padding: 0 var(--space-2) 0 var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.sess-item:hover {
  background: var(--bg-hover);
  color: var(--c-text-strong);
}
.sess-item.is-active {
  background: var(--bg-active);
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.sess-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sess-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-left: var(--space-1);
  border-radius: var(--radius-sm);
  color: var(--c-text-faint);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}
.sess-item:hover .sess-del,
.sess-item.is-active .sess-del {
  opacity: 1;
}
.sess-del:hover {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.hist-more {
  padding: var(--space-3);
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* 底部账号区 */
.aside-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.user {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  outline: none;
  color: var(--c-text);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  min-width: 0;
  transition: background-color var(--dur-fast) var(--ease-out);
}
.user:hover {
  background: var(--bg-hover);
}
.user-avatar {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  flex-shrink: 0;
}
.user-name {
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main {
  padding: var(--space-5);
  background: var(--bg-app);
}
</style>

<!-- el-popover 内容 teleport 到 body，scoped 属性不附着，故用非 scoped 块按 popper-class 命中。
     仅作用于本气泡 popper，命中范围受限，不污染其它 popover。 -->
<style>
.cando-popper.el-popover.el-popper {
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-4);
}
.cando-popper .el-popper__arrow::before {
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
}
.cando-popper .cando-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-3);
}
.cando-popper .cando-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.cando-popper .cando-list li {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
}
.cando-popper .cando-icon {
  flex-shrink: 0;
  line-height: 1.5;
}
.cando-popper .cando-text {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.cando-popper .cando-text b {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.cando-popper .cando-foot {
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-soft);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
