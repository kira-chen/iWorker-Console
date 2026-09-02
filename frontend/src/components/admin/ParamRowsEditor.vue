<script setup>
/**
 * 参数行编辑器（公共组件，2026-08-31 API KEY 鉴权改造 B.3）。
 *
 * 自 McpEditor 的 V110 Env 行编辑器抽象而来，两处共用（一致性靠抽象兑现，不逐页复制）：
 *  - MCP stdio Env：不显示「位置」列（showIn=false），行 = 名称/描述/客户端填写/平台值；
 *  - API KEY 鉴权：显示「位置」列（showIn=true），行 = 位置/参数名/描述/客户端填写/参数值。
 *
 * 行结构（父组件持有）：{ in?, key, description, clientFill, value, configured, valueMasked? }
 *  - clientFill：true=客户端填写（值由客户端收集，与 value 互斥——勾选即清空禁用）；
 *  - value：平台值明文（仅提交瞬间存在；编辑态留空=保留旧密文，永不回显）；
 *  - configured：该行后端已有密文（决定 value 占位提示「留空保留」）；
 *  - valueMasked：首尾掩码串（全站密钥掩码口径，2026-09-01）——有则占位提示带掩码供核对。
 *
 * 行内字段直接 v-model 到行对象（与父共享引用）；增删行 emit update:rows；
 * 任何交互 emit interact（父组件借此清字段级红框）。校验不在本组件（父层 defValidate 收口）。
 */
const props = defineProps({
  rows: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
  /** 是否显示「位置」列（API 鉴权 true / MCP Env false）。 */
  showIn: { type: Boolean, default: false },
  /** 位置下拉选项 [{ value, label }]（仅 showIn）。 */
  inOptions: { type: Array, default: () => [] },
  /** 位置选项禁用判定（仅 showIn，如 BODY×GET/DELETE 互斥）。 */
  inDisabled: { type: Function, default: () => false },
  /** 行级提示（仅 showIn 场景用到，如 QUERY 泄漏警示）：(row) => { type:'warn'|'hint', text } | null */
  rowNotice: { type: Function, default: () => null },
  keyHeader: { type: String, default: '名称' },
  keyPlaceholder: { type: String, default: 'API_KEY' },
  valueHeader: { type: String, default: '平台值' },
  descPlaceholder: { type: String, default: '选填：这个变量是做什么的' },
  addLabel: { type: String, default: '+ 添加变量' },
  /** 含客户端填写行时展示的底部提示；空串不展示。 */
  clientFillHint: { type: String, default: '' }
})
const emit = defineEmits(['update:rows', 'interact'])

function emptyRow() {
  const row = { key: '', description: '', clientFill: false, value: '', configured: false }
  if (props.showIn) row.in = props.inOptions[0]?.value ?? ''
  return row
}
function addRow() {
  emit('update:rows', [...props.rows, emptyRow()])
  emit('interact')
}
function removeRow(idx) {
  emit('update:rows', props.rows.filter((_, i) => i !== idx))
  emit('interact')
}
// 勾选「客户端填写」→ 平台值互斥清空（后端同口径校验，V110 拍板语义）
function onClientFillChange(row) {
  if (row.clientFill) row.value = ''
  emit('interact')
}
function valuePlaceholder(row) {
  if (row.clientFill) return '由客户端填写'
  if (!row.configured) return '必填'
  // 已配置：占位展示首尾掩码供核对（全站密钥掩码口径），留空=保留原值
  return row.valueMasked ? `当前 ${row.valueMasked}（留空保留）` : '已配置（留空保留原值）'
}
</script>

<template>
  <div class="pr-rows">
    <!-- 列序（2026-09-01 拍板）：参数名 → 描述 → 客户端填写 → 位置(仅 showIn) → 值 -->
    <div v-if="rows.length" class="pr-row pr-row-head" :class="{ 'has-in': showIn }">
      <span>{{ keyHeader }}</span>
      <span>描述（客户端可见）</span>
      <span class="pr-cf-head">客户端填写</span>
      <span v-if="showIn">位置</span>
      <span>{{ valueHeader }}</span>
      <span class="pr-del-head"></span>
    </div>
    <template v-for="(row, i) in rows" :key="i">
      <div class="pr-row" :class="{ 'has-in': showIn }">
        <el-input v-model="row.key" class="pr-key-input" :placeholder="keyPlaceholder" @input="emit('interact')" />
        <el-input v-model="row.description" maxlength="200" :placeholder="descPlaceholder" @input="emit('interact')" />
        <span class="pr-cf">
          <el-checkbox v-model="row.clientFill" @change="onClientFillChange(row)" />
        </span>
        <el-select v-if="showIn" v-model="row.in" class="pr-in-select" @change="emit('interact')">
          <el-option
            v-for="o in inOptions"
            :key="o.value"
            :value="o.value"
            :label="o.label"
            :disabled="inDisabled(o.value)"
          />
        </el-select>
        <el-input
          v-model="row.value"
          :disabled="row.clientFill"
          :placeholder="valuePlaceholder(row)"
          @input="emit('interact')"
        />
        <el-button link type="danger" :disabled="readonly" @click="removeRow(i)">删除</el-button>
      </div>
      <div
        v-if="rowNotice(row)"
        class="pr-row-notice"
        :class="rowNotice(row).type === 'warn' ? 'is-warn' : 'is-hint'"
      >
        {{ rowNotice(row).text }}
      </div>
    </template>
    <div class="pr-add">
      <el-button link type="primary" :disabled="readonly" @click="addRow">{{ addLabel }}</el-button>
      <span v-if="clientFillHint && rows.some((r) => r.clientFill)" class="pr-cf-hint">
        {{ clientFillHint }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.pr-rows {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.pr-row {
  display: grid;
  grid-template-columns: 1.1fr 1.5fr auto 1.3fr auto;
  gap: var(--space-2);
  align-items: center;
}
.pr-row.has-in {
  grid-template-columns: 1fr 1.4fr auto 0.9fr 1.2fr auto;
}
.pr-row-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1;
}
.pr-cf-head,
.pr-cf {
  min-width: 64px;
  text-align: center;
}
.pr-del-head {
  min-width: 32px;
}
.pr-key-input :deep(.el-input__inner) {
  font-family: var(--font-mono);
}
/* 行级提示（QUERY 泄漏警示等）：紧贴所属行，缩进对齐内容区 */
.pr-row-notice {
  font-size: var(--fs-xs);
  margin-top: calc(-1 * var(--space-1));
}
.pr-row-notice.is-warn {
  color: var(--c-warning, #b7791f);
}
.pr-row-notice.is-hint {
  color: var(--c-text-faint);
}
.pr-add {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.pr-cf-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
