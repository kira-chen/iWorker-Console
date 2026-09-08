<script setup>
/**
 * 用户技能审核 · 查看技能抽屉（2026-09-08 PRD-20260908 对齐，md §五 / 原型 openAuditViewer L4502–4513）。
 *
 * DrawerEditor 780 壳 + 三张 section-card：
 *   1. 基本信息（两列 form-grid）：技能名称 / 提交人 / 提交时间 / 审核状态(tag) / 审核尺度(tag) / 技能描述(整行)
 *   2. SKILL.MD：原样只读、不渲染（pre-wrap 等宽灰底块），空值「（暂无内容）」
 *   3. 检测明细「共 4 项」：固定 4 项顺序 对外动作 / 敏感信息 / 权限范围 / 危险操作，每项
 *      序号圆标 + 名称 + 结果 tag + 位置 + 代码块（等宽）+ 依据；卡片底色随等级（原型 .audit-risk-card.is-*，
 *      原型因键名旧命名永不上色属缺陷，此处按五档正确上色）；检测通过依据「未检测到该项相关风险」
 * 底部：【关闭】；待审核加【通过】(plain)【驳回】(红底主按钮)。审核动作经 approve / reject 事件上抛（弹窗在列表页）。
 * 详情为提交审核时的只读快照（md §五）；数据按 reviewId 拉取 getReviewApplication。
 */
import { ref, computed, watch } from 'vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import UserSkillAuditTag from '@/components/admin/UserSkillAuditTag.vue'
import { getReviewApplication } from '@/api/skillReview'
import { fmtTime } from '@/utils/docMeta'
import { fullDetectionResults, riskLevelTone, DETECTION_ITEMS } from '@/utils/userSkillAuditMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  reviewId: { type: [String, Number], default: null },
  /** 进行中的动作（'approve' | 'reject' | ''）：对应按钮转圈、另一个禁点 */
  busyKey: { type: String, default: '' }
})
const emit = defineEmits(['update:visible', 'approve', 'reject'])

const vis = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

const row = ref(null)
const loading = ref(false)
const loadError = ref(false)

async function load() {
  if (!props.reviewId) return
  loading.value = true
  loadError.value = false
  row.value = null
  try {
    row.value = await getReviewApplication(props.reviewId)
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.reviewId],
  ([v]) => {
    if (v) load()
  },
  { immediate: true }
)

const results = computed(() => (row.value ? fullDetectionResults(row.value.risks) : []))
const isPending = computed(() => row.value?.status === 'PENDING')
const skillMdText = computed(() => (row.value?.skillMd ? row.value.skillMd : '（暂无内容）'))
const itemCount = DETECTION_ITEMS.length

defineExpose({ reload: load })
</script>

