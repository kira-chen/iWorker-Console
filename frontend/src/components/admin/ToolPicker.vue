<script setup>
/**
 * 工具勾选器：MCP / API 两分组（2026-10-20 走查：自动化任务引用工具只有 MCP 和 API，去掉 Mock 分组；
 * MCP / API 已是真实连接器，原「未接入 · 下轮上线」占位标记一并撤掉）。
 *
 * 单一职责：从两来源可选工具清单（由父组件经 props.available 注入，不自取数）勾选工具，
 * 每条可叠加 requiresConfirmation 标记。双向绑定已选工具数组 v-model:selected。
 *
 * 关键：勾选/回显/去重一律按 (type, code) 联合键（契约 B3，同 code 跨源不唯一；
 * MCP code 为限定名 mcp__{mcpCode}__{toolName}）。逻辑见 utils/toolKey.js。
 *
 * selected 元素：{ type, code, requiresConfirmation }（按勾选顺序）。
 * available（props）：{ mcp:[...], api:[...] }，每项至少 { code, type, bizName, description, requiresConfirmation }。
 */
import { computed } from 'vue'
import { isToolSelected, toggleTool, setToolConfirm, selectedOrder } from '@/utils/toolKey'

const props = defineProps({
  selected: { type: Array, default: () => [] },
  // 两来源清单 { mcp, api }
  available: { type: Object, default: () => ({ mcp: [], api: [] }) },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }, // data.field==='tools' 时父级传入
  // 是否展示「执行前需二次确认」开关与文案。默认 true（Skill 编辑器需要）；
  // 定时任务侧内联 skill 默认关闭二次确认、不暴露，传 false 隐藏该 UI（契约 §7）。
  showConfirm: { type: Boolean, default: true },
  // 员工端友好模式（默认 false=后台 FDA 原样）。true 时：去术语/去原始 code/去内部话术，
  // 两来源合并为单一平铺列表。
  friendly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:selected'])

const groups = computed(() => [
  { type: 'MCP', label: 'MCP 工具', tools: props.available?.mcp || [] },
  { type: 'API', label: 'API 工具', tools: props.available?.api || [] }
])

// 员工端友好模式：两来源合并为单一平铺列表（保留各项原 type 用于勾选键）
const flatTools = computed(() => groups.value.flatMap((g) => g.tools))

const totalCount = computed(() =>
  groups.value.reduce((n, g) => n + g.tools.length, 0)
)
const selectedCount = computed(() => props.selected.length)

// 默认展开有工具的分组
const activeNames = computed(() => groups.value.filter((g) => g.tools.length).map((g) => g.type))

function checked(tool) {
  return isToolSelected(props.selected, tool.type, tool.code)
}
function toggle(tool, val) {
  emit('update:selected', toggleTool(props.selected, tool, val))
}
function setConfirm(tool, val) {
  emit('update:selected', setToolConfirm(props.selected, tool.type, tool.code, val))
}
function order(tool) {
  return selectedOrder(props.selected, tool.type, tool.code)
}
</script>

<template>
  <div class="tp" :class="{ 'tp-error': !!error }">
    <div v-if="loading" class="tp-state"><el-skeleton :rows="4" animated /></div>
    <el-empty v-else-if="!totalCount" description="暂无可用工具" :image-size="64">
      <template #image>
        <el-icon class="tp-empty-icon"><Box /></el-icon>
      </template>
    </el-empty>

    <!-- 员工端友好模式：单一平铺列表，去术语/去 code/去内部话术 -->
    <template v-else-if="friendly">
      <div class="tp-summary">
        已选择 <strong>{{ selectedCount }}</strong> 个工具
      </div>
      <div class="tp-list">
        <div
          v-for="tool in flatTools"
          :key="tool.type + '::' + tool.code"
          class="tp-item"
          :class="{ 'is-checked': checked(tool) }"
        >
          <div class="tp-main">
            <el-checkbox
              :model-value="checked(tool)"
              @update:model-value="toggle(tool, $event)"
            >
              <span class="tp-name">{{ tool.bizName || tool.code }}</span>
            </el-checkbox>
          </div>
          <div v-if="tool.description" class="tp-desc">{{ tool.description }}</div>
        </div>
      </div>
    </template>

    <!-- 后台 FDA 原样模式（默认） -->
    <template v-else>
      <div class="tp-summary">
        已选 <strong>{{ selectedCount }}</strong> 个工具（跨 MCP / API 两来源）
      </div>
      <el-collapse :model-value="activeNames" class="tp-collapse">
        <el-collapse-item v-for="g in groups" :key="g.type" :name="g.type">
          <template #title>
            <span class="tp-group-title">{{ g.label }}</span>
            <el-tag size="small" type="info" effect="plain" class="tp-group-count">
              {{ g.tools.length }}
            </el-tag>
          </template>

          <el-empty
            v-if="!g.tools.length"
            :description="`暂无已登记的 ${g.label}，请先到对应管理页登记`"
            :image-size="40"
          >
            <template #image>
              <el-icon class="tp-empty-icon tp-empty-icon--sm"><Box /></el-icon>
            </template>
          </el-empty>
          <div v-else class="tp-list">
            <div
              v-for="tool in g.tools"
              :key="tool.code"
              class="tp-item"
              :class="{ 'is-checked': checked(tool) }"
            >
              <div class="tp-main">
                <el-checkbox
                  :model-value="checked(tool)"
                  @update:model-value="toggle(tool, $event)"
                >
                  <span class="tp-name">{{ tool.bizName || tool.code }}</span>
                </el-checkbox>
                <code class="tp-code">{{ tool.code }}</code>
                <el-tag v-if="checked(tool)" size="small" type="info" class="tp-order">
                  第 {{ order(tool) }} 步
                </el-tag>
              </div>
              <div v-if="tool.description" class="tp-desc">{{ tool.description }}</div>
              <div
                v-if="g.type === 'MCP' && tool.mcpDefName"
                class="tp-src"
              >
                来自 MCP：{{ tool.mcpDefName }}
              </div>
              <div v-if="showConfirm && checked(tool)" class="tp-confirm">
                <el-switch
                  :model-value="selected.find((s) => s.type === tool.type && s.code === tool.code)?.requiresConfirmation"
                  size="small"
                  @update:model-value="setConfirm(tool, $event)"
                />
                <span class="tp-confirm-label">执行前需二次确认</span>
              </div>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
      <div class="tp-foot">
        <span class="tp-hint">
          勾选顺序即调用顺序<template v-if="showConfirm">；二次确认靠开关，勿写进 SOP 文案</template>。
        </span>
      </div>
    </template>
    <div v-if="error" class="tp-err-text">{{ error }}</div>
  </div>
</template>

<style scoped>
.tp {
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  background: var(--bg-sunken);
}
.tp-error {
  border-color: var(--c-danger);
}
.tp-state {
  padding: var(--space-3);
}
.tp-summary {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  padding: var(--space-1) var(--space-2) var(--space-2);
}
.tp-collapse {
  border: none;
}
.tp-collapse :deep(.el-collapse-item__header),
.tp-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-color: var(--border-soft);
}
.tp-group-title {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  margin-right: var(--space-2);
}
.tp-group-count {
  margin-right: var(--space-2);
}
.tp-item {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: background var(--dur-fast), border-color var(--dur-fast);
}
.tp-item.is-checked {
  background: var(--bg-selected);
  border-color: var(--c-accent-soft);
}
.tp-main {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.tp-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.tp-code {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.tp-order {
  margin-left: auto;
}
.tp-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  margin: 2px 0 0 24px;
  line-height: var(--lh-base);
}
.tp-src {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin: 2px 0 0 24px;
}
.tp-confirm {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-2) 0 0 24px;
}
.tp-confirm-label {
  font-size: var(--fs-xs);
  color: var(--c-text);
}
.tp-foot {
  padding: var(--space-2) var(--space-3) 0;
}
.tp-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
}
.tp-err-text {
  margin: var(--space-2) var(--space-3) 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}
/* 中性空态图标：弱化线性图标替代 EP 彩色插画 */
.tp-empty-icon {
  font-size: 48px;
  color: var(--c-text-faint);
}
.tp-empty-icon--sm {
  font-size: 32px;
}
</style>
