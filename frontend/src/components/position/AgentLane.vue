<script setup>
/**
 * Agent 泳道（交互规格 §3）—— 横向并排的「技能分组容器」。
 *
 * 泳道头：⠿ + [Agent]徽标 + Agent名(就地编辑) + N技能 + ⋯菜单（删除）；下方 lane-desc（就地编辑）。
 * 泳道体：技能卡纵向堆叠（SkillCard），支持同泳道调序 + 跨泳道迁移（HTML5 draggable）；
 * 底部「＋ 引用技能」（达 20 上限禁用）。<b>岗位页只引用「已发布」FDE 技能、不创建</b>——
 * 新技能的创建/管理在「FDE 工作台 → 技能」页；本组件仅经 SkillPickerDialog 引用已发布技能。
 *
 * 删 Agent（新口径·用户拍板「删Agent技能脱钩」）：二次确认须展示技能数 N，说清技能「脱离本岗位、变成
 * 未被引用技能、可在技能页查看、不随本岗位发布生效、暂不支持界面重挂」。N=0 简化。
 * （「未绑定 Agent」收纳泳道已退役：本组件回归为纯「绑定 Agent」泳道，无 isOrphan 分支。）
 *
 * 拖拽：技能卡 draggable，dragstart 写 skillId/fromAgentId；泳道体 drop 触发 reorder（同泳道）/ move（Agent↔Agent）。
 *
 * req3（平台技能引用改造·统一设计 §4.1/§7-B2）：Agent 级「引用平台技能」直接引用通道已下线——
 * 泳道不再有引用区/⊕入口/解除引用。平台技能进岗位的唯一正道 = 平台技能浏览页「复制为 FDE 技能」（深拷贝独立副本）后挂到 Agent。
 */
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MoreFilled } from '@element-plus/icons-vue'
import SkillCard from './SkillCard.vue'
import { LIMITS } from '@/utils/positionModel'

const props = defineProps({
  agent: { type: Object, required: true }
})
const emit = defineEmits([
  'rename', // (agentId, { name?, description? })
  'delete', // (agentId)
  'pick-skill', // (agentId) 从技能库引用已发布 FDE 技能（岗位页只引用、不创建；创建在「技能」页）
  'focus-skill', // (skillId)
  'delete-skill', // ({ agentId, skillId }) 技能卡从本 Agent 移除（V84：可逆 detach，透传给父级 onDeleteSkill）
  'reorder-skills', // (agentId, newSkills)
  'move-skill' // ({ skillId, fromAgentId, toAgentId }) Agent↔Agent 跨泳道迁移
])

const skills = computed(() => props.agent.skills || [])
const atLimit = computed(() => skills.value.length >= LIMITS.SKILL_MAX)

/* ---------- 就地编辑 ---------- */
function onName(e) {
  const v = e.target.innerText.trim()
  if (v && v !== props.agent.name) emit('rename', props.agent.agentId, { name: v })
}
function onDesc(e) {
  const v = e.target.innerText.trim()
  if (v !== (props.agent.description || '')) emit('rename', props.agent.agentId, { description: v })
}