<template>
  <DrawerEditor
    v-model:visible="vis"
    title="查看技能"
    :loading="loading"
    :error="loadError"
    :skeleton-rows="10"
    @retry="load"
  >
    <template v-if="row">
      <!-- 1. 基本信息 -->
      <section class="section-card">
        <h3 class="section-title">基本信息</h3>
        <div class="usa-form-grid">
          <div class="usa-field">
            <div class="usa-label">技能名称</div>
            <div class="usa-readonly">{{ row.skillName || '—' }}</div>
          </div>
          <div class="usa-field">
            <div class="usa-label">提交人</div>
            <div class="usa-readonly">{{ row.submitter || '—' }}</div>
          </div>
          <div class="usa-field">
            <div class="usa-label">提交时间</div>
            <div class="usa-readonly">{{ row.submittedAt ? fmtTime(row.submittedAt) : '—' }}</div>
          </div>
          <div class="usa-field">
            <div class="usa-label">审核状态</div>
            <div class="usa-readonly"><UserSkillAuditTag kind="status" :value="row.status" /></div>
          </div>
          <div class="usa-field">
            <div class="usa-label">审核尺度</div>
            <div class="usa-readonly"><UserSkillAuditTag kind="scale" :value="row.scale" /></div>
          </div>
          <div class="usa-field usa-field--full">
            <div class="usa-label">技能描述</div>
            <div class="usa-readonly">{{ row.description || '—' }}</div>
          </div>
        </div>
      </section>

      <!-- 2. SKILL.MD（原样只读，不渲染） -->
      <section class="section-card">
        <h3 class="section-title">SKILL.MD</h3>
        <pre class="usa-skill-md">{{ skillMdText }}</pre>
      </section>

      <!-- 3. 检测明细 -->
      <section class="section-card">
        <h3 class="section-title">检测明细 <span class="section-sub">共 {{ itemCount }} 项</span></h3>
        <div
          v-for="(r, i) in results"
          :key="r.item"
          class="usa-risk-card"
          :class="`is-${riskLevelTone(r.level)}`"
          :data-item="r.item"
        >
          <div class="usa-risk-head">
            <div class="usa-risk-title">
              <span class="usa-risk-index">{{ i + 1 }}</span>
              <strong>{{ r.label }}</strong>
            </div>
            <UserSkillAuditTag kind="level" :value="r.level" />
          </div>
          <div v-if="r.location" class="usa-risk-location">位置：{{ r.location }}</div>
          <blockquote v-if="r.code" class="usa-risk-code">{{ r.code }}</blockquote>
          <p class="usa-risk-reason">{{ r.detail }}</p>
        </div>
      </section>
    </template>

    <template #footer>
      <el-button :disabled="!!busyKey" @click="vis = false">关闭</el-button>
      <template v-if="isPending">
        <el-button :loading="busyKey === 'approve'" :disabled="!!busyKey && busyKey !== 'approve'" @click="emit('approve', row)">
          通过
        </el-button>
        <el-button type="danger" :loading="busyKey === 'reject'" :disabled="!!busyKey && busyKey !== 'reject'" @click="emit('reject', row)">
          驳回
        </el-button>
      </template>
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* 基本信息两列（原型 .form-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 22px}） */
.usa-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 22px;
}
.usa-field--full {
  grid-column: 1 / -1;
}
.usa-label {
  margin-bottom: 8px;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text);
}
/* 原型 .readonly-value{min-height:38px;padding:9px 12px;border-radius:8px;background:#f3f5f4} */
.usa-readonly {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--c-text);
  font-size: var(--fs-base);
  line-height: 1.5;
  word-break: break-word;
}
/* SKILL.MD 灰底等宽块（原型 L4509 内联样式） */
.usa-skill-md {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid var(--border-base);
  border-radius: 6px;
  background: var(--bg-hover);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  color: var(--c-text);
  white-space: pre-wrap;
  word-break: break-all;
}
/* 检测项卡（原型 .audit-risk-card 及 is-* 等级底色 L4418–4440） */
.usa-risk-card {
  padding: 12px 14px;
  border: 1px solid var(--border-base);
  border-radius: 6px;
  background: var(--bg-hover);
  margin-bottom: 10px;
}
.usa-risk-card:last-child {
  margin-bottom: 0;
}
.usa-risk-card.is-pass {
  background: #f7fbf8;
  border-color: #cee5d7;
}
.usa-risk-card.is-low {
  background: #f7f9fb;
  border-color: #d9e0e6;
}
.usa-risk-card.is-medium {
  background: #fffbf2;
  border-color: #ecd8a9;
}
.usa-risk-card.is-high {
  background: #fff7f7;
  border-color: #efc1c1;
}
.usa-risk-card.is-fatal {
  background: #fff0f0;
  border-color: #e74c3c;
}
:root[data-theme='dark'] .usa-risk-card.is-pass,
:root[data-theme='dark'] .usa-risk-card.is-low,
:root[data-theme='dark'] .usa-risk-card.is-medium,
:root[data-theme='dark'] .usa-risk-card.is-high,
:root[data-theme='dark'] .usa-risk-card.is-fatal {
  background: var(--bg-hover);
}
:root[data-theme='dark'] .usa-risk-card.is-pass {
  border-color: var(--c-success);
}
:root[data-theme='dark'] .usa-risk-card.is-medium {
  border-color: var(--c-warning);
}
:root[data-theme='dark'] .usa-risk-card.is-high,
:root[data-theme='dark'] .usa-risk-card.is-fatal {
  border-color: var(--c-danger);
}
.usa-risk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.usa-risk-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.usa-risk-title strong {
  font-size: 14px;
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.usa-risk-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #edf1ef;
  color: #607069;
  font-size: 12px;
  font-weight: 600;
  flex: 0 0 auto;
}
.usa-risk-card.is-pass .usa-risk-index {
  background: #dff2e7;
  color: #237247;
}
:root[data-theme='dark'] .usa-risk-index {
  background: var(--bg-active);
  color: var(--c-text-muted);
}
.usa-risk-location {
  margin: 8px 0 0;
  padding: 0 2px;
  font-size: 12px;
  color: var(--c-text-muted);
  font-family: var(--font-mono);
}
.usa-risk-code {
  margin: 4px 0 6px;
  padding: 10px 14px;
  border-left: 3px solid #6aaa82;
  border-radius: 0 6px 6px 0;
  background: #f5f7f6;
  color: #2d3a32;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
:root[data-theme='dark'] .usa-risk-code {
  background: var(--bg-active);
  color: var(--c-text);
}
.usa-risk-reason {
  margin: 4px 0 0;
  padding: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-muted);
}
</style>
