<script setup>
/**
 * 发布前检查清单弹窗（交互规格 §6.2）。
 *
 * 逐项 ✓/✗：硬阻断项（岗位名 / Agent+技能 / 采集完整）+ warning 项（未绑定技能 / 异常工具）。
 * 底部双按钮：「返回修改」/「仍要发布」（有硬阻断项时「仍要发布」disabled，仅 warning 可强发）。
 *
 * check 由 computePublishCheck 计算后由父级传入；本组件只负责呈现 + emit('publish')。
 */
import { computed } from 'vue'
import { Check, Close, Warning } from '@element-plus/icons-vue'
import { validateVersionLabel, versionIncrementHint, VERSION_LABEL_SAMPLE } from '@/utils/positionModel'

const props = defineProps({
  visible: { type: Boolean, default: false },
  check: { type: Object, default: () => ({ items: [], blockingPassed: false }) },
  publishing: { type: Boolean, default: false },
  // N5：展示版本号 + 升级说明（v-model 双向，父级持有并提交）。
  versionLabel: { type: String, default: '' },
  releaseNotes: { type: String, default: '' },
  // 历史最大版本号（供"建议递增"软提示）；无法自动建议版本号时父级传 atMax=true（版本框禁用 + 人话提示）。
  prevMaxLabel: { type: String, default: '' },
  atMax: { type: Boolean, default: false },
  nextLoading: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'update:versionLabel', 'update:releaseNotes', 'publish'])

const canPublish = computed(() => props.check?.blockingPassed)

// N5 版本号格式错（硬拦，报错给样例）。
const versionErr = computed(() => validateVersionLabel(props.versionLabel))
// N5 建议递增软提示（不阻断）。
const incrementHint = computed(() => versionIncrementHint(props.versionLabel, props.prevMaxLabel))
// N5 升级说明必填。
const notesErr = computed(() =>
  String(props.releaseNotes || '').trim() ? '' : '升级说明必填，简述本次更新项'
)

// 可提交发布：硬检查通过 + 版本号合法 + 升级说明非空 + 非到顶。
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
    <div v-else class="check-hint ok">已通过全部检查，填好版本号与升级说明即可发布。</div>

    <!-- N5：版本号 + 升级说明（硬检查通过后才要求填写，避免阻断项未修就先填版本） -->
    <div v-if="canPublish" class="pub-ver">
      <!-- 无法自动建议是「告知非错误」→ 用 warning 语义（与 PositionPublishVersionDialog .pv-max 口径一致），不用 danger 红底。 -->
      <div v-if="atMax" class="check-hint warn">
        无法自动生成建议版本号；如需继续发布请联系管理员处理版本策略。
      </div>
      <template v-else>
        <div class="pub-field">
          <label class="pub-label">版本号 <em>*</em></label>
          <el-input
            :model-value="versionLabel"
            placeholder="例如 v013"
            maxlength="8"
            :disabled="nextLoading"
            class="pub-ver-input"
            @update:model-value="emit('update:versionLabel', $event)"
          />
          <div class="pub-tip">
            <span v-if="versionErr" class="pub-err">{{ versionErr }}</span>
            <span v-else-if="incrementHint" class="pub-warn">{{ incrementHint }}</span>
            <span v-else class="pub-dim">{{ VERSION_LABEL_SAMPLE }}</span>
          </div>
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
/* N5 版本号 + 升级说明区 */
.pub-ver {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-base);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.pub-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pub-label {
  font-size: var(--fs-sm);
  color: var(--c-text);
}
.pub-label em {
  color: var(--c-danger);
  font-style: normal;
}
.pub-ver-input {
  max-width: 180px;
}
.pub-tip {
  min-height: 16px;
  font-size: var(--fs-xs);
}
.pub-err {
  color: var(--c-danger);
}
.pub-warn {
  color: var(--c-warning);
}
.pub-dim {
  color: var(--c-text-faint);
}
</style>
