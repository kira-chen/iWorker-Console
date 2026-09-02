<script setup>
/**
 * 版本历史只读列表（管理侧 · 平台技能快照 / 岗位发布快照复用，设计 §6.6）。
 *
 * 单一职责：把「一批版本快照行」渲染成只读列表 —— 版本号 / 大小 / 指纹 / 发布时间 / 状态徽标，
 * 每行对 ACTIVE 版本给「下线」、对 DELISTED 给「恢复」按钮。下线/恢复的二次确认 + 接口调用由父级承接
 * （不同资源落不同端点、二次确认文案不同），本组件仅 emit('delist'|'relist', row) 上抛。
 *
 * loading / 错误 / 空态齐全（由父级传入 loading/error）；任一行操作在途（busyVersion）时全列表按钮禁用。
 * 令牌与双主题：全用 var(--...) 语义色 + StatusTag，无硬编码色值。
 */
import { computed } from 'vue'
import StatusTag from '@/components/StatusTag.vue'
import { fmtSize, fmtTime } from '@/utils/docMeta'

const props = defineProps({
  // 版本行：[{ version, sizeBytes, contentHash?, status, publishedBy?, publishedAt, delistedAt?, extra? }]
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // 正在下线/恢复中的 version（防重复提交 + 全列表禁用）
  busyVersion: { type: [Number, String], default: null },
  // 是否展示内容指纹列（技能快照有 hash；岗位列表契约未回 hash → 关）
  showHash: { type: Boolean, default: false },
  // 停用动作用词（默认「下线」；平台技能版本传「禁用」，岗位沿用默认）。用于停用按钮/停用态/元信息文案。
  delistTerm: { type: String, default: '下线' },
  // 恢复动作用词（默认「恢复」；平台技能版本传「启用」）。用于恢复按钮文案。
  relistTerm: { type: String, default: '恢复' },
  // 生效态标签（默认「可下载」；平台技能版本传「已启用」）。用于 ACTIVE 状态标签。
  activeLabel: { type: String, default: '可下载' },
  // 「最后一个启用版本禁用置灰」开关（2026-09-01 岗位版本管理接入，默认关=现有行为不变）：
  // 开启后当列表仅剩 1 个 ACTIVE 行时，该行的停用按钮置灰并给 lastActiveTip 的 title 悬停提示。
  guardLastActive: { type: Boolean, default: false },
  // 置灰按钮的 title 提示文案（随 guardLastActive 使用；岗位传原型文案）
  lastActiveTip: { type: String, default: '' }
})
const emit = defineEmits(['delist', 'relist', 'retry'])

const busy = computed(() => props.busyVersion != null)
const activeCount = computed(() => props.rows.filter((r) => r.status === 'ACTIVE').length)
// 该行是否因「最后一个启用版本」护栏而禁用停用按钮
function lastActiveGuarded(r) {
  return props.guardLastActive && r.status === 'ACTIVE' && activeCount.value <= 1
}
function shortHash(h) {
  if (!h) return '-'
  return h.length > 12 ? `${h.slice(0, 12)}…` : h
}
</script>

<template>
  <div class="vhl">
    <div v-if="loading" class="vhl-state">
      <el-skeleton :rows="4" animated />
    </div>
    <div v-else-if="error" class="vhl-state vhl-error">
      <p>{{ error }}</p>
      <el-button size="small" @click="emit('retry')">重试</el-button>
    </div>
    <div v-else-if="!rows.length" class="vhl-state vhl-empty">
      暂无版本 · 发布后将在此生成不可变版本快照
    </div>
    <div v-else class="vhl-rows">
      <div v-for="r in rows" :key="r.version" class="vhl-row" :class="{ 'is-delisted': r.status === 'DELISTED' }">
        <div class="vhl-main">
          <!-- verLabel（N5 岗位展示版本号 vXXX）优先；无则回落内部自增 v{version}（技能快照场景不带 verLabel，行为不变） -->
          <span class="vhl-ver">{{ r.verLabel || ('v' + r.version) }}</span>
          <StatusTag :type="r.status === 'ACTIVE' ? 'success' : 'info'">
            {{ r.status === 'ACTIVE' ? activeLabel : '已' + delistTerm }}
          </StatusTag>
          <span v-if="r.extra" class="vhl-extra">{{ r.extra }}</span>
          <span class="vhl-sp"></span>
          <el-button
            v-if="r.status === 'ACTIVE'"
            link
            type="warning"
            :loading="busyVersion === r.version"
            :disabled="(busy && busyVersion !== r.version) || lastActiveGuarded(r)"
            :title="lastActiveGuarded(r) ? lastActiveTip : undefined"
            @click="emit('delist', r)"
          >
            {{ delistTerm }}
          </el-button>
          <el-button
            v-else
            link
            type="success"
            :loading="busyVersion === r.version"
            :disabled="busy && busyVersion !== r.version"
            @click="emit('relist', r)"
          >
            {{ relistTerm }}
          </el-button>
        </div>
        <div class="vhl-meta">
          <span class="vhl-meta-i">大小 {{ fmtSize(r.sizeBytes) }}</span>
          <span v-if="showHash" class="vhl-meta-i" :title="r.contentHash">指纹 {{ shortHash(r.contentHash) }}</span>
          <span v-if="r.publishedBy" class="vhl-meta-i">发布人 {{ r.publishedBy }}</span>
          <span class="vhl-meta-i">发布于 {{ fmtTime(r.publishedAt) }}</span>
          <span v-if="r.delistedAt" class="vhl-meta-i vhl-meta-del">{{ delistTerm }}于 {{ fmtTime(r.delistedAt) }}</span>
        </div>
        <!-- N5 升级说明（岗位版本快照带；技能快照不带此字段，不渲染） -->
        <div v-if="r.releaseNotes" class="vhl-notes" :title="r.releaseNotes">升级说明：{{ r.releaseNotes }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vhl {
  display: flex;
  flex-direction: column;
}
.vhl-state {
  padding: var(--space-4);
  text-align: center;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.vhl-error p {
  color: var(--c-danger);
  margin: 0 0 var(--space-3);
}
.vhl-empty {
  color: var(--c-text-faint);
}
.vhl-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.vhl-row {
  padding: var(--space-3);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  transition: opacity var(--dur-fast);
}
.vhl-row.is-delisted {
  opacity: 0.72;
}
.vhl-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.vhl-ver {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  font-size: var(--fs-base);
}
.vhl-extra {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.vhl-sp {
  flex: 1;
}
.vhl-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.vhl-meta-del {
  color: var(--c-warning);
}
.vhl-notes {
  margin-top: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
