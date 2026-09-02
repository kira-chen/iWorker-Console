<script setup>
/**
 * 更换/解绑专家 · 强提示二次确认弹窗（PRD-06 §3.3）。
 *
 * 设计要点：
 *  - ElMessageBox 强度不够（一键即过），改用自定义 el-dialog + 显式勾选门槛：
 *    必须勾选确认门槛才点亮确认按钮。
 *  - 明确告知三件事：将永久清除什么（具体字段中文名 + Skill 中文 name）、
 *    将保留什么（会话/记忆/定时任务）、不可恢复说明。
 *  - 覆盖 loading（拉 preview 中）/ error（拉取失败可重试）态。
 *  - 选回当前专家（sameAsCurrent，仅 rebind）：禁用确认并提示「已是当前专家」。
 *
 * 双模式（mode）复用同款强确认范式与样式：
 *  - rebind（默认）：更换为目标专家，preview.targetExpert 为新专家。
 *  - unbind：解绑当前专家（targetExpert=null），解绑后需重新选专家才能继续使用系统。
 *
 * 数据流：父组件控制 visible，并传入 preview / loading / error / submitting。
 *  - confirm 事件：用户勾选后点确认时触发，由父组件去调 rebind / unbind。
 *  - retry 事件：error 态点重试，父组件重新拉 preview。
 *  - 关闭即取消，不做任何改动（PRD §3.3）。
 */
import { ref, computed, watch } from 'vue'
import { canConfirmRebind } from '@/utils/rebindGate'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 模式：'rebind'=更换专家（默认）；'unbind'=解绑当前专家
  mode: { type: String, default: 'rebind' },
  // 预览数据（rebind-preview / unbind-preview 的 data），结构见接口契约 §1
  preview: { type: Object, default: null },
  loading: { type: Boolean, default: false }, // 拉 preview 中
  error: { type: Boolean, default: false }, // 拉 preview 失败
  submitting: { type: Boolean, default: false } // 换绑/解绑提交中
})

const emit = defineEmits(['update:visible', 'confirm', 'retry'])

// 勾选门槛：弹窗每次打开都重置为未勾选，避免沿用上次状态误触
const acknowledged = ref(false)
watch(
  () => props.visible,
  (v) => {
    if (v) acknowledged.value = false
  }
)

const isUnbind = computed(() => props.mode === 'unbind')
const dialogTitle = computed(() => (isUnbind.value ? '解绑搭子' : '更换搭子'))
const confirmText = computed(() => (isUnbind.value ? '确认解绑' : '确认更换'))

const currentName = computed(() => props.preview?.currentExpert?.name || '当前搭子')
const targetName = computed(() => props.preview?.targetExpert?.name || '新搭子')
// 解绑无目标专家，不存在「选回当前」语义，恒为 false
const sameAsCurrent = computed(() => !isUnbind.value && props.preview?.sameAsCurrent === true)

const willClear = computed(() => props.preview?.willClear || {})
const customizedFields = computed(() => willClear.value.customizedFields || [])
// Skill 仅展示中文 name（不暴露 code，契约铁律）
const personalizedSkills = computed(() =>
  (willClear.value.personalizedSkills || []).map((s) => s?.name).filter(Boolean)
)
const hasAnyClear = computed(
  () => customizedFields.value.length > 0 || personalizedSkills.value.length > 0
)

const irreversibleNote = computed(() => {
  if (props.preview?.irreversibleNote) return props.preview.irreversibleNote
  return isUnbind.value
    ? '解绑后当前搭子的个性化将被永久清除，重新绑定该搭子也不会恢复（全新空白开始）；会话、记忆、定时任务保留不变。'
    : '更换后旧搭子的个性化将被永久清除，换回该搭子也不会恢复；会话、记忆、定时任务保留不变。'
})

// 确认按钮点亮条件（判定逻辑抽到 utils/rebindGate 便于单测）：
// preview 就绪、非选回当前、已勾选门槛、未在提交中
const canConfirm = computed(() =>
  canConfirmRebind({
    loading: props.loading,
    error: props.error,
    sameAsCurrent: sameAsCurrent.value,
    acknowledged: acknowledged.value,
    submitting: props.submitting
  })
)

function onClose() {
  if (props.submitting) return // 提交中不允许关闭，防半截
  emit('update:visible', false)
}

