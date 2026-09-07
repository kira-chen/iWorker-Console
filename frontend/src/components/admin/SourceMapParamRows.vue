<script setup>
/**
 * 请求参数映射行编辑器（递归，2026-09-07 PRD-20260904 知识库数据源新口径）。
 *
 * 供 SourceMappingEditor 渲染「请求参数映射」表体：列 = 参数名 / 类型 / 必填 / 映射客户端字段 / 默认值 / 删除
 * （md §六.2 / §七.4，API 与 MCP 数据源完全同构）。
 * - 预设行（row.preset：query / topK）：参数名与类型固定展示、必填与映射不可改、无默认值、不可删除（md：固定参数不可删除）；
 * - 自定义行可增删；类型选 object / array 时展开子字段区，子字段结构与一级字段一致、任意层级嵌套（md §六.2）——
 *   通过组件自递归实现（子层无预设行）。
 * 行字段直接 v-model 到行对象（与父共享引用）；增删行 emit update:rows；任何交互 emit interact（父层清校验红框）。
 */
import { VAR_TYPE_OPTIONS, CLIENT_FIELD_OPTIONS, mkRequestMapRow } from '@/utils/knowledgeBaseMeta'
import SourceMapParamRows from './SourceMapParamRows.vue'

const props = defineProps({
  rows: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
  /** 参数名词头：'API' | 'MCP'（列头与占位文案用） */
  noun: { type: String, default: 'API' },
  /** 嵌套深度（0=顶层，仅顶层有预设行语义；子层加缩进） */
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
  if (!Array.isArray(row.children)) row.children = []
  emit('interact')
}
function updateChildren(row, next) {
  row.children = next
  emit('interact')
}
</script>

<template>
  <div class="smp-rows">
    <div class="smp-head" :class="{ 'is-sub': depth > 0 }">
      <span>{{ depth > 0 ? '子字段名' : `${noun} 参数名` }}</span>
      <span>类型</span>
      <span class="smp-center">必填</span>
      <span>映射客户端字段</span>
      <span>默认值</span>
      <span class="smp-del"></span>
    </div>
    <template v-for="(row, i) in rows" :key="i">
      <div class="smp-row">
        <!-- 预设行参数名 / 类型固定（md §六.2：query·topK 为固定参数） -->
        <code v-if="row.preset" class="smp-fixed-name">{{ row.name }}</code>
        <el-input v-else v-model="row.name" class="smp-name" :placeholder="`${noun} 参数名`" @input="emit('interact')" />
        <span v-if="row.preset" class="smp-fixed-type">{{ row.type }}</span>
        <el-select v-else v-model="row.type" class="smp-type" @change="onTypeChange(row)">
          <el-option v-for="t in VAR_TYPE_OPTIONS" :key="t" :value="t" :label="t" />
        </el-select>
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
        <span v-if="row.preset" class="smp-nodefault">—</span>
        <el-input v-else v-model="row.defaultValue" placeholder="默认值（可选）" @input="emit('interact')" />
        <!-- 固定行不可删（md §六.2），仅自定义行给删除入口 -->
        <span v-if="row.preset" class="smp-del"></span>
        <el-button v-else link type="danger" :disabled="readonly" @click="removeRow(i)">删除</el-button>
      </div>
      <!-- object / array：展开子字段区，结构与一级字段一致、任意层级（md §六.2） -->
      <div v-if="!row.preset && isNested(row)" class="smp-sub">
        <SourceMapParamRows
          :rows="row.children || []"
          :readonly="readonly"
          :noun="noun"
          :depth="depth + 1"
          @update:rows="updateChildren(row, $event)"
          @interact="emit('interact')"
        />
      </div>
    </template>
    <div class="smp-add">
      <el-button link type="primary" :disabled="readonly" @click="addRow">
        {{ depth > 0 ? '＋ 添加子字段' : '＋ 添加参数' }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.smp-rows {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
/* 列骨架照原型 api-param-head/api-param-row：名 / 类型 / 必填 / 映射客户端字段 / 默认值 / 删 */
.smp-head,
.smp-row {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr auto 1.2fr 1fr auto;
  gap: var(--space-2);
  align-items: center;
}
.smp-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1;
}
.smp-center {
  min-width: 40px;
  text-align: center;
}
.smp-del {
  min-width: 32px;
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
/* 子字段区：缩进 + 左侧引导线（原型 api-subparam-section 骨架） */
.smp-sub {
  margin-left: 18px;
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--c-border, #d6ddd9);
  background: var(--c-bg-subtle, rgba(0, 0, 0, 0.02));
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}
.smp-add {
  display: flex;
  align-items: center;
}
</style>
