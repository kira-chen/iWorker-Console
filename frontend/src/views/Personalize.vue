<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getEffectivePosition, updatePositionFields, resetField } from '@/api/myUserPosition'
import RebindConfirmDialog from '@/components/RebindConfirmDialog.vue'
import PositionPickerDialog from '@/components/PositionPickerDialog.vue'
import { useUserStore } from '@/stores/user'
import { useCompanionStore } from '@/stores/companion'
import { useRebindFlow } from '@/composables/useRebindFlow'
import { isCurrentBoundPosition } from '@/utils/positionBinding'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const companionStore = useCompanionStore()

// 方案B/B2：岗位 id 已字符串化（ps_*），路由参数原样作字符串用，不再 Number()。
const positionId = computed(() => route.params.positionId)

// US-6：用户个性化仅两项 —— 岗位人格(persona) + 搭子名称(buddyName)。
// 「搭子名称」即用户给搭子起的名字（前端持久化于 companionStore，并同步后端写通道），
// 不暴露 FDE 术语。
const BUDDY_NAME_MAX = 8

// 未绑定专家个性化拦截（PRD-06 §4.2）：仅当前绑定专家可个性化。
const isBoundPosition = computed(() =>
  isCurrentBoundPosition(positionId.value, userStore.userInfo?.boundPositionId)
)

const view = ref(null)
const loading = ref(false)
const loadError = ref(false)

// 当前用户 id（与 companionStore / 头部口径一致）
const currentUserId = computed(
  () => userStore.userInfo?.userId ?? userStore.userInfo?.id
)

function avatarChar(name) {
  return (name || '岗')[0]
}

// ---------- 搭子名称（buddyName） ----------
// 口径（H4）：以后端有效视图 view.fields.buddyName 为准（{value, origin}）——
//  - origin=USER_OVERRIDE → 用户已自定义；value 即自定义名。
//  - origin=GLOBAL        → 跟随全局（默认 = 岗位 name）。
// companionStore(localStorage) 降级为「就近缓存」：仅在后端值缺失时兜底，避免空白。
const buddyName = ref('')

// 后端有效视图里的搭子名称字段（value/origin）。
const buddyNameField = computed(() => view.value?.fields?.buddyName || null)
// origin 标记：是否用户自定义（true=已自定义 / false=跟随全局）。
const buddyNameCustomized = computed(
  () => (buddyNameField.value?.origin || 'GLOBAL') === 'USER_OVERRIDE'
)

function loadBuddyName() {
  // 优先后端 view.fields.buddyName.value；为空时回退本地缓存，再回退岗位名/默认占位。
  const serverVal = buddyNameField.value?.value
  if (serverVal && String(serverVal).trim()) {
    buddyName.value = serverVal
  } else {
    buddyName.value = companionStore.getNickname(currentUserId.value, positionId.value)
  }
}

