<script setup>
/**
 * AuditCallDetailItem —— 工具调用审计详情里「工具调用明细」时间线的单项（2026-10-09 记录单元
 * 改版新增）。一次技能执行 / 任务运行可能调用多个工具，每一项各自有读写性质、确认状态（可选，
 * 任务运行没有）、执行结果、耗时；点击【查看请求参数 / 响应结果】就地展开，不影响时间线上
 * 其他项——各自维护自己的展开状态，互不影响（PRD §5.2）。
 *
 * @prop {string} tool 工具标识（连接器类型·连接器名称）
 * @prop {{label:string,type:string}} nature 操作性质
 * @prop {{label:string,type:string}|null} confirm 用户确认（任务运行传 null，不展示这一项）
 * @prop {{label:string,type:string}} result 执行结果
 * @prop {string} reason 失败 / 拦截 / 取消原因，无则不展示
 * @prop {string} duration 执行耗时
 * @prop {Array<[string,string,string]>} params 实际请求参数
 * @prop {Object} output 实际响应结果
 * @prop {string} paramsHint 请求参数页签顶部提示
 */
import { ref } from 'vue'
import StatusTag from '@/components/StatusTag.vue'

defineProps({
  tool: { type: String, required: true },
  nature: { type: Object, required: true },
  confirm: { type: Object, default: null },
  result: { type: Object, required: true },
  reason: { type: String, default: '' },
  duration: { type: String, default: '' },
  params: { type: Array, default: () => [] },
  output: { type: Object, default: null },
  paramsHint: { type: String, default: '敏感字段已脱敏' }
})

const expanded = ref(false)
const activeTab = ref('input')

function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) activeTab.value = 'input'
}
</script>

<template>
  <div class="call-item">
    <div class="call-item-head">
      <span class="call-item-tool">{{ tool }}</span>
      <StatusTag :type="nature.type">{{ nature.label }}</StatusTag>
      <StatusTag v-if="confirm" :type="confirm.type">{{ confirm.label }}</StatusTag>
      <StatusTag :type="result.type">{{ result.label }}</StatusTag>
      <span class="call-item-duration">{{ duration }}</span>
    </div>
    <p v-if="reason" class="call-item-reason">{{ reason }}</p>

    <button type="button" class="call-item-toggle" @click="toggle">
      {{ expanded ? '收起' : '查看' }}请求参数 / 响应结果
    </button>

    <div v-if="expanded" class="call-item-body">
      <div class="tca-tabs">
        <el-button :type="activeTab === 'input' ? 'primary' : 'default'" size="small" @click="activeTab = 'input'">实际请求参数</el-button>
        <el-button :type="activeTab === 'output' ? 'primary' : 'default'" size="small" @click="activeTab = 'output'">实际响应结果</el-button>
      </div>

      <template v-if="activeTab === 'input'">
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
  </div>
</template>

<style scoped>
.call-item {
  padding: 10px 0;
}
.call-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.call-item-tool {
  font-family: Consolas, monospace;
  font-size: var(--fs-sm);
}
.call-item-duration {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.call-item-reason {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.call-item-toggle {
  margin-top: 6px;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--c-accent);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.call-item-body {
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--bg-sunken);
  border-radius: var(--radius-sm);
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
