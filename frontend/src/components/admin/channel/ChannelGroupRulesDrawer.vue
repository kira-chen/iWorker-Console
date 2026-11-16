<script setup>
/**
 * 群聊治理 ·【群聊规则】抽屉（PRD 渠道 第五章 4）。只读，作用于所有机器人和群，底部只有【关闭】。
 * 第一版群聊默认规则固定、不提供配置界面；页面上不展示未开放的选项（不做置灰，第五章 4.2）。
 */
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { GROUP_DEFAULT_RULES, GROUP_FIXED_RULES } from '@/utils/channelMeta'

defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['update:visible'])
</script>

<template>
  <DrawerEditor
    :visible="visible"
    title="群聊规则"
    readonly
    size="720px"
    append-to-body
    @update:visible="emit('update:visible', $event)"
  >
    <div class="page-time gr-times"><span>作用范围：所有机器人和群</span></div>
    <section class="section-card">
      <div class="section-title">群聊默认规则<span class="section-sub">只读 · 所有群一致，第一版不支持单个群调整</span></div>
      <table class="gr-table" data-testid="default-rules">
        <thead>
          <tr><th>规则</th><th>第一版取值</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in GROUP_DEFAULT_RULES" :key="r[0]"><td>{{ r[0] }}</td><td>{{ r[1] }}</td></tr>
        </tbody>
      </table>
    </section>
    <section class="section-card">
      <div class="section-title">固定规则<span class="section-sub">只读 · 安全底线</span></div>
      <table class="gr-table" data-testid="fixed-rules">
        <thead>
          <tr><th>规则</th><th>内容</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in GROUP_FIXED_RULES" :key="r[0]"><td>{{ r[0] }}</td><td>{{ r[1] }}</td></tr>
        </tbody>
      </table>
    </section>
  </DrawerEditor>
</template>

<style scoped>
/* 同查看群抽屉：去掉抽屉顶部第一行的上边线 */
.de-body > .page-time.gr-times {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.gr-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}
.gr-table th,
.gr-table td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--border-soft);
}
.gr-table th {
  font-weight: var(--fw-medium);
  color: var(--c-text-muted);
  background: var(--bg-admin-table-head);
}
.gr-table td:first-child {
  width: 120px;
  color: var(--c-text-strong);
  white-space: nowrap;
}
.gr-table td:last-child {
  color: var(--c-text);
  line-height: 1.6;
}
</style>
