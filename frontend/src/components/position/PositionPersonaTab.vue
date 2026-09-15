<script setup>
/**
 * 岗位详情 · 「人格」页签（md §2 六区块：图标 / 描述 / 领用页文案 / 示例问题 / SOP / 人格）。
 *
 * 2026-09-10 病 A 拆分（docs/调研讨论/2026-09-09-代码冗余治理第二批方案.md 第 5 项）：
 * 自 PositionDetailTabs.vue 原样抽出，DOM 结构 / class / 交互零变更。
 * - 数据直接走 usePositionStore（不做 props 深传），父层只传 isReadonly 一个 prop；
 * - eqShowErrors 由父层 provide（发布编排在父层：openPublish 发现示例问题缺失时置红）。
 */
import { ref, computed, inject } from 'vue'
import { ElMessage } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import {
  normalizeExampleQuestions,
  genExampleQuestions,
  genPositionSop,
  DESCRIPTION_MAX_LEN,
  EXAMPLE_Q_MAX_LEN,
  SOP_MAX_LEN
} from '@/utils/positionModel'
// 「生成中…」按钮文案走全站共享常量（本页原先硬写三个 ASCII 点，与其余 5 个编辑器不一致）
import { AI_LIVE_BUSY_LABEL } from '@/utils/aiLiveGenerate'
import ClaimNotesEditor from '@/components/position/ClaimNotesEditor.vue'
import IconField from '@/components/common/IconField.vue'
import SkillMilkdownEditor from '@/components/position/SkillMilkdownEditor.vue'

