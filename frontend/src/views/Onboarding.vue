<script setup>
/**
 * Onboarding —— 首登三步引导（替代直跳 BindPosition）。
 *  步骤1 选搭子：复用 positionStore.fetchPositions()（GET /positions），搭子卡网格点选。
 *  步骤2 认识搭子 + 起名：选中的搭子即将成为你的搭子，搭子头像 + 起名（默认「小助」，maxlength 8）+ 四条能力。
 *  步骤3 完善个人信息：姓名/部门(必填)/职级/负责区域 → PUT /users/me（updateMyProfile）。
 * 完成：写昵称 localStorage → 按岗位 intake-schema 采集（PRD-01 §2.9，前后端双校验）：
 *   - 该岗位配置了采集字段 → 弹 IntakeFormDialog（claim 模式）收集 intakeValues，
 *     由弹窗内 claimPosition(positionId, intakeValues) 完成「bind + 采集」一体提交 → markClaimed → 跳 Chat。
 *   - 无采集字段 → 沿用 positionStore.bind(positionId) 直接绑定（零额外步骤）→ 跳 Chat。
 * 说明：claim 接口（POST /my-positions/{id}/claim）后端内部即调用 bind，故对「有采集」岗位用 claim
 *   替代 bind 是完整超集，无需后端改动；首登领用即按岗位字段采集填齐，满足 §2.9 硬验收。
 *
 * 术语：用户端统一称「搭子」（= 后台配置的「岗位」/「专家」）；产品品牌名仍用「工作搭子」（仅 Login/title）。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserPositionStore } from '@/stores/userPosition'
import { useUserStore } from '@/stores/user'
import { useCompanionStore } from '@/stores/companion'
import { updateMyProfile } from '@/api/user'
import { DEFAULT_NICKNAME } from '@/stores/companion'
import IntakeFormDialog from '@/components/intake/IntakeFormDialog.vue'
import { getIntakeSchema } from '@/api/myPosition'
import { hasIntakeSchema } from '@/utils/intakeForm'

const router = useRouter()
const positionStore = useUserPositionStore()
const userStore = useUserStore()
const companionStore = useCompanionStore()

// ---------- 步进 ----------
const step = ref(1) // 1 选搭子 / 2 起名 / 3 完善信息
const steps = [
  { no: 1, label: '选搭子' },
  { no: 2, label: '认识搭子' },
  { no: 3, label: '完善信息' }
]

// ---------- 步骤1：岗位列表 ----------
const selectedId = ref(null)
const loadError = ref(false)

async function loadPositions() {
  loadError.value = false
  try {
    await positionStore.fetchPositions()
  } catch (e) {
    loadError.value = true
  }
}
onMounted(loadPositions)

const selectedPosition = computed(
  () => positionStore.positions.find((e) => e.id === selectedId.value) || null
)

function pick(position) {
  selectedId.value = position.id
}

function avatarChar(name) {
  return (name || '岗')[0]
}

// ---------- 步骤2：起名 ----------
const nickname = ref(DEFAULT_NICKNAME)

// 选岗位后进入步骤2时，回填该岗位伙伴已存昵称（无则默认「小助」）
function syncNicknameForPosition() {
  nickname.value = companionStore.getNickname(
    userStore.userInfo?.userId ?? userStore.userInfo?.id,
    selectedId.value
  )
}

// 四条能力（通用化表述，不绑定具体岗位/行业术语）
const capabilities = [
  { icon: '📝', title: '帮你记', desc: '随口说一句，自动记进对应系统、攒成你要的素材' },
  { icon: '🔍', title: '帮你查', desc: '一句话查信息、出简报，带可追溯的信息来源' },
  { icon: '📊', title: '帮你析', desc: '梳理与分析手头的数据，给出结论 + 建议动作' },
  { icon: '⏰', title: '帮你盯', desc: '建定时任务，到点自动跑，结果推回对话' }
]

// ---------- 步骤3：个人信息 ----------
// 字段映射后端 UserProfileVO 契约：姓名→displayName，部门→profile.dept，职级→profile.position。
// 「负责区域」后端暂无对应字段，仅作引导展示、不提交（不擅自新增后端字段名）。
const profile = reactive({
  name: '',
  dept: '',
  position: '',
  region: ''
})

const profileValid = computed(() => profile.name.trim() && profile.dept.trim())

// ---------- 步进控制 ----------
const canNext = computed(() => {
  if (step.value === 1) return !!selectedId.value
  if (step.value === 2) return true
  return false
})

const nextHint = computed(() => {
  if (step.value === 1 && !selectedId.value) return '先选一个搭子'
  return ''
})

function prev() {
  if (step.value > 1) step.value -= 1
}

function next() {
  if (step.value === 1) {
    if (!selectedId.value) return
    syncNicknameForPosition()
    step.value = 2
  } else if (step.value === 2) {
    step.value = 3
  }
}

// ---------- 完成 ----------
const submitting = ref(false)
// 领用采集弹窗（首登：有采集字段的岗位在绑定前必须填齐 → claim 一体提交）
const intakeVisible = ref(false)

async function finish() {
  if (!profileValid.value) {
    ElMessage.warning('请填写姓名和部门')
    return
  }
  if (!selectedId.value) {
    ElMessage.warning('请先选择搭子')
    return
  }
  submitting.value = true
  try {
    // 1) 提交个人资料（契约字段：displayName + profile.dept/position）
    const payload = {
      displayName: profile.name.trim(),
      profile: {
        dept: profile.dept.trim(),
        position: profile.position.trim()
      }
    }
    const saved = await updateMyProfile(payload)
    // 同步登录态显示名（name 口径供头部/头像读取）
    const newName = (saved && saved.displayName) || payload.displayName
    userStore.setUserInfo({
      ...(userStore.userInfo || {}),
      ...(saved || {}),
      name: newName,
      displayName: newName
    })

    // 2) 持久化伙伴昵称（前端，键含 userId + positionId）
    // TODO: 待后端补昵称字段后改为服务端持久化。
    companionStore.setNickname(
      userStore.userInfo?.userId ?? userStore.userInfo?.id,
      selectedId.value,
      nickname.value
    )

    // 3) 按岗位 intake-schema 采集（PRD-01 §2.9）：有采集字段 → 弹采集表单走 claim（bind + 采集一体）；
    //    无采集字段 → 沿用直接 bind（零额外步骤）。schema 读取失败时降级为直接 bind，不阻断领用。
    let schema = []
    try {
      const data = await getIntakeSchema(selectedId.value)
      schema = Array.isArray(data?.intakeSchema) ? data.intakeSchema : []
    } catch (e) {
      schema = []
    }
    if (hasIntakeSchema(schema)) {
      // 有采集字段：打开弹窗收集 intakeValues，必填校验通过后由弹窗内 claim 提交完成绑定。
      // 注意：此处不收 submitting，交由弹窗的 onClaimed/关闭流程收尾（避免按钮 loading 卡死）。
      intakeVisible.value = true
      submitting.value = false
      return
    }

    // 无采集定义：沿用既有直接绑定路径
    await positionStore.bind(selectedId.value)
    ElMessage.success('就绪，开始使用')
    router.replace({ name: 'Chat' })
  } catch (e) {
    /* 接口错误已由拦截器统一提示；失败不前进，保留当前步骤 */
  } finally {
    if (!intakeVisible.value) submitting.value = false
  }
}

