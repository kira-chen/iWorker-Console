<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useUserPositionStore } from '@/stores/userPosition'
import { getMyProfile, updateMyProfile } from '@/api/user'
import { useRebindFlow } from '@/composables/useRebindFlow'
import { unbindErrorMessage } from '@/api/rebind'
import RebindConfirmDialog from '@/components/RebindConfirmDialog.vue'
import PositionPickerDialog from '@/components/PositionPickerDialog.vue'
import IntakeFormDialog from '@/components/intake/IntakeFormDialog.vue'
import PageHeader from '@/components/PageHeader.vue'
import BizCredentialPanel from '@/components/biz/BizCredentialPanel.vue'
import { getCurrentPosition, getIntakeSchema } from '@/api/myPosition'
import { hasIntakeSchema } from '@/utils/intakeForm'
import { FRONT_RUNTIME_ENABLED } from '@/utils/featureFlags'

const router = useRouter()
const userStore = useUserStore()
const positionStore = useUserPositionStore()

// 个人资料（display_name + profile.*）：读写走后端 GET/PUT /api/users/me，
// 本地登录态作为初值/离线回退，保存成功后同步回写本地 userInfo 保持一致。
const profile = reactive({
  displayName: '',
  dept: '',
  position: '',
  email: '',
  avatar: ''
})

const saving = ref(false)

// 通知偏好（数据驱动开关；S3 配套，MVP 仅落本地偏好）
const NOTIFY_KEY = 'ai_assistant_notify_prefs'
const notify = reactive({
  scheduledResult: true
})

// 把一个用户对象（本地态或后端 /users/me 返回）灌进表单
function applyProfile(u) {
  const src = u || {}
  const p = src.profile || {}
  profile.displayName = src.name || src.displayName || ''
  profile.dept = p.dept || ''
  profile.position = p.position || ''
  profile.email = src.email || p.email || ''
  profile.avatar = p.avatar || ''
}

function loadProfile() {
  // 先用本地登录态作为初值（离线/请求前先有内容）
  applyProfile(userStore.userInfo)
  try {
    const raw = localStorage.getItem(NOTIFY_KEY)
    if (raw) Object.assign(notify, JSON.parse(raw))
  } catch (e) {
    /* ignore */
  }
}

// 从后端拉取最新资料（GET /api/users/me），成功后覆盖表单并同步本地态
async function fetchProfile() {
  try {
    const me = await getMyProfile()
    if (me) {
      applyProfile(me)
      userStore.setUserInfo({ ...(userStore.userInfo || {}), ...me })
    }
  } catch (e) {
    /* 静默：拉取失败保留本地初值，拦截器已提示 */
  }
}

const profileValid = computed(
  () => profile.displayName.trim() && profile.dept.trim() && profile.position.trim()
)

async function saveProfile() {
  if (!profileValid.value) {
    ElMessage.warning('请填写姓名、部门、岗位')
    return
  }
  saving.value = true
  // 提交后端的资料负载（PUT /api/users/me 契约字段为 displayName，非 name；
  // avatar 仍随 profile 提交以保留既有头像，不因表单去掉头像字段而被整体替换清空）
  const payload = {
    displayName: profile.displayName.trim(),
    email: profile.email.trim(),
    profile: {
      dept: profile.dept.trim(),
      position: profile.position.trim(),
      avatar: profile.avatar.trim()
    }
  }
  try {
    // PUT /api/users/me：以后端为准，回包同步本地登录态（无回包则用提交值兜底）
    const saved = await updateMyProfile(payload)
    // 新显示名优先取后端回包 displayName；本地登录态用 name 口径（头部等读 name），
    // 故同时写 name + displayName，保证保存后头部/资料立即刷新为新名
    const newName = (saved && saved.displayName) || payload.displayName
    const merged = { ...(userStore.userInfo || {}), ...(saved || {}), name: newName, displayName: newName }
    userStore.setUserInfo(merged)
    if (saved) applyProfile(saved)
    ElMessage.success('已保存')
  } catch (e) {
    /* 保存失败由拦截器提示，不写本地态避免与后端不一致 */
  } finally {
    saving.value = false
  }
}

function saveNotify() {
  localStorage.setItem(NOTIFY_KEY, JSON.stringify(notify))
  ElMessage.success('通知偏好已保存')
}

// 我的专家：列出已绑定专家（数据驱动）→ 个性化入口
const boundPositions = computed(() => {
  const id = userStore.userInfo?.boundPositionId
  if (!id) return []
  const found = positionStore.positions.find((e) => e.id === id)
  return found ? [found] : [{ id, name: '我的搭子', jobTag: '' }]
})

function goPersonalize(positionId) {
  router.push({ name: 'Personalize', params: { positionId } })
}