defineProps({
  // 只读态（列表【查看】进入 / 审核中锁定），由父层统一推导
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()

/* ---------- 人格 Tab 内联绑定（md 三.2 六区块；改动 patch→store.basic，随顶部【保存】提交） ---------- */
function patchBasic(key, value) {
  store.basic = { ...store.basic, [key]: value }
}
// 领用页文案（原「岗位认领说明」；纯文本动态列表，可选，≤6 条 × 100 字，md §2.3）
const claimNotesModel = computed({
  get: () => (Array.isArray(store.basic?.claimDescriptions) ? store.basic.claimDescriptions : []),
  set: (v) => patchBasic('claimDescriptions', v)
})
// 示例问题固定 3 格
const exampleQuestions = computed(() => normalizeExampleQuestions(store.basic?.exampleQuestions))
function onExampleInput(idx, val) {
  const next = normalizeExampleQuestions(store.basic?.exampleQuestions)
  next[idx] = val
  patchBasic('exampleQuestions', next)
}
// 发布阻断时示例问题标红：置位在父层 openPublish（发布编排归父壳），此处只消费
const eqShowErrors = inject('pdEqShowErrors', ref(false))
const eqPlaceholders = ['如：帮我分析本周经营数据', '请输入示例问题', '请输入示例问题']

// 领用页文案卡片头「＋ 新增一条」直调编辑器暴露的 startAdd（按钮进卡片头，照原型排版）
const claimEditorRef = ref(null)
// 图标卡：共享图标行组件 IconField（预览块 + 并排【从图标库选择】【上传图标】，照原型 position-icon-section；
// 2026-09-08 原型复刻批次 1 · S4 样板接入，其余抽屉后续批次换用）

// 图标选择回吐（IconField → IconPickerPopover 单次给 {icon, iconSource}）
function onPickIcon({ icon, iconSource }) {
  store.basic = { ...store.basic, icon, iconSource }
}

/* ---------- AI 生成（本地拟真：延迟 500ms；描述为空禁用并 title 提示） ---------- */
const descEmpty = computed(() => !String(store.basic?.description || '').trim())
const aiQuestionsBusy = ref(false)
const aiSopBusy = ref(false)
function aiGenQuestions() {
  if (descEmpty.value || aiQuestionsBusy.value) return
  aiQuestionsBusy.value = true
  setTimeout(() => {
    patchBasic('exampleQuestions', genExampleQuestions(store.basic?.name, store.basic?.description))
    aiQuestionsBusy.value = false
    ElMessage.success('已生成示例问题') // md §2.4 逐字
  }, 500)
}
function aiGenSop() {
  if (descEmpty.value || aiSopBusy.value) return
  aiSopBusy.value = true
  setTimeout(() => {
    patchBasic('positionSop', genPositionSop(store.basic?.name, store.basic?.description))
    aiSopBusy.value = false
    ElMessage.success('已生成岗位 SOP') // md §2.5 逐字
  }, 500)
}
</script>

<template>
  <div class="pd-pane">
    <!-- 1. 岗位图标（原型 position-icon-section：预览 + 从图标库选择 / 上传图标） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <!-- 一览表 §一 第 7 行：岗位图标为「选填」，不挂必填星（校验里本就不拦） -->
        <span class="pd-card-title">岗位图标</span>
        <span class="pd-card-sub">用于岗位列表与员工端展示</span>
      </div>
      <div class="pd-card-body">
        <!-- 共享图标行：预览 + 从图标库选择 / 上传图标（IconField，内部走 IconPickerPopover 无头链路） -->
        <IconField
          :icon="store.basic.icon"
          :name="store.basic.name"
          :readonly="isReadonly"
          :size="42"
          @pick="onPickIcon"
        />
      </div>
    </section>

    <!-- 2. 岗位描述（必填，≤500 字，2026-09-08 决议第 5 项；全链同口径：新建弹窗 / mock 校验） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">岗位描述<i class="pd-req">*</i></span>
        <span class="pd-card-sub">向用户说明该岗位的职责范围</span>
      </div>
      <div class="pd-card-body">
        <el-input
          :model-value="store.basic.description || ''"
          type="textarea"
          :rows="3"
          :maxlength="DESCRIPTION_MAX_LEN"
          placeholder="说明该岗位负责什么、可以帮助用户完成哪些工作"
          class="pd-desc-input"
          :disabled="isReadonly"
          @update:model-value="patchBasic('description', $event)"
        />
        <div class="pd-card-hint">最多 {{ DESCRIPTION_MAX_LEN }} 个字符</div>
      </div>
    </section>

    <!-- 3. 领用页文案（md §2.3：可选、不参与阻断；卡片头/副标题/按钮照原型领用页文案卡 L4240） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">领用页文案</span>
        <span class="pd-card-sub">员工领用时看到的卖点，可多条，最多 6 条</span>
        <span class="pd-card-spacer"></span>
        <!-- 满 6 条不隐藏按钮，点击由 ClaimNotesEditor.startAdd toast「领用页文案最多 6 条」
             （md §2.3 L188；2026-09-12 审计 J18） -->
        <el-button
          v-if="!isReadonly && !claimEditorRef?.editing"
          link
          type="primary"
          @click="claimEditorRef?.startAdd()"
        >
          ＋ 新增一条
        </el-button>
      </div>
      <div class="pd-card-body">
        <ClaimNotesEditor ref="claimEditorRef" v-model="claimNotesModel" :readonly="isReadonly" />
      </div>
    </section>

    <!-- 4. 示例问题（3 条必填 × 60 字 + 区级 AI 生成） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">示例问题<i class="pd-req">*</i></span>
        <span class="pd-card-sub">帮助用户快速了解如何使用该岗位</span>
        <span class="pd-card-spacer"></span>
        <el-button
          v-if="!isReadonly"
          class="pd-ai-btn"
          size="small"
          plain
          :loading="aiQuestionsBusy"
          :disabled="descEmpty || aiQuestionsBusy"
          :title="descEmpty ? '请先填写岗位描述' : undefined"
          @click="aiGenQuestions"
        >
          {{ aiQuestionsBusy ? AI_LIVE_BUSY_LABEL : 'AI 生成' }}
        </el-button>
      </div>
      <div class="pd-card-body">
        <div class="pd-eq-list">
          <div v-for="(q, idx) in exampleQuestions" :key="idx" class="pd-eq-row">
            <span class="pd-eq-no">{{ idx + 1 }}</span>
            <el-input
              :model-value="q"
              :maxlength="EXAMPLE_Q_MAX_LEN"
              :placeholder="eqPlaceholders[idx]"
              :disabled="isReadonly"
              :class="{ 'pd-eq-err': eqShowErrors && !String(q).trim() }"
              @update:model-value="onExampleInput(idx, $event)"
            />
          </div>
        </div>
        <div class="pd-card-hint">3 条均为必填，每条不超过 {{ EXAMPLE_Q_MAX_LEN }} 个字符</div>
      </div>
    </section>

    <!-- 5. 岗位 SOP（必填，≤4000 字 + AI 生成） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">岗位 SOP<i class="pd-req">*</i></span>
        <span class="pd-card-sub">对该岗位绑定的所有能力进行综述</span>
        <span class="pd-card-spacer"></span>
        <el-button
          v-if="!isReadonly"
          class="pd-ai-btn"
          size="small"
          plain
          :loading="aiSopBusy"
          :disabled="descEmpty || aiSopBusy"
          :title="descEmpty ? '请先填写岗位描述' : undefined"
          @click="aiGenSop"
        >
          {{ aiSopBusy ? AI_LIVE_BUSY_LABEL : 'AI 生成' }}
        </el-button>
      </div>
      <div class="pd-card-body">
        <el-input
          :model-value="store.basic.positionSop || ''"
          type="textarea"
          :rows="6"
          :maxlength="SOP_MAX_LEN"
          placeholder="说明岗位如何组合使用 Agent、技能、知识与工具完成工作"
          class="pd-sop-input"
          :disabled="isReadonly"
          @update:model-value="patchBasic('positionSop', $event)"
        />
        <div class="pd-card-hint">必填，最多 {{ SOP_MAX_LEN }} 个字符</div>
      </div>
    </section>

    <!-- 6. 岗位人格（富文本编辑器沿用现有 Milkdown） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">岗位人格</span>
        <span class="pd-card-sub">定义岗位的语气、表达方式和行为边界</span>
      </div>
      <div class="pd-card-body">
        <div class="pd-mde">
          <SkillMilkdownEditor
            :model-value="store.basic.persona"
            height="320px"
            placeholder="你是一名严谨的经营分析助手。优先核对数据口径，先给结论，再展示关键依据和风险提示。"
            :readonly="isReadonly"
            @update:model-value="patchBasic('persona', $event)"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 样式随模板自 PositionDetailTabs.vue 原样搬入（病 A 拆分）：
   .pd-card 家族在人格与 Agent 两页签各自成 scope 复制一份——scoped 样式不穿子组件内层 DOM，
   留父层需改 :deep 且罩不住 append-to-body 的抽屉内容，为保视觉零差异按页签就近持有。 */
/* 常规内容页：照原型 pd2-pane 居中限宽（max-width 1180px），卡片纵向排布 */
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
/* 必填红星（对齐 el-form required 视觉口径） */
.pd-req {
  color: var(--c-danger);
  font-style: normal;
  margin: 0 0 0 2px;
}
/* ---- 人格页签卡片（照原型 pd2-section：白底/描边/圆角卡，头行 + 分隔线 + 体） ---- */
.pd-card {
  background: var(--bg-surface);
  /* 2026-09-10 像素账本 G3 附带（描边铺开）：本页签是四个 pd-card 页签里唯一漏改的一个——
     采集 / 知识 / Agent 三页签早前已改 --border-admin-card，人格页签仍留着半透明
     --border-base（浅色 10% 黑），同一套卡在四个页签间描边深浅不一。此处补齐。 */
  border: 1px solid var(--border-admin-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.pd-card-head {
  min-height: 50px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  /* 卡头分隔线与卡描边同浓度：半透明 --border-soft 叠在灰底卡头上会比卡描边淡一档 */
  border-bottom: 1px solid var(--border-admin-card);
  /* 卡头灰条与其余三页签同源（--bg-admin-card-head，浅色 #f8faf9 = 原型同值） */
  background: var(--bg-admin-card-head);
}
.pd-card-title {
  display: inline-flex;
  align-items: center;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  white-space: nowrap;
}
/* 示例问题 / 岗位 SOP 的【AI 生成】按钮：常规字重，与技能/专家/连接器四处一致
   （一览表附录「AI 生成按钮样式」）。原先该类只在模板上挂着、没有任何样式定义，
   落 Element Plus 默认 500 而显得比同类按钮粗。 */
.pd-ai-btn {
  font-weight: var(--fw-regular, 400);
  white-space: nowrap;
}
.pd-card-sub {
  font-size: var(--fs-xs);
  font-weight: var(--fw-regular);
  color: var(--c-text-muted);
}
.pd-card-spacer {
  margin-left: auto;
}
.pd-card-body {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
/* 卡片底部弱提示（照原型 hint：「最多 500 个字符」等） */
.pd-card-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
/* 人格 · 示例问题 3 格 */
.pd-eq-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.pd-eq-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.pd-eq-no {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
:deep(.pd-eq-err .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--c-danger) inset;
}
</style>
