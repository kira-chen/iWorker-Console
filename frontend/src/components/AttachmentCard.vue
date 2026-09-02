<script setup>
/**
 * 对话产物卡（对齐原型 §4.5）：类型标签 + 标题 + 要点 +（有则）来源 [1][2] + 底部三连。
 *
 * 数据驱动（attachment 由后端返回）。后端字段可能缺省 —— 缺省的行不渲染、不报错：
 *   - 要点（summary / points）：无则不渲染要点行
 *   - 来源（sources）：无则不渲染来源行
 *   - url：无则「查看详情」回退为「文件暂不可下载」提示
 *
 * attachment 兼容字段（尽量宽松，缺字段优雅降级）：
 *   { id?, name, title?, type?, size?, url?,
 *     summary? | points?(string),
 *     sources?: Array<string | { title?, url? }> }
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import { downloadArtifact } from '@/api/chat'

const props = defineProps({
  attachment: { type: Object, required: true }
})

// 下载中态（防重复点击 + 按钮 loading）
const downloading = ref(false)

// 标题：优先 title，回退 name，再回退占位
const title = computed(() => props.attachment.title || props.attachment.name || '生成文件')

// 类型标签：优先 type，回退扩展名
const ext = computed(() => {
  const n = props.attachment.name || ''
  const dot = n.lastIndexOf('.')
  return dot > -1 ? n.slice(dot + 1).toUpperCase() : ''
})
const typeLabel = computed(() => props.attachment.type || ext.value || '产物')

// 要点摘要：summary 或 points（字符串），缺省不渲染
const points = computed(() => {
  const p = props.attachment.summary ?? props.attachment.points
  return typeof p === 'string' && p.trim() ? p : ''
})

// 来源：规整为 [{ label, url }]，缺省 → 空数组（不渲染来源行）
const sources = computed(() => {
  const raw = props.attachment.sources
  if (!Array.isArray(raw) || !raw.length) return []
  return raw
    .map((s, i) => {
      if (s == null) return null
      if (typeof s === 'string') return { label: `[${i + 1}]`, url: s }
      const name = s.title || s.name || ''
      return { label: name ? `${name}[${i + 1}]` : `[${i + 1}]`, url: s.url || '' }
    })
    .filter(Boolean)
})

// 下载（任务 A 重点）：下载端点需 JWT，window.open 新标签页不带 Authorization 会 401。
// 改为带 token 取 blob 再触发下载（downloadArtifact 内用 fetch 带 JWT）。加 loading/失败态。
async function download() {
  if (!props.attachment.url) {
    ElMessage.info('文件暂不可下载')
    return
  }
  if (downloading.value) return
  downloading.value = true
  try {
    await downloadArtifact(props.attachment.url, props.attachment.name)
  } catch (e) {
    ElMessage.error(e?.message || '下载失败，请稍后重试')
  } finally {
    downloading.value = false
  }
}

// 编辑：编辑能力为后置项，当前仅入口占位（对齐原型演示）
// TODO(后置)：接产物编辑能力后改为真实编辑。
function edit() {
  ElMessage.info('编辑能力即将上线')
}

// 转存个人空间：个人空间为后置能力，当前仅演示入口、未真正落库（PRD §3.3.6 / §7）
// TODO(Sprint-后置)：接个人空间存储接口后改为真实转存并去掉「（演示）」标注。
function saveToSpace() {
  ElMessage.info('已转存到个人空间（演示）')
}
</script>

<template>
  <div class="att-card">
    <!-- 类型标签 + 标题 -->
    <div class="att-head">
      <StatusTag type="info">{{ typeLabel }}</StatusTag>
      <span class="att-title" :title="title">{{ title }}</span>
    </div>

    <!-- 要点摘要（有则显示） -->
    <div v-if="points" class="att-points">{{ points }}</div>

    <!-- 来源（有则显示） -->
    <div v-if="sources.length" class="att-sources">
      <span class="att-sources-label">来源：</span>
      <template v-for="(s, i) in sources" :key="i">
        <a
          v-if="s.url"
          class="att-source-link"
          :href="s.url"
          target="_blank"
          rel="noopener"
        >{{ s.label }}</a>
        <span v-else class="att-source-text">{{ s.label }}</span>
        <span v-if="i < sources.length - 1" class="att-source-sep"> · </span>
      </template>
    </div>

    <!-- 底部三连 -->
    <div class="att-actions">
      <el-button
        link
        type="primary"
        :loading="downloading"
        @click="download"
      >下载</el-button>
      <el-button link @click="edit">编辑</el-button>
      <el-button link @click="saveToSpace">转存个人空间</el-button>
    </div>
  </div>
</template>

<style scoped>
.att-card {
  margin-top: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  max-width: 460px;
}
.att-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.att-title {
  color: var(--c-text-strong);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-points {
  margin-top: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: var(--lh-base);
  white-space: pre-wrap;
  word-break: break-word;
}
.att-sources {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-soft);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  line-height: var(--lh-base);
}
.att-sources-label {
  color: var(--c-text-faint);
}
.att-source-link {
  color: var(--c-text-strong);
}
.att-source-link:hover {
  text-decoration: underline;
}
.att-source-text {
  color: var(--c-text-muted);
}
.att-source-sep {
  color: var(--c-text-faint);
}
.att-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-soft);
}
</style>
