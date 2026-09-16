<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListStates from '@/components/admin/ListStates.vue'
import StatusTag from '@/components/StatusTag.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import { listInstances, operateInstance } from '@/api/instance'

const route = useRoute()
const allowedViews = new Set(['spec', 'position', 'detail'])
const instanceView = ref(allowedViews.has(route.query.view) ? route.query.view : 'spec')
const query = reactive({ keyword: '', status: '', position: '', spec: '', pending: false })
const detailVisible = ref(false)
const current = ref(null)
const instances = ref([])
const loading = ref(true)
const loadError = ref(false)
const updatedAt = ref('—')

const statusMeta = { RUNNING:['运行中','success'], IDLE:['空闲','info'], ERROR:['异常','danger'], STARTING:['启动中','warning'], RECYCLING:['回收中','warning'] }
const positions = computed(() => [...new Set(instances.value.map(x => x.position))])
const specs = computed(() => [...new Set(instances.value.map(x => x.effectiveSpec))])
const filteredInstances = computed(() => instances.value.filter(x => {
  const keyword = query.keyword.trim().toLowerCase()
  return (!keyword || `${x.name}${x.username}${x.id}${x.position}${x.actualSpec}${x.effectiveSpec}`.toLowerCase().includes(keyword))
    && (!query.status || x.status === query.status)
    && (!query.position || x.position === query.position)
    && (!query.spec || x.effectiveSpec === query.spec)
    && (!query.pending || x.actualSpec !== x.effectiveSpec)
}))

function aggregate(list, key, label) {
  const groups = new Map()
  list.forEach(item => {
    const name = item[key]
    if (!groups.has(name)) groups.set(name, { name, label, total:0, users:new Set(), running:0, idle:0, starting:0, abnormal:0, pending:0, lastActive:item.active })
    const row = groups.get(name)
    row.total += 1
    row.users.add(item.username)
    row.running += item.status === 'RUNNING' ? 1 : 0
    row.idle += item.status === 'IDLE' ? 1 : 0
    row.starting += item.status === 'STARTING' ? 1 : 0
    row.abnormal += item.status === 'ERROR' ? 1 : 0
    row.pending += item.actualSpec !== item.effectiveSpec ? 1 : 0
    if (item.active > row.lastActive) row.lastActive = item.active
  })
  return [...groups.values()].map(row => ({ ...row, users:row.users.size }))
}

const instanceGroups = computed(() => aggregate(filteredInstances.value, instanceView.value === 'spec' ? 'effectiveSpec' : 'position', instanceView.value === 'spec' ? '运行规格' : '岗位'))
const metrics = computed(() => [
  ['运行中', instances.value.filter(x => x.status === 'RUNNING').length, 'RUNNING'],
  ['空闲', instances.value.filter(x => x.status === 'IDLE').length, 'IDLE'],
  ['异常', instances.value.filter(x => x.status === 'ERROR').length, 'ERROR'],
  ['规格待生效', instances.value.filter(x => x.actualSpec !== x.effectiveSpec).length, 'PENDING']
])
const cardTitle = computed(() => instanceView.value === 'detail' ? '实例明细' : `按${instanceView.value === 'spec' ? '规格' : '岗位'}汇总`)