// ---------- 完善信息（查看/修改已填采集值，复用同一动态采集表单 + 改采集端点） ----------
const intakeVisible = ref(false)
const intakePositionId = ref(null)
const intakeInitial = ref({})
const intakeLoading = ref(false)
// 当前绑定岗位是否定义了采集字段：无字段则不渲染「完善信息」入口，
// 避免用户点开只见空态空跑一趟（结合 intake-schema 存在性判断）。
const hasIntakeFields = ref(false)

async function loadIntakeAvailability() {
  const id = userStore.userInfo?.boundPositionId
  if (!id) {
    hasIntakeFields.value = false
    return
  }
  try {
    const data = await getIntakeSchema(id)
    hasIntakeFields.value = hasIntakeSchema(data?.intakeSchema)
  } catch (e) {
    /* 静默：探测失败时保守隐藏入口（弹窗内仍可重试，但避免误导入口） */
    hasIntakeFields.value = false
  }
}

async function openIntake(positionId) {
  intakePositionId.value = positionId
  intakeInitial.value = {}
  intakeLoading.value = true
  try {
    // 读当前绑定岗位的已填采集值用于回填（current 含 intakeValues）
    const cur = await getCurrentPosition()
    intakeInitial.value = cur?.intakeValues || {}
  } catch (e) {
    /* 读取失败：回填空，弹窗内仍可重新填写（schema 由弹窗自取） */
  } finally {
    intakeLoading.value = false
    intakeVisible.value = true
  }
}

function onIntakeDone() {
  ElMessage.success('信息已更新')
}

// ---------- 更换专家（三入口之一：设置页「我的专家」分组） ----------
const pickerVisible = ref(false)
const rebindFlow = useRebindFlow({
  onSuccess: async (result) => {
    // 换绑成功：刷新本页「我的专家」展示为新专家（拉一次专家列表兜底名称/头像）
    if (result?.changed === false) return
    try {
      await positionStore.fetchPositions()
    } catch (e) {
      /* 静默：boundPositionId 已更新，列表拉取失败仅影响展示名 */
    }
    // 换绑后重新探测新岗位的采集字段存在性，保持「完善信息」入口准确
    await loadIntakeAvailability()
  }
})

function openPicker() {
  pickerVisible.value = true
}
function onPickTarget(id) {
  pickerVisible.value = false
  rebindFlow.start(id)
}

// ---------- 解绑当前专家（强确认 → 清个性化 + 解绑 → 强制回选专家页） ----------
// 复用 RebindConfirmDialog 的强确认范式（mode='unbind'）：拉 unbind-preview 展示影响，
// 勾选门槛后调 positionStore.unbind()（成功后清态 + 跳 BindPosition，guard 锁住 0 绑定）。
const unbindVisible = ref(false)
const unbindPreview = ref(null)
const unbindLoading = ref(false)
const unbindError = ref(false)
const unbindSubmitting = ref(false)

// 是否有可解绑的专家（未绑定态不显示解绑入口）
const hasBoundPosition = computed(() => !!userStore.userInfo?.boundPositionId)

async function fetchUnbindPreview() {
  unbindLoading.value = true
  unbindError.value = false
  unbindPreview.value = null
  try {
    unbindPreview.value = await positionStore.previewUnbind()
  } catch (e) {
    unbindError.value = true
  } finally {
    unbindLoading.value = false
  }
}

async function openUnbind() {
  if (!hasBoundPosition.value) return
  unbindVisible.value = true
  unbindSubmitting.value = false
  await fetchUnbindPreview()
}

function onUnbindRetry() {
  fetchUnbindPreview()
}

async function confirmUnbind() {
  if (unbindSubmitting.value) return
  unbindSubmitting.value = true
  try {
    await positionStore.unbind()
    unbindVisible.value = false
    // unbind action 已强制跳 BindPosition，这里仅给一句轻提示
    ElMessage.success('已解绑，请重新选择搭子')
  } catch (e) {
    const msg = unbindErrorMessage(e)
    if (msg) ElMessage.error(msg)
  } finally {
    unbindSubmitting.value = false
  }
}

// 进入「个人记忆」独立管理页
function goMemory() {
  router.push({ name: 'MemoryManage' })
}

onMounted(async () => {
  loadProfile()
  // 拉后端最新资料覆盖本地初值（GET /api/users/me）
  await fetchProfile()
  try {
    if (positionStore.positions.length === 0) await positionStore.fetchPositions()
  } catch (e) {
    /* 静默 */
  }
  // 探测当前绑定岗位是否有采集字段，决定「完善信息」入口是否渲染
  await loadIntakeAvailability()
})
</script>

