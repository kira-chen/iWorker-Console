<script setup>
/**
 * 存储空间（04运行 › 存储空间，对齐 docs/PRD/数字员工管理端PRD/04运行/存储空间/prd.存储空间.md）。
 *
 * 两个页签：容量分配（默认容量、员工用量、调整容量）与扩容申请（同意 / 拒绝）。
 * 容量口径只算员工的本地产物（最终产物 + 缓存），不含知识库资料，所以页面叫「存储空间」而不是「知识库存储空间」。
 * 本页只做外壳：页签切换、待处理数角标，以及容量分配页「待处理」到扩容申请页的跳转。
 */
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { queryString } from '@/utils/routeQuery'
import PageHeader from '@/components/PageHeader.vue'
import StorageQuotaPane from '@/components/admin/storage/StorageQuotaPane.vue'
import StorageRequestPane from '@/components/admin/storage/StorageRequestPane.vue'
import { getStorageOverview } from '@/api/storageSpace'

// 访问审计「查看」（调整容量的记录）会带 ?keyword=员工用户名 跳到容量分配页签（访问审计 §6.3）；
// 同意 / 拒绝扩容的记录不在审计页展示，所以没有跳进扩容申请页签的入口
const route = useRoute()
const activeTab = ref('quota')
const pendingCount = ref(0)
// 容量分配页点「待处理」时带过去的员工用户名；两个页签用 v-if 懒挂载，切过去时扩容申请页读它作初始搜索词
const focusKeyword = ref('')
// 审计页跳过来的员工用户名，只在首次进入容量分配页签时生效
const quotaKeyword = ref(queryString(route.query.keyword))

async function refreshPending() {
  try {
    pendingCount.value = (await getStorageOverview()).pendingCount
  } catch {
    // 角标读失败不影响页面使用
  }
}

function openRequest(row) {
  focusKeyword.value = row.username
  activeTab.value = 'request'
}

// 离开页签后，跳转带来的搜索词作废，下次手动切回来是干净的默认状态
watch(activeTab, (_now, old) => {
  if (old === 'request') focusKeyword.value = ''
  if (old === 'quota') quotaKeyword.value = ''
})

onMounted(refreshPending)
</script>

<template>
  <div class="list-page">
    <PageHeader title="存储空间" subtitle="分配员工产物存储容量，处理扩容申请；仅统计本地产物（最终产物 + 缓存），不含知识库资料" />

    <el-tabs v-model="activeTab" class="ss-tabs">
      <el-tab-pane label="容量分配" name="quota">
        <StorageQuotaPane v-if="activeTab === 'quota'" :initial-keyword="quotaKeyword" @open-request="openRequest" @changed="refreshPending" />
      </el-tab-pane>
      <el-tab-pane name="request">
        <template #label>
          <span>扩容申请</span>
          <span v-if="pendingCount" class="ss-badge">{{ pendingCount }}</span>
        </template>
        <StorageRequestPane v-if="activeTab === 'request'" :focus-keyword="focusKeyword" @changed="refreshPending" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.ss-badge {
  display: inline-block;
  min-width: 16px;
  margin-left: 6px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  color: var(--c-text-on-accent);
  background: var(--c-danger);
  border-radius: 8px;
}
</style>
