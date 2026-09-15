<script setup>
/**
 * 参数行编辑器（公共组件，2026-08-31 API KEY 鉴权改造 B.3）。
 *
 * 自 McpEditor 的 V110 Env 行编辑器抽象而来，两处共用（一致性靠抽象兑现，不逐页复制）：
 *  - MCP stdio Env：不显示「位置」列（showIn=false），行 = 名称/描述/客户端填写/平台值；
 *  - API KEY 鉴权：显示「位置」列（showIn=true），行 = 位置/参数名/描述/客户端填写/参数值。
 *
 * 行结构（父组件持有）：
 *   { in?, key, description, clientFill, value, configured, valueMasked?, editingValue?, pendingDelete? }
 *  - clientFill：true=客户端填写（值由客户端收集，与 value 互斥——勾选即清空禁用）；
 *  - value：平台值明文（仅提交瞬间存在；编辑态留空=保留旧密文，永不回显）；
 *  - configured：该行后端已有密文（决定 value 占位提示「留空保留」）；
 *  - valueMasked：首尾掩码串（全站密钥掩码口径，2026-09-01）——有则占位提示带掩码供核对；
 *  - editingValue / pendingDelete：三步式界面态，仅 threeStep 消费方用（见下方 threeStep prop）。
 *
 * 2026-09-09 PRD 复核轮 · G4/A11：新增 threeStep prop（默认 false）——MCP stdio Env 传 true 后
 * 已配置行走「改值 / 删除→待删除 / 撤销」三步式；API KEY 鉴权不传，行为逐字不变。
 *
 * 行内字段直接 v-model 到行对象（与父共享引用）；增删行 emit update:rows；
 * 任何交互 emit interact（父组件借此清字段级红框）。校验不在本组件（父层 defValidate 收口）。
 *
 * 2026-09-09 原型复刻批次 3A（M5 / A4）：新增 emptyText / addPosition / cardRows /
 * clientFillLabel / secretValue / clientFillHintAlways 六个可选 prop，全部默认保持既有形态，
 * 只有显式传入的消费方（MCP stdio Env、API 鉴权参数）改变；expose addRow 供宿主把
 * 「＋ 添加」按钮摆到分区标题行（原型 `.mcp-env-title` 右侧）。
 */
import { computed } from 'vue'

