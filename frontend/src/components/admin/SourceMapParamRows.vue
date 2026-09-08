<script setup>
/**
 * API 数据源「请求参数映射」行编辑器（递归）。
 * 2026-09-07 PRD-20260904 建；2026-09-08 按 PRD-20260908 md §六.2 递归嵌套 7 条 + 原型 L1937 / L2009–2019 重排。
 *
 * 顶层（depth=0，原型 api-param-head / api-param-row）：列 = API 参数名 / 类型 / 必填 / 映射客户端字段 / 默认值 / 删除；
 *   预设行（row.preset：query / topK）参数名与类型固定展示、必填与映射不可改、无默认值、不可删除（md：固定参数不可删除）；
 *   顶层「＋ 添加参数」按钮由 SourceMappingEditor 放在卡底说明行右侧（原型 kmcp-note），本组件不渲染。
 * 子层（depth>0，原型 api-subparam-section）：列收敛为 子字段名 / 类型 / 默认值 / 删除（md §六.2）；
 *   层头「下一级子字段 · object / array 可继续嵌套」提示 + 底部「＋ 添加下一级子字段」（原型 L2012 文案）；
 *   缩进 + 左侧层级线 + 逐级变浅背景 + 行首连接短线；展开中的 object / array 类型下拉用强调色（全层级，md「展开中的…使用强调色」）。
 * 类型切基础类型：子字段区收起、children 作为草稿保留在行对象上；切回 object / array 时恢复；
 *   最终保存为基础类型时由父层 cleanRequestRows 不提交 children（md §六.2）。删除父行即级联删除全部后代。
 * 行字段直接 v-model 到行对象（与父共享引用）；增删行 emit update:rows；任何交互 emit interact（父层清校验红框）。
 */
import { VAR_TYPE_OPTIONS, CLIENT_FIELD_OPTIONS, mkRequestMapRow } from '@/utils/knowledgeBaseMeta'
import SourceMapParamRows from './SourceMapParamRows.vue'

const props = defineProps({
  rows: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
  /** 嵌套深度（0=顶层，仅顶层有预设行与必填 / 映射列；子层 4 列 + 缩进） */
  depth: { type: Number, default: 0 }
})
const emit = defineEmits(['update:rows', 'interact'])

function addRow() {
  emit('update:rows', [...props.rows, mkRequestMapRow()])
  emit('interact')
}
function removeRow(idx) {
  emit('update:rows', props.rows.filter((_, i) => i !== idx))
  emit('interact')
}
function isNested(row) {
  return row.type === 'object' || row.type === 'array'
}
function onTypeChange(row) {
  // children 不清空：切基础类型时作为草稿暂存，切回 object / array 恢复（md §六.2）
  if (!Array.isArray(row.children)) row.children = []
  emit('interact')
}
function updateChildren(row, next) {
  row.children = next
  emit('interact')
}
</script>

<template>
  <div class="smp-rows" :class="{ 'is-sub': depth > 0 }">
    <!-- 子层层头（原型 api-subparam-depth-label）：主文「下一级子字段」+ 副文 -->
    <div v-if="depth > 0" class="smp-depth-label">
      下一级子字段
      <span>object / array 可继续嵌套</span>
    </div>
    <div class="smp-head">
      <span>{{ depth > 0 ? '子字段名' : 'API 参数名' }}</span>
      <span>类型</span>
      <template v-if="depth === 0">
        <span class="smp-center">必填</span>
        <span>映射客户端字段</span>
      </template>
      <span>默认值</span>
      <span class="smp-del"></span>
    </div>
    <template v-for="(row, i) in rows" :key="i">
      <div class="smp-node">
        <div class="smp-row">
          <!-- 预设行参数名 / 类型固定（md §六.2：query·topK 为固定参数） -->
          <code v-if="row.preset" class="smp-fixed-name">{{ row.name }}</code>
          <el-input v-else v-model="row.name" class="smp-name" :placeholder="depth > 0 ? '子字段名' : 'API 参数名'" @input="emit('interact')" />
          <span v-if="row.preset" class="smp-fixed-type">{{ row.type }}</span>
          <el-select v-else v-model="row.type" class="smp-type" :class="{ 'is-expanded': isNested(row) }" @change="onTypeChange(row)">
            <el-option v-for="t in VAR_TYPE_OPTIONS" :key="t" :value="t" :label="t" />
          </el-select>
          <template v-if="depth === 0">
            <span class="smp-center">
              <el-checkbox
                v-model="row.required"
                :disabled="row.preset"
                :title="row.preset ? (row.required ? '固定必填' : '固定选填') : undefined"
                @change="emit('interact')"
              />
            </span>
            <el-select
              v-model="row.clientField"
              class="smp-client"
              :disabled="row.preset"
              :title="row.preset ? '固定映射' : undefined"
              @change="emit('interact')"
            >
              <el-option v-if="!row.preset" value="" label="不映射" />
              <el-option v-for="o in CLIENT_FIELD_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
            </el-select>
          </template>
          <span v-if="row.preset" class="smp-nodefault">—</span>
          <el-input v-else v-model="row.defaultValue" placeholder="默认值（可选）" @input="emit('interact')" />
          <!-- 固定行不可删（md §六.2），仅自定义行给删除入口（原型 icon-btn ×；删父级级联删后代） -->
          <span v-if="row.preset" class="smp-del"></span>
          <el-button
            v-else
            link
            class="smp-x"
            :disabled="readonly"
            :aria-label="depth > 0 ? '删除该字段及其所有子字段' : '删除参数及其所有子字段'"
            :title="depth > 0 ? '删除该字段及其所有子字段' : '删除参数及其所有子字段'"
            @click="removeRow(i)"
          >
            ×
          </el-button>
        </div>
        <!-- object / array：展开子字段区，任意层级递归（md §六.2）；基础类型时收起（children 草稿保留） -->
        <div v-if="!row.preset && isNested(row)" class="smp-sub">
          <SourceMapParamRows :rows="row.children || []" :readonly="readonly" :depth="depth + 1" @update:rows="updateChildren(row, $event)" @interact="emit('interact')" />
        </div>
      </div>
    </template>
    <div v-if="depth > 0" class="smp-add">
      <el-button plain size="small" :disabled="readonly" @click="addRow">＋ 添加下一级子字段</el-button>
    </div>
  </div>
