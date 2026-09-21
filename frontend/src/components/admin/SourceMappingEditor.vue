<script setup>
/**
 * 数据源「请求参数映射 + 响应字段映射」编辑区（2026-09-07 PRD-20260904 建；
 * 2026-09-08 按 PRD-20260908 md §六.2 / §六.3 + 原型 L1937 重排）。
 *
 * 2026-09-18 推翻 09-08「MCP 无映射」决议，加 variant prop 复用本组件（md §六.3 / §七.5 两者同一套机制）：
 * 响应字段映射两种 variant 结构完全一致（参数名固定 + 可编辑「接口返回字段名」显式改名 + 描述 + 变量类型），
 * 仅预设字段不同（API：content/source/score，均须填写接口返回字段名；MCP：title/content/sourceName，
 * sourceName 可留空取数据源名称）；variant='mcp' 额外多一个卡内「结果数组路径」必填输入
 * （工具返回结构无统一形状，需 JSONPath 定位结果数组，API 侧无此概念）。
 * 请求参数映射两种 variant 完全一致（复用 SourceMapParamRows，含预设 query/topK、object/array 递归嵌套），
 * 仅副标题文案随 variant 切换。
 *
 * 卡片骨架照原型 kmcp-card / api-param-* / api-resp-*：白卡 + 「标题 + 弱色副注」行 + 灰底表头 + 卡底说明行（右侧添加按钮）。
 * 行字段与父共享引用；增删行 emit update:*；任何交互 emit interact。校验在父层
 * （utils/knowledgeBaseMeta 的 validateRequestMap / validateResponseMap / validateMcpResponseMap）收口。
 */
import { computed } from 'vue'
import { VAR_TYPE_OPTIONS, mkRequestMapRow, mkResponseMapRow, mkMcpResponseMapRow } from '@/utils/knowledgeBaseMeta'
import SourceMapParamRows from './SourceMapParamRows.vue'

const props = defineProps({
  requestRows: { type: Array, required: true },
  responseRows: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
  requestError: { type: String, default: '' },
  responseError: { type: String, default: '' },
  /** 'api'（默认）| 'mcp'：响应字段映射结构随 variant 切换，见文件头注释。 */
  variant: { type: String, default: 'api' },
  /** 仅 variant='mcp'：结果数组路径（md §七.5）。 */
  resultArrayPath: { type: String, default: '' }
})
const emit = defineEmits(['update:requestRows', 'update:responseRows', 'update:resultArrayPath', 'interact'])

const isMcp = computed(() => props.variant === 'mcp')

function addReqRow() {
  emit('update:requestRows', [...props.requestRows, mkRequestMapRow()])
  emit('interact')
}
function addRespRow() {
  emit('update:responseRows', [...props.responseRows, isMcp.value ? mkMcpResponseMapRow() : mkResponseMapRow()])
  emit('interact')
}
function removeRespRow(idx) {
  emit('update:responseRows', props.responseRows.filter((_, i) => i !== idx))
  emit('interact')
}
/** 接口返回字段名占位符：MCP 的 sourceName 引导「留空取数据源名称」，其余（含全部 API 预设）引导必填。 */
function sourceFieldPlaceholder(row) {
  return isMcp.value && row.name === 'sourceName' ? '留空则取数据源名称' : '第三方返回的字段名，如 text'
}
</script>

