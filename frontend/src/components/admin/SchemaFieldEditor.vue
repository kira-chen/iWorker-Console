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
 * 2026-09-09 原型复刻批次 3A · A5：**同表扁平缩进行**（原型 requestRowsHtml/responseRowsHtml L899-900
 * + schemaBlock L901）。原实现把子字段渲染成独立缩进块（带「X 的子字段」小标题 + 各自的空态与脚），
 * 层数一多就是一堆嵌套盒子；原型是一张表、一份表头，子字段按 depth 左缩进（24/48/72px，最深 3 级）
 * 直接跟在父行后面，对象/数组行的操作区多出【＋子字段】link。改造点：
 *   - 顶层组件把树拍平成 `flatRows`（带 depth / path），一次 v-for 渲染完，表头只在顶层出一份；
 *   - 请求方法列各层都在（原型 req-row 每层都有 `.req-method`；原先仅顶层）；
 *   - 去掉子块标题 / 子块空态 / 子块脚，底部只留一处【＋ 添加字段】+ 嵌套提示；
 *   - 删除仍用 popconfirm（md §三.5 要求二次确认；原型 `window.confirm` 属原型形态，不搬）。
 * 组件不再自递归；depth 只作缩进量，不再控制列形态。
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
  // 字段级错误文案（来自后端 data.field 命中 inputSchema/outputSchema 时）
  error: { type: String, default: '' },
  /**
   * 列形态（2026-09-01 拍板）：
   * - request：参数名 | 描述 | 类型 | 请求方法（默认 Query）| 必填 | 默认值
   * - response（默认）：参数名 | 描述 | 变量类型
   */
  variant: { type: String, default: 'response' }
})
const emit = defineEmits(['update:rows'])

const isRequest = computed(() => props.variant === 'request')
// A5：请求方法列各层都在（原型 requestRowsHtml 每层行都渲染 `.req-method`）
const showIn = computed(() => isRequest.value)
const gridClass = computed(() => (isRequest.value ? 'sfe-grid-req' : 'sfe-grid-resp'))
// 缩进最深 3 级（原型 `depth-1/2/3` = 左缩进 24/48/72px，再深不继续缩进）
const INDENT_PX = 24
const MAX_INDENT_DEPTH = 3

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

/**
 * 树 → 扁平展示行（A5）：先序遍历，每行带 depth（缩进量）与 path（在树中的下标链，
 * 供增删改按路径定位）。父行紧跟其子行，正是原型 requestRowsHtml 递归拼串的顺序。
 */
const flatRows = computed(() => {
  const out = []
  const walk = (rows, depth, path) => {
    ;(rows || []).forEach((row, i) => {
      const p = [...path, i]
      out.push({ row, depth, path: p })
      if (typeHasChildren(row.type) && Array.isArray(row.children)) {
        walk(row.children, depth + 1, p)
      }
    })
  }
  walk(props.rows, 0, [])
  return out
})

function newRow() {
  const row = { _uid: nextUid(), name: '', type: 'string', required: false, description: '' }
  if (isRequest.value) {
    row.defaultValue = ''
    row.in = 'QUERY' // 请求方法默认 Query（拍板）
  }
  return row
}

/**
 * 按 path 就地改写树并回吐新数组（沿路径逐层浅拷贝，不改父级传入的对象）。
 * mutate 收到目标行所在的**数组副本**与该行下标，返回值忽略——直接改副本即可。
 */
function mutateAt(path, mutate) {
  const rebuild = (rows, depth) => {
    const next = rows.slice()
    const idx = path[depth]
    if (depth === path.length - 1) {
      mutate(next, idx)
      return next
    }
    const child = { ...next[idx] }
    child.children = rebuild(child.children || [], depth + 1)
    next[idx] = child
    return next
  }
  update(rebuild(props.rows, 0))
}

/** 顶层追加一行（表底【＋ 添加字段】）。 */
function addRow() {
  update([...props.rows, newRow()])
}

/** 行内【＋子字段】（原型 L899 `.api-schema-child`）：给对象/数组行的 children 追加一行。 */
function addChild(path) {
  mutateAt(path, (arr, idx) => {
    const row = { ...arr[idx] }
    row.children = [...(row.children || []), newRow()]
    arr[idx] = row
  })
}

function removeRow(path) {
  mutateAt(path, (arr, idx) => arr.splice(idx, 1))
}

function patch(path, key, value) {
  mutateAt(path, (arr, idx) => {
    const row = { ...arr[idx], [key]: value }
    // 切成对象/数组时，若未初始化子字段则给空数组；切离时移除 children，避免残留脏数据下发（PRD §5）
    if (key === 'type') {
      if (typeHasChildren(value)) {
        if (!Array.isArray(row.children)) row.children = []
      } else {
        delete row.children
      }
    }
    arr[idx] = row
  })
}

