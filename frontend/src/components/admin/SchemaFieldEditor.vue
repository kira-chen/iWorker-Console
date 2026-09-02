<script setup>
/**
 * 入参/出参「字段行编辑器」（契约 §0.6 / 设计 §3.5，N10 起支持多级嵌套）。
 * 单一职责：以字段行维护一组字段，双向绑定字段行数组（v-model:rows）。
 * 列形态由 variant 分流（2026-09-01 拍板）：request=参数名|描述|类型|请求方法(仅顶层,默认Query)|必填|默认值；
 * response=参数名|描述|变量类型。
 * 类型选「对象 object」或「数组 array」时（PRD-20260828 §5），行下方展开一块缩进的子字段区，
 * 递归复用本组件配置子字段——配几层就是几层；切换为非对象/数组类型时清空已有子字段。
 * 组装/反解析 JSON Schema 由父级用 utils/schema 完成。错误（如 field 级红框）由父级通过 error 传入。
 *
 * 删除字段（PRD §5）：点【×】先二次确认（popconfirm 就地确认，不打断编辑流）；删父字段连带删其全部子字段。
 *
 * 递归：模板内用组件自身文件名 <SchemaFieldEditor> 自引用（Vue SFC 支持递归组件）。
 *
 * 稳定 key（CR 落地，参照 BizSystemEditor 业务页行 _uid 范式）：
 * 每行分配一个仅前端用的自增 _uid 作 v-for key（不用数组索引），删中间行时后续行（含展开的
 * 子编辑器 DOM）不再串位/输入态错乱。_uid 是纯 UI 键——rowsToSchema 只读 name/type/
 * required/description/children，天然忽略 _uid，不会混进下发的 schema。inbound rows（含
 * schemaToRows 反解析结果）缺 _uid 时在此就地补齐并 emit 回父级，保证往返稳定。
 */
import { computed, watch } from 'vue'
import { FIELD_TYPES, PARAM_IN_OPTIONS, typeHasChildren } from '@/utils/schema'

// 全局自增 uid 分配器（跨递归层级共享，保证同一编辑器内 key 全局唯一，仅前端用）。
let _uidSeq = 0
function nextUid() {
  return ++_uidSeq
}

const props = defineProps({
  rows: { type: Array, default: () => [] },
  // 字段级错误文案（来自后端 data.field 命中 inputSchema/outputSchema 时）；仅顶层展示
  error: { type: String, default: '' },
  // 嵌套深度（0=顶层）：控制缩进与文案层级提示，子级由父级递增传入
  depth: { type: Number, default: 0 },
  /**
   * 列形态（2026-09-01 拍板）：
   * - request：参数名 | 描述 | 类型 | 请求方法（仅顶层，默认 Query）| 必填 | 默认值
   * - response（默认）：参数名 | 描述 | 变量类型
   */
  variant: { type: String, default: 'response' }
})
const emit = defineEmits(['update:rows'])

const isRequest = computed(() => props.variant === 'request')
// 请求方法列仅请求参数顶层有意义（子字段位置随父字段，天然在 Body 结构里）
const showIn = computed(() => isRequest.value && props.depth === 0)
const gridClass = computed(() =>
  isRequest.value ? (showIn.value ? 'sfe-grid-req' : 'sfe-grid-req-child') : 'sfe-grid-resp'
)

// 给一批行补齐缺失的 _uid（对象/数组行的 children 一并递归补齐）。返回 { rows, changed }：
// changed 表示确有行缺 _uid（需 emit 回父级），无缺失则原样返回、不触发多余更新。
function ensureUids(rows) {
  let changed = false
  const next = (rows || []).map((r) => {
    let row = r
    if (row._uid == null) {
      row = { ...row, _uid: nextUid() }
      changed = true
    }
    if (typeHasChildren(row.type) && Array.isArray(row.children)) {
      const c = ensureUids(row.children)
      if (c.changed) {
        // 复制一层再挂新 children，避免原地改父级传入的 prop 对象
        row = { ...row, children: c.rows }
        changed = true
      }
    }
    return row
  })
  return { rows: next, changed }
}

