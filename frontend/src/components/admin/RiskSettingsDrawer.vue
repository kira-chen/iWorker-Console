<script setup>
/**
 * 用户技能审核 · 风险设置抽屉（2026-09-08 PRD-20260908 对齐，md §七 / 原型 renderRiskDrawerBody L4487–4494）。
 *
 * DrawerEditor 780 壳 + 两张 section-card：
 *   1. 「当前审查尺度」单选 通用 / 严格 / 宽松（md §7.1 顺序，默认通用）——只改草稿，随【保存设置】落库
 *   2. 「审核尺度模板配置」说明文「维护三套审核尺度模板，管控技能上传的安全检测策略。」+ Tab 宽松 / 通用 / 严格
 *      （默认打开通用）+ 表格 检测项 | 说明 | 触发审核的最低风险等级（第三列纵向单选，选项集合按检测项 md §7.2 表一）
 * 底部：【恢复默认】（当前 Tab 草稿回默认值表 + toast「已恢复默认设置」）｜【取消】（不保存，关闭）｜
 *      【保存设置】（保存当前 Tab → toast「「尺度名」审核尺度设置已保存」并关闭）。
 *      Tab 下方展示当前尺度的适用说明（md §7.2 L156-160 三句逐字；2026-09-12 审计 K31 补，Q416 09-08 裁决补进 md）。
 * 【与原型/旧 md 的差别】原型 SCALE_DESC 段描述"阻断/告警/放行"旧模型且与默认值表自相矛盾，不搬。
 * 【2026-09-09 负责人拍板】「保存设置才视为生效，取消则清空当前未保存的内容」——覆盖 md §七 L150/L184
 * 「即时生效、取消不回滚」的旧口径：模板配置与当前审查尺度**全部走草稿**，点【保存设置】才一并落库，
 * 【取消】关闭即丢弃（抽屉每次打开都 load() 重取，天然回到已保存态）。
 */
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { getRiskConfig, setCurrentScale, saveRiskTemplate } from '@/api/skillReview'
import {
  AUDIT_SCALES,
  CURRENT_SCALE_OPTIONS,
  DEFAULT_CURRENT_SCALE,
  DETECTION_ITEMS,
  ITEM_DESC,
  ITEM_RISK_OPTIONS,
  DEFAULT_RISK_TEMPLATES,
  detectionItemLabel,
  cloneTemplate
} from '@/utils/userSkillAuditMeta'

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible', 'saved'])

const vis = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v)
})

const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)
const currentScale = ref(DEFAULT_CURRENT_SCALE)
const activeTab = ref('通用')
/** 三套模板草稿（取消即弃） */
const drafts = reactive({})

const scaleTabs = AUDIT_SCALES
const currentScaleOptions = CURRENT_SCALE_OPTIONS
/** 各尺度适用说明（md §7.2 L156-160 逐字；随 Tab 切换只显当前一句，审计 K31） */
const SCALE_NOTES = {
  宽松: '四项检测均不进入人工审核，检测结果仅作记录，适合内部可信来源的技能。',
  通用: '默认策略，敏感信息达到严重风险、其余三项达到高风险时进入人工审核。',
  严格: '在通用基础上收紧，对外动作、权限范围和危险操作降到中风险即进入人工审核，适合对外发布场景。'
}
const items = DETECTION_ITEMS.map((item) => ({ item, label: detectionItemLabel(item), desc: ITEM_DESC[item], options: ITEM_RISK_OPTIONS[item] }))

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const cfg = await getRiskConfig()
    currentScale.value = cfg.currentScale || DEFAULT_CURRENT_SCALE
    AUDIT_SCALES.forEach((s) => {
      drafts[s] = cloneTemplate(cfg.templates?.[s] || DEFAULT_RISK_TEMPLATES[s])
    })
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      activeTab.value = '通用'
      load()
    }
  },
  { immediate: true }
)

/**
 * 当前审查尺度：只改本地草稿，点【保存设置】才落库（2026-09-09 负责人拍板
 * 「保存设置才视为生效，取消则清空当前未保存的内容」——覆盖 md §七 L150/L184「即时生效、
 * 取消不回滚」的旧口径）。抽屉每次打开都会 load() 重取，故取消即等于丢弃未保存改动。
 */
function onCurrentScaleChange(scale) {
  currentScale.value = scale
}

function resetCurrentTab() {
  drafts[activeTab.value] = cloneTemplate(DEFAULT_RISK_TEMPLATES[activeTab.value])
  ElMessage.success('已恢复默认设置')
}

