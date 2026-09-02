<script setup>
/**
 * 治理页共享「业务原生详情」分发器（2026-09-01 PRD 对齐改造，审核中心 / 我的申请共用）。
 *
 * 按业务类型把「查看 / 前往修改」分发到各业务模块自己的编辑器（只读或编辑态打开，
 * 编辑器组件本身零改动）：
 *   EXPERT      → ExpertEditor（readonly）
 *   MCP         → McpEditor（readonly）
 *   API         → ApiEditor（readonly）
 *   BIZ_SYSTEM  → BizSystemEditor（readonly）
 *   MODEL       → ModelConfigEditDialog（readonly，入参 model 对象由行数据合成）
 *   POSITION    → 本组件内置简易只读抽屉（岗位抽屉尚未拍板——岗位模块 Q4，
 *                 暂展示 名称/描述/提交人/提交时间，待岗位抽屉拍板后接入）
 * SKILL（跳技能整页只读）与 OTHER（toast）不进本组件，由页面路由/提示自行处理。
 *
 * 【吸底操作栏】审核中心要求详情底部为 关闭|驳回|通过、我的申请按状态出按钮，而各编辑器
 * 只读态的底部动作条固定只有「关闭」且不可注入（不修改编辑器的前提约束）。故本组件用
 * teleport 到 body 的固定吸底条覆盖在抽屉底部动作区上（宽度随抽屉宽），按钮由调用方
 * 通过 buttons 传入、点击经 action 事件上抛。z-index 取 3000（高于 EP 弹层默认递增区间）。
 *
 * 【抽屉宽度】PRD §4.1 要求专家/岗位/MCP/API/业务系统 780px、模型 820px；既有编辑器
 * 统一走 DrawerEditor 默认 720px 且不外露宽度入参（不改编辑器），故仅本组件自持的
 * POSITION 抽屉按 780px 落地，其余维持编辑器现宽（差异已在 PRD-review 记录待拍板）。
 */
import { ref, computed, watch } from 'vue'
import ExpertEditor from '@/components/admin/ExpertEditor.vue'
import McpEditor from '@/components/admin/McpEditor.vue'
import ApiEditor from '@/components/admin/ApiEditor.vue'
import BizSystemEditor from '@/components/admin/BizSystemEditor.vue'
import ModelConfigEditDialog from '@/components/admin/ModelConfigEditDialog.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 业务类型（归一化）：EXPERT | POSITION | MCP | API | BIZ_SYSTEM | MODEL。 */
  kind: { type: String, default: '' },
  /** 业务实体 id（传给对应编辑器；mock 期仅 MCP/API 指向真实 mock 实体）。 */
  refId: { type: [Number, String], default: null },
  /** 原始行（审核行或申请行），用于 POSITION 简易抽屉与 MODEL 合成对象。 */
  item: { type: Object, default: null },
  /** 只读打开（默认）；我的申请「前往修改」传 false 走编辑态。 */
  readonly: { type: Boolean, default: true },
  /**
   * 吸底操作栏按钮：[{ key, label, type?('primary'|'danger'|''), loadingKey? }]。
   * 空数组 = 不出吸底条（沿用编辑器自身「关闭」）。
   */
  buttons: { type: Array, default: () => [] },
  /** 进行中的按钮 key（转圈 + 全条禁点防重复提交）。 */
  busyKey: { type: String, default: '' }
})
const emit = defineEmits(['update:visible', 'action'])

const vis = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

// 行字段归一化：审核行 name/submitterName ↔ 申请行 objectName/submitter
const displayName = computed(() => props.item?.name || props.item?.objectName || '')
const submitter = computed(() => props.item?.submitterName || props.item?.submitter || '—')

