<script setup>
/**
 * 岗位身份卡（交互规格 §2 + 改造设计 §4）—— 紧凑顶部窄横幅。
 *
 * 职责：身份卡级别的就地编辑（岗位名 / 定位）+ 三入口（人格 / 采集 / 数据底座）。
 * - v-model:basic 双向绑定身份卡数据（name/intro/icon/iconSource/claimDesc/persona/intakeSchema）；
 * - 「人格」「采集」改为打开弹窗（PersonaEditDialog / IntakeEditDialog，弹窗由父级持有，本卡仅上抛打开事件）；
 * - SOP 与开场白编辑已退役（设计需求 1），本卡不再承载；
 * - 图标选择改为头像旁 popover（IconPickerPopover，设计反馈 1：不在人格弹窗平铺图标库）。
 *
 * 字段级校验/错误由父级在保存时处理；本组件只负责就地编辑态。
 */
import { computed } from 'vue'
import IconPickerPopover from './IconPickerPopover.vue'

const props = defineProps({
  basic: { type: Object, required: true },
  positionId: { type: [Number, String], default: null },
  positionName: { type: String, default: '' },
  // 数据底座入口徽标：本岗位数据表数量（父级轻量预取 / stage 回吐）
  tableCount: { type: Number, default: 0 },
  // 数据表数量是否仍在加载（加载中入口只显「🗂️ 数据底座」，不显徽标）
  tableCountLoading: { type: Boolean, default: false }
})
const emit = defineEmits(['update:basic', 'open-datatable', 'open-persona', 'open-intake'])

// 入口徽标文案：加载中→空；N=0→「· 暂无表」；N>0→「· N 张表」
const dtBadge = computed(() => {
  if (props.tableCountLoading) return ''
  return props.tableCount > 0 ? `· ${props.tableCount} 张表` : '· 暂无表'
})

function patch(key, value) {
  emit('update:basic', { ...props.basic, [key]: value })
}

/* ---------- 就地编辑（contenteditable） ---------- */
function onNameInput(e) {
  // 岗位名即 store.basic.name 真相，顶部条经 store 联动，无需再 emit（N4）
  patch('name', e.target.innerText.trim())
}
function onIntroInput(e) {
  patch('intro', e.target.innerText.trim())
}

const nameEmpty = computed(() => !String(props.basic.name || '').trim())

// 图标选择回吐（IconPickerPopover 单次给 {icon, iconSource}）：一次性 emit，杜绝连续 patch 覆盖 bug。
function onPickIcon({ icon, iconSource }) {
  emit('update:basic', { ...props.basic, icon, iconSource })
}
</script>

<template>
  <div class="brick identity">
    <div class="id-bar">
      <IconPickerPopover
        :icon="basic.icon"
        :position-name="basic.name || positionName"
        @pick="onPickIcon"
      />
      <div class="id-bar-main">
        <div class="id-name-row">
          <span
            class="ie id-name"
            :class="{ 'name-empty': nameEmpty }"
            contenteditable="true"
            spellcheck="false"
            @blur="onNameInput"
          >{{ basic.name }}</span>
          <span
            class="ie id-pos"
            contenteditable="true"
            spellcheck="false"
            data-ph="岗位定位（一句话）"
            @blur="onIntroInput"
          >{{ basic.intro }}</span>
        </div>
        <div v-if="nameEmpty" class="name-empty-tip">岗位名必填</div>
      </div>
      <div class="id-bar-chips">
        <span class="id-mini" @click="emit('open-persona')">
          🎭 人格 <span class="caret">↗</span>
        </span>
        <span class="id-mini" @click="emit('open-intake')">
          📥 采集 <span class="caret">↗</span>
        </span>
        <!-- 数据底座入口（竖线分隔；点开三栏聚焦弹窗；身份卡不持有弹窗状态，仅上抛事件） -->
        <span class="id-dt-sep"></span>
        <button type="button" class="id-dt-btn" @click="emit('open-datatable')">
          🗂️ 数据底座 <span v-if="dtBadge" class="id-dt-badge">{{ dtBadge }}</span> ▸
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brick {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.identity {
  margin-bottom: var(--space-5);
}
.id-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5);
}
.id-bar-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.id-name-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.ie {
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  margin: -1px -5px;
  cursor: text;
  transition: background var(--dur-fast), border-color var(--dur-fast);
}
.ie:hover {
  background: var(--bg-hover);
}
.ie:focus {
  outline: none;
  background: var(--bg-surface);
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}
.id-name {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.id-name.name-empty {
  border-color: var(--c-danger);
}
.id-pos {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
.id-pos:empty::before {
  content: attr(data-ph);
  color: var(--c-text-faint);
}
.name-empty-tip {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  margin-top: 2px;
}
.id-bar-chips {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
.id-mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--bg-app);
  transition: border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast);
}
.id-mini:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--c-text);
}
.id-mini .caret {
  font-size: 10px;
}
/* 数据底座入口：与人格/采集 chip 之间竖线分隔 */
.id-dt-sep {
  width: 1px;
  align-self: stretch;
  margin: 2px var(--space-1);
  background: var(--border-soft);
}
.id-dt-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--c-text);
  font-size: var(--fs-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--dur-fast), background var(--dur-fast);
}
.id-dt-btn:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.id-dt-badge {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* 窄屏：chips 换行右对齐 */
@media (max-width: 720px) {
  .id-bar-chips {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
