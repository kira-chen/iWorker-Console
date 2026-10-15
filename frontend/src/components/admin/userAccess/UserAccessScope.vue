<script setup>
/**
 * 「完全访问」放开的权限范围说明（PRD 06组织/用户访问权限 §一 2 与附录）。
 * 管理员授权前要看清楚：授权 = 员工可自行开启后，下面 4 类操作不再逐次弹窗确认。
 * 页面顶部用完整版（含不受影响的边界），默认只显示一个窄的行内链接「完全访问权限口径」，点击后下方才展开带框的具体口径；
 * 授权弹窗里用 compact 精简版（只列名称，常显）。
 */
import { ref } from 'vue'
import { ACCESS_SCOPE, ACCESS_SCOPE_EXCLUDED } from '@/utils/userAccess'

defineProps({
  compact: { type: Boolean, default: false }
})

const expanded = ref(false)
</script>

<template>
  <div class="uas" :class="{ 'uas--compact': compact }">
    <div v-if="compact" class="uas-head">
      <span class="uas-title">完全访问包含的权限</span>
      <span class="uas-sub">开启后，数字员工执行以下 4 类操作时不再弹窗征求员工确认</span>
    </div>
    <button v-else type="button" class="uas-toggle" :aria-expanded="expanded" @click="expanded = !expanded">
      <el-icon class="uas-arrow" :class="{ 'is-open': expanded }"><ArrowRight /></el-icon>
      <span>完全访问权限口径</span>
    </button>
    <div v-if="compact || expanded" :class="{ 'uas-panel': !compact }">
      <p v-if="!compact" class="uas-note">每项下列出的是原本会弹窗二次确认的场景；其余操作（如读取、新建文件）本来就不弹窗，不受授权影响。</p>
      <ul class="uas-list">
        <li v-for="item in ACCESS_SCOPE" :key="item.key">
          <b>{{ item.name }}</b>
          <span v-if="!compact" class="uas-desc">{{ item.desc }}</span>
          <ul v-if="!compact" class="uas-covers">
            <li v-for="text in item.covers" :key="text">{{ text }}</li>
          </ul>
        </li>
      </ul>
      <template v-if="!compact">
        <div class="uas-title uas-title--excluded">不受完全访问影响</div>
        <ul class="uas-list uas-list--excluded">
          <li v-for="text in ACCESS_SCOPE_EXCLUDED" :key="text">{{ text }}</li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 页面顶部完整版：折叠时只有一个窄的行内链接，展开后下方出现带框的 .uas-panel */
.uas {
  font-size: var(--fs-sm);
  color: var(--c-text-base);
}
.uas-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 0;
  border: none;
  background: none;
  font: inherit;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  cursor: pointer;
  transition: color 0.2s;
}
.uas-toggle:hover {
  color: var(--c-accent);
}
.uas-arrow {
  font-size: 12px;
  transition: transform 0.2s;
}
.uas-arrow.is-open {
  transform: rotate(90deg);
}
.uas-panel,
.uas--compact {
  padding: var(--space-3) var(--space-4);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
.uas-panel {
  margin-top: var(--space-2);
}
.uas-title {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.uas-title--excluded {
  margin-top: var(--space-3);
  margin-bottom: var(--space-1);
}
.uas-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.8;
}
.uas-desc {
  margin-left: var(--space-2);
  color: var(--c-text-muted);
}
.uas-note {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.uas-covers {
  margin: 0;
  padding-left: 18px;
  font-size: var(--fs-xs);
  line-height: 1.7;
  color: var(--c-text-faint);
}
.uas-list--excluded {
  color: var(--c-text-muted);
}

/* 弹窗里的精简版：浅底小卡，标题 + 一行灰字说明 + 2 列勾选小标签 */
.uas-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: var(--space-3);
}
.uas-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.uas--compact .uas-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  padding-left: 0;
  list-style: none;
}
.uas--compact .uas-list > li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-3);
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  line-height: 1.4;
}
.uas--compact .uas-list > li::before {
  content: '';
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-accent);
}
.uas--compact .uas-list b {
  font-weight: var(--fw-regular);
  color: var(--c-text-base);
}
</style>
