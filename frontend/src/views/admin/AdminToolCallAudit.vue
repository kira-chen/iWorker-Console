<script setup>
/**
 * 工具调用审计（治理，ADMIN 专属）——数字员工调用外部工具 / 第三方知识服务的事后审计记录，只读。
 *
 * 容器页：页头 + 三个页签，每个页签是一个独立子页（自己的统计卡片、筛选、列表、详情）：
 *   技能调用       用户在对话中触发，技能调连接器          → ToolCallAuditSkills   （PRD §二~§七）
 *   岗位自动化任务  定时触发、无人值守，任务调连接器        → ToolCallAuditTasks    （PRD §八）
 *   知识库检索     岗位 / 专家引用的知识库检索第三方知识服务 → ToolCallAuditKnowledge（PRD §九）
 *
 * 页签范式对齐访问审计（AdminLoginLogs）：默认进入第一个页签；el-tab-pane 用 lazy，首次切到才挂载，
 * 挂载后保持不销毁，所以切换页签时各页签的查询条件互不影响、也不会丢。
 */
import { ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import ToolCallAuditSkills from '@/views/admin/ToolCallAuditSkills.vue'
import ToolCallAuditTasks from '@/views/admin/ToolCallAuditTasks.vue'
import ToolCallAuditKnowledge from '@/views/admin/ToolCallAuditKnowledge.vue'

const activeTab = ref('skill')
</script>

<template>
  <div class="list-page">
    <PageHeader title="工具调用审计" subtitle="追溯每次工具调用的发起人、确认过程与执行结果" />

    <el-tabs v-model="activeTab" class="tca-tabs">
      <el-tab-pane label="技能调用" name="skill" lazy>
        <ToolCallAuditSkills />
      </el-tab-pane>
      <el-tab-pane label="岗位自动化任务" name="task" lazy>
        <ToolCallAuditTasks />
      </el-tab-pane>
      <el-tab-pane label="知识库检索" name="knowledge" lazy>
        <ToolCallAuditKnowledge />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
/* Tab 导航（对齐连接器页 connector-tabs / 访问审计 aa-tabs 样式） */
.tca-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}
.tca-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
</style>
