<script setup>
/**
 * 用户访问权限（06组织 › 用户访问权限，对齐 docs/PRD/数字员工管理端PRD/06组织/用户访问权限/prd.用户访问权限.md）。
 *
 * 两个页签：授权名单（谁在哪个运行环境有「完全访问」资格、授权 / 收回，员工的权限申请也在这里经【处理申请】通过 / 驳回，
 * 同岗位管理的「待分配申请」，不占单独页签）与操作记录（开启后数字员工的操作留痕，只读）。
 * 「完全访问」让数字员工直接操作员工的运行环境、不再逐步确认；管理端只管「有没有资格」，开关本身的开 / 关只存员工本机。
 * 本页只做外壳：页签切换、顶部权限口径说明，以及授权名单「查看」到操作记录页的跳转。
 */
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { queryString } from '@/utils/routeQuery'
import PageHeader from '@/components/PageHeader.vue'
import UserAccessScope from '@/components/admin/userAccess/UserAccessScope.vue'
import UserAccessGrantPane from '@/components/admin/userAccess/UserAccessGrantPane.vue'
import UserAccessOperationPane from '@/components/admin/userAccess/UserAccessOperationPane.vue'

// 访问审计「查看」会带 ?keyword=员工用户名 跳过来（授权 / 收回 / 通过申请 / 驳回申请都落在授权名单按该员工搜索）；
// ?tab=operation&keyword=员工用户名&env=LOCAL|CLOUD 进操作记录页签（env 可省）；
// 驾驶舱待办卡片【去处理】带 ?pending=1：进页即只看有待处理申请的员工
const route = useRoute()
const fromOperationTab = route.query.tab === 'operation'
const activeTab = ref(fromOperationTab ? 'operation' : 'grant')
// 审计页跳来的员工用户名，只在首次进入授权名单页签时生效
const grantKeyword = ref(fromOperationTab ? '' : queryString(route.query.keyword))
const grantPending = ref(!fromOperationTab && route.query.pending === '1')
// 授权名单点「查看」带过去的员工用户名，操作记录页签读它作初始搜索词
const operationKeyword = ref(fromOperationTab ? queryString(route.query.keyword) : '')
const operationEnv = ref(fromOperationTab ? queryString(route.query.env) : '')

function openOperation(row) {
  operationKeyword.value = row.username
  activeTab.value = 'operation'
}

// 离开页签后，跳转带来的条件作废，下次手动切回来是干净的默认状态
watch(activeTab, (_now, old) => {
  if (old === 'grant') {
    grantKeyword.value = ''
    grantPending.value = false
  }
  if (old === 'operation') {
    operationKeyword.value = ''
    operationEnv.value = ''
  }
})
</script>

<template>
  <div class="list-page">
    <PageHeader title="用户访问权限" subtitle="管理员工能否开启「完全访问」，让数字员工直接操作运行环境、不再逐步确认；处理员工提交的权限申请" />

    <UserAccessScope class="ua-scope" />

    <el-tabs v-model="activeTab" class="ua-tabs">
      <el-tab-pane label="授权名单" name="grant">
        <UserAccessGrantPane v-if="activeTab === 'grant'" :initial-keyword="grantKeyword" :initial-pending="grantPending" @open-operation="openOperation" />
      </el-tab-pane>
      <el-tab-pane label="操作记录" name="operation">
        <UserAccessOperationPane v-if="activeTab === 'operation'" :focus-keyword="operationKeyword" :focus-env="operationEnv" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.ua-scope {
  margin-bottom: var(--space-4);
}
/* Tab 导航（对齐连接器页 connector-tabs / 访问审计 aa-tabs 样式） */
.ua-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}
.ua-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
</style>
