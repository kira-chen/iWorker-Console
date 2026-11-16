<script setup>
/**
 * 群聊治理 ·【查看】群抽屉（PRD 渠道 第五章 3）。全部只读，底部只有【关闭】。
 * 群信息：群名称、渠道 / 机器人、成员人数、拉入人；顶部拉入时间、最近更新。
 * 群内规则取「群聊规则」的固定值（第一版不提供单个群配置），见 GROUP_RULES。
 */
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { getGroup } from '@/api/channel'
import { platformName, GROUP_RULES } from '@/utils/channelMeta'

const props = defineProps({
  visible: { type: Boolean, default: false },
  groupId: { type: String, default: '' }
})
const emit = defineEmits(['update:visible', 'gone'])

const loading = ref(false)
const loadError = ref('')
const group = ref(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    group.value = await getGroup(props.groupId)
  } catch (e) {
    if (e?.code === 40400) {
      ElMessage.warning(e.message)
      emit('update:visible', false)
      emit('gone')
      return
    }
    loadError.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}
watch(
  () => props.visible,
  (v) => v && load(),
  { immediate: true }
)
</script>

<template>
  <DrawerEditor
    :visible="visible"
    title="查看群"
    readonly
    :loading="loading"
    :error="loadError"
    size="720px"
    append-to-body
    @update:visible="emit('update:visible', $event)"
    @retry="load"
  >
    <template v-if="group">
      <div class="page-time gd-times">
        <span>拉入时间：{{ group.joinedAt }}</span>
        <span>最近更新：{{ group.updatedAt }}</span>
      </div>
      <section class="section-card">
        <div class="section-title">群信息</div>
        <dl class="gd-kv" data-testid="group-info">
          <dt>群名称</dt>
          <dd>{{ group.name }}</dd>
          <dt>渠道 / 机器人</dt>
          <dd>{{ platformName(group.ch) }} · {{ group.botName || '—' }}</dd>
          <dt>成员</dt>
          <dd>{{ group.members }} 人</dd>
          <dt>拉入人</dt>
          <dd>{{ group.by }}</dd>
        </dl>
      </section>
      <section class="section-card">
        <div class="section-title">群内规则<span class="section-sub">按「群聊规则」执行，所有群一致</span></div>
        <dl class="gd-kv" data-testid="group-rules">
          <dt>响应方式</dt>
          <dd>{{ GROUP_RULES.respond }}</dd>
          <dt>能力范围</dt>
          <dd>{{ GROUP_RULES.capability }}</dd>
          <dt>业务沉淀</dt>
          <dd>{{ GROUP_RULES.dossier }}</dd>
        </dl>
      </section>
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* 压过 admin-shell.css 里 body.admin-scope .page-time 的上边线（抽屉顶部第一行不需要分隔线） */
.de-body > .page-time.gd-times {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.gd-kv {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-3) var(--space-4);
  margin: 0;
  font-size: var(--fs-sm);
}
.gd-kv dt {
  color: var(--c-text-muted);
}
.gd-kv dd {
  margin: 0;
  color: var(--c-text-strong);
}
</style>