// inbound rows（含 schemaToRows 反解析）缺 _uid 时就地补齐并回写父级，保证 key 稳定与往返一致。
watch(
  () => props.rows,
  (rows) => {
    const { rows: normalized, changed } = ensureUids(rows)
    if (changed) emit('update:rows', normalized)
  },
  { immediate: true }
)

function update(next) {
  emit('update:rows', next)
}
function addRow() {
  const row = { _uid: nextUid(), name: '', type: 'string', required: false, description: '' }
  if (isRequest.value) {
    row.defaultValue = ''
    if (showIn.value) row.in = 'QUERY' // 请求方法默认 Query（拍板）
  }
  update([...props.rows, row])
}
function removeRow(idx) {
  const next = props.rows.slice()
  next.splice(idx, 1)
  update(next)
}
function patch(idx, key, value) {
  const next = props.rows.map((r, i) => {
    if (i !== idx) return r
    const row = { ...r, [key]: value }
    // 切成对象/数组时，若未初始化子字段则给空数组；切离时移除 children，避免残留脏数据下发（PRD §5）
    if (key === 'type') {
      if (typeHasChildren(value)) {
        if (!Array.isArray(row.children)) row.children = []
      } else {
        delete row.children
      }
    }
    return row
  })
  update(next)
}
// 子字段区更新：把某行的 children 整体替换
function patchChildren(idx, childRows) {
  patch(idx, 'children', childRows)
}
// 删除确认文案：有子字段时明示连带删除
function removeConfirmText(row) {
  return Array.isArray(row.children) && row.children.length
    ? '删除该字段将同时删除其全部子字段，确认删除？'
    : '确认删除该字段？'
}
</script>