async function save() {
  const scale = activeTab.value
  saving.value = true
  try {
    // 一并落「当前审查尺度」：它同样只是草稿，不保存就不生效（负责人 2026-09-09 拍板）
    await setCurrentScale(currentScale.value)
    await saveRiskTemplate(scale, drafts[scale])
    ElMessage.success(`「${scale}」审核尺度设置已保存`)
    emit('saved', { scale, currentScale: currentScale.value })
    vis.value = false
  } catch (e) {
    ElMessage.error(e?.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <DrawerEditor
    v-model:visible="vis"
    title="风险设置"
    :loading="loading"
    :error="loadError"
    :skeleton-rows="8"
    @retry="load"
  >
    <!-- 1. 当前审查尺度 -->
    <section class="section-card">
      <h3 class="section-title">当前审查尺度</h3>
      <el-radio-group :model-value="currentScale" class="rsd-current" @change="onCurrentScaleChange">
        <el-radio v-for="s in currentScaleOptions" :key="s" :value="s">{{ s }}</el-radio>
      </el-radio-group>
    </section>

    <!-- 2. 审核尺度模板配置 -->
    <section class="section-card">
      <h3 class="section-title">审核尺度模板配置</h3>
      <p class="rsd-desc">维护三套审核尺度模板，管控技能上传的安全检测策略。</p>
      <div class="rsd-tabs" role="tablist">
        <button
          v-for="s in scaleTabs"
          :key="s"
          type="button"
          role="tab"
          class="rsd-tab"
          :class="{ active: activeTab === s }"
          :aria-selected="activeTab === s"
          @click="activeTab = s"
        >{{ s }}</button>
      </div>
      <!-- 当前尺度适用说明（md §7.2 L154-160，K31） -->
      <p class="rsd-scale-note"><strong>{{ activeTab }}</strong>：{{ SCALE_NOTES[activeTab] }}</p>
      <table v-if="drafts[activeTab]" class="rsd-table">
        <colgroup>
          <col style="width: 130px" />
          <col />
          <col style="width: 220px" />
        </colgroup>
        <thead>
          <tr>
            <th>检测项</th>
            <th>说明</th>
            <th>触发审核的最低风险等级</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.item" :data-item="it.item">
            <td><strong class="rsd-item">{{ it.label }}</strong></td>
            <td><span class="rsd-item-desc">{{ it.desc }}</span></td>
            <td>
              <el-radio-group v-model="drafts[activeTab][it.item]" class="rsd-levels">
                <el-radio v-for="opt in it.options" :key="opt" :value="opt">{{ opt }}</el-radio>
              </el-radio-group>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <template #footer>
      <el-button class="rsd-reset" :disabled="loading || loadError || saving" @click="resetCurrentTab">恢复默认</el-button>
      <span class="rsd-spacer" />
      <el-button :disabled="saving" @click="vis = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="loading || loadError" @click="save">保存设置</el-button>
    </template>
  </DrawerEditor>
</template>

<style scoped>
.rsd-current {
  display: flex;
  align-items: center;
  gap: 20px;
}
.rsd-desc {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--c-text-muted);
}
/* Tab（原型 .risk-settings-tabs / .risk-settings-tab L4446–4448） */
.rsd-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-base);
}
.rsd-tab {
  height: 44px;
  padding: 0 24px;
  margin-bottom: -1px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--c-text-muted);
}
.rsd-tab.active {
  color: var(--c-text-strong);
  border-bottom-color: var(--c-accent);
  font-weight: 600;
}
/* Tab 下方适用说明（md §7.2）：与说明文同档弱色，紧贴表格 */
.rsd-scale-note {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--c-text-muted);
}
.rsd-scale-note strong {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
/* 表格（原型 .table：th 48px 灰底 / td 分隔线） */
.rsd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-base);
}
.rsd-table th {
  height: 48px;
  padding: 0 12px;
  text-align: left;
  font-size: 13px;
  font-weight: var(--fw-medium);
  color: var(--c-admin-table-head, var(--c-text-muted));
  background: var(--bg-admin-table-head);
  border-bottom: 1px solid var(--border-soft);
}
.rsd-table td {
  padding: 12px;
  vertical-align: top;
  border-bottom: 1px solid var(--border-soft);
}
.rsd-table tr:last-child td {
  border-bottom: 0;
}
.rsd-item {
  font-size: 14px;
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.rsd-item-desc {
  font-size: 14px;
  line-height: 1.55;
  color: var(--c-text-muted);
}
.rsd-levels {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.rsd-levels :deep(.el-radio) {
  height: auto;
  margin-right: 0;
  padding: 3px 0;
}
.rsd-spacer {
  flex: 1;
}
</style>
