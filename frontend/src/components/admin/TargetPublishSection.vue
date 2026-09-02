<script setup>
/**
 * 共享「目标态行 + 操作 + 多选提交」子组件（V39 S3，发布下沉）。
 *
 * 单一职责：承载「两目标(FDE 工作台 / 用户端)行 + 当前发布态徽标 + 该态启停操作（撤回/下架/重新上架）
 * + 提交发布多选区」——供「连接器发布抽屉(ConnectorPublishDrawer)」复用。
 * （注：平台技能发布已去分端并合入统一的「版本管理」抽屉 VersionDrawer，不再复用本组件。）
 *
 * 安全属性（读/写性质 writeClass + 二次确认 requiresConfirmation）已于 V40 下沉工具定义层，由 MCP/API
 * 工具定义配置、发布提交不再填；本组件原 showSecurity 安全属性区已随之删除（两调用方均不展示）。
 *
 * 本组件不持有发布态、不调 API：发布态以入参 targetRows 为准（父组件据 marketMeta/skillPublication 算好），
 * 写动作通过 emit 上抛父组件就地执行（工具/技能落不同端点，由父分流）。所有按钮在 busy 时禁用/loading。
 */
import { computed } from 'vue'
import StatusTag from '@/components/StatusTag.vue'
import { TARGETS } from '@/utils/marketMeta'

const props = defineProps({
  // 每目标当前态行：[{ target, label, status, actions:[], rejectComment }]（父据状态工具函数算好）
  targetRows: { type: Array, default: () => [] },
  // status → StatusTag type 映射函数（工具/技能各传各的，口径一致）
  statusTagType: { type: Function, required: true },
  // status → 中文标签函数
  statusLabel: { type: Function, required: true },
  // 启停动作元数据：{ [action]: { btn, btnType } }（撤回/下架/重新上架；父侧 ACTION_META 同源）
  actionMeta: { type: Object, default: () => ({}) },
  // 任一写操作进行中 → 全段禁用/按钮 loading
  busy: { type: Boolean, default: false },
  // 提交发布勾选（v-model）
  checked: { type: Array, default: () => [] },
  // 额外的「提交发布」禁用条件（默认 false 不影响连接器；平台技能 N6 用它在版本号/升级说明未就绪时禁用提交）
  submitDisabled: { type: Boolean, default: false },
  // 禁用原因 tooltip（可选）：非空时给「提交发布」按钮包 tooltip 复述禁用原因（如无法自动建议版本号），
  // 别让用户对着灰按钮猜。空串（默认）则不包 tooltip，连接器等调用方不受影响。
  submitDisabledReason: { type: String, default: '' }
})
const emit = defineEmits([
  'update:checked',
  'submit', // (checkedTargets) 提交本段勾选目标
  'action' // ({ action, row }) 撤回/下架/重新上架
])

// 可纳入「提交发布」的目标（NONE / REJECTED → actions 含 'publish'）
const publishableTargets = computed(() =>
  props.targetRows.filter((r) => r.actions.includes('publish')).map((r) => r.target)
)
// 被驳回且带意见的目标（展示驳回原因，便于作者修改后重提）
const rejectedRows = computed(() => props.targetRows.filter((r) => r.rejectComment))

// 勾选区显示的目标行（按 TARGETS 固定顺序）
const publishableRows = computed(() =>
  TARGETS.map((t) => props.targetRows.find((r) => r.target === t)).filter(
    (r) => r && publishableTargets.value.includes(r.target)
  )
)

const checkedModel = computed({
  get: () => props.checked,
  set: (v) => emit('update:checked', v)
})

function onSubmit() {
  emit('submit', [...props.checked])
}
function onAction(action, row) {
  emit('action', { action, row })
}
function actionBtn(action) {
  return props.actionMeta[action] || null
}
// 勾选区每行备注：行带 checkNote（平台技能 R1 每态备注）优先；未提供（连接器）沿用「被驳回」旧文案。
function checkNoteOf(row) {
  if (row.checkNote != null) return row.checkNote
  return row.status === 'REJECTED' ? '（被驳回，可修改后重新提交）' : ''
}
</script>

<template>
  <div class="tps">
    <!-- 每目标当前态 + 启停操作；提交发布走下方多选区，不在此行 -->
    <div class="tps-targets">
      <div v-for="r in targetRows" :key="r.target" class="tps-row">
        <span class="tps-tname">{{ r.label }}</span>
        <StatusTag v-if="r.status !== 'NONE'" :type="statusTagType(r.status)">
          {{ statusLabel(r.status) }}
        </StatusTag>
        <span v-else class="tps-none">未发布</span>
        <span class="tps-sp"></span>
        <template v-for="a in r.actions" :key="a">
          <el-button
            v-if="actionBtn(a)"
            link
            :type="actionBtn(a).btnType"
            :disabled="busy"
            @click="onAction(a, r)"
          >
            {{ actionBtn(a).btn }}
          </el-button>
        </template>
      </div>
      <!-- 被驳回目标：展示驳回原因 -->
      <div v-for="r in rejectedRows" :key="`rej-${r.target}`" class="tps-reject">
        <span class="tps-reject-t">{{ r.label }} 被驳回：</span>{{ r.rejectComment }}
      </div>
    </div>

    <!-- 提交发布区：仅未发布 / 被驳回目标可勾 -->
    <div v-if="publishableTargets.length" class="tps-submit">
      <div class="tps-sub-title">提交发布到</div>
      <el-checkbox-group v-model="checkedModel" :disabled="busy">
        <el-checkbox v-for="r in publishableRows" :key="r.target" :value="r.target">
          {{ r.label }}
          <span v-if="checkNoteOf(r)" class="tps-re">{{ checkNoteOf(r) }}</span>
        </el-checkbox>
      </el-checkbox-group>

      <div class="tps-actions">
        <!-- 禁用且有原因时用 tooltip 复述原因（如无法自动建议版本号）；禁用态下按钮不响应 hover，
             故用外层 span 承接 tooltip 触发（Element Plus 惯用法）。无原因则不包 tooltip。 -->
        <el-tooltip
          v-if="submitDisabledReason && (submitDisabled || !checked.length)"
          :content="submitDisabledReason"
          placement="top"
        >
          <span class="tps-submit-wrap">
            <el-button
              type="primary"
              :loading="busy"
              :disabled="!checked.length || submitDisabled"
              @click="onSubmit"
            >
              提交发布
            </el-button>
          </span>
        </el-tooltip>
        <el-button
          v-else
          type="primary"
          :loading="busy"
          :disabled="!checked.length || submitDisabled"
          @click="onSubmit"
        >
          提交发布
        </el-button>
      </div>
    </div>
    <div v-else class="tps-allset">两个目标均已提交/发布，无可新提交的目标。</div>
  </div>
</template>

<style scoped>
.tps {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.tps-targets {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--bg-sunken);
  border-radius: var(--radius-md);
}
.tps-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.tps-tname {
  font-size: var(--fs-sm);
  color: var(--c-text);
  min-width: 84px;
}
.tps-none {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.tps-sp {
  flex: 1;
}
.tps-reject {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  line-height: 1.5;
}
.tps-reject-t {
  font-weight: var(--fw-medium);
}
.tps-submit {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.tps-sub-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text);
}
.tps-re {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.tps-actions {
  display: flex;
  justify-content: flex-end;
}
/* tooltip 承接 span：内联包裹禁用按钮，不影响布局 */
.tps-submit-wrap {
  display: inline-flex;
}
.tps-allset {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
</style>
