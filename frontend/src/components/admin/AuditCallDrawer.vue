<script setup>
/**
 * AuditCallDrawer —— 工具调用审计三个页签共用的「调用详情」右侧抽屉（只读）。
 *
 * 【分工】各页签只负责把一条记录翻译成下面这几份数据；抽屉只负责统一渲染，
 * 保证三个页签的详情长得一样（PRD §五 / §八.6 / §九.5）：
 *   操作摘要  → summary   结果标签 + 若干「标签: 值」
 *   执行过程  → steps     时间线；被拦截 / 取消 / 待确认的调用在对应节点停止，由页签决定截到哪一步
 *   结果说明  → explain   一句话解释当前结果与建议动作
 *   请求参数 / 响应结果  → params / output 两个页签，默认展示「实际请求参数」
 *
 * @prop {boolean} visible v-model:visible
 * @prop {string} title 抽屉标题
 * @prop {{label:string,type:string}} result 结果标签
 * @prop {Array<{label:string,value:string,mono?:boolean}>} summary
 * @prop {Array<{time:string,title:string,desc:string,type:string}>} steps
 * @prop {string} explain
 * @prop {Array<[string,string,string]>} params [参数名, 技术标识, 本次请求值]
 * @prop {{summary?:string,headers?:string[],rows?:string[][],text?:string,note?:string}|null} output
 * @prop {string} paramsHint 请求参数页签顶部的提示
 */
import { ref, watch } from 'vue'
import StatusTag from '@/components/StatusTag.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  result: { type: Object, default: null },
  summary: { type: Array, default: () => [] },
  steps: { type: Array, default: () => [] },
  explain: { type: String, default: '' },
  params: { type: Array, default: () => [] },
  output: { type: Object, default: null },
  paramsHint: { type: String, default: '敏感字段已脱敏' }
})
defineEmits(['update:visible'])

// 每次打开都回到「实际请求参数」页签
const detailTab = ref('input')
watch(() => props.visible, (v) => { if (v) detailTab.value = 'input' })
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
      <h3>执行过程</h3>
      <el-timeline class="detail-timeline">
        <el-timeline-item
          v-for="(step, i) in steps"
          :key="i"
          :timestamp="step.time"
          :type="step.type"
          placement="top"
        >
          <strong>{{ step.title }}</strong>
          <p class="tca-step-desc">{{ step.desc }}</p>
        </el-timeline-item>
      </el-timeline>
    </div>

    <el-alert :title="explain" type="info" :closable="false" show-icon class="detail-section" />

    <div class="detail-section">
      <div class="tca-tabs">
        <el-button :type="detailTab === 'input' ? 'primary' : 'default'" size="small" @click="detailTab = 'input'">实际请求参数</el-button>
        <el-button :type="detailTab === 'output' ? 'primary' : 'default'" size="small" @click="detailTab = 'output'">实际响应结果</el-button>
      </div>

      <template v-if="detailTab === 'input'">
        <p class="tca-tab-hint">{{ paramsHint }}</p>
        <el-table :data="params" size="small" border>
          <el-table-column label="参数 / 技术标识">
            <template #default="{ row }">
              {{ row[0] }}<span class="tca-secondary tca-mono">{{ row[1] }}</span>
            </template>
          </el-table-column>
          <el-table-column label="本次请求值">
            <template #default="{ row }">{{ row[2] }}</template>
          </el-table-column>
        </el-table>
      </template>

      <template v-else-if="output">
        <p v-if="output.summary">{{ output.summary }}</p>
        <el-table v-if="output.rows" :data="output.rows" size="small" border>
          <el-table-column :label="output.headers?.[0] || ''">
            <template #default="{ row }">{{ row[0] }}</template>
          </el-table-column>
          <el-table-column :label="output.headers?.[1] || ''">
            <template #default="{ row }">{{ row[1] }}</template>
          </el-table-column>
        </el-table>
        <p v-if="output.text">{{ output.text }}</p>
        <p v-if="output.note" class="tca-secondary">{{ output.note }}</p>
      </template>
    </div>

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
.tca-step-desc {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.tca-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tca-tab-hint {
  margin: 0 0 8px;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.tca-secondary {
  display: block;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  margin-top: 2px;
}
.tca-mono {
  font-family: Consolas, monospace;
}
</style>