// MODEL：ModelConfigEditDialog 以 model 对象（列表行 VO）为入参，不自取数——
// 打开时按 refId 拉模型行（adminModel mock），取到前先用行数据合成最小对象兜底。
const modelRow = ref(null)
watch(
  () => [props.visible, props.kind, props.refId],
  async ([visible, kind, refId]) => {
    if (!visible || kind !== 'MODEL' || refId == null) return
    modelRow.value = null
    try {
      // 动态引：避免把 api/request → @/router 链条带进引用本组件页面的单测模块图
      const { getModel } = await import('@/api/adminModel')
      modelRow.value = await getModel(refId)
    } catch (e) {
      /* 取不到（demo 无对应实体）→ 保持合成对象兜底 */
    }
  },
  { immediate: true }
)
const modelObj = computed(
  () =>
    modelRow.value ||
    (props.item ? { id: props.refId, name: displayName.value, description: props.item.description || '' } : null)
)

// 吸底条宽度随抽屉宽：POSITION 自持抽屉 780px；MODEL 为居中弹窗 → 通栏；其余编辑器 720px
const barWidth = computed(() => {
  if (props.kind === 'POSITION') return '780px'
  if (props.kind === 'MODEL') return '100%'
  return '720px'
})
</script>

<template>
  <ExpertEditor
    v-if="kind === 'EXPERT'"
    :visible="visible"
    :expert-id="refId"
    :readonly="readonly"
    @update:visible="vis = $event"
  />
  <McpEditor
    v-else-if="kind === 'MCP'"
    :visible="visible"
    :mcp-id="refId"
    :readonly="readonly"
    @update:visible="vis = $event"
  />
  <ApiEditor
    v-else-if="kind === 'API'"
    :visible="visible"
    :api-id="refId"
    :readonly="readonly"
    @update:visible="vis = $event"
  />
  <BizSystemEditor
    v-else-if="kind === 'BIZ_SYSTEM'"
    :visible="visible"
    :biz-id="refId"
    :readonly="readonly"
    @update:visible="vis = $event"
  />
  <ModelConfigEditDialog
    v-else-if="kind === 'MODEL'"
    :visible="visible"
    :model="modelObj"
    :readonly="readonly"
    @update:visible="vis = $event"
  />
  <!-- POSITION：岗位抽屉尚未拍板（岗位模块 Q4），暂用简易只读抽屉，待拍板后接入正式岗位抽屉 -->
  <el-drawer
    v-else-if="kind === 'POSITION'"
    v-model="vis"
    title="查看岗位"
    size="780px"
    append-to-body
  >
    <div v-if="item" class="god-pos">
      <div class="god-pos-name">{{ displayName }}</div>
      <dl class="god-pos-fields">
        <div class="god-pos-field">
          <dt>描述</dt>
          <dd>{{ item.description || '—' }}</dd>
        </div>
        <div class="god-pos-field">
          <dt>提交人</dt>
          <dd>{{ submitter }}</dd>
        </div>
        <div class="god-pos-field">
          <dt>提交时间</dt>
          <dd>{{ item.submittedAt || '—' }}</dd>
        </div>
      </dl>
      <div class="god-pos-hint">岗位详情抽屉待岗位模块拍板后接入完整配置视图。</div>
    </div>
  </el-drawer>

  <!-- 吸底操作栏：覆盖在抽屉底部动作区上（见头注释），按钮组由调用方定义 -->
  <Teleport to="body">
    <div v-if="visible && kind && buttons.length" class="god-bar" :style="{ width: barWidth }">
      <el-button
        v-for="b in buttons"
        :key="b.key"
        :type="b.type || ''"
        :plain="b.type === 'danger'"
        :loading="busyKey === b.key"
        :disabled="!!busyKey && busyKey !== b.key"
        @click="emit('action', b.key)"
      >
        {{ b.label }}
      </el-button>
    </div>
  </Teleport>
</template>

<style scoped>
/* ---- POSITION 简易只读抽屉 ---- */
.god-pos-name {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-bottom: var(--space-4);
}
.god-pos-fields {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.god-pos-field {
  display: flex;
  gap: var(--space-3);
}
.god-pos-field dt {
  flex-shrink: 0;
  width: 72px;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.god-pos-field dd {
  margin: 0;
  color: var(--c-text);
  font-size: var(--fs-sm);
  word-break: break-word;
}
.god-pos-hint {
  margin-top: var(--space-5);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* ---- 吸底操作栏（teleport 到 body；覆盖抽屉底部动作区） ---- */
.god-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  z-index: 3000;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border-soft);
  box-sizing: border-box;
}
</style>