function drillInstances(row) { instanceView.value = 'detail'; if (row.label === '运行规格') query.spec = row.name; else query.position = row.name }
function chooseMetric(metric) { instanceView.value = 'detail'; query.pending = metric[2] === 'PENDING'; query.status = metric[2] === 'PENDING' ? '' : (query.status === metric[2] ? '' : metric[2]) }
function showDetail(row) { current.value = row; detailVisible.value = true }
async function load() {
  loading.value = true
  loadError.value = false
  try {
    const data = await listInstances({ size: 200 })
    instances.value = data.list || []
    updatedAt.value = data.updatedAt || '—'
    if (current.value) current.value = instances.value.find((item) => item.id === current.value.id) || null
    const deepLinkId = typeof route.query.instance === 'string' ? route.query.instance : ''
    const target = deepLinkId ? instances.value.find((item) => item.id === deepLinkId) : null
    if (target) { instanceView.value = 'detail'; current.value = target; detailVisible.value = true }
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
async function refreshStatus() {
  await load()
  if (!loadError.value) ElMessage.success('实例状态已刷新')
}
function canOperate(row, type) {
  if (!row.operable || ['STARTING', 'RECYCLING'].includes(row.status)) return false
  if (type === 'rebuild' && row.actualSpec === row.effectiveSpec) return false
  return true
}
function disabledReason(row, type) {
  if (!row.operable) return row.operationHint || '当前实例不可操作'
  if (['STARTING', 'RECYCLING'].includes(row.status)) return '实例状态变更中，请稍后再试'
  if (type === 'rebuild' && row.actualSpec === row.effectiveSpec) return '当前实际规格已是最新生效规格'
  return ''
}
async function instanceAction(row, type) {
  if (!canOperate(row, type)) { ElMessage.warning(disabledReason(row, type)); return }
  const labels = { restart:'重启', rebuild:'按最新规格重建', recycle:'回收' }
  const descriptions = { restart:'将使用当前配置重新创建实例，期间该实例暂时不可用。', rebuild:`将从「${row.actualSpec}」切换为「${row.effectiveSpec}」，重建期间该实例暂时不可用。`, recycle:'将释放当前运行资源，用户下次发起运行请求时系统会自动创建新实例。' }
  try { await ElMessageBox.confirm(`${descriptions[type]}确认${labels[type]}？`, `${labels[type]}实例`, { type:'warning', confirmButtonText:labels[type], cancelButtonText:'取消' }) } catch { return }
  try {
    await operateInstance(row.id, type)
    detailVisible.value = false
    ElMessage.success(`实例${labels[type]}操作已提交`)
    await load()
  } catch (error) {
    ElMessage.error(error?.message || '实例操作失败，请稍后重试')
  }
}

onMounted(load)
</script>

<template>
  <div class="list-page runtime-page">
    <PageHeader title="实例管理" subtitle="按运行规格或岗位查看实例分布，下钻定位具体实例并处理运行异常" />
    <div class="runtime-note">本页仅管理当前存在的运行实例，不展示任务和会话数据。运行操作是否可用以服务端返回的实例可操作状态为准。</div>
    <div class="metric-grid">
      <button v-for="metric in metrics" :key="metric[0]" class="metric-card" @click="chooseMetric(metric)"><span>{{ metric[0] }}</span><strong>{{ metric[1] }}</strong></button>
    </div>
    <ListToolbar>
      <el-input v-model="query.keyword" placeholder="搜索规格、岗位、用户或实例标识" clearable class="lt-search"><template #prefix><el-icon><Search /></el-icon></template></el-input>
      <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter">
        <el-option v-for="(value,key) in statusMeta" :key="key" :label="value[0]" :value="key" />
      </el-select>
      <el-select v-model="query.position" placeholder="全部岗位" clearable class="lt-filter">
        <el-option v-for="position in positions" :key="position" :label="position" :value="position" />
      </el-select>
      <el-select v-model="query.spec" placeholder="全部运行规格" clearable class="lt-filter">
        <el-option v-for="spec in specs" :key="spec" :label="spec" :value="spec" />
      </el-select>
      <el-button>查询</el-button><template #right><el-button @click="refreshStatus">刷新状态</el-button></template>
    </ListToolbar>
    <div class="view-switch"><span>查看方式</span><el-radio-group v-model="instanceView" size="small"><el-radio-button value="spec">按规格</el-radio-button><el-radio-button value="position">按岗位</el-radio-button><el-radio-button value="detail">实例明细</el-radio-button></el-radio-group><span class="view-hint">先查看实例分布，再下钻定位具体实例</span></div>
    <div class="runtime-card">
      <div class="runtime-card-title">{{ cardTitle }}<span>数据更新于 {{ updatedAt }}</span></div>
      <ListStates :loading="loading" :error="loadError" :empty="!loading && !loadError && filteredInstances.length === 0" empty-text="暂无符合条件的实例" @retry="load">
      <el-table v-if="instanceView !== 'detail'" v-loading="loading" :data="instanceGroups" row-key="name">
        <el-table-column :label="instanceView === 'spec' ? '运行规格' : '岗位'" min-width="180"><template #default="{row}"><div class="primary-text">{{ row.name }}</div><div class="secondary-text">{{ row.label }}汇总</div></template></el-table-column>
        <el-table-column prop="users" label="涉及用户" width="110" /><el-table-column prop="total" label="当前实例" width="110" />
        <el-table-column label="状态分布" min-width="300"><template #default="{row}"><span class="state-item success-text">运行 {{ row.running }}</span><span class="state-item">空闲 {{ row.idle }}</span><span class="state-item warning-text">启动 {{ row.starting }}</span><span class="state-item danger-text">异常 {{ row.abnormal }}</span></template></el-table-column>
        <el-table-column prop="pending" label="规格待生效" width="120" /><el-table-column prop="lastActive" label="最近活跃" width="160" /><el-table-column label="操作" width="110" fixed="right"><template #default="{row}"><el-button link type="primary" @click="drillInstances(row)">查看实例</el-button></template></el-table-column>
      </el-table>
      <el-table v-else v-loading="loading" :data="filteredInstances" row-key="id">
        <el-table-column label="用户" min-width="130"><template #default="{row}"><div class="primary-text">{{ row.name }}</div><div class="secondary-text">{{ row.username }}</div></template></el-table-column><el-table-column prop="position" label="岗位" width="120" /><el-table-column label="实例状态" width="100"><template #default="{row}"><StatusTag :type="statusMeta[row.status][1]">{{ statusMeta[row.status][0] }}</StatusTag></template></el-table-column><el-table-column label="当前实际规格" min-width="140"><template #default="{row}"><div>{{ row.actualSpec }}</div><StatusTag v-if="row.actualSpec !== row.effectiveSpec" type="warning">规格待生效</StatusTag></template></el-table-column><el-table-column label="CPU / 内存" width="145"><template #default="{row}"><div>{{ row.cpu }}</div><div class="secondary-text">已用 {{ row.usage }}</div></template></el-table-column><el-table-column prop="active" label="最近活跃" width="150" /><el-table-column label="异常摘要" min-width="190"><template #default="{row}"><span :class="{'danger-text':row.error !== '—'}">{{ row.error }}</span></template></el-table-column>
        <el-table-column label="操作" width="145" fixed="right"><template #default="{row}"><div class="row-actions"><el-button link type="primary" @click="showDetail(row)">查看</el-button><el-dropdown trigger="click"><el-button link type="primary">运行操作⌄</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item :disabled="!canOperate(row,'restart')" @click="instanceAction(row,'restart')">重启</el-dropdown-item><el-dropdown-item :disabled="!canOperate(row,'rebuild')" @click="instanceAction(row,'rebuild')">按最新规格重建</el-dropdown-item><el-dropdown-item :disabled="!canOperate(row,'recycle')" divided @click="instanceAction(row,'recycle')">回收</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></template></el-table-column>
      </el-table>
      </ListStates>
      <div class="table-foot">{{ instanceView === 'detail' ? filteredInstances.length : instanceGroups.length }} 条记录</div>
    </div>
    <DrawerEditor v-model:visible="detailVisible" :title="`实例详情 · ${current?.name || ''}`" readonly size="720px">
      <template v-if="current">
        <div class="detail-section"><h3>基本信息</h3><el-descriptions :column="2" border><el-descriptions-item label="实例标识">{{ current.id }}</el-descriptions-item><el-descriptions-item label="所属用户">{{ current.name }}（{{ current.username }}）</el-descriptions-item><el-descriptions-item label="岗位">{{ current.position }}</el-descriptions-item><el-descriptions-item label="当前状态"><StatusTag :type="statusMeta[current.status][1]">{{ statusMeta[current.status][0] }}</StatusTag></el-descriptions-item></el-descriptions></div>
        <div class="detail-section"><h3>规格与资源</h3><el-descriptions :column="2" border><el-descriptions-item label="当前实际规格">{{ current.actualSpec }}</el-descriptions-item><el-descriptions-item label="当前生效规格">{{ current.effectiveSpec }}</el-descriptions-item><el-descriptions-item label="CPU / 内存额度">{{ current.cpu }}</el-descriptions-item><el-descriptions-item label="当前用量">{{ current.usage }}</el-descriptions-item></el-descriptions></div>
        <div class="detail-section"><h3>状态与异常</h3><el-alert v-if="current.error !== '—'" :title="current.error" type="error" :closable="false" show-icon /><el-alert v-else title="当前未发现实例异常" type="success" :closable="false" show-icon /><el-descriptions :column="2" border class="time-descriptions"><el-descriptions-item label="启动时间">{{ current.startedAt }}</el-descriptions-item><el-descriptions-item label="最近活跃">{{ current.active }}</el-descriptions-item><el-descriptions-item label="数据更新时间" :span="2">{{ current.updatedAt }}</el-descriptions-item></el-descriptions></div>
        <div class="detail-section"><h3>运行操作</h3><el-alert v-if="!current.operable" :title="current.operationHint" type="warning" :closable="false" show-icon /><div class="detail-actions"><el-button :disabled="!canOperate(current,'restart')" @click="instanceAction(current,'restart')">重启</el-button><el-button :disabled="!canOperate(current,'rebuild')" @click="instanceAction(current,'rebuild')">按最新规格重建</el-button><el-button type="danger" plain :disabled="!canOperate(current,'recycle')" @click="instanceAction(current,'recycle')">回收</el-button></div></div>
        <div class="detail-section"><h3>操作记录</h3><el-timeline class="detail-timeline"><el-timeline-item :timestamp="current.updatedAt" type="primary">实例状态已同步</el-timeline-item><el-timeline-item :timestamp="current.startedAt" type="success">运行环境已创建</el-timeline-item></el-timeline></div>
      </template><template #footer><el-button @click="detailVisible = false">关闭</el-button><el-button type="primary" @click="refreshStatus">刷新状态</el-button></template>
    </DrawerEditor>
  </div>
</template>

<style scoped>
.runtime-page{gap:0}.runtime-note{margin-bottom:16px;padding:10px 14px;font-size:12px;line-height:1.7;color:var(--c-text-muted);background:var(--bg-sunken);border:1px solid var(--border-soft);border-left:3px solid var(--c-success);border-radius:var(--radius-sm)}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.metric-card{text-align:left;padding:13px 16px;background:var(--bg-base);border:1px solid var(--border-soft);border-radius:var(--radius-md);cursor:pointer;color:var(--c-text-muted)}.metric-card:hover{border-color:var(--c-accent)}.metric-card span{display:block;font-size:12px}.metric-card strong{display:block;margin-top:5px;font-size:23px;color:var(--c-text-strong)}.view-switch{display:flex;align-items:center;gap:12px;margin:0 0 12px;padding:10px 14px;background:var(--bg-sunken);border:1px solid var(--border-soft);border-radius:var(--radius-sm);font-size:12px;color:var(--c-text-muted)}.view-hint{margin-left:auto;color:var(--c-text-faint)}.runtime-card{border:1px solid var(--border-soft);border-radius:var(--radius-md);background:var(--bg-base);overflow:hidden}.runtime-card-title{display:flex;justify-content:space-between;padding:12px 16px;font-weight:var(--fw-semibold);border-bottom:1px solid var(--border-soft)}.runtime-card-title span,.secondary-text,.table-foot{font-size:12px;color:var(--c-text-faint);font-weight:400}.primary-text{font-weight:var(--fw-semibold);color:var(--c-text-strong)}.state-item{display:inline-block;margin-right:16px}.success-text{color:var(--c-success)}.warning-text{color:var(--c-warning)}.danger-text{color:var(--c-danger)}.row-actions,.detail-actions{display:flex;align-items:center;gap:8px;white-space:nowrap}.table-foot{padding:10px 16px;border-top:1px solid var(--border-soft)}.detail-section{margin-bottom:24px}.detail-section h3{margin:0 0 12px;font-size:14px}.detail-timeline{margin-top:8px}.time-descriptions{margin-top:12px}@media(max-width:1000px){.metric-grid{grid-template-columns:repeat(2,1fr)}.view-hint{display:none}}
</style>