// 领用采集弹窗 claim 成功（已带 intakeValues 并完成 bind）→ 同步本地绑定态 → 进对话页
function onClaimed() {
  positionStore.markClaimed(selectedId.value)
  ElMessage.success('就绪，开始使用')
  router.replace({ name: 'Chat' })
}
</script>

<template>
  <div class="ob-page">
    <div class="ob-shell surface-block rise-in">
      <!-- 步进条 -->
      <div class="ob-steps">
        <template v-for="(s, i) in steps" :key="s.no">
          <div class="ob-step" :class="{ on: step >= s.no, cur: step === s.no }">
            <span class="ob-step-no">{{ s.no }}</span>
            <span class="ob-step-label">{{ s.label }}</span>
          </div>
          <span v-if="i < steps.length - 1" class="ob-step-line"></span>
        </template>
      </div>

      <!-- 内容区 -->
      <div class="ob-body">
        <!-- 步骤1：选搭子 -->
        <section v-if="step === 1">
          <h2 class="ob-title">挑选你的搭子</h2>
          <p class="ob-sub">从公司发布的搭子中挑选一位，系统会把对应技能装配成你的专属搭子。</p>

          <el-alert
            v-if="loadError"
            type="error"
            title="搭子列表加载失败"
            description="请检查网络或稍后重试。"
            show-icon
            :closable="false"
            class="ob-alert"
          >
            <template #default>
              <el-button @click="loadPositions">重试</el-button>
            </template>
          </el-alert>

          <div v-loading="positionStore.loading" class="ob-grid">
            <el-empty
              v-if="!positionStore.loading && !loadError && positionStore.positions.length === 0"
              :image-size="96"
              description="还没有可选搭子 · 请联系管理员发布岗位"
            />
            <button
              v-for="exp in positionStore.positions"
              :key="exp.id"
              type="button"
              class="np-card np-card--hover ob-role"
              :class="{ 'np-card--selected': selectedId === exp.id }"
              @click="pick(exp)"
            >
              <span v-if="selectedId === exp.id" class="ob-role-ck">●</span>
              <el-avatar :size="40" :src="exp.avatar" class="ob-role-avatar">
                {{ avatarChar(exp.name) }}
              </el-avatar>
              <div class="ob-role-name">{{ exp.name }}</div>
              <div v-if="exp.jobTag || exp.intro" class="ob-role-desc">
                {{ exp.jobTag || exp.intro }}
              </div>
            </button>
          </div>
        </section>

        <!-- 步骤2：认识搭子 + 起名 -->
        <section v-else-if="step === 2">
          <h2 class="ob-title">认识一下，你的搭子</h2>
          <p class="ob-sub">
            系统为「{{ selectedPosition?.jobTag || selectedPosition?.name }}」装配的专属搭子，给 TA 起个名字吧。
          </p>

          <div class="ob-name-row np-card">
            <el-avatar :size="48" :src="selectedPosition?.avatar" class="ob-name-avatar">
              {{ avatarChar(nickname) }}
            </el-avatar>
            <div class="ob-name-field">
              <div class="ob-name-label">搭子名字</div>
              <el-input
                v-model="nickname"
                maxlength="8"
                placeholder="小助"
                class="ob-name-input"
              />
            </div>
          </div>

          <div class="ob-cap-title">TA 能帮你做什么</div>
          <ul class="ob-cap-list">
            <li v-for="c in capabilities" :key="c.title" class="ob-cap-item">
              <span class="ob-cap-icon">{{ c.icon }}</span>
              <span class="ob-cap-text"><b>{{ c.title }}</b> —— {{ c.desc }}</span>
            </li>
          </ul>
        </section>

        <!-- 步骤3：完善信息 -->
        <section v-else>
          <h2 class="ob-title">再花一分钟，让 TA 更懂你</h2>
          <p class="ob-sub">这些信息会自动带入每次对话，你不用反复交代背景。</p>

          <el-form label-position="top" class="ob-form">
            <el-form-item required>
              <template #label>姓名</template>
              <el-input v-model="profile.name" maxlength="64" placeholder="请输入姓名" />
            </el-form-item>
            <el-form-item required>
              <template #label>部门</template>
              <el-input v-model="profile.dept" placeholder="如：政企事业部" />
            </el-form-item>
            <div class="ob-form-grid">
              <el-form-item label="职级">
                <el-input v-model="profile.position" placeholder="如：高级客户经理" />
              </el-form-item>
              <el-form-item label="负责区域">
                <el-input v-model="profile.region" placeholder="如：华东" />
              </el-form-item>
            </div>
          </el-form>
        </section>
      </div>

      <!-- 底部操作 -->
      <div class="ob-foot">
        <el-button
          v-if="step > 1"
          link
          class="ob-prev"
          @click="prev"
        >← 上一步</el-button>
        <div class="ob-foot-right">
          <span v-if="nextHint" class="ob-hint">{{ nextHint }}</span>
          <el-button
            v-if="step < 3"
            type="primary"
            :disabled="!canNext"
            @click="next"
          >下一步</el-button>
          <el-button
            v-else
            type="primary"
            :loading="submitting"
            :disabled="!profileValid"
            @click="finish"
          >完成，开始使用</el-button>
        </div>
      </div>
    </div>

    <!-- 首登采集（PRD-01 §2.9）：有采集字段的岗位在绑定前弹动态采集表单，claim 一体提交（bind + 采集） -->
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
.ob-page {
  min-height: 100vh;
  background: var(--bg-app);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}