<template>
  <div class="sfe" :class="{ 'sfe-error': !!error, 'sfe-nested': depth > 0 }">
    <!-- 列头仅顶层渲染一次；子层（depth>0）隐藏列头，减轻多层嵌套的纵向噪声 -->
    <div v-if="rows.length && depth === 0" class="sfe-head" :class="gridClass">
      <span>参数名</span>
      <span>描述</span>
      <span>{{ isRequest ? '类型' : '变量类型' }}</span>
      <span v-if="showIn">请求方法</span>
      <span v-if="isRequest" class="col-req">必填</span>
      <span v-if="isRequest">默认值</span>
      <span class="col-op"></span>
    </div>
    <template v-for="(row, idx) in rows" :key="row._uid">
      <div class="sfe-row" :class="gridClass">
        <el-input
          :model-value="row.name"
          placeholder="如 billNo"
          @update:model-value="patch(idx, 'name', $event)"
        />
        <el-input
          :model-value="row.description"
          placeholder="字段说明（可选）"
          @update:model-value="patch(idx, 'description', $event)"
        />
        <el-select
          :model-value="row.type"
          @update:model-value="patch(idx, 'type', $event)"
        >
          <el-option
            v-for="t in FIELD_TYPES"
            :key="t.value"
            :value="t.value"
            :label="t.label"
          />
        </el-select>
        <el-select
          v-if="showIn"
          :model-value="row.in || 'QUERY'"
          @update:model-value="patch(idx, 'in', $event)"
        >
          <el-option
            v-for="o in PARAM_IN_OPTIONS"
            :key="o.value"
            :value="o.value"
            :label="o.label"
          />
        </el-select>
        <el-checkbox
          v-if="isRequest"
          class="col-req"
          :model-value="row.required"
          @update:model-value="patch(idx, 'required', $event)"
        />
        <el-input
          v-if="isRequest"
          :model-value="row.defaultValue || ''"
          placeholder="默认值（可选）"
          @update:model-value="patch(idx, 'defaultValue', $event)"
        />
        <!-- 删除前二次确认（PRD §5）；popconfirm 就地确认，不弹全局遮罩 -->
        <el-popconfirm
          :title="removeConfirmText(row)"
          confirm-button-text="删除"
          cancel-button-text="取消"
          confirm-button-type="danger"
          width="240"
          @confirm="removeRow(idx)"
        >
          <template #reference>
            <el-button class="col-op" link type="danger">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-popconfirm>
      </div>
      <!-- 类型为对象/数组：缩进展开子字段区，递归复用本组件（任意层级） -->
      <div v-if="typeHasChildren(row.type)" class="sfe-children">
        <div class="sfe-children-title">
          {{ row.name || (row.type === 'array' ? '（未命名数组）' : '（未命名对象）') }} 的子字段
          <span class="sfe-children-hint">
            {{ row.type === 'array'
              ? '该字段是数组，下面配数组元素内部的字段；子字段仍可是对象/数组，可继续往里套'
              : '该字段是对象，下面配它内部的字段；子字段仍可是对象/数组，可继续往里套' }}
          </span>
        </div>
        <SchemaFieldEditor
          :rows="row.children || []"
          :depth="depth + 1"
          :variant="variant"
          @update:rows="patchChildren(idx, $event)"
        />
      </div>
    </template>
    <div v-if="rows.length === 0" class="sfe-empty">
      {{ depth > 0 ? '暂无子字段，可不配置' : '暂无字段，可不配置（留空表示不约束）' }}
    </div>
    <div class="sfe-foot">
      <el-button link type="primary" @click="addRow">
        {{ depth > 0 ? '+ 添加子字段' : '+ 添加字段' }}
      </el-button>
      <span v-if="depth === 0" class="sfe-hint">类型选「对象」或「数组」可展开配子字段，支持任意层级嵌套</span>
    </div>
    <div v-if="error" class="sfe-err-text">{{ error }}</div>
  </div>
</template>

<style scoped>
.sfe {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  background: var(--bg-sunken);
}
.sfe-error {
  border-color: var(--c-danger);
}
/* 嵌套子字段区：透明底、去外框，靠左侧强调条 + 缩进表达层级，避免多层套盒视觉过重 */
.sfe-nested {
  border: none;
  border-radius: 0;
  padding: 0;
  background: transparent;
}
.sfe-head,
.sfe-row {
  display: grid;
  gap: var(--space-2);
  align-items: center;
}
/* 列宽按形态分流（2026-09-01 拍板列序）：
   response：参数名|描述|变量类型；request：参数名|描述|类型|请求方法(仅顶层)|必填|默认值 */
.sfe-grid-resp {
  grid-template-columns: 1.4fr 1.8fr 1.1fr 36px;
}
.sfe-grid-req {
  grid-template-columns: 1.2fr 1.5fr 1fr 0.9fr 44px 1fr 36px;
}
.sfe-grid-req-child {
  grid-template-columns: 1.2fr 1.5fr 1fr 44px 1fr 36px;
}
.sfe-head {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin-bottom: var(--space-2);
  padding: 0 2px;
}
.sfe-row {
  margin-bottom: var(--space-2);
}
.col-req {
  justify-self: center;
}
/* 子字段容器：左强调条 + 缩进，层级一目了然，深层不迷路 */
.sfe-children {
  margin: 0 0 var(--space-3) var(--space-2);
  padding-left: var(--space-3);
  border-left: 2px solid var(--c-accent);
}
.sfe-children-title {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
  margin-bottom: var(--space-2);
}
.sfe-children-hint {
  font-weight: var(--fw-regular);
  color: var(--c-text-muted);
  margin-left: var(--space-2);
}
.sfe-empty {
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  padding: var(--space-2) 0;
}
.sfe-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-1);
}
.sfe-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.sfe-err-text {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
</style>