const props = defineProps({
  rows: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
  /** 是否显示「位置」列（API 鉴权 true / MCP Env false）。 */
  showIn: { type: Boolean, default: false },
  /** 位置下拉选项 [{ value, label }]（仅 showIn）。 */
  inOptions: { type: Array, default: () => [] },
  // inDisabled（位置选项禁用判定）已于 2026-09-12 删除（审计 J13）：零调用方——BODY×GET/DELETE 硬拦 2026-09-01 拍板放开，改 rowNotice 软提示。
  /** 行级提示（仅 showIn 场景用到，如 QUERY 泄漏警示）：(row) => { type:'warn'|'hint', text } | null */
  rowNotice: { type: Function, default: () => null },
  keyHeader: { type: String, default: '名称' },
  keyPlaceholder: { type: String, default: 'API_KEY' },
  valueHeader: { type: String, default: '平台值' },
  descPlaceholder: { type: String, default: '选填：这个变量是做什么的' },
  addLabel: { type: String, default: '+ 添加变量' },
  /** 含客户端填写行时展示的底部提示；空串不展示。 */
  clientFillHint: { type: String, default: '' },
  /**
   * 无行时的空态文案（2026-09-09 原型复刻批次 3A · M5/A4）。
   * 原型 MCP Env `.mcp-env-empty`「暂无环境变量」、API 鉴权 `.api-schema-empty`「暂无鉴权参数」。
   * 空串（默认）= 不渲染空态，既有消费方行为不变。
   */
  emptyText: { type: String, default: '' },
  /**
   * 「添加」按钮位置（M5）：'foot'（默认，既有形态）| 'header'——原型 MCP stdio Env 的
   * `.mcp-env-title` 是「左 Env label + hint／右【＋ 添加变量】」一行，按钮不在表底。
   * 走 header 时按钮由宿主用 #add-action 插槽自行摆放，本组件只负责不再渲染表底按钮。
   */
  addPosition: { type: String, default: 'foot' },
  /**
   * 行卡片描边变体（M5）：原型 `.mcp-env-card` 每行是带描边浅底的卡片。
   */
  cardRows: { type: Boolean, default: false },
  /** 「客户端填写」勾选框旁的文字（原型 `label.mcp-env-client` 带「客户端填写」四字）；空串=只有勾选框。 */
  clientFillLabel: { type: String, default: '' },
  /** 该列表头文案（原型 MCP Env 表头第三列是「填写方式」，API 鉴权是「客户端填写」）。 */
  clientFillHeader: { type: String, default: '客户端填写' },
  /** 表头恒显（原型 MCP Env `.mcp-env-head` 无行时也在）；默认仅有行时显示。 */
  alwaysHead: { type: Boolean, default: false },
  /** 平台值/参数值输入是否走密码态（原型 API 鉴权参数值 `type="password"`）。 */
  secretValue: { type: Boolean, default: false },
  /** 客户端填写说明常显（原型 API 鉴权 `.api-auth-add-note` 与【＋ 添加参数】同行常显，不随勾选出现）。 */
  clientFillHintAlways: { type: Boolean, default: false },
  /**
   * 三步式改值 / 删除（2026-09-09 PRD 复核轮 · G4/A11，Q137 负责人「先采纳A（保留 改值+待删除+撤销）」）。
   *
   * md `prd-连接器-MCP.md` §三.4.2 L283-286：
   *   「每个已配置名称提供【改值】和【删除】／点击【改值】后，在下方输入区域填写该名称的新值／
   *     点击【删除】后，该名称显示"待删除"并提供【撤销】／未修改的内容保存后继续保留原值。」
   *
   * **仅 MCP stdio Env 传 true**；API KEY 鉴权（ApiEditor）不传，行为与改造前逐字不变——
   * 该组件两处共用，此 prop 就是清单第三节 G4 冲突①要求的隔离开关。
   *
   * 只对「已配置行」（row.configured，即编辑已有 MCP 时后端回来的存量变量）生效：
   *   - 平台值列不再是可直接编辑的输入框，改为「已配置（不回显）」＋【改值】；
   *   - 点【改值】置 row.editingValue=true，就地展开输入框填新值，旁边给【取消改值】还原；
   *   - 点【删除】置 row.pendingDelete=true（不立即移出数组），整行置灰标「待删除」＋【撤销】；
   *   - 保存时由 utils/mcpEnv.buildEnvSubmit 丢弃 pendingDelete 行 → 后端按「完整期望集」删该 KEY。
   * 新添加的行（configured=false）不走三步式：本就没有「原值」可保护，直接填、直接移除。
   */
  threeStep: { type: Boolean, default: false }
})
const emit = defineEmits(['update:rows', 'interact'])