<template>
  <!-- 请求参数映射（原型 kmcp-card 骨架；两种 variant 结构完全一致，仅副注文案不同） -->
  <section class="sme-card">
    <div class="sme-card-title">
      <strong>请求参数映射 <em class="req">*</em></strong>
      <span>{{ isMcp ? '平台调用工具时的入参结构' : '下游 API 入参 ← 客户端字段映射' }}</span>
    </div>
    <SourceMapParamRows :rows="requestRows" :readonly="readonly" @update:rows="emit('update:requestRows', $event)" @interact="emit('interact')" />
    <!-- 说明文照原型 L1937 完整句；「＋ 添加参数」在说明行右侧（原型 kmcp-note flex space-between） -->
    <div class="sme-note sme-note-row">
      <span>query、topK 为固定映射；可继续添加自定义参数。object / array 字段可逐级展开添加子字段，子字段仍可继续嵌套；必填参数可配置系统默认值。</span>
      <el-button plain :disabled="readonly" @click="addReqRow">＋ 添加参数</el-button>
    </div>
    <div v-if="requestError" class="sme-err">{{ requestError }}</div>
  </section>

  <!-- 响应字段映射（md §六.3 / §七.5 同一套显式改名机制）：variant='mcp' 额外多卡内「结果数组路径」 -->
  <section class="sme-card">
    <div class="sme-card-title">
      <strong>{{ isMcp ? '响应字段' : '响应字段映射' }} <em class="req">*</em></strong>
      <span>{{ isMcp ? '工具返回数组 → 标准知识检索结果' : '下游 API 返回 → 标准知识检索结果' }}</span>
    </div>
    <el-form-item v-if="isMcp" label="结果数组路径" required class="sme-array-path">
      <el-input
        :model-value="resultArrayPath"
        :disabled="readonly"
        placeholder="JSONPath，如 $.content[0].items[*]"
        @update:model-value="emit('update:resultArrayPath', $event); emit('interact')"
      />
    </el-form-item>
    <div class="sme-resp-head">
      <span>参数名</span>
      <span>接口返回字段名</span>
      <span>描述</span>
      <span>变量类型</span>
      <span class="sme-del"></span>
    </div>
    <div v-for="(row, i) in responseRows" :key="i" class="sme-resp-row">
      <code v-if="row.preset" class="sme-fixed-name">{{ row.name }}</code>
      <el-input v-else v-model="row.name" class="sme-name" placeholder="平台标准字段名" @input="emit('interact')" />
      <el-input v-model="row.sourceField" class="sme-name" :placeholder="sourceFieldPlaceholder(row)" @input="emit('interact')" />
      <el-input v-model="row.description" maxlength="200" placeholder="描述（业务备注）" @input="emit('interact')" />
      <el-select v-model="row.type" class="sme-type" @change="emit('interact')">
        <el-option v-for="t in VAR_TYPE_OPTIONS" :key="t" :value="t" :label="t" />
      </el-select>
      <!-- 预设字段不可删除（md §六.3 / §七.5），仅自定义行可删（原型 icon-btn ×） -->
      <span v-if="row.preset" class="sme-del"></span>
      <el-button v-else link class="sme-x" :disabled="readonly" aria-label="删除该字段" title="删除该字段" @click="removeRespRow(i)">×</el-button>
    </div>
    <div class="sme-note sme-note-row">
      <span v-if="isMcp">左列是发给客户端的字段名，右列填第三方接口实际返回的字段名（支持 meta.title 点分路径）；title / content 必填，sourceName 留空则取数据源名称。</span>
      <span v-else>左列是发给客户端的字段名，右列填下游 API 实际返回的字段名（支持点分路径）；content / source / score 均为必填映射。保存校验：至少存在一条输出参数。</span>
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
/* 必填红星（与 McpEditor / BizSystemEditor 的 .req 同款） */
.req {
  color: var(--c-danger);
  font-style: normal;
}
.sme-card-title span {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
/* 响应表列骨架（md §六.3 / §七.5 同构）：参数名 / 接口返回字段名 / 描述 各 1fr，变量类型 110，删除 36，
 * 灰底表头 + 行底分隔线 */
.sme-resp-head,
.sme-resp-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 110px 36px;
  gap: var(--space-2);
  align-items: center;
}
/* 结果数组路径（md §七.5）：卡内独立一行，label 顶置 */
.sme-array-path {
  margin-bottom: var(--space-3);
}
.sme-array-path :deep(.el-form-item__label) {
  display: block;
  width: auto !important;
  margin-bottom: 6px;
  padding: 0;
  text-align: left;
  line-height: 1.4;
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