// 删除确认文案：有子字段时明示连带删除
function removeConfirmText(row) {
  return Array.isArray(row.children) && row.children.length
    ? '删除该字段将同时删除其全部子字段，确认删除？'
    : '确认删除该字段？'
}
</script>

<template>
  <div class="sfe" :class="{ 'sfe-error': !!error }">
    <!-- 表头只一份（原型 schemaBlock L901 `.schema-header-row`），子字段行共用同一套列 -->
    <div v-if="flatRows.length" class="sfe-head" :class="gridClass">
      <span>参数名</span>
      <span>描述</span>
      <span>{{ isRequest ? '类型' : '变量类型' }}</span>
      <span v-if="showIn">请求方法</span>
      <span v-if="isRequest" class="col-req">必填</span>
      <span v-if="isRequest">默认值</span>
      <span class="col-op"></span>
    </div>
    <!-- 扁平缩进行（A5）：父行后紧跟其子行，depth 决定左缩进；每行列完整 -->
    <div
      v-for="item in flatRows"
      :key="item.row._uid"
      class="sfe-row"
      :class="[gridClass, { 'is-child': item.depth > 0 }]"
      :style="{ marginLeft: `${Math.min(item.depth, MAX_INDENT_DEPTH) * INDENT_PX}px` }"
    >
      <el-input
        :model-value="item.row.name"
        placeholder="参数名"
        @update:model-value="patch(item.path, 'name', $event)"
      />
      <el-input
        :model-value="item.row.description"
        placeholder="描述"
        @update:model-value="patch(item.path, 'description', $event)"
      />
      <el-select
        :model-value="item.row.type"
        @update:model-value="patch(item.path, 'type', $event)"
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
        :model-value="item.row.in || 'QUERY'"
        @update:model-value="patch(item.path, 'in', $event)"
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
        :model-value="item.row.required"
        @update:model-value="patch(item.path, 'required', $event)"
      />
      <el-input
        v-if="isRequest"
        :model-value="item.row.defaultValue || ''"
        placeholder="默认值（可选）"
        @update:model-value="patch(item.path, 'defaultValue', $event)"
      />
      <!-- 行操作区（原型 `.api-schema-row-actions`）：对象/数组行多出【＋子字段】，其后是删除 -->
      <div class="sfe-row-actions col-op">
        <el-button
          v-if="typeHasChildren(item.row.type)"
          link
          type="primary"
          class="sfe-child-add"
          @click="addChild(item.path)"
        >
          ＋子字段
        </el-button>
        <!-- 删除前二次确认（PRD §5）；popconfirm 就地确认，不弹全局遮罩 -->
        <el-popconfirm
          :title="removeConfirmText(item.row)"
          confirm-button-text="删除"
          cancel-button-text="取消"
          confirm-button-type="danger"
          width="240"
          @confirm="removeRow(item.path)"
        >
          <template #reference>
            <el-button link type="danger">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-popconfirm>
      </div>
    </div>
    <div v-if="flatRows.length === 0" class="sfe-empty">暂无字段，可不配置（留空表示不约束）</div>
    <div class="sfe-foot">
      <el-button link type="primary" @click="addRow">＋ 添加字段</el-button>
      <span class="sfe-hint">类型选「对象」或「数组」可展开配子字段，支持任意层级嵌套</span>
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
.sfe-head,
.sfe-row {
  display: grid;
  gap: var(--space-2);
  align-items: center;
}
/* 列宽按形态分流（2026-09-01 拍板列序）：
   response：参数名|描述|变量类型；request：参数名|描述|类型|请求方法|必填|默认值
   （A5：请求方法列各层都在，子层不再另设一套列宽） */
.sfe-grid-req {
  /* 末列放【＋子字段】+ 删除两枚按钮，比原来的 36px 单删除列宽 */
  grid-template-columns: 1.2fr 1.5fr 1fr 0.9fr 44px 1fr 96px;
}
.sfe-grid-resp {
  grid-template-columns: 1.4fr 1.8fr 1.1fr 96px;
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
/* 子字段行（A5，原型 `.depth-1/2/3`）：左缩进由行内 marginLeft 给，另加一条连接线标层级 */
.sfe-row.is-child {
  position: relative;
  padding-left: var(--space-2);
}
.sfe-row.is-child::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  border-left: 2px solid var(--border-base);
}
.col-req {
  justify-self: center;
}
/* 行操作区（原型 `.api-schema-row-actions`）：【＋子字段】+ 删除并排右对齐 */
.sfe-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1);
}
.sfe-child-add {
  white-space: nowrap;
  font-size: var(--fs-xs);
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
