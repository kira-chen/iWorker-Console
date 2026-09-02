<script setup>
/**
 * 模型能力标签四件套（V77，CR-清理项：原三处复制且文案已漂移，收敛为单组件）。
 *
 * 能力值三态：true=支持（显）、false=不支持（不显）、null=未探测。
 * - 全部为 null（未探测）→ 显 unprobedText（不传则什么都不渲染）
 * - 已探测但无一支持 → 显 emptyText（不传则什么都不渲染）
 * - verbose 切换长短文案（列表行用短文案省宽度，弹窗用长文案更可读）
 */
import { computed } from 'vue'

const props = defineProps({
  /** 含 supportsStreaming/supportsTools/supportsJsonMode/isReasoning 的对象（行 VO 或验证结果 VO） */
  source: { type: Object, default: null },
  /** 长文案模式（流式输出/工具调用/JSON 模式/推理模型） */
  verbose: { type: Boolean, default: false },
  /** 已探测但无一支持时的占位文案；空串=不渲染占位 */
  emptyText: { type: String, default: '' },
  /** 未探测（全 null）时的占位文案；空串=不渲染占位 */
  unprobedText: { type: String, default: '' }
})

// 能力元数据单一来源：新增第五项能力（如 vision）只改这里
const CAPS = [
  { key: 'supportsStreaming', short: '流式', long: '流式输出', type: 'success' },
  { key: 'supportsTools', short: '工具', long: '工具调用', type: 'success' },
  { key: 'supportsJsonMode', short: 'JSON', long: 'JSON 模式', type: 'success' },
  { key: 'isReasoning', short: '推理', long: '推理模型', type: 'warning' }
]

const enabled = computed(() => CAPS.filter((c) => props.source?.[c.key] === true))
const probed = computed(() => CAPS.some((c) => props.source?.[c.key] != null))
</script>

<template>
  <span class="mct">
    <template v-if="enabled.length">
      <el-tag v-for="c in enabled" :key="c.key" size="small" :type="c.type" effect="plain">
        {{ verbose ? c.long : c.short }}
      </el-tag>
    </template>
    <span v-else-if="probed && emptyText" class="mct-hint">{{ emptyText }}</span>
    <span v-else-if="!probed && unprobedText" class="mct-hint">{{ unprobedText }}</span>
  </span>
</template>

<style scoped>
.mct {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}
.mct-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
</style>
