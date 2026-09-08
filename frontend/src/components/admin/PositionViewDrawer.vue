<script setup>
/**
 * 治理侧 · 岗位只读详情抽屉（2026-09-08 原型复刻批次 2B · G-4，负责人决议第 10 项「按 md 落地」）。
 *
 * 审核中心 / 我的申请 查看岗位类申请时打开（md §四「岗位：打开右侧只读详情抽屉」，780px）。
 * 此前为占位抽屉（仅名称 / 描述 / 提交人 / 提交时间 + 「待拍板」提示），本批按 md 落地为真实只读视图：
 *   壳与卡片分区照原型 openPositionEditor(readonly) L1202–1210：标题「查看岗位」、section-card、
 *   readonly-value 灰底只读值、末尾 .page-time 行（当前状态 / 最新版本 / 最近更新时间）；
 *   内容按岗位 md §三.2 人格页签要素只读展示：
 *     1. 基本信息：岗位名称 / 图标（IconField 只读）/ 岗位描述
 *     2. 人格：领用页文案（列表）/ 示例问题（3 条）/ 岗位 SOP / 岗位人格
 *     3. 岗位技能（原型同名卡；由 Agent 引用的技能并集推导，空「暂无关联技能」）
 * 数据按 positionId 拉 getPosition（岗位 mock 实体）；实体不存在（已删除）时按 md §七「使用申请快照
 * 展示只读详情」——用申请行 item 的名称 / 描述兜底，人格要素显「—」。
 * 底部动作由 GovObjectDetail 吸底条覆盖（关闭 | 驳回 | 通过 / 按申请状态），本组件只出默认「关闭」。
 */
import { ref, computed, watch } from 'vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import IconField from '@/components/common/IconField.vue'
import { fmtTime } from '@/utils/docMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 岗位实体 id（治理行 refId） */
  positionId: { type: [Number, String], default: null },
  /** 申请 / 审核行（实体缺失时作快照兜底） */
  item: { type: Object, default: null }
})
const emit = defineEmits(['update:visible'])

const vis = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

const detail = ref(null)
const loading = ref(false)
const loadError = ref(false)
/** 实体不存在 → 以申请快照（行数据）兜底展示 */
const snapshotOnly = ref(false)

async function load() {
  if (!props.visible) return
  loading.value = true
  loadError.value = false
  snapshotOnly.value = false
  detail.value = null
  try {
    // 动态引：避免把 api/request → @/router 链条带进引用本组件页面的单测模块图（同 GovObjectDetail MODEL 分支）
    const { getPosition } = await import('@/api/position')
    detail.value = props.positionId != null ? await getPosition(props.positionId) : null
    if (!detail.value) snapshotOnly.value = true
  } catch (e) {
    // 岗位已删除 / 无对应实体：md §七「对象已被删除 → 使用申请快照展示只读详情」
    snapshotOnly.value = true
  } finally {
    loading.value = false
  }
}

watch(() => [props.visible, props.positionId], ([v]) => { if (v) load() }, { immediate: true })

// 展示模型：实体优先，快照兜底
const name = computed(() => detail.value?.name || props.item?.name || props.item?.objectName || '')
const description = computed(() => detail.value?.description || props.item?.description || '')
const icon = computed(() => detail.value?.icon || '')
const claimDescriptions = computed(() => (detail.value?.claimDescriptions || []).filter(Boolean))
const exampleQuestions = computed(() => {
  const arr = detail.value?.exampleQuestions || []
  return [0, 1, 2].map((i) => arr[i] || '')
})
const positionSop = computed(() => detail.value?.positionSop || '')
const persona = computed(() => detail.value?.persona || '')

// 岗位技能：Agent 引用技能并集（同列表 skillIds 口径），按名称去重
const skillNames = computed(() => {
  const seen = new Set()
  const names = []
  for (const a of detail.value?.agents || []) {
    for (const s of a.skills || []) {
      const key = String(s.skillId)
      if (seen.has(key)) continue
      seen.add(key)
      names.push(s.name || key)
    }
  }
  return names
})

// 状态三态展示映射（与岗位列表 displayView 同口径）：在途待审 → 审核中；published → 已发布；其余 → 未发布
const statusLabel = computed(() => {
  const d = detail.value
  if (!d) return '—'
  if (d.pendingAction) return '审核中'
  return d.status === 'published' ? '已发布' : '未发布'
})
const latestVersion = computed(() => detail.value?.latestVersion || '-')
const updatedAt = computed(() => (detail.value?.updatedAt ? fmtTime(detail.value.updatedAt) : '-'))

