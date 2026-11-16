<script setup>
/**
 * 渠道（04运行 › 渠道，对齐 docs/PRD/数字员工管理端PRD/04运行/渠道/prd.渠道.md）。
 *
 * 把 iWorker 接入飞书、钉钉、企业微信：管理员在 IM 平台创建企业自建应用，把凭据填到这里。
 * 两个页签：【机器人】（接入、编辑、停用 / 启用、更换应用、消息设置）与【群聊治理】（查看、移出群、群聊规则）。
 * 本页只做外壳：两个页签都常驻挂载，切换时各自的搜索与筛选原样保留（第二章 2）。
 *
 * 访问审计【查看】跳过来（第十章）：机器人记录带 ?keyword=机器人名称 进【机器人】；
 * 移出群记录带 ?tab=group&keyword=群名称 进【群聊治理】；修改配置记录不带关键词。
 */
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { queryString } from '@/utils/routeQuery'
import PageHeader from '@/components/PageHeader.vue'
import ChannelBotPane from '@/components/admin/channel/ChannelBotPane.vue'
import ChannelGroupPane from '@/components/admin/channel/ChannelGroupPane.vue'

const route = useRoute()
const toGroup = queryString(route.query.tab) === 'group'
const activeTab = ref(toGroup ? 'group' : 'bot')
const keyword = queryString(route.query.keyword)
</script>

<template>
  <div class="list-page">
    <PageHeader title="渠道" subtitle="接入飞书、钉钉、企业微信机器人，统一配置单聊与群聊" />

    <el-tabs v-model="activeTab" class="ch-tabs">
      <el-tab-pane label="机器人" name="bot">
        <ChannelBotPane :initial-keyword="toGroup ? '' : keyword" />
      </el-tab-pane>
      <el-tab-pane label="群聊治理" name="group">
        <ChannelGroupPane :initial-keyword="toGroup ? keyword : ''" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
