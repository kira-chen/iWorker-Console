<script setup>
/**
 * 机器人抽屉 · 权限清单（PRD 渠道 第四章 3「权限清单」、附录 C）。
 *
 * 在「应用凭据」说明条的【查看权限清单】下方展开：必需权限 / 按需权限 / 事件订阅三组，
 * 每项展示权限标识、中文说明和「必需 / 按需」标签；底部【复制清单】，飞书额外【复制必需权限（批量导入 JSON）】。
 * 清单内容来自平台描述配置（utils/channelMeta.js PLATFORMS[ch].perms），不写死在组件里。
 */
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import { PLATFORMS, permListText, permImportJson } from '@/utils/channelMeta'
import { copyText } from '@/utils/clipboard'

const props = defineProps({
  ch: { type: String, required: true }
})

const perms = computed(() => PLATFORMS[props.ch].perms)

async function copyAll() {
  if (await copyText(permListText(props.ch))) ElMessage.success('已复制到剪贴板')
  else ElMessage.error('复制失败，请手动复制')
}
async function copyJson() {
  if (await copyText(permImportJson(props.ch))) ElMessage.success('已复制，在飞书开发者后台「权限管理 → 批量导入权限」粘贴')
  else ElMessage.error('复制失败，请手动复制')
}
</script>

<template>
  <div class="cp-wrap" data-testid="perm-list">
    <div class="cp-group-title">必需权限</div>
    <ul class="cp-list">
      <li v-for="r in perms.required" :key="r[0]" class="cp-item">
        <div class="cp-main">
          <span class="cp-id">{{ r[0] }}</span>
          <small class="cp-desc">{{ r[1] }} · 用于{{ r[2] }}</small>
        </div>
        <StatusTag type="success">必需</StatusTag>
      </li>
    </ul>

    <div class="cp-group-title">按需权限</div>
    <ul class="cp-list">
      <li v-for="r in perms.optional" :key="r[0]" class="cp-item">
        <div class="cp-main">
          <span class="cp-id">{{ r[0] }}</span>
          <small class="cp-desc">{{ r[1] }} · 用于{{ r[2] }}</small>
        </div>
        <StatusTag type="info">按需</StatusTag>
      </li>
    </ul>

    <div class="cp-group-title">事件订阅</div>
    <ul class="cp-list">
      <li v-for="e in perms.events" :key="e[0]" class="cp-item">
        <div class="cp-main">
          <span class="cp-id">{{ e[0] }}</span>
          <small class="cp-desc">{{ e[1] }}</small>
        </div>
        <StatusTag type="success">必需</StatusTag>
      </li>
    </ul>

    <div class="cp-actions">
      <el-button link type="primary" @click="copyAll">复制清单</el-button>
      <el-button v-if="perms.jsonImport" link type="primary" @click="copyJson">复制必需权限（批量导入 JSON）</el-button>
    </div>
    <p class="cp-foot">权限标识以平台最新文档为准；必需权限缺失时，列表状态显示「连接中断 · 缺少必需权限」；按需权限可以上线后再开通。</p>
  </div>
</template>

<style scoped>
.cp-wrap {
  margin-bottom: var(--space-4);
}
.cp-group-title {
  margin: var(--space-3) 0 6px;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--c-text-muted);
}
.cp-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
}
.cp-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
}
.cp-item + .cp-item {
  border-top: 1px solid var(--border-soft);
}
.cp-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.cp-id {
  font-family: var(--font-mono, monospace);
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  word-break: break-all;
}
.cp-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.cp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-3);
}
.cp-actions .el-button + .el-button {
  margin-left: 0;
}
.cp-foot {
  margin: 6px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
