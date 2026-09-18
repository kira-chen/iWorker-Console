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
 *   POSITION    → PositionViewDrawer（2026-09-08 原型复刻批次 2B · G-4，负责人决议第 10 项「按 md 落地」：
 *                 岗位基本信息 + 人格页要素 + 岗位技能 只读，按 refId 取岗位 mock 实体，缺失时用申请快照兜底；
 *                 原「待岗位模块拍板」占位抽屉已退役。岗位模块没有编辑抽屉（整页 PositionDetailTabs），
 *                 我的申请「前往修改 / 重新提交」的编辑态对岗位仍展示同一只读视图 + 关闭|提交审核 吸底条）
 *   KNOWLEDGE_BASE → KnowledgeBaseEditor（mode="view"；2026-09-09 PRD 复核 A6 新增分支）
 * SKILL（跳技能整页只读）与未知类型（toast）不进本组件，由页面路由/提示自行处理。
 *
 * 【审核快照】（2026-09-09 PRD 复核 A5，md `prd.审核中心.md` §四 L48 / §七 L102）
 * 快照由各提交模块自己存（技能 / 专家 / 岗位在提交审核时把当时配置存一份，见各 mock 的
 * submitSnapshots），本组件与治理两页**只读取展示、不做存储**。分发前先判：
 *   - 需快照的三类（POSITION / EXPERT / SKILL）快照缺失 → snapshotMissing=true，不打开业务详情，
 *     改出「阻止审核」提示卡（md §七「业务快照缺失（岗位 / 专家 / 技能）→ 阻止审核并提示联系提交人重新提交」）；
 *   - 其余五类（知识库 / MCP / API / 业务系统 / 模型）不生成快照，照旧按 refId 读业务模块当前配置。
 *
 * 【吸底操作栏】审核中心要求详情底部为 关闭|驳回|通过、我的申请按状态出按钮，而各编辑器
 * 只读态的底部动作条固定只有「关闭」且不可注入（不修改编辑器的前提约束）。故本组件用
 * teleport 到 body 的固定吸底条覆盖在抽屉底部动作区上（宽度随抽屉宽），按钮由调用方
 * 通过 buttons 传入、点击经 action 事件上抛。z-index 取 3000（高于 EP 弹层默认递增区间）。
 *
 * 【抽屉宽度】PRD §4.1 要求专家/岗位/MCP/API/业务系统 780px、模型 820px。
 * 2026-09-08 原型复刻批次 1（G-2 / G-3）：DrawerEditor 默认已改 780px、模型抽屉传 820px，
 * 与 PRD 一致；吸底条宽度随之 780 / 820（此前 MODEL 分支误按「居中弹窗」返回 100%，
 * 吸底条横跨整个视口——ModelConfigEditDialog 自 2026-08-20 起已是抽屉，属过期注释导致的 bug，已修）。
 */
import { ref, computed, watch } from 'vue'
import ExpertEditor from '@/components/admin/ExpertEditor.vue'
import McpEditor from '@/components/admin/McpEditor.vue'
import ApiEditor from '@/components/admin/ApiEditor.vue'
import BizSystemEditor from '@/components/admin/BizSystemEditor.vue'
import ModelConfigEditDialog from '@/components/admin/ModelConfigEditDialog.vue'
import PositionViewDrawer from '@/components/admin/PositionViewDrawer.vue'
import KnowledgeBaseEditor from '@/components/admin/KnowledgeBaseEditor.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { needsSnapshot, loadReviewSnapshot, SNAPSHOT_MISSING_HINT } from '@/utils/reviewSnapshot'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 业务类型（归一化）：EXPERT | POSITION | MCP | API | BIZ_SYSTEM | MODEL。 */
  kind: { type: String, default: '' },
  /** 业务实体 id（传给对应编辑器；治理 mock 行 refId 均指向各业务 mock 真实实体）。 */
  refId: { type: [Number, String], default: null },
  /** 原始行（审核行或申请行），用于 POSITION 快照兜底与 MODEL 合成对象。 */
  item: { type: Object, default: null },
  /** 只读打开（默认）；我的申请「前往修改」传 false 走编辑态。 */
  readonly: { type: Boolean, default: true },
  /**
   * 吸底操作栏按钮：[{ key, label, type?('primary'|'danger'|''), loadingKey? }]。
   * 空数组 = 不出吸底条（沿用编辑器自身「关闭」）。
   */
  buttons: { type: Array, default: () => [] },
  /** 进行中的按钮 key（转圈 + 全条禁点防重复提交）。 */
  busyKey: { type: String, default: '' },
  /**
   * 是否启用「快照缺失即阻止审核」闸门。仅审核中心传 true——md §七 L102 是审核中心的规则，
   * 目的是不让人对着看不到提交内容的对象做审核结论。我的申请是提交人自己回看，md §4.2–4.4
   * 明确「详情主体继续复用业务模块查看态」，终态申请本就不该被这道闸门挡在外面。
   */
  snapshotGate: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'action'])

const vis = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

// 行字段归一化：审核行 name ↔ 申请行 objectName
const displayName = computed(() => props.item?.name || props.item?.objectName || '')

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
      // 取不到（对象已删除等）→ 用行数据合成最小对象兜底，仍打开只读抽屉给个能看的壳
      modelRow.value = props.item ? { id: props.refId, name: displayName.value, description: props.item.description || '' } : { id: props.refId, name: displayName.value }
    }
  },
  { immediate: true }
)
const modelObj = computed(
  () =>
    modelRow.value ||
    (props.item ? { id: props.refId, name: displayName.value, description: props.item.description || '' } : null)
)