async function load() {
  // 未绑定专家个性化拦截：非当前绑定专家不可个性化，拦截并引导走换绑（PRD §4.2）
  if (!isBoundPosition.value) {
    blocked.value = true
    loading.value = false
    return
  }
  blocked.value = false
  loading.value = true
  loadError.value = false
  try {
    view.value = await getEffectivePosition(positionId.value)
    loadBuddyName()
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// 拦截态：进入了非当前绑定专家的个性化页
const blocked = ref(false)

watch(positionId, load)
onMounted(load)

// ---------- 更换搭子（三入口之一：个性化页顶部主入口） ----------
const pickerVisible = ref(false)
const rebindFlow = useRebindFlow({
  onSuccess: (result) => {
    if (result?.changed === false) return
    const newId = result?.newPositionId
    if (newId == null) return
    if (String(newId) !== String(positionId.value)) {
      router.replace({ name: 'Personalize', params: { positionId: newId } })
    } else if (blocked.value) {
      load()
    }
  }
})

function openPicker() {
  pickerVisible.value = true
}

function onPickTarget(id) {
  pickerVisible.value = false
  rebindFlow.start(id)
}

function rebindToThis() {
  rebindFlow.start(positionId.value)
}

function goChat() {
  router.replace({ name: 'Chat' })
}

// ---------- 岗位人格（persona） ----------
function personaVal() {
  return view.value?.fields?.persona?.value ?? ''
}
const personaCustomized = computed(
  () => (view.value?.fields?.persona?.origin || 'GLOBAL') === 'USER_OVERRIDE'
)

const personaEditing = ref(false)
const personaDraft = ref('')

function startPersonaEdit() {
  personaDraft.value = personaVal()
  personaEditing.value = true
}
function cancelPersonaEdit() {
  personaEditing.value = false
}

async function savePersona() {
  try {
    // 写入口已收窄：仅传 persona（后端白名单）
    view.value = await updatePositionFields(positionId.value, { persona: personaDraft.value })
    personaEditing.value = false
    ElMessage.success('已保存，仅对你生效')
  } catch (e) {
    /* 拦截器已提示，保留输入 */
  }
}

async function resetPersona() {
  try {
    await ElMessageBox.confirm(
      '还原后「性格设定」将回到默认，你的自定义内容会丢失。确定还原吗？',
      '还原默认',
      { type: 'warning', confirmButtonText: '还原', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  try {
    view.value = await resetField(positionId.value, 'persona')
    personaEditing.value = false
    ElMessage.success('已还原为默认')
  } catch (e) {
    /* 拦截器已提示 */
  }
}

// ---------- 搭子名称编辑 ----------
const nameEditing = ref(false)
const nameDraft = ref('')

function startNameEdit() {
  nameDraft.value = buddyName.value
  nameEditing.value = true
}
function cancelNameEdit() {
  nameEditing.value = false
}

async function saveName() {
  const next = (nameDraft.value || '').trim()
  if (!next) {
    ElMessage.warning('请给搭子起个名字')
    return
  }
  try {
    // 同步后端写通道（字段名 buddyName，后端白名单两项之一）。后端落库后返回最新有效视图，
    // 据 view.fields.buddyName.value/origin 刷新展示与 origin 标记；companionStore 仅做就近缓存兜底。
    view.value = await updatePositionFields(positionId.value, { buddyName: next })
    loadBuddyName()
  } catch (e) {
    /* 后端写通道异常：拦截器已提示，名字仍以本地为准持久化保证可用性 */
    buddyName.value = next
  }
  companionStore.setNickname(currentUserId.value, positionId.value, next)
  nameEditing.value = false
  ElMessage.success('已更新搭子名称')
}

// 搭子名称「单项还原」（对齐 persona 的 resetField）：清除 buddyName 覆盖 → 回到跟随全局（岗位名）。
async function resetName() {
  try {
    await ElMessageBox.confirm(
      '还原后「搭子名称」将回到默认（跟随系统设定的名字），你起的名字会丢失。确定还原吗？',
      '还原默认',
      { type: 'warning', confirmButtonText: '还原', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  try {
    view.value = await resetField(positionId.value, 'buddyName')
    // 还原后 origin=GLOBAL、value=岗位名（非空），loadBuddyName 直接取后端值，
    // 不会回退到本地缓存，故无需清缓存（缓存仅在后端值缺失时兜底）。
    loadBuddyName()
    nameEditing.value = false
    ElMessage.success('已还原为默认')
  } catch (e) {
    /* 拦截器已提示 */
  }
}

function goBack() {
  router.back()
}
</script>

<template>
  <div class="pz-page">
    <div class="pz-back">
      <el-button link @click="goBack"><el-icon><ArrowLeft /></el-icon> 返回</el-button>
    </div>

    <!-- 未绑定搭子个性化拦截态：引导走更换搭子流程（PRD §4.2） -->
    <div v-if="blocked" class="pz-card center">
      <el-empty description="这不是你当前的搭子，无法个性化" :image-size="96">
        <div class="blocked-note">
          要把它设为你的搭子，需先将其更换为你的当前搭子——
          这会替换并永久清除你当前搭子的个性化。
        </div>
        <div class="blocked-actions">
          <el-button @click="goChat">返回对话</el-button>
          <el-button type="primary" @click="rebindToThis">更换为该搭子</el-button>
        </div>
      </el-empty>
    </div>

    <div v-else-if="loading" class="pz-card">
      <el-skeleton :rows="6" animated />
    </div>
    <div v-else-if="loadError" class="pz-card center">
      <el-empty description="加载失败" :image-size="96">
        <el-button @click="load">重试</el-button>
      </el-empty>
    </div>

    <template v-else-if="view">
      <!-- 搭子头卡 -->
      <div class="pz-card pz-hero">
        <el-avatar :size="64" :src="view.fields?.avatar?.value" class="hero-av">
          {{ avatarChar(buddyName || view.name) }}
        </el-avatar>
        <div class="hero-meta">
          <div class="hero-name">{{ buddyName || view.name }}</div>
          <el-tag size="small" class="hero-tag" effect="plain">{{ view.jobTag }}</el-tag>
          <div class="hero-note">这是你的专属搭子，下面两项可以按你的喜好调整</div>
        </div>
        <el-button class="hero-rebind" plain @click="openPicker">
          <el-icon><Switch /></el-icon> 更换搭子
        </el-button>
      </div>

      <!-- 搭子名称 -->
      <div class="pz-card">
        <div class="pz-sec-head">
          <span class="pz-sec-title">搭子名称</span>
          <span class="pz-sec-sub">给你的搭子起个名字，对话里就用这个称呼</span>
        </div>
        <div class="field-row">
          <div class="field-head">
            <span class="field-label">名字</span>
            <span class="field-flag" :class="buddyNameCustomized ? 'custom' : 'follow'">
              {{ buddyNameCustomized ? '已自定义' : '跟随全局' }}
            </span>
            <div class="field-ops">
              <el-button v-if="!nameEditing" link @click="startNameEdit">编辑</el-button>
              <el-button
                v-if="buddyNameCustomized && !nameEditing"
                link
                type="danger"
                @click="resetName"
              >还原默认</el-button>
            </div>
          </div>
          <div v-if="nameEditing" class="field-edit">
            <el-input
              v-model="nameDraft"
              :maxlength="BUDDY_NAME_MAX"
              show-word-limit
              placeholder="给搭子起个名字"
            />
            <div class="edit-actions">
              <el-button @click="cancelNameEdit">取消</el-button>
              <el-button type="primary" @click="saveName">保存</el-button>
            </div>
          </div>
          <div v-else class="field-value">{{ buddyName }}</div>
        </div>
      </div>

      <!-- 岗位人格 -->
      <div class="pz-card">
        <div class="pz-sec-head">
          <span class="pz-sec-title">搭子性格</span>
          <span class="pz-sec-sub">设定搭子的说话风格与性格，调整仅对你生效</span>
        </div>
        <div class="field-row">
          <div class="field-head">
            <span class="field-label">性格设定</span>
            <span class="field-flag" :class="personaCustomized ? 'custom' : 'follow'">
              {{ personaCustomized ? '已自定义' : '跟随全局' }}
            </span>
            <div class="field-ops">
              <el-button
                v-if="!personaEditing"
                link
                @click="startPersonaEdit"
              >编辑</el-button>
              <el-button
                v-if="personaCustomized && !personaEditing"
                link
                type="danger"
                @click="resetPersona"
              >还原默认</el-button>
            </div>
          </div>
          <div v-if="personaEditing" class="field-edit">
            <el-input
              v-model="personaDraft"
              type="textarea"
              :rows="4"
              maxlength="1000"
              show-word-limit
              placeholder="例如：说话简洁、先给结论再给理由，遇到不确定的会主动确认。"
            />
            <div class="edit-actions">
              <el-button @click="cancelPersonaEdit">取消</el-button>
              <el-button type="primary" @click="savePersona">保存</el-button>
            </div>
          </div>
          <div v-else class="field-value">
            <span>{{ personaVal() || '（空，使用默认性格）' }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 更换搭子：选目标 -->
    <PositionPickerDialog v-model:visible="pickerVisible" @pick="onPickTarget" />

    <!-- 更换搭子：强提示二次确认 -->
    <RebindConfirmDialog
      v-model:visible="rebindFlow.visible.value"
      :preview="rebindFlow.preview.value"
      :loading="rebindFlow.loading.value"
      :error="rebindFlow.error.value"
      :submitting="rebindFlow.submitting.value"
      @confirm="rebindFlow.confirm"
      @retry="rebindFlow.retry"
    />
  </div>
</template>

<style scoped>
.pz-page {
  max-width: 880px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.pz-back {
  margin-bottom: -8px;
}
.pz-back :deep(.el-button) {
  color: var(--c-text-muted);
}
.pz-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: var(--space-5);
}
.pz-card.center {
  display: flex;
  justify-content: center;
}

/* 头卡 */
.pz-hero {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.hero-av {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
}
.hero-name {
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.hero-tag {
  margin-top: var(--space-1);
}
.hero-note {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.hero-rebind {
  margin-left: auto;
  align-self: flex-start;
}

/* 拦截态 */
.blocked-note {
  max-width: 420px;
  margin: var(--space-2) auto var(--space-4);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.blocked-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-3);
}

.pz-sec-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.pz-sec-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.pz-sec-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  flex: 1;
}

/* 字段行 */
.field-row {
  padding: var(--space-2) 0;
}
.field-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.field-label {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.field-flag {
  font-size: var(--fs-xs);
  padding: 1px 10px;
  border-radius: var(--radius-pill);
}
.field-flag.custom {
  color: var(--c-accent);
  background: var(--c-accent-soft);
}
.field-flag.follow {
  color: var(--c-text-muted);
  background: var(--bg-hover);
}
.field-ops {
  margin-left: auto;
  display: flex;
  gap: var(--space-2);
}
.field-value {
  margin-top: var(--space-2);
  color: var(--c-text);
  line-height: var(--lh-base);
  white-space: pre-wrap;
  word-break: break-word;
}
.field-edit {
  margin-top: var(--space-2);
}
.edit-actions {
  margin-top: var(--space-2);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
