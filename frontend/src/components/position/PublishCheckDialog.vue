<script setup>
/**
 * 发布前检查清单弹窗（md §9.2 · 原型 openPub L2132 + positionPublishHtml L1224）。
 *
 * 2026-09-08 PRD-20260908 对齐：
 * - 清单四行（岗位名称与描述 / 示例问题 / 岗位 SOP 硬阻断，Agent 与技能 ! 警告不阻断），
 *   文案由 computePublishCheck 按原型逐字给出；本组件只呈现 + emit('publish')。
 * - 版本号不再手填（md §3.7「系统根据所选类型自动计算并填充下一个版本号，不支持手动输入」）：
 *   改为「更新类型」三选一（文案与顺序照原型 L1224：修订版本 / 功能更新 / 重大更新）+ 只读版本号
 *   + 类型 hint（原型 positionBumpHint）；首个版本无类型可选、hint「首个版本」。算号由父级
 *   useVersionPublish.setBump 承担，本组件经 v-model:bump 回吐类型。
 * - 底部双按钮：「返回修改」/「发布」（硬阻断项未过时「发布」disabled，仅 warning 可强发）。
 */
import { computed } from 'vue'
import { Check, Close, Warning } from '@element-plus/icons-vue'
import { validateVersionLabel, POSITION_BUMP_OPTIONS } from '@/utils/positionModel'

const props = defineProps({
  visible: { type: Boolean, default: false },
  check: { type: Object, default: () => ({ items: [], blockingPassed: false }) },
  publishing: { type: Boolean, default: false },
  // 自动算出的版本号（只读展示）+ 升级说明（v-model 双向，父级持有并提交）。
  versionLabel: { type: String, default: '' },
  releaseNotes: { type: String, default: '' },
  // 升级类型（v-model）：NONE 修订版本 / MINOR 功能更新 / MAJOR 重大更新
  bump: { type: String, default: 'NONE' },
  // 首个版本：无升级类型可选，版本号固定 v1.0.0、hint「首个版本」
  firstPublish: { type: Boolean, default: false },
  // 无法自动建议版本号时父级传 atMax=true（人话提示 + 禁发）。
  atMax: { type: Boolean, default: false },
  nextLoading: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'update:releaseNotes', 'update:bump', 'publish'])

const canPublish = computed(() => props.check?.blockingPassed)

// 版本号由系统算出；仅当上游降级（建议号拉取失败留空）时提示，避免发出空版本号。
const versionErr = computed(() => validateVersionLabel(props.versionLabel))
// 升级说明必填。
const notesErr = computed(() =>
  String(props.releaseNotes || '').trim() ? '' : '升级说明必填，简述本次更新项'
)
const bumpHint = computed(() =>
  props.firstPublish ? '首个版本' : POSITION_BUMP_OPTIONS.find((o) => o.value === props.bump)?.hint || ''
)

// 可提交发布：硬检查通过 + 版本号已算出 + 升级说明非空 + 非到顶。
const canSubmit = computed(
  () => canPublish.value && !props.atMax && !versionErr.value && !notesErr.value
)
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="发布前检查"
    width="460px"
    @update:model-value="emit('update:visible', $event)"
  >
    <ul class="check-list">
      <li v-for="item in check.items" :key="item.key" class="check-item">
        <el-icon v-if="item.ok" class="ci-ok"><Check /></el-icon>
        <el-icon v-else-if="item.warning" class="ci-warn"><Warning /></el-icon>
        <el-icon v-else class="ci-bad"><Close /></el-icon>
        <div class="ci-main">
          <div class="ci-label" :class="{ warn: item.warning, bad: !item.ok && !item.warning }">
            {{ item.label }}
          </div>
          <div v-if="item.detail" class="ci-detail">{{ item.detail }}</div>
        </div>
      </li>
    </ul>
    <div v-if="!canPublish" class="check-hint bad">存在硬阻断项，修复后才能发布。</div>
    <div v-else-if="check.warnings && check.warnings.length" class="check-hint warn">
      存在告警项（不阻断），可选择修复或仍要发布。
    </div>
    <div v-else class="check-hint ok">已通过全部检查，选择更新类型并填写升级说明即可发布。</div>

    <!-- 发布表单（硬检查通过后才出：更新类型 → 版本号（只读）→ 升级说明，顺序照原型 L1224） -->
    <div v-if="canPublish" class="pub-ver">
      <!-- 无法自动建议是「告知非错误」→ 用 warning 语义，不用 danger 红底。 -->
      <div v-if="atMax" class="check-hint warn">
        无法自动生成建议版本号；如需继续发布请联系管理员处理版本策略。
      </div>
      <template v-else>
        <div v-if="!firstPublish" class="pub-row">
          <span class="pub-label">更新类型</span>
          <el-radio-group
            :model-value="bump"
            :disabled="nextLoading"
            class="pub-bump"
            @update:model-value="emit('update:bump', $event)"
          >
            <el-radio-button v-for="o in POSITION_BUMP_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="pub-row">
          <span class="pub-label">版本号</span>
          <span class="pub-ver-num">{{ nextLoading ? '…' : versionLabel || '—' }}</span>
          <span v-if="versionErr && !nextLoading" class="pub-err">{{ versionErr }}</span>
          <span v-else class="pub-dim">{{ bumpHint }}</span>
        </div>
        <div class="pub-field">
          <label class="pub-label">升级说明 <em>*</em></label>
          <el-input
            :model-value="releaseNotes"
            type="textarea"
            :rows="3"
            maxlength="2000"
            show-word-limit
            placeholder="简述本次更新了什么，方便记录与追溯"
            @update:model-value="emit('update:releaseNotes', $event)"
          />
          <div class="pub-tip">
            <span v-if="notesErr" class="pub-err">{{ notesErr }}</span>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <el-button @click="emit('update:visible', false)">返回修改</el-button>
      <el-button type="primary" :disabled="!canSubmit" :loading="publishing" @click="emit('publish')">
        发布
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.check-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.check-item {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
}
.ci-ok {
  color: var(--c-success);
  margin-top: 2px;
}
.ci-warn {
  color: var(--c-warning);
  margin-top: 2px;
}
.ci-bad {
  color: var(--c-danger);
  margin-top: 2px;
}
.ci-label {
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.ci-label.warn {
  color: var(--c-warning);
}
.ci-label.bad {
  color: var(--c-danger);
}
.ci-detail {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin-top: 2px;
}
.check-hint {
  margin-top: var(--space-4);
  font-size: var(--fs-xs);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}
.check-hint.ok {
  color: var(--c-success);
  background: var(--c-success-soft);
}
.check-hint.warn {
  color: var(--c-warning);
  background: var(--c-warning-soft);
}
.check-hint.bad {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
/* 发布表单区：更新类型 / 版本号（只读）/ 升级说明 */
.pub-ver {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-base);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.pub-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 32px;
}
.pub-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pub-label {
  flex: none;
  min-width: 64px;
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.pub-label em {
  color: var(--c-danger);
  font-style: normal;
}
/* 只读版本号（原型 .version-number：等宽强调） */
.pub-ver-num {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.pub-tip {
  min-height: 16px;
  font-size: var(--fs-xs);
}
.pub-err {
  color: var(--c-danger);
  font-size: var(--fs-xs);
}
.pub-dim {
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
}
</style>
