<script setup>
/**
 * AuditCallDrawer —— 工具调用审计「会话调用」「岗位自动化任务」两页签共用的详情抽屉（只读）。
 * 知识库检索页签的详情结构不同（§九.5 没有「工具调用明细」的多项展开），用自己的抽屉，不复用本组件。
 *
 * 2026-10-09 记录单元改版：原「执行过程」时间线（发起 → 检查 → 确认 → 结果，固定 4 步、只对应
 * 一次工具调用）改为「工具调用明细」时间线——一次会话 / 任务运行可能调用零到多个工具，
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
 * @prop {Array<{skill:string,result:{label:string,type:string},reason:string}>|null} skillCalls
 *        调用的技能（仅会话调用页签传）。传入（含空数组）时明细分「按工具 / 按技能」两条互不关联的
 *        时间线，用分段切换查看；不传（null，岗位自动化任务）则只有工具时间线，没有切换
 * @prop {string} emptyCallsText calls 为空时的占位文案
 * @prop {string} emptySkillsText skillCalls 为空时的占位文案
 *
 * 2026-10-13：平台分不清工具由谁发起（多技能还可能同时调起），故不标「调用来源」、也不按技能给工具分组，
 * 技能与工具各一条时间线，各自展示成败（PRD §5.2）。
 */
import { ref, watch } from 'vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import StatusTag from '@/components/StatusTag.vue'
import AuditCallDetailItem from '@/components/admin/AuditCallDetailItem.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  result: { type: Object, default: null },
  summary: { type: Array, default: () => [] },
  calls: { type: Array, default: () => [] },
  explain: { type: String, default: '' },
  skillCalls: { type: Array, default: null },
  emptyCallsText: { type: String, default: '本次执行未调用外部工具' },
  emptySkillsText: { type: String, default: '本次会话未调用技能' }
})
defineEmits(['update:visible'])

// 每次打开都回到默认的「按工具」（工具项带读写 / 确认 / 参数，是审计的主要对象）
const dim = ref('tool')
watch(() => props.visible, (v) => { if (v) dim.value = 'tool' })
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
      <h3>{{ skillCalls ? '调用明细' : '工具调用明细' }}</h3>
      <div v-if="skillCalls" class="tca-dims">
        <el-button :type="dim === 'tool' ? 'primary' : 'default'" size="small" @click="dim = 'tool'">按工具 {{ calls.length }}</el-button>
        <el-button :type="dim === 'skill' ? 'primary' : 'default'" size="small" @click="dim = 'skill'">按技能 {{ skillCalls.length }}</el-button>
      </div>

      <template v-if="dim === 'skill' && skillCalls">
        <p v-if="!skillCalls.length" class="tca-empty-calls">{{ emptySkillsText }}</p>
        <el-timeline v-else class="detail-timeline">
          <el-timeline-item v-for="(s, i) in skillCalls" :key="i" :type="s.result.type" placement="top">
            <div class="tca-skill-head">
              <span>{{ s.skill }}</span>
              <StatusTag :type="s.result.type">{{ s.result.label }}</StatusTag>
            </div>
            <p v-if="s.reason" class="tca-skill-reason">{{ s.reason }}</p>
          </el-timeline-item>
        </el-timeline>
      </template>
      <template v-else>
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
      </template>
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
.tca-dims {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.tca-skill-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
}
.tca-skill-reason {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
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