function onConfirm() {
  if (!canConfirm.value) return
  emit('confirm')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="dialogTitle"
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="!submitting"
    class="rebind-dialog"
    @update:model-value="onClose"
  >
    <!-- loading：拉取预览中 -->
    <div v-if="loading" class="rb-state">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- error：拉取失败可重试 -->
    <div v-else-if="error" class="rb-state rb-center">
      <el-empty description="加载更换影响失败" :image-size="80">
        <el-button type="primary" @click="emit('retry')">重试</el-button>
      </el-empty>
    </div>

    <!-- 正常：强提示内容 -->
    <template v-else-if="preview">
      <!-- 选回当前专家：识别为无变化，禁用确认 -->
      <el-alert
        v-if="sameAsCurrent"
        type="info"
        :closable="false"
        show-icon
        class="rb-alert"
        title="这已是你当前的搭子"
        description="无需更换；如需更换，请选择其他搭子。"
      />

      <template v-else>
        <div v-if="isUnbind" class="rb-lead">
          解绑「<b>{{ currentName }}</b>」前，请确认以下影响——这是一次<b>不可恢复</b>的解绑。
        </div>
        <div v-else class="rb-lead">
          更换为「<b>{{ targetName }}</b>」前，请确认以下影响——这是一次<b>不可恢复</b>的替换。
        </div>

        <!-- 将被永久清除 -->
        <div class="rb-block rb-danger">
          <div class="rb-block-title">
            <el-icon><WarningFilled /></el-icon>
            将被永久清除（不可恢复）
          </div>
          <div class="rb-block-body">
            你在「{{ currentName }}」上的全部个性化将被<b>永久清除且无法找回</b>。
            <template v-if="hasAnyClear">
              <div v-if="customizedFields.length" class="rb-detail-row">
                <span class="rb-detail-label">已自定义字段</span>
                <el-tag
                  v-for="f in customizedFields"
                  :key="f"
                  size="small"
                  type="danger"
                  effect="light"
                  class="rb-tag"
                >{{ f }}</el-tag>
              </div>
              <div v-if="personalizedSkills.length" class="rb-detail-row">
                <span class="rb-detail-label">已私有化 Skill</span>
                <el-tag
                  v-for="(s, i) in personalizedSkills"
                  :key="i"
                  size="small"
                  type="danger"
                  effect="light"
                  class="rb-tag"
                >{{ s }}</el-tag>
              </div>
            </template>
            <div v-else class="rb-hint">
              <template v-if="isUnbind">当前搭子暂无任何个性化内容，解绑后将无绑定搭子。</template>
              <template v-else>当前搭子暂无任何个性化内容，更换后将直接以新搭子全新开始。</template>
            </div>
          </div>
        </div>

        <!-- 将保留 -->
        <div class="rb-block rb-keep">
          <div class="rb-block-title">
            <el-icon><CircleCheckFilled /></el-icon>
            将保留（不受影响）
          </div>
          <div class="rb-block-body">
            你与「{{ currentName }}」的<b>对话记录</b>、<b>记忆</b>与已创建的<b>定时任务</b>均会保留，可继续查看 / 运行。
          </div>
        </div>

        <!-- 将开始 / 解绑后 -->
        <div class="rb-block rb-start">
          <div class="rb-block-title">
            <el-icon><Refresh /></el-icon>
            {{ isUnbind ? '解绑后' : '更换后' }}
          </div>
          <div v-if="isUnbind" class="rb-block-body">
            你将<b>不再绑定任何搭子</b>，需<b>重新选择搭子</b>才能继续使用系统。
          </div>
          <div v-else class="rb-block-body">
            「{{ targetName }}」将以<b>全新空白状态</b>开始，你可以从头个性化它。
          </div>
        </div>

        <div class="rb-note">{{ irreversibleNote }}</div>

        <!-- 勾选门槛：勾选后才点亮确认 -->
        <el-checkbox v-model="acknowledged" class="rb-ack" :disabled="submitting">
          {{ isUnbind ? '我已知晓将永久清除且需重新选搭子' : '我已知晓将永久清除且不可恢复' }}
        </el-checkbox>
      </template>
    </template>

    <template #footer>
      <el-button :disabled="submitting" @click="onClose">取消</el-button>
      <el-button
        :type="isUnbind ? 'danger' : 'primary'"
        :loading="submitting"
        :disabled="!canConfirm"
        @click="onConfirm"
      >{{ confirmText }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rb-state {
  min-height: 160px;
}
.rb-center {
  display: flex;
  justify-content: center;
  align-items: center;
}
.rb-alert {
  margin-bottom: var(--space-2);
}
.rb-lead {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  line-height: var(--lh-base);
  margin-bottom: var(--space-4);
}

.rb-block {
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
  border: 1px solid var(--border-soft);
  background: var(--bg-sunken);
}
.rb-block-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  margin-bottom: var(--space-2);
}
.rb-block-body {
  font-size: var(--fs-sm);
  color: var(--c-text);
  line-height: var(--lh-base);
}
.rb-danger {
  border-color: var(--c-danger);
  background: var(--c-danger-soft);
}
.rb-danger .rb-block-title {
  color: var(--c-danger);
}
.rb-keep {
  border-color: var(--c-success);
  background: var(--c-success-soft);
}
.rb-keep .rb-block-title {
  color: var(--c-success);
}
.rb-start .rb-block-title {
  color: var(--c-accent);
}

.rb-detail-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.rb-detail-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.rb-tag {
  margin: 0;
}
.rb-hint {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.rb-note {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: var(--lh-base);
  margin: var(--space-3) 0 var(--space-4);
  padding: var(--space-2) var(--space-3);
  border-left: 2px solid var(--border-base);
  background: var(--bg-hover);
  border-radius: var(--radius-xs);
}
.rb-ack {
  font-weight: var(--fw-medium);
}
.rb-ack :deep(.el-checkbox__label) {
  color: var(--c-danger);
}
</style>