/* ---------- 删 Agent 二次确认（新口径·PRD §3.2：技能脱离岗位变「未被引用」、暂不支持界面重挂） ---------- */
async function confirmDelete() {
  const n = skills.value.length
  // N=0：简化文案，不提「未被引用」。N>0：说清四件事——没删除 / 脱离本岗位变未被引用 / 在技能页可看 / 不随本岗位发布生效 + 暂不支持界面重挂。
  const opts = {
    type: 'warning',
    confirmButtonText: '确认删除 Agent',
    cancelButtonText: '取消',
    confirmButtonClass: 'el-button--danger'
  }
  let ok = false
  try {
    if (n === 0) {
      await ElMessageBox.confirm(
        `删除 Agent「${props.agent.name}」？该 Agent 下没有技能，删除后不影响任何技能。`,
        '删除 Agent',
        opts
      )
    } else {
      // 用 HTML 列出后果，层次清晰（dangerouslyUseHTMLString）。
      // CR 软化：「本期无法重挂」→「目前暂不支持界面重挂」（传达「暂不支持」而非「永久回不去」，别让用户不敢删）。
      const html =
        `<p>该 Agent 下的 <b>${n}</b> 个技能不会被删除，但会<b>脱离本岗位、变成「未被引用」的技能</b>。</p>` +
        '<ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">' +
        '<li>可在左侧「技能」页查看和编辑（筛选「未被引用」即可找到）。</li>' +
        '<li>未被引用的技能<b>不会随本岗位发布生效</b>，运行时也不会被调用。</li>' +
        '<li>目前<b>暂不支持</b>在界面把它们重新挂回岗位；如不再需要，可在技能页删除。</li>' +
        '</ul>'
      await ElMessageBox.confirm(html, `删除 Agent「${props.agent.name}」？`, {
        ...opts,
        dangerouslyUseHTMLString: true
      })
    }
    ok = true
  } catch {
    /* 取消 */
  }
  if (ok) emit('delete', props.agent.agentId)
}

/* ---------- 拖拽调序 / 跨泳道迁移 ---------- */
const dragOver = ref(false)
const draggingIndex = ref(-1)

function onCardDragStart(e, skill, index) {
  draggingIndex.value = index
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/skill-id', String(skill.skillId))
  e.dataTransfer.setData('text/from-agent', String(props.agent.agentId))
}
function onCardDragEnd() {
  draggingIndex.value = -1
  dragOver.value = false
}
function onLaneDragOver(e) {
  if (e.dataTransfer.types.includes('text/skill-id')) {
    e.preventDefault()
    dragOver.value = true
  }
}
function onLaneDragLeave() {
  dragOver.value = false
}
function onDrop(e, dropIndex) {
  e.preventDefault()
  dragOver.value = false
  // 方案B/B3：skillId 已字符串化（sk_*），原样取字符串（不再 Number()，与 s.skillId 字符串比较）。
  const skillId = e.dataTransfer.getData('text/skill-id') || null
  const fromRaw = e.dataTransfer.getData('text/from-agent')
  // 方案B/B2：agentId 已字符串化（ag_*），不可 Number()，原样取字符串与 props.agent.agentId（字符串）比较。
  const fromAgentId = fromRaw === '' ? null : fromRaw
  const toAgentId = props.agent.agentId

  // 同泳道调序
  if (fromAgentId === toAgentId) {
    const from = skills.value.findIndex((s) => s.skillId === skillId)
    if (from < 0) return
    const next = skills.value.slice()
    const [moved] = next.splice(from, 1)
    // dropIndex 是「拖拽前」坐标（落在第 i 张卡上），移除源卡后需 -1 修正；
    // 落到泳道末尾空白区（dropIndex=null）时 next.length 已是移除后坐标，不做修正——
    // 原先对两者统一 -1，导致「首卡拖到末尾空白区只落到倒数第二」的 off-by-one（2026-08-08 测试钉出）。
    let to
    if (dropIndex == null) {
      to = next.length
    } else {
      to = dropIndex
      if (from < to) to -= 1
    }
    next.splice(to, 0, moved)
    emit('reorder-skills', props.agent.agentId, next)
    return
  }
  // 跨泳道迁移（Agent↔Agent）
  if (atLimit.value) {
    // UI4：轻提示而非阻塞弹窗，不打断拖拽手势
    ElMessage.warning(`该 Agent 已达 ${LIMITS.SKILL_MAX} 个技能上限`)
    return
  }
  emit('move-skill', { skillId, fromAgentId, toAgentId })
}
</script>