// 吸底条宽度随抽屉宽：模型抽屉 820px（ModelConfigEditDialog size="820px"），
// 其余（岗位 / 专家 / MCP / API / 业务系统 = DrawerEditor 默认）780px。
// 抽屉本身是 min(宽, 视口)，吸底条同样封顶 100vw，窄窗口下不越出抽屉。
const DRAWER_W = { MODEL: 820 }
const barWidth = computed(() => `min(${DRAWER_W[props.kind] || 780}px, 100vw)`)

/* ---------------- 审核版本快照（A5，见头注释「审核快照」） ---------------- */
// 只读取、不存储：快照由技能/专家/岗位三个提交模块在提交审核时自行落库（utils/reviewSnapshot 头注释）。
const snapshot = ref(null)
const snapshotLoading = ref(false)
watch(
  () => [props.visible, props.kind, props.refId],
  async ([visible, kind, refId]) => {
    if (!visible) return
    snapshot.value = null
    if (!needsSnapshot(kind)) return // 知识库/MCP/API/业务系统/模型：读当前配置（md §四 L48）
    snapshotLoading.value = true
    try {
      snapshot.value = await loadReviewSnapshot(kind, refId)
    } finally {
      snapshotLoading.value = false
    }
  },
  { immediate: true }
)
/** 需快照的三类且快照缺失 → 阻止审核（md §七 L102），不打开业务详情、吸底条只留「关闭」。 */
const snapshotMissing = computed(
  () => props.snapshotGate && needsSnapshot(props.kind) && !snapshotLoading.value && !snapshot.value
)
/** 快照缺失态下只保留「关闭」，驳回/通过等按钮一律撤下（md §七「阻止审核」）。 */
const effectiveButtons = computed(() =>
  snapshotMissing.value ? props.buttons.filter((b) => b.key === 'close') : props.buttons
)
defineExpose({ snapshot, snapshotMissing })
</script>

<template>
  <!-- 快照缺失（岗位 / 专家 / 技能）：md §七 L102「阻止审核并提示联系提交人重新提交」——
       不打开业务详情，改出提示抽屉；吸底条同时只保留「关闭」（effectiveButtons） -->
  <DrawerEditor
    v-if="snapshotMissing"
    v-model:visible="vis"
    title="无法查看"
    readonly
    data-testid="god-snapshot-missing"
  >
    <section class="section-card">
      <h3 class="section-title">版本快照缺失</h3>
      <el-alert type="warning" :closable="false" show-icon :title="SNAPSHOT_MISSING_HINT" />
      <p class="god-missing-sub">申请对象：{{ displayName || '—' }}</p>
    </section>
  </DrawerEditor>

  <!-- EXPERT：只读查看走审核版本快照（A5，md §四 L48）；编辑态（我的申请「前往修改」）仍取当前配置 -->
  <ExpertEditor
    v-else-if="kind === 'EXPERT'"
    :visible="visible"
    :expert-id="refId"
    :readonly="readonly"
    :snapshot-detail="readonly ? snapshot?.detail || null : null"
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
  <!-- 模型抽屉只在 visible 变 true 那一刻从 props.model 灌表单（ModelConfigEditDialog 的 watch），
       所以必须等 getModel 取到完整行再打开——原实现先用行数据合成的最小对象打开，表单其余字段全空，
       编辑态【保存】会把空字段提交出去（09-18 实走附带发现）。 -->
  <ModelConfigEditDialog
    v-else-if="kind === 'MODEL'"
    :visible="visible && !!modelRow"
    :model="modelObj"
    :readonly="readonly"
    @update:visible="vis = $event"
  />
  <!-- POSITION：岗位只读详情抽屉（G-4 按 md 落地；岗位无编辑抽屉，编辑态亦展示同一只读视图） -->
  <PositionViewDrawer
    v-else-if="kind === 'POSITION'"
    :visible="visible"
    :position-id="refId"
    :item="item"
    :snapshot="snapshot"
    @update:visible="vis = $event"
  />
  <!-- KNOWLEDGE_BASE：知识库详情抽屉（2026-09-09 A6；md §四「知识库……不生成快照，读当前配置」）。
       KnowledgeBaseEditor 用 mode（'view' | 'edit'）而非 readonly 表达只读；抽屉宽同 DrawerEditor 默认 780px。
       注：审核中的知识库编辑器自身还有 pendingLocked 锁（api 层同样 409 拦），编辑态也进不去写操作。 -->
  <KnowledgeBaseEditor
    v-else-if="kind === 'KNOWLEDGE_BASE'"
    :visible="visible"
    :kb-id="refId"
    :mode="readonly ? 'view' : 'edit'"
    @update:visible="vis = $event"
  />

  <!-- 吸底操作栏：覆盖在抽屉底部动作区上（见头注释），按钮组由调用方定义 -->
  <Teleport to="body">
    <div v-if="visible && kind && effectiveButtons.length" class="god-bar" :style="{ width: barWidth }">
      <el-button
        v-for="b in effectiveButtons"
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
/* ---- 吸底操作栏（teleport 到 body；覆盖抽屉底部动作区） ---- */
.god-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  z-index: 3000;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  /* 与 DrawerEditor 脚部同尺寸（66px / 0 28px / gap 10），正好盖住抽屉自带的「关闭」条 */
  gap: 10px;
  height: 66px;
  padding: 0 28px;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border-base);
  box-sizing: border-box;
}
.god-bar .el-button + .el-button {
  margin-left: 0;
}
/* ---- 快照缺失提示（A5，md §七 L102） ---- */
.god-missing-sub {
  margin: 14px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
}
</style>
