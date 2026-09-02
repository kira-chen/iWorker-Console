<script setup>
/**
 * 【DEV ONLY】效果测试拟真角标隔离验证（Playwright e2e）。
 * 喂 ReActSteps 与「效果测试 SSE 修复后」逐字同构的 steps：
 *  - 读工具步(TOOL_CALL hr_get_leave_balance)：无 simulated（不应误标）
 *  - THOUGHT 步：无 simulated（不应误标）
 *  - 写工具步(TOOL_CALL hr_submit_leave_request)：simulated:true + simulatedTool（应渲染🧪角标）
 * 验证点：.step-sim 角标只在写工具成功步出现，tooltip 含拟真工具名。
 */
import ReActSteps from '@/components/ReActSteps.vue'

// 与 /api/fde/effect-test/confirm 修复后实测 SSE step 形态一致（含顶层 simulated/simulatedTool）
const steps = [
  { no: 1, type: 'PLAN', summary: '已理解诉求，开始按 SOP 推进', status: 'success' },
  { no: 2, type: 'THOUGHT', summary: '决定调用工具推进', status: 'success' },
  {
    no: 3, type: 'TOOL_CALL', toolCode: 'hr_get_leave_balance', bizName: '查询假期余额',
    status: 'success', latencyMs: 0,
    observationBrief: "{'annual': 6.5, 'personal': 3}"
  },
  { no: 4, type: 'THOUGHT', summary: '决定调用工具推进', status: 'success' },
  {
    no: 8, type: 'TOOL_CALL', toolCode: 'hr_submit_leave_request', bizName: '提交请假工单',
    status: 'success', latencyMs: 0,
    observationBrief: '（测试拟真·未真实执行）该写操作已模拟执行成功，未对真实业务系统产生任何写入/提交/外呼。',
    simulated: true, simulatedTool: 'hr_submit_leave_request'
  }
]
</script>

<template>
  <div data-testid="dev-react-sim" style="padding: 24px; max-width: 720px">
    <h3>DEV: 效果测试拟真角标隔离验证</h3>
    <ReActSteps :steps="steps" :default-open="true" trace-summary="已提交请假工单" />
  </div>
</template>