defineExpose({ reload: load })
</script>

<template>
  <DrawerEditor
    v-model:visible="vis"
    title="查看岗位"
    readonly
    :loading="loading"
    :error="loadError"
    :skeleton-rows="10"
    @retry="load"
  >
    <!-- 1. 基本信息（原型 L1207 section-card：岗位名称 / 岗位描述 readonly-value；图标按 md §三.2.2 只读） -->
    <section class="section-card" data-testid="pvd-basic">
      <h3 class="section-title">基本信息</h3>
      <div class="pvd-grid">
        <div class="pvd-field">
          <div class="pvd-label">岗位名称</div>
          <div class="pvd-readonly">{{ name || '—' }}</div>
        </div>
        <div class="pvd-field">
          <div class="pvd-label">岗位图标</div>
          <IconField :icon="icon" :name="name" readonly placeholder="♟" />
        </div>
        <div class="pvd-field pvd-field--full">
          <div class="pvd-label">岗位描述</div>
          <div class="pvd-readonly pvd-readonly--multi">{{ description || '-' }}</div>
        </div>
      </div>
      <p v-if="snapshotOnly" class="pvd-snapshot-hint">对应岗位不存在或已删除，以下为申请提交时保存的快照。</p>
    </section>

    <!-- 2. 人格（岗位 md §三.2 人格页签要素只读） -->
    <section class="section-card" data-testid="pvd-persona">
      <h3 class="section-title">人格</h3>
      <div class="pvd-stack">
        <div class="pvd-field">
          <div class="pvd-label">领用页文案 <span class="section-sub">员工领用时看到的卖点，可多条，最多 6 条</span></div>
          <ul v-if="claimDescriptions.length" class="pvd-list">
            <li v-for="(t, i) in claimDescriptions" :key="i" class="pvd-readonly">{{ t }}</li>
          </ul>
          <div v-else class="pvd-muted">暂无领用页文案</div>
        </div>
        <div class="pvd-field">
          <div class="pvd-label">示例问题</div>
          <ul class="pvd-list">
            <li v-for="(q, i) in exampleQuestions" :key="i" class="pvd-readonly">
              <span class="pvd-index">{{ i + 1 }}</span>{{ q || '—' }}
            </li>
          </ul>
        </div>
        <div class="pvd-field">
          <div class="pvd-label">岗位 SOP</div>
          <div class="pvd-readonly pvd-readonly--multi">{{ positionSop || '—' }}</div>
        </div>
        <div class="pvd-field">
          <div class="pvd-label">岗位人格</div>
          <div class="pvd-readonly pvd-readonly--multi">{{ persona || '—' }}</div>
        </div>
      </div>
    </section>

    <!-- 3. 岗位技能（原型 L1207 .position-view-skills：灰 tag 列表，空「暂无关联技能」） -->
    <section class="section-card" data-testid="pvd-skills">
      <h3 class="section-title">岗位技能 <span class="section-sub">仅关联岗位私有技能，发布前至少选择 1 个</span></h3>
      <div v-if="skillNames.length" class="pvd-skills">
        <el-tag v-for="n in skillNames" :key="n" type="info" effect="plain" round>{{ n }}</el-tag>
      </div>
      <div v-else class="pvd-muted">暂无关联技能</div>
    </section>

    <!-- 时间行（原型 L1207 .page-time：当前状态 / 最新版本 / 最近更新时间） -->
    <div class="page-time pvd-time" data-testid="pvd-time">
      <span>当前状态：{{ statusLabel }}</span>
      <span>最新版本：{{ latestVersion }}</span>
      <span>最近更新时间：{{ updatedAt }}</span>
    </div>
  </DrawerEditor>
</template>

<style scoped>
/* 两列（原型 .form-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 22px}） */
.pvd-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 22px;
}
.pvd-field--full {
  grid-column: 1 / -1;
}
.pvd-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.pvd-label {
  margin-bottom: 8px;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text);
}
/* 原型 .readonly-value{min-height:38px;padding:9px 12px;border-radius:8px;background:#f3f5f4} */
.pvd-readonly {
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
.pvd-readonly--multi {
  display: block;
  white-space: pre-wrap;
}
.pvd-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pvd-index {
  flex-shrink: 0;
  width: 20px;
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}
.pvd-muted {
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}
.pvd-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pvd-snapshot-hint {
  margin: 14px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
/* 时间行不在卡内：贴 .de-body 白卡之外，沿用 admin-shell 的 .page-time 弱色 + 上边线 */
.pvd-time {
  padding-left: 2px;
}
</style>
