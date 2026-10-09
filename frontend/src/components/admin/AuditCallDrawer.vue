<script setup>
/**
 * AuditCallDrawer —— 工具调用审计「技能调用」「岗位自动化任务」两页签共用的详情抽屉（只读）。
 * 知识库检索页签的详情结构不同（§九.5 没有「工具调用明细」的多项展开），用自己的抽屉，不复用本组件。
 *
 * 2026-10-09 记录单元改版：原「执行过程」时间线（发起 → 检查 → 确认 → 结果，固定 4 步、只对应
 * 一次工具调用）改为「工具调用明细」时间线——一次技能执行 / 任务运行可能调用零到多个工具，
 * 每一项是一次具体调用，各自的确认 / 结果 / 参数响应收在 AuditCallDetailItem 里，点开才看，
 * 互不影响（PRD §5.2）。不展示具体执行时刻——系统不采集单次调用的过程时间，时间线只体现
 * 发生顺序，不标时间点。
 *
 * @prop {boolean} visible v-model:visible
 * @prop {string} title 抽屉标题
 * @prop {{label:string,type:string}} result 整体结果标签（成功 / 失败，两页签取值一致）
 * @prop {Array<{label:string,value:string,mono?:boolean}>} summary 操作摘要
 * @prop {Array<Object>} calls 工具调用明细，字段见 AuditCallDetailItem；为空数组时展示「未调用外部工具」
 * @prop {string} explain 结果说明
 * @prop {string} emptyCallsText calls 为空时的占位文案
 */
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import AuditCallDetailItem from '@/components/admin/AuditCallDetailItem.vue'

defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  result: { type: Object, default: null },
  summary: { type: Array, default: () => [] },
  calls: { type: Array, default: () => [] },
  explain: { type: String, default: '' },
  emptyCallsText: { type: String, default: '本次执行未调用外部工具' }
})
defineEmits(['update:visible'])
</script>

<template>
  <DrawerEditor
    :visible="visible"
    :title="title"
    readonly
    size="720px"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="detail-section">
      <h3>操作摘要 <StatusTag v-if="result" :type="result.type">{{ result.label }}</StatusTag></h3>
      <el-descriptions :column="2" border>
        <el-descriptions-item v-for="item in summary" :key="item.label" :label="item.label">
          <span :class="{ 'tca-mono': item.mono }">{{ item.value }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <div class="detail-section">
      <h3>工具调用明细</h3>
      <p v-if="!calls.length" class="tca-empty-calls">{{ emptyCallsText }}</p>
      <el-timeline v-else class="detail-timeline">
        <el-timeline-item
          v-for="(c, i) in calls"
          :key="i"
          :type="c.result.type"
          placement="top"
        >
          <AuditCallDetailItem
            :tool="c.tool"
            :nature="c.nature"
            :confirm="c.confirm"
            :result="c.result"
            :reason="c.reason"
            :show-params="c.showParams"
            :params="c.params"
            :output="c.output"
          />
        </el-timeline-item>
      </el-timeline>
    </div>

    <el-alert :title="explain" type="info" :closable="false" show-icon class="detail-section" />

    <template #footer>
      <el-button @click="$emit('update:visible', false)">关闭</el-button>
    </template>
  </DrawerEditor>
</template>

<style scoped>
.detail-section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 14px;
}
.detail-timeline {
  margin-top: 8px;
}
.tca-empty-calls {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
}
.tca-mono {
  font-family: Consolas, monospace;
}
</style>