function emptyRow() {
  // editingValue / pendingDelete 显式置 false：新行 configured=false 本就不走三步式，
  // 但显式带上让行结构在两条产出路径（此处与 utils/mcpEnv.emptyEnvRow）保持一致。
  const row = {
    key: '',
    description: '',
    clientFill: false,
    value: '',
    configured: false,
    editingValue: false,
    pendingDelete: false
  }
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
/** 添加按钮是否由本组件渲染在表底（addPosition='header' 时交宿主放到分区标题行）。 */
const showFootAdd = computed(() => props.addPosition !== 'header')
/** 客户端填写说明是否展示：常显模式（API 鉴权，原型 .api-auth-add-note）或已有勾选行。 */
const showClientFillHint = computed(
  () =>
    !!props.clientFillHint &&
    (props.clientFillHintAlways || props.rows.some((r) => r.clientFill))
)
function valuePlaceholder(row) {
  if (row.clientFill) return '由客户端填写'
  if (!row.configured) return '必填'
  // 三步式：点过【改值】才展开输入框，占位直说「填新值」（不再暗示可留空——留空就该点【取消改值】）
  if (props.threeStep) return row.valueMasked ? `新值（原 ${row.valueMasked}）` : '填写新值'
  // 已配置：占位展示首尾掩码供核对（全站密钥掩码口径），留空=保留原值
  return row.valueMasked ? `当前 ${row.valueMasked}（留空保留）` : '已配置（留空保留原值）'
}

/* ===== 三步式改值 / 删除（A11，仅 threeStep 且 configured 行；见 threeStep prop 注释） ===== */

/** 该行是否走三步式（已配置的存量行）。新加的行 configured=false，照旧直填直删。 */
function isManaged(row) {
  return props.threeStep && !!row.configured
}
/** 平台值列是否渲染输入框：非托管行恒是；托管行仅在点过【改值】后。 */
function showValueInput(row) {
  return !isManaged(row) || !!row.editingValue
}
/** 点【改值】：展开输入区填新值（值本身仍不回显，md L282「仅展示名称，不展示原值」）。 */
function startEditValue(row) {
  row.editingValue = true
  row.value = ''
  emit('interact')
}
/** 点【取消改值】：收起输入区并丢弃本次填的新值 → 回到「未修改，保存后保留原值」。 */
function cancelEditValue(row) {
  row.editingValue = false
  row.value = ''
  emit('interact')
}
/** 点【删除】（托管行）：只置标记不出数组，行置灰标「待删除」，保存时才真丢弃。 */
function markDelete(row) {
  row.pendingDelete = true
  row.editingValue = false
  row.value = ''
  emit('interact')
}
/** 点【撤销】：清除待删除标记，该变量恢复原样（值仍是后端旧值，本次未动）。 */
function undoDelete(row) {
  row.pendingDelete = false
  emit('interact')
}
/** 删除按钮统一入口：托管行走「待删除」中间态，其余行直接移出数组。 */
function onDeleteClick(row, idx) {
  if (isManaged(row)) markDelete(row)
  else removeRow(idx)
}

// 宿主把「＋ 添加」按钮摆到分区标题行时（addPosition='header'）由此直调，行结构仍由本组件产出
defineExpose({ addRow })
</script>

<template>
  <div class="pr-rows">
    <!-- 列序（2026-09-01 拍板）：参数名 → 描述 → 客户端填写 → 位置(仅 showIn) → 值 -->
    <!-- 表头：默认仅有行时显示；MCP Env 照原型 connFields 恒显（表头是分区骨架的一部分，空态在其下） -->
    <div v-if="rows.length || alwaysHead" class="pr-row pr-row-head" :class="{ 'has-in': showIn }">
      <span>{{ keyHeader }}</span>
      <span>描述（客户端可见）</span>
      <span class="pr-cf-head">{{ clientFillHeader }}</span>
      <span v-if="showIn">位置</span>
      <span>{{ valueHeader }}</span>
      <span class="pr-del-head"></span>
    </div>
    <template v-for="(row, i) in rows" :key="i">
      <div
        class="pr-row"
        :class="{ 'has-in': showIn, 'is-card': cardRows, 'is-pending-delete': row.pendingDelete }"
      >
        <el-input
          v-model="row.key"
          class="pr-key-input"
          :placeholder="keyPlaceholder"
          :disabled="isManaged(row)"
          @input="emit('interact')"
        />
        <el-input
          v-model="row.description"
          maxlength="200"
          :placeholder="descPlaceholder"
          :disabled="row.pendingDelete"
          @input="emit('interact')"
        />
        <span class="pr-cf">
          <el-checkbox
            v-model="row.clientFill"
            :disabled="row.pendingDelete"
            @change="onClientFillChange(row)"
          >
            <template v-if="clientFillLabel">{{ clientFillLabel }}</template>
          </el-checkbox>
        </span>
        <el-select v-if="showIn" v-model="row.in" class="pr-in-select" @change="emit('interact')">
          <el-option
            v-for="o in inOptions"
            :key="o.value"
            :value="o.value"
            :label="o.label"
          />
        </el-select>
        <!-- 平台值列：三步式托管行未点【改值】时不给输入框，只显示状态字 +【改值】（md L281「仅展示名称，不展示原值」） -->
        <el-input
          v-if="showValueInput(row)"
          v-model="row.value"
          :type="secretValue && !row.clientFill ? 'password' : 'text'"
          :show-password="secretValue && !row.clientFill"
          :disabled="row.clientFill || row.pendingDelete"
          :placeholder="valuePlaceholder(row)"
          @input="emit('interact')"
        />
        <span v-else class="pr-value-state">
          <template v-if="row.pendingDelete">
            <span class="pr-pending-tag">待删除</span>
          </template>
          <template v-else>
            <span class="pr-configured">{{ row.clientFill ? '由客户端填写' : '已配置（不回显）' }}</span>
            <el-button
              v-if="!readonly && !row.clientFill"
              link
              type="primary"
              class="pr-act"
              @click="startEditValue(row)"
            >
              改值
            </el-button>
          </template>
        </span>
        <!-- 操作列：托管行三步式（改值中→取消改值；待删除→撤销；否则→删除），其余行照旧直接删除 -->
        <span class="pr-ops">
          <el-button
            v-if="isManaged(row) && row.pendingDelete"
            link
            type="primary"
            class="pr-act"
            :disabled="readonly"
            @click="undoDelete(row)"
          >
            撤销
          </el-button>
          <template v-else>
            <el-button
              v-if="isManaged(row) && row.editingValue"
              link
              class="pr-act"
              :disabled="readonly"
              @click="cancelEditValue(row)"
            >
              取消改值
            </el-button>
            <el-button link type="danger" class="pr-act" :disabled="readonly" @click="onDeleteClick(row, i)">
              删除
            </el-button>
          </template>
        </span>
      </div>
      <div
        v-if="rowNotice(row)"
        class="pr-row-notice"
        :class="rowNotice(row).type === 'warn' ? 'is-warn' : 'is-hint'"
      >
        {{ rowNotice(row).text }}
      </div>
    </template>
    <!-- 空态（原型 `.mcp-env-empty`「暂无环境变量」/ `.api-schema-empty`「暂无鉴权参数」）：仅显式传 emptyText 时渲染 -->
    <div v-if="emptyText && !rows.length" class="pr-empty">{{ emptyText }}</div>
    <!-- 表底一行：【＋ 添加】+ 客户端填写说明。两者都不显时整行不渲染（避免留一条空白） -->
    <div v-if="showFootAdd || showClientFillHint" class="pr-add">
      <el-button v-if="showFootAdd" link type="primary" :disabled="readonly" @click="addRow">
        {{ addLabel }}
      </el-button>
      <span v-if="showClientFillHint" class="pr-cf-hint">{{ clientFillHint }}</span>
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
/* 行卡片变体（原型 `.mcp-env-card`：描边 + 浅底，把一行环境变量收成一张卡） */
.pr-row.is-card {
  padding: var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}
/* 空态（原型 .mcp-env-empty / .api-schema-empty） */
.pr-empty {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  padding: var(--space-2) 0;
}
/* ===== 三步式改值 / 删除（A11，仅 threeStep 消费方 MCP stdio Env 会命中） ===== */
/* 平台值列的「非输入框」形态：已配置（不回显）＋【改值】，或待删除标签 */
.pr-value-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--fs-sm);
}
.pr-configured {
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 「待删除」：橙色描边小标签，一眼可见「这行保存后会消失」，但还能撤 */
.pr-pending-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  color: var(--c-warning, #b7791f);
  box-shadow: 0 0 0 1px currentColor inset;
  white-space: nowrap;
}
/* 待删除整行降透明：保留在列表里（可撤销），但视觉上退出「有效配置」 */
.pr-row.is-pending-delete {
  opacity: 0.6;
}
/* 操作列：可能同时放两枚 link 按钮（取消改值 + 删除），故收成一个 flex 容器 */
.pr-ops {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  white-space: nowrap;
}
.pr-ops .pr-act + .pr-act {
  margin-left: 0;
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
