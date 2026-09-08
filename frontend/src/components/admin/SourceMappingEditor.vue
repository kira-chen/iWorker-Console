<script setup>
/**
 * API 数据源「请求参数映射 + 响应字段映射」编辑区（2026-09-07 PRD-20260904 建；
 * 2026-09-08 按 PRD-20260908 md §六.2 / §六.3 + 原型 L1937 重排）。
 *
 * 仅 API 数据源持有映射（md §七 已删除 MCP 请求 / 响应映射两节，原 protocol=MCP 分支随之退役）。
 * 卡片骨架照原型 kmcp-card / api-param-* / api-resp-*：白卡 + 「标题 + 弱色副注」行 + 灰底表头 + 卡底说明行（右侧添加按钮）。
 * - 请求参数映射：行编辑委托 SourceMapParamRows（预设 query/topK 不可删、object/array 任意层级递归嵌套）；
 *   「＋ 添加参数」按原型放在卡底说明行右侧（plain 描边按钮）；
 * - 响应字段映射：列 = 参数名 / 描述 / 变量类型；预设 content/source/score 不可删、类型可改（md §六.3，
 *   原型预设行可删属 md↔原型冲突，按 md）。
 * 行字段与父共享引用；增删行 emit update:*；任何交互 emit interact。校验在父层
 * （utils/knowledgeBaseMeta 的 validateRequestMap / validateResponseMap）收口。
 */
import { VAR_TYPE_OPTIONS, mkRequestMapRow, mkResponseMapRow } from '@/utils/knowledgeBaseMeta'
import SourceMapParamRows from './SourceMapParamRows.vue'

const props = defineProps({
  requestRows: { type: Array, required: true },
  responseRows: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
  requestError: { type: String, default: '' },
  responseError: { type: String, default: '' }
})
const emit = defineEmits(['update:requestRows', 'update:responseRows', 'interact'])

function addReqRow() {
  emit('update:requestRows', [...props.requestRows, mkRequestMapRow()])
  emit('interact')
}
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
  <!-- 请求参数映射（原型 kmcp-card 骨架；副注照原型：下游 API 入参 ← 客户端字段映射） -->
  <section class="sme-card">
    <div class="sme-card-title">
      <strong>请求参数映射</strong>
      <span>下游 API 入参 ← 客户端字段映射</span>
    </div>
    <SourceMapParamRows :rows="requestRows" :readonly="readonly" @update:rows="emit('update:requestRows', $event)" @interact="emit('interact')" />
    <!-- 说明文照原型 L1937 完整句；「＋ 添加参数」在说明行右侧（原型 kmcp-note flex space-between） -->
    <div class="sme-note sme-note-row">
      <span>query、topK 为固定映射；可继续添加自定义参数。object / array 字段可逐级展开添加子字段，子字段仍可继续嵌套；必填参数可配置系统默认值。</span>
      <el-button plain :disabled="readonly" @click="addReqRow">＋ 添加参数</el-button>
    </div>
    <div v-if="requestError" class="sme-err">{{ requestError }}</div>
  </section>

  <!-- 响应字段映射（md §六.3：参数名 / 描述 / 变量类型；预设三行不可删、类型可改） -->
  <section class="sme-card">
    <div class="sme-card-title">
      <strong>响应字段映射</strong>
      <span>仅返回列表中配置的下游 API 原始字段</span>
    </div>
    <div class="sme-resp-head">
      <span>参数名</span>
      <span>描述</span>
      <span>变量类型</span>
      <span class="sme-del"></span>
    </div>
    <div v-for="(row, i) in responseRows" :key="i" class="sme-resp-row">
      <code v-if="row.preset" class="sme-fixed-name">{{ row.name }}</code>
      <el-input v-else v-model="row.name" class="sme-name" placeholder="API 原始字段名" @input="emit('interact')" />
      <el-input v-model="row.description" maxlength="200" placeholder="描述（业务备注）" @input="emit('interact')" />
      <el-select v-model="row.type" class="sme-type" @change="emit('interact')">
        <el-option v-for="t in VAR_TYPE_OPTIONS" :key="t" :value="t" :label="t" />
      </el-select>
      <!-- 预设字段不可删除（md §六.3），仅自定义行可删（原型 icon-btn ×） -->
      <span v-if="row.preset" class="sme-del"></span>
      <el-button v-else link class="sme-x" :disabled="readonly" aria-label="删除该字段" title="删除该字段" @click="removeRespRow(i)">×</el-button>
    </div>
    <div class="sme-note sme-note-row">
      <span>保存校验：至少存在一条输出参数。返回时遍历下游结果数组，仅保留已配置字段、其余全部过滤；字段值与嵌套结构完全沿用 API 返回原样，不做改名映射。</span>
      <el-button plain :disabled="readonly" @click="addRespRow">＋ 添加字段</el-button>
    </div>
    <div v-if="responseError" class="sme-err">{{ responseError }}</div>
  </section>
</template>

<style scoped>
/* 卡片骨架照原型 kmcp-card：细边框圆角白卡 + 「标题 + 弱色副注」行 */
.sme-card {
  width: 100%;
  border: 1px solid var(--border-admin-card);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
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
/* 响应表列骨架照原型 api-resp-head / api-resp-row：1fr / 1fr / 110 / 36，灰底表头 + 行底分隔线 */
.sme-resp-head,
.sme-resp-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 110px 36px;
  gap: var(--space-2);
  align-items: center;
}
.sme-resp-head {
  padding: 7px 9px;
  border-radius: 6px 6px 0 0;
  background: var(--bg-admin-table-head);
  font-size: var(--fs-xs);
  color: var(--c-admin-table-head);
  line-height: 1;
}
.sme-resp-row {
  padding: 7px 9px;
  border-bottom: 1px solid var(--border-soft);
}
.sme-del {
  min-width: 36px;
}
.sme-x {
  justify-self: center;
  width: 28px;
  height: 28px;
  font-size: 20px;
  line-height: 1;
  color: var(--c-text-muted);
}
.sme-x:hover {
  color: var(--c-danger);
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
  margin-top: 9px;
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
.sme-note-row :deep(.el-button) {
  flex: 0 0 auto;
}
.sme-err {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
