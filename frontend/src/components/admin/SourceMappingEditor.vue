<script setup>
/**
 * 数据源「请求参数映射 + 响应字段映射」共用编辑区（2026-09-07 PRD-20260904 知识库数据源新口径）。
 *
 * API 数据源（md §六.2 / §六.3）与 MCP 数据源（md §七.4 / §七.5）的两张映射表完全同构，
 * 本组件按 protocol 切换文案、渲染共用，不逐处复制（卡片骨架照原型 kmcp-card / api-resp-*）。
 * - 请求参数映射：行编辑委托 SourceMapParamRows（预设 query/topK 不可删、object/array 任意层级嵌套）；
 * - 响应字段映射：列 = 参数名 / 描述 / 变量类型；预设 content/source/score 不可删、类型可改（md §六.3）。
 * 行字段与父共享引用；增删行 emit update:*；任何交互 emit interact。校验在父层
 * （utils/knowledgeBaseMeta 的 validateRequestMap / validateResponseMap）收口。
 */
import { VAR_TYPE_OPTIONS, mkResponseMapRow } from '@/utils/knowledgeBaseMeta'
import SourceMapParamRows from './SourceMapParamRows.vue'

const props = defineProps({
  /** 'API' | 'MCP'：切换卡片副注与参数名词头 */
  protocol: { type: String, default: 'API' },
  requestRows: { type: Array, required: true },
  responseRows: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
  requestError: { type: String, default: '' },
  responseError: { type: String, default: '' }
})
const emit = defineEmits(['update:requestRows', 'update:responseRows', 'interact'])

function addRespRow() {
  emit('update:responseRows', [...props.responseRows, mkResponseMapRow()])
  emit('interact')
}
function removeRespRow(idx) {
  emit('update:responseRows', props.responseRows.filter((_, i) => i !== idx))
  emit('interact')
}
</script>

<template>
  <!-- 请求参数映射（原型 kmcp-card 骨架；副注照原型：下游入参 ← 客户端字段映射） -->
  <section class="sme-card">
    <div class="sme-card-title">
      <strong>请求参数映射</strong>
      <span>{{ protocol === 'MCP' ? 'MCP 工具入参 ← 客户端字段映射' : '下游 API 入参 ← 客户端字段映射' }}</span>
    </div>
    <SourceMapParamRows
      :rows="requestRows"
      :readonly="readonly"
      :noun="protocol"
      @update:rows="emit('update:requestRows', $event)"
      @interact="emit('interact')"
    />
    <div class="sme-note">
      query、topK 为固定映射；可继续添加自定义参数，选择对应客户端字段，必填参数可配置系统默认值。
    </div>
    <div v-if="requestError" class="sme-err">{{ requestError }}</div>
  </section>

  <!-- 响应字段映射（md §六.3 / §七.5：参数名 / 描述 / 变量类型；预设三行不可删、类型可改） -->
  <section class="sme-card">
    <div class="sme-card-title">
      <strong>响应字段映射</strong>
      <span>仅返回列表中配置的下游 {{ protocol }} 原始字段</span>
    </div>
    <div class="sme-resp-head">
      <span>参数名</span>
      <span>描述</span>
      <span>变量类型</span>
      <span class="sme-del"></span>
    </div>
    <div v-for="(row, i) in responseRows" :key="i" class="sme-resp-row">
      <code v-if="row.preset" class="sme-fixed-name">{{ row.name }}</code>
      <el-input v-else v-model="row.name" class="sme-name" :placeholder="`${protocol} 原始字段名`" @input="emit('interact')" />
      <el-input v-model="row.description" maxlength="200" placeholder="描述（业务备注）" @input="emit('interact')" />
      <el-select v-model="row.type" class="sme-type" @change="emit('interact')">
        <el-option v-for="t in VAR_TYPE_OPTIONS" :key="t" :value="t" :label="t" />
      </el-select>
      <!-- 预设字段不可删除（md §六.3），仅自定义行可删 -->
      <span v-if="row.preset" class="sme-del"></span>
      <el-button v-else link type="danger" :disabled="readonly" @click="removeRespRow(i)">删除</el-button>
    </div>
    <div class="sme-note sme-note-row">
      <span>保存校验：至少存在一条输出参数。返回时遍历下游结果数组，仅保留已配置字段、其余全部过滤；字段值与嵌套结构完全沿用 {{ protocol }} 返回原样，不做改名映射。</span>
      <el-button link type="primary" :disabled="readonly" @click="addRespRow">＋ 添加字段</el-button>
    </div>
    <div v-if="responseError" class="sme-err">{{ responseError }}</div>
  </section>
</template>

<style scoped>
/* 卡片骨架照原型 kmcp-card：细边框圆角白卡 + 「标题 + 弱色副注」行 */
.sme-card {
  width: 100%;
  border: 1px solid var(--c-border, #e0e6e3);
  border-radius: var(--radius-md);
  background: var(--c-bg, transparent);
  padding: var(--space-4);
}
.sme-card + .sme-card {
  margin-top: var(--space-3);
}
.sme-card-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.sme-card-title strong {
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.sme-card-title span {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.sme-resp-head,
.sme-resp-row {
  display: grid;
  grid-template-columns: 1fr 1.3fr 0.9fr auto;
  gap: var(--space-2);
  align-items: center;
}
.sme-resp-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
}
.sme-resp-row + .sme-resp-row {
  margin-top: var(--space-2);
}
.sme-del {
  min-width: 32px;
}
.sme-fixed-name {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
}
.sme-name :deep(.el-input__inner) {
  font-family: var(--font-mono);
}
.sme-note {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1.55;
}
.sme-note-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}
.sme-err {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
