<script setup>
/**
 * 技能卡（交互规格 §4.1）—— 总览态小巧卡，便于纵览/调序。
 *
 * 卡面：⠿ 拖拽手柄 / 技能名 / ✎放大编辑(hover) / 触发词 chip / 工具徽标（健康点 + code + 写类⚠）。
 *
 * 交互（决议 1）：单击卡任意非操作区 → emit('focus')；手柄/徽标 stopPropagation 防误触。
 * 拖拽调序/迁移由父级（AgentLane）通过 draggable 事件处理，本卡只透传 grip 区。
 */
import { computed } from 'vue'
import { healthClass } from '@/utils/positionModel'
import StatusTag from '@/components/StatusTag.vue'
import { categoryLabel, categoryTagType, hasCategory, CATEGORY_TOOLTIP } from '@/utils/skillCategory'

const props = defineProps({
  skill: { type: Object, required: true },
  // 是否显示 🗑「从当前 Agent 移除」（=解绑）。Agent 泳道内 true；收纳区/未绑定泳道传 false 隐藏——
  // 对已 agentId=null 的游离技能再点「从 Agent 移除」无意义（真删入口在「技能管理」页）。
  removable: { type: Boolean, default: true }
})
const emit = defineEmits(['focus', 'delete'])

// 派生类别（操作类/查询类）只读徽标——口径同技能列表/整页编辑，复用 skillCategory.js 单一真相。
const showCategory = computed(() => hasCategory(props.skill.category))

// 工具徽标：仅取后端结构化的 referencedTools[]（总览态稳定字段）。
// 不再回退解析 skillMd —— skillMd 在「列表 summary 形状」与「聚焦 detail 形状」间不一致
// （聚焦/编辑回吐带完整正文，列表 refetch 是精简正文），用它解析会导致关闭编辑器后徽标
// 「先多几行、几秒后被 refetch 覆盖消失」的跳变。改为只依赖 referencedTools 后，
// 卡片在总览态前后形状一致：有 referencedTools 才显示、且关闭前后一致，无闪现。
const toolBadges = computed(() => {
  const refs = props.skill.referencedTools
  if (!Array.isArray(refs) || !refs.length) return []
  return refs.map((t) => ({
    code: t.code,
    cls: healthClass(t.checkStatus),
    warn: !!t.requiresConfirmation
  }))
})

const triggers = computed(() => props.skill.triggers || [])

function onCardClick() {
  emit('focus', props.skill.skillId)
}
// 删除入口（设计 §5.2/§5.3：整页化后白板技能卡 hover 删除）；stopPropagation 防误触放大编辑。
function onDelete() {
  emit('delete', props.skill.skillId)
}
</script>

<template>
  <div class="skill" @click="onCardClick">
    <div class="skill-top">
      <span class="skill-grip" title="拖拽调序" @click.stop @mousedown.stop>⠿</span>
      <span class="skill-name">{{ skill.name || '未命名技能' }}</span>
      <el-tooltip
        v-if="showCategory"
        :content="CATEGORY_TOOLTIP"
        placement="top"
        effect="dark"
      >
        <StatusTag :type="categoryTagType(skill.category)" class="skill-category" @click.stop>
          {{ categoryLabel(skill.category) }}
        </StatusTag>
      </el-tooltip>
      <span class="skill-edit-ic" title="编辑">✎</span>
      <span v-if="removable" class="skill-del-ic" title="从当前 Agent 移除" @click.stop="onDelete">🗑</span>
    </div>
    <div v-if="triggers.length" class="skill-trigs">
      <span v-for="(t, i) in triggers.slice(0, 5)" :key="i" class="tchip">{{ t }}</span>
      <span v-if="triggers.length > 5" class="tchip">+{{ triggers.length - 5 }}</span>
    </div>
    <div v-if="toolBadges.length" class="skill-tools">
      <span
        v-for="(b, i) in toolBadges.slice(0, 4)"
        :key="i"
        class="tool-badge"
        :class="{ warn: b.warn }"
        @click.stop
      >
        <span class="d" :class="b.cls"></span>{{ b.code }}<span v-if="b.warn">⚠</span>
      </span>
      <span v-if="toolBadges.length > 4" class="tool-badge">+{{ toolBadges.length - 4 }}</span>
    </div>
  </div>
</template>

<style scoped>
.skill {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  transition: background var(--dur-fast), border-color var(--dur-fast), box-shadow var(--dur-fast);
  position: relative;
}
/* hover 仅做 border + shadow 反馈，不再 translateY 位移：
   位移会改变卡片几何位置，鼠标在卡边缘时卡片上移→离开光标→hover 解除→落回→再命中，
   造成无限抖动、光标在小手/箭头间横跳。去掉位移即根除抖动，hover 视觉基本不丢。 */
.skill:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}
.skill-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.skill-grip {
  color: var(--c-text-faint);
  cursor: grab;
  font-size: var(--fs-xs);
}
.skill-name {
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
  font-size: var(--fs-sm);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 类别徽标：卡片空间小，缩到 11px + 紧边距；语义色/文案复用 StatusTag，不抢技能名宽度 */
.skill-category {
  flex-shrink: 0;
  font-size: 11px;
  padding: 0 6px;
  cursor: default;
}
.skill-edit-ic {
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
  opacity: 0;
  transition: opacity var(--dur-fast);
}
.skill:hover .skill-edit-ic {
  opacity: 1;
}
.skill-del-ic {
  color: var(--c-text-faint);
  font-size: var(--fs-xs);
  opacity: 0;
  cursor: pointer;
  padding: 0 2px;
  border-radius: var(--radius-sm);
  transition: opacity var(--dur-fast), color var(--dur-fast), background var(--dur-fast);
}
.skill:hover .skill-del-ic {
  opacity: 1;
}
.skill-del-ic:hover {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}
.skill-trigs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.tchip {
  font-size: 11px;
  color: var(--c-text-muted);
  background: var(--bg-active);
  padding: 1px 7px;
  border-radius: var(--radius-pill);
}
.skill-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--c-text-muted);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  padding: 1px 6px 1px 5px;
  border-radius: var(--radius-sm);
}
.tool-badge.warn {
  color: var(--c-warning);
}
.tool-badge .d {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.tool-badge .d.ok {
  background: var(--c-success);
}
.tool-badge .d.bad {
  background: var(--c-danger);
}
.tool-badge .d.unknown,
.tool-badge .d.off {
  background: var(--c-text-faint);
}
</style>