.ob-shell {
  width: min(640px, 94vw);
  overflow: hidden;
}

/* 步进条 */
.ob-steps {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-8) var(--space-4);
  border-bottom: 1px solid var(--border-soft);
}
.ob-step {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.ob-step-no {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  background: var(--bg-hover);
  color: var(--c-text-faint);
  transition: background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.ob-step.on {
  color: var(--c-text);
}
.ob-step.on .ob-step-no {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}
.ob-step.cur {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.ob-step-line {
  flex: 1;
  height: 1px;
  background: var(--border-base);
}

/* 内容区 */
.ob-body {
  padding: var(--space-8);
  min-height: 360px;
}
.ob-title {
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-1);
}
.ob-sub {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  margin: 0 0 var(--space-5);
}
.ob-alert {
  margin-bottom: var(--space-4);
}

/* 步骤1 岗位网格 */
.ob-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-3);
  min-height: 120px;
}
.ob-role {
  position: relative;
  text-align: left;
  padding: var(--space-4);
  font: inherit;
}
.ob-role-ck {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  font-size: var(--fs-xs);
  color: var(--c-accent);
}
.ob-role-avatar {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  margin-bottom: var(--space-2);
}
.ob-role-name {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
  margin-bottom: var(--space-1);
}
.ob-role-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* 步骤2 起名 */
.ob-name-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  margin-bottom: var(--space-5);
  background: var(--bg-sunken);
}
.ob-name-avatar {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}
.ob-name-field {
  flex: 1;
}
.ob-name-label {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin-bottom: var(--space-1);
}
.ob-name-input {
  max-width: 200px;
}
.ob-cap-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-muted);
  margin-bottom: var(--space-3);
}
.ob-cap-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.ob-cap-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}
.ob-cap-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ob-cap-text {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
  padding-top: 2px;
}
.ob-cap-text b {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}

/* 步骤3 表单 */
.ob-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.ob-form :deep(.el-form-item__label) {
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

/* 底部操作 */
.ob-foot {
  display: flex;
  align-items: center;
  padding: var(--space-4) var(--space-8);
  border-top: 1px solid var(--border-soft);
}
.ob-prev {
  color: var(--c-text-muted);
}
.ob-foot-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.ob-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

@media (max-width: 560px) {
  .ob-grid,
  .ob-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
