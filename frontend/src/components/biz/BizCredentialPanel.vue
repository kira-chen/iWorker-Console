<script setup>
/**
 * 业务系统登录态托管面板（员工侧入口，切片3b）。嵌入「设置」页。
 *
 * 展示当前用户各业务系统的托管状态（已连接 / 已过期请重新登录 / 未连接），
 * 支持「连接 / 重新登录」（提交登录态）与「解除托管」（二次确认 DELETE）。
 *
 * 数据源：GET /api/my-positions/biz-credentials（后端仅返回已托管的系统，绝不回显凭据）。
 * 说明：本期无员工侧「全部可连接业务系统」发现接口，故列表展示已托管项；
 * 新系统的首次连接由 FDE 在技能中引用后、经办事流程触发引导，本面板给出占位说明。
 *
 * 安全铁律：本面板只展示「状态」，绝不展示 / 记录任何凭据明文。
 */
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listBizCredentials, deleteBizCredential } from '@/api/myPosition'
import { fmtTime } from '@/utils/docMeta'
import { credStateLabel, credStateTagType, credActionLabel, isHosted } from '@/utils/bizSystemMeta'
import StatusTag from '@/components/StatusTag.vue'
import BizCredentialHostDialog from './BizCredentialHostDialog.vue'

const loading = ref(false)
const loadError = ref(false)
const rows = ref([])
const delBusy = ref(null)

const hostVisible = ref(false)
const hostTarget = ref(null)

async function fetchList() {
  loading.value = true
  loadError.value = false
  try {
    const data = await listBizCredentials()
    rows.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    loadError.value = true
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchList)

function openHost(row) {
  hostTarget.value = {
    bizSystemId: row.bizSystemId,
    bizSystemName: row.bizSystemName,
    loginUrl: row.loginUrl || ''
  }
  hostVisible.value = true
}

function onHosted() {
  fetchList()
}

async function disconnect(row) {
  try {
    await ElMessageBox.confirm(
      `解除后「${row.bizSystemName}」的登录态托管将被删除，相关办事能力需重新连接。确认解除？`,
      '解除托管',
      { type: 'warning', confirmButtonText: '解除', confirmButtonClass: 'el-button--danger' }
    )
    delBusy.value = row.bizSystemId
    await deleteBizCredential(row.bizSystemId)
    ElMessage.success('已解除托管')
    fetchList()
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e?.message || '解除失败')
  } finally {
    delBusy.value = null
  }
}
</script>

<template>
  <div class="bcp">
    <div v-loading="loading" class="bcp-list">
      <div v-if="loadError && !loading" class="bcp-state">
        <el-empty description="托管状态加载失败">
          <el-button type="primary" @click="fetchList">重试</el-button>
        </el-empty>
      </div>
      <div v-else-if="!loading && !rows.length" class="bcp-empty">
        暂无已连接的业务系统。当你的办事流程需要访问某业务系统时，会引导你完成登录态连接。
      </div>
      <div v-for="row in rows" :key="row.bizSystemId" class="np-card bcp-row">
        <div class="bcp-icon">🖥️</div>
        <div class="bcp-meta">
          <div class="bcp-name">{{ row.bizSystemName }}</div>
          <div class="bcp-sub">
            <StatusTag :type="credStateTagType(row.state)">{{ credStateLabel(row.state) }}</StatusTag>
            <span v-if="row.expiresAt" class="bcp-hint">有效期至 {{ fmtTime(row.expiresAt) }}</span>
            <span v-else-if="row.updatedAt" class="bcp-hint">连接于 {{ fmtTime(row.updatedAt) }}</span>
          </div>
        </div>
        <div class="bcp-actions">
          <el-button type="primary" plain @click="openHost(row)">{{ credActionLabel(row.state) }}</el-button>
          <el-button
            v-if="isHosted(row.state)"
            type="danger"
            plain
            :loading="delBusy === row.bizSystemId"
            @click="disconnect(row)"
          >
            解除托管
          </el-button>
        </div>
      </div>
    </div>

    <BizCredentialHostDialog
      v-model:visible="hostVisible"
      :target="hostTarget"
      @hosted="onHosted"
    />
  </div>
</template>

<style scoped>
.bcp-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 48px;
}
.bcp-state {
  padding: var(--space-3) 0;
}
.bcp-empty {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  line-height: 1.6;
}
.bcp-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
}
.bcp-icon {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
}
.bcp-meta {
  flex: 1;
  min-width: 0;
}
.bcp-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.bcp-sub {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: 4px;
}
.bcp-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.bcp-actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
