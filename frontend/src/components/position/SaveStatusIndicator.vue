<script setup>
/**
 * 保存状态四态灯（功能波次 2a · 组①）。
 *
 * 背景：技能编辑器无显式保存按钮、2s debounce 自动保存，用户/设计/最终用户一致反映「改动到底存上没」心里没底。
 * 本组件是**常驻可见的固定锚点**（不再是一闪而过的小灰字），四态明确 + 已保存显相对时间（周期刷新）+ 失败给「重试」。
 *
 * 四态（由父级传入聚合后的 status 对象决定，纯展示 + 相对时间自刷新）：
 *  - editing  ：灰点 + 「未保存」（dirtyCount>1 时「N 个文件未保存」）
 *  - saving   ：转圈 + 「保存中…」
 *  - saved    ：绿勾 + 相对时间（「刚刚 / 3 秒前 / 2 分钟前」，setInterval 周期刷新）
 *  - error    ：红 + 「保存失败」+ 「重试」按钮（点击 emit('retry')，父级立即 flush，不靠继续打字碰运气）
 *  - idle     ：无内容（首屏未编辑 / 无技能）——不渲染，避免空锚点
 *
 * 不持有任何业务保存逻辑：status 由父级（AdminSkillEditPage / PositionWorkbench）据 dirtyMap/savedCache/在途保存/
 * lastSavedAt 聚合后传入；retry 上抛父级执行。相对时间的 setInterval 在本组件 onBeforeUnmount 清理（不泄漏）。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
// el-icon 走全局注册（app.use(ElementPlus)），不直接 import（与站内其它组件一致、便于测试 stub）。
import { Loading, Select, WarningFilled } from '@element-plus/icons-vue'
import { fmtRelative } from '@/utils/docMeta'

const props = defineProps({
  // 聚合保存态：{ phase:'idle'|'editing'|'saving'|'saved'|'error', dirtyCount?:number, savedAt?:number, flushing?:boolean }
  status: {
    type: Object,
    default: () => ({ phase: 'idle' })
  }
})
const emit = defineEmits(['retry'])

const phase = computed(() => props.status?.phase || 'idle')
const dirtyCount = computed(() => props.status?.dirtyCount || 0)
const flushing = computed(() => !!props.status?.flushing)

/* ---------- 相对时间：每 10s 刷新一次「刚刚 / N 秒前 / N 分钟前 / N 小时前」 ---------- */
const now = ref(Date.now())
let tick = null
onMounted(() => {
  // 10s 粒度足够（秒级在 1 分钟内有意义，分钟级以上 10s 刷新无感差异），低开销。
  tick = setInterval(() => {
    now.value = Date.now()
  }, 10000)
})
onBeforeUnmount(() => {
  if (tick) clearInterval(tick)
})

// 相对时间实现已上收至 utils/docMeta（全站单一口径），此处仅按本组件的 tick 传入参照时刻
function relativeTime(ts) {
  return fmtRelative(ts, now.value)
}

const savedLabel = computed(() => {
  const rel = relativeTime(props.status?.savedAt)
  return rel ? `已保存 · ${rel}` : '已保存'
})
const editingLabel = computed(() =>
  dirtyCount.value > 1 ? `${dirtyCount.value} 个文件未保存` : '未保存'
)
</script>

<template>
  <!-- idle：不渲染（避免空锚点占位）。 -->
  <span
    v-if="phase !== 'idle'"
    class="save-ind"
    :class="`is-${phase}`"
    role="status"
    aria-live="polite"
  >
    <!-- 保存中（含 flush 中）：转圈 -->
    <template v-if="phase === 'saving' || flushing">
      <el-icon class="si-icon is-spin"><Loading /></el-icon>
      <span class="si-text">保存中…</span>
    </template>
    <!-- 保存失败：红点 + 文案 + 重试按钮 -->
    <template v-else-if="phase === 'error'">
      <el-icon class="si-icon"><WarningFilled /></el-icon>
      <span class="si-text">保存失败</span>
      <button type="button" class="si-retry" @click="emit('retry')">重试</button>
    </template>
    <!-- 已保存：绿勾 + 相对时间 -->
    <template v-else-if="phase === 'saved'">
      <el-icon class="si-icon"><Select /></el-icon>
      <span class="si-text">{{ savedLabel }}</span>
    </template>
    <!-- 编辑中（有未保存改动）：灰点 + 未保存（聚合 N 个） -->
    <template v-else>
      <span class="si-dot"></span>
      <span class="si-text">{{ editingLabel }}</span>
    </template>
  </span>
</template>

<style scoped>
.save-ind {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  line-height: 1;
  white-space: nowrap;
  user-select: none;
}
.si-icon {
  flex-shrink: 0;
  font-size: 13px;
}
.si-text {
  color: var(--c-text-muted);
}
/* 编辑中：灰点 + 弱底 */
.save-ind.is-editing {
  background: var(--bg-hover);
}
.si-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-text-faint);
}
/* 保存中：转圈（强调色） */
.save-ind.is-saving .si-icon {
  color: var(--c-accent);
}
.si-icon.is-spin {
  animation: siSpin 0.9s linear infinite;
}
@keyframes siSpin {
  to {
    transform: rotate(360deg);
  }
}
/* 已保存：绿勾 + 绿字 */
.save-ind.is-saved {
  background: var(--c-success-soft);
}
.save-ind.is-saved .si-icon {
  color: var(--c-success);
}
.save-ind.is-saved .si-text {
  color: var(--c-success);
}
/* 失败：红底 + 红字 + 重试 */
.save-ind.is-error {
  background: var(--c-danger-soft);
}
.save-ind.is-error .si-icon,
.save-ind.is-error .si-text {
  color: var(--c-danger);
}
.si-retry {
  flex-shrink: 0;
  margin-left: 2px;
  padding: 1px 8px;
  border: 1px solid var(--c-danger);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-danger);
  font-size: var(--fs-xs);
  line-height: 1.4;
  cursor: pointer;
}
.si-retry:hover {
  background: var(--c-danger);
  color: #ffffff; /* 危险实底上的标准白字 */
}
</style>