<template>
  <div class="set-page page-shell">
    <PageHeader title="设置" subtitle="完善个人信息与岗位，让你的搭子更懂你" />

    <!-- 个人资料 -->
    <section class="set-card">
      <div class="set-head">个人资料</div>
      <el-form label-position="top" class="set-form">
        <div class="form-grid">
          <el-form-item label="姓名" required>
            <el-input v-model="profile.displayName" maxlength="64" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="profile.email" placeholder="可选" />
          </el-form-item>
          <el-form-item label="部门" required>
            <el-input v-model="profile.dept" placeholder="如：财务部 / 法务部…" />
          </el-form-item>
          <el-form-item label="岗位" required>
            <el-input v-model="profile.position" placeholder="如：会计 / 法务专员…" />
          </el-form-item>
        </div>
        <div class="set-actions">
          <el-button type="primary" :loading="saving" @click="saveProfile">保存资料</el-button>
        </div>
      </el-form>
    </section>

    <!-- 通知偏好 -->
    <section class="set-card">
      <div class="set-head">通知偏好</div>
      <div class="notify-row">
        <div class="notify-meta">
          <div class="notify-name">定时任务结果站内通知</div>
          <div class="notify-desc">定时任务执行完成后在站内提醒（S3 功能配套）</div>
        </div>
        <el-switch v-model="notify.scheduledResult" @change="saveNotify" />
      </div>
    </section>

    <!-- 我的搭子 -->
    <section class="set-card">
      <div class="set-head">我的搭子</div>
      <div v-if="boundPositions.length === 0" class="set-empty">尚未绑定搭子。</div>
      <div v-for="exp in boundPositions" :key="exp.id" class="np-card position-row">
        <el-avatar :size="40" :src="exp.avatar">{{ (exp.name || '岗')[0] }}</el-avatar>
        <div class="position-meta">
          <div class="position-name">{{ exp.name }}</div>
          <div v-if="exp.jobTag" class="position-tag">{{ exp.jobTag }}</div>
        </div>
        <div class="position-actions">
          <el-button v-if="hasIntakeFields" plain :loading="intakeLoading" @click="openIntake(exp.id)">完善信息</el-button>
          <el-button type="primary" plain @click="goPersonalize(exp.id)">个性化</el-button>
          <el-button plain @click="openPicker">更换搭子</el-button>
          <el-button type="danger" plain @click="openUnbind">解绑搭子</el-button>
        </div>
      </div>
    </section>

    <!-- 业务系统连接（登录态托管入口；只展示状态，绝不展示凭据） -->
    <section class="set-card">
      <div class="set-head">业务系统连接</div>
      <div class="set-sub">托管你在各业务系统的登录态，让搭子代你在系统里办事（凭据加密保存，不会展示）</div>
      <BizCredentialPanel />
    </section>

    <!-- 个人记忆（入口卡片，进入独立管理页；运行时封存期隐藏：后端无 /api/memory 对端） -->
    <section v-if="FRONT_RUNTIME_ENABLED" class="set-card">
      <div class="set-head">个人记忆</div>
      <div class="mem-entry">
        <div class="mem-meta">
          <div class="mem-name">管理你的记忆</div>
          <div class="mem-desc">查看、筛选、编辑或删除搭子记住的内容</div>
        </div>
        <el-button type="primary" plain @click="goMemory">进入管理</el-button>
      </div>
    </section>

    <!-- 完善信息（查看/修改已填采集值，编辑模式复用同一动态采集表单） -->
    <IntakeFormDialog
      v-model:visible="intakeVisible"
      mode="edit"
      :position-id="intakePositionId"
      :initial-values="intakeInitial"
      @done="onIntakeDone"
    />

    <!-- 更换专家：选目标 -->
    <PositionPickerDialog v-model:visible="pickerVisible" @pick="onPickTarget" />

    <!-- 更换专家：强提示二次确认 -->
    <RebindConfirmDialog
      v-model:visible="rebindFlow.visible.value"
      :preview="rebindFlow.preview.value"
      :loading="rebindFlow.loading.value"
      :error="rebindFlow.error.value"
      :submitting="rebindFlow.submitting.value"
      @confirm="rebindFlow.confirm"
      @retry="rebindFlow.retry"
    />

    <!-- 解绑当前专家：复用强确认弹窗（mode=unbind） -->
    <RebindConfirmDialog
      v-model:visible="unbindVisible"
      mode="unbind"
      :preview="unbindPreview"
      :loading="unbindLoading"
      :error="unbindError"
      :submitting="unbindSubmitting"
      @confirm="confirmUnbind"
      @retry="onUnbindRetry"
    />
  </div>
</template>

<style scoped>
/* 宽度/居中/内边距统一由 .page-shell 提供（960px，与个人空间/定时任务同宽） */
.set-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.set-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: var(--space-5);
}
.set-head {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-4);
}
.set-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-top: -8px;
  margin-bottom: var(--space-4);
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 var(--space-4);
}
.set-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}
.notify-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.notify-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.notify-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-top: 2px;
}
.set-empty {
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.position-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
}
.position-row :deep(.el-avatar) {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}
.position-meta {
  flex: 1;
}
.position-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.position-tag {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.position-actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}
.mem-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.mem-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.mem-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-top: 2px;
}
</style>