</template>

<style scoped>
.smp-rows {
  width: 100%;
  display: flex;
  flex-direction: column;
}
/* 顶层列骨架照原型 api-param-head / api-param-row：110 / 72 / 64 / 1fr / 1fr / 36 */
.smp-head,
.smp-row {
  display: grid;
  grid-template-columns: 128px 100px 56px minmax(0, 1fr) minmax(0, 1fr) 36px;
  gap: var(--space-2);
  align-items: center;
}
/* 表头灰底圆角条（原型 .api-param-head） */
.smp-head {
  padding: 7px 9px;
  border-radius: 6px 6px 0 0;
  background: var(--bg-admin-table-head);
  font-size: var(--fs-xs);
  color: var(--c-admin-table-head);
  line-height: 1;
}
/* 行底细分隔线（原型 .api-param-row） */
.smp-row {
  padding: 7px 9px;
  border-bottom: 1px solid var(--border-soft);
}
.smp-center {
  min-width: 40px;
  text-align: center;
}
.smp-del {
  min-width: 36px;
}
.smp-fixed-name {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.smp-fixed-type,
.smp-nodefault {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.smp-name :deep(.el-input__inner) {
  font-family: var(--font-mono);
}
/* 删除 ×（原型 .icon-btn：透明底、放大字号） */
.smp-x {
  justify-self: center;
  width: 28px;
  height: 28px;
  font-size: 20px;
  line-height: 1;
  color: var(--c-text-muted);
}
.smp-x:hover {
  color: var(--c-danger);
}
/* 展开中的 object / array 类型下拉强调色（原型 .api-subparam-type[aria-expanded="true"]，按 md 全层级） */
.smp-type.is-expanded :deep(.el-select__wrapper) {
  box-shadow: 0 0 0 1px var(--c-accent) inset, 0 0 0 1px var(--c-accent);
}
/* 子字段区（原型 .api-subparam-section）：缩进 18 + 左侧 3px 层级线 + 分层背景。
   层级色阶（原型 L2006 / L2019：底 #f5f9f7 → #f8fbf9 → #fbfcfb；线 #b8d9cb → #9fcbb8）用强调色
   半透明叠加表达，浅 / 暗两主题共用；变量挂在各级 .smp-sub 上，行首连接线取最近一级的线色 */
.smp-sub {
  --smp-sub-bg: rgba(16, 185, 129, 0.07);
  --smp-sub-line: rgba(16, 185, 129, 0.38);
  margin: 2px 0 6px 18px;
  padding: 8px 10px 6px;
  border-left: 3px solid var(--smp-sub-line);
  background: var(--smp-sub-bg);
  border-radius: 0 6px 6px 0;
}
/* 二级 / 三级逐级变浅（原型 L2019） */
.smp-sub .smp-sub {
  --smp-sub-bg: rgba(16, 185, 129, 0.045);
  --smp-sub-line: rgba(16, 185, 129, 0.3);
  margin-top: 4px;
}
.smp-sub .smp-sub .smp-sub {
  --smp-sub-bg: rgba(16, 185, 129, 0.025);
}
/* 子层列骨架照原型 api-subparam-head / api-subparam-row：子字段名 / 类型 100 / 默认值 / 36 */
.smp-rows.is-sub > .smp-head,
.smp-rows.is-sub > .smp-node > .smp-row {
  grid-template-columns: minmax(0, 1fr) 100px minmax(0, 1fr) 36px;
}
.smp-rows.is-sub > .smp-head {
  padding: 3px 4px;
  margin-bottom: 3px;
  border-radius: 0;
  background: transparent;
}
.smp-rows.is-sub > .smp-node > .smp-row {
  position: relative;
  padding: 5px 4px;
}
/* 子行行首横向连接短线（原型 .api-subparam-node>.api-subparam-row:before） */
.smp-rows.is-sub > .smp-node > .smp-row::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  width: 7px;
  border-top: 1px solid var(--smp-sub-line);
}
/* 层头（原型 .api-subparam-depth-label） */
.smp-depth-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 1px 4px 6px;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--c-text);
}
.smp-depth-label span {
  font-weight: var(--fw-regular);
  color: var(--c-text-muted);
}
.smp-add {
  display: flex;
  align-items: center;
  margin: 6px 0 2px;
}
.smp-add :deep(.el-button) {
  font-size: var(--fs-xs);
}
</style>