<template>
  <div
    class="lane"
    :class="{ 'drag-over': dragOver }"
    @dragover="onLaneDragOver"
    @dragleave="onLaneDragLeave"
    @drop="onDrop($event, null)"
  >
    <div class="lane-head">
      <span class="lane-grip" title="拖拽排序 Agent">⠿</span>
      <span class="lane-label">
        <span class="lane-tag">Agent</span>
        <span
          class="lane-name ie"
          contenteditable="true"
          spellcheck="false"
          @blur="onName"
        >{{ agent.name }}</span>
      </span>
      <span class="lane-count">{{ skills.length }} 技能</span>
      <el-dropdown trigger="click" @command="confirmDelete">
        <span class="lane-menu"><el-icon><MoreFilled /></el-icon></span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="delete">删除 Agent</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div
      class="lane-desc ie"
      contenteditable="true"
      spellcheck="false"
      data-ph="Agent 简介（这组技能负责什么）"
      @blur="onDesc"
    >{{ agent.description }}</div>

    <div class="lane-cards">
      <div v-if="!skills.length" class="lane-empty">
        这个 Agent 还没有技能 · 点下方「＋引用技能」从技能库选择已发布技能
      </div>
      <div
        v-for="(s, i) in skills"
        :key="s.skillId"
        class="card-wrap"
        :class="{ lifting: draggingIndex === i }"
        :draggable="true"
        @dragstart="onCardDragStart($event, s, i)"
        @dragend="onCardDragEnd"
        @drop.stop="onDrop($event, i)"
        @dragover="onLaneDragOver"
      >
        <SkillCard
          :skill="s"
          :removable="true"
          @focus="emit('focus-skill', $event)"
          @delete="emit('delete-skill', { agentId: agent.agentId, skillId: $event })"
        />
      </div>
    </div>

    <!-- 岗位页只「引用已发布技能」，不创建；新技能在「技能」页创建后再来引用。 -->
    <div
      class="lane-add"
      :class="{ disabled: atLimit }"
      @click="!atLimit && emit('pick-skill', agent.agentId)"
    >
      <template v-if="atLimit">已达 {{ LIMITS.SKILL_MAX }} 个技能上限</template>
      <template v-else>＋ 引用技能</template>
    </div>
  </div>
</template>

<style scoped>
.lane {
  flex: 0 0 340px;
  width: 340px;
  background: var(--bg-sunken);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
}
.lane.drag-over {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 2px var(--c-accent-soft);
}
.lane-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-soft);
}
.lane-grip {
  color: var(--c-text-faint);
  cursor: grab;
  font-size: var(--fs-sm);
}
.lane-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  font-size: var(--fs-base);
  min-width: 0;
}
.lane-tag {
  font-size: 11px;
  font-weight: var(--fw-semibold);
  color: var(--c-accent);
  background: var(--c-accent-soft);
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  letter-spacing: 0.3px;
}
.lane-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ie {
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  margin: -1px -3px;
  cursor: text;
  transition: background var(--dur-fast), border-color var(--dur-fast);
}
.ie:hover {
  background: var(--bg-hover);
}
.ie:focus {
  outline: none;
  background: var(--bg-surface);
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}
.lane-count {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.lane-menu {
  color: var(--c-text-faint);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  display: inline-flex;
}
.lane-menu:hover {
  background: var(--bg-hover);
  color: var(--c-text);
}
.lane-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  padding: var(--space-2) var(--space-4) 0;
}
.lane-desc:empty::before {
  content: attr(data-ph);
  color: var(--c-text-faint);
}
.lane-cards {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 60px;
}
.lane-empty {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  text-align: center;
  padding: var(--space-4) var(--space-2);
}
.card-wrap {
  transition: opacity var(--dur-fast);
  position: relative;
}
.card-wrap.lifting {
  opacity: 0.35;
}
.lane-add {
  margin: 0 var(--space-3) var(--space-3);
  padding: 8px;
  text-align: center;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--c-text-muted);
  cursor: pointer;
  font-size: var(--fs-sm);
}
.lane-add:hover {
  color: var(--c-accent);
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
.lane-add.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.lane-add.disabled:hover {
  color: var(--c-text-muted);
  border-color: var(--border-strong);
  background: transparent;
}
</style>
