<script setup>
/**
 * 连接器发布管理抽屉（连接器改造一：MCP 服务级发布 / API 仍工具粒度）。
 *
 * 两种发布心智，按 connector.type 分流：
 * - MCP：**服务级**发布。整个 MCP 服务作为一个发布单位——一键把服务下全部工具发布到所选目标
 *   （FDE_WORKBENCH / USER_END，可多选）；服务级撤回/下架/重新上架按 target 分别作用于该服务对应态
 *   全部工具。状态消费后端服务级聚合端点（getMcpServicePublishStatus），前端不自拼优先级、不展现逐工具态。
 *   writeClass/requiresConfirmation 已挪到 MCP 编辑器逐工具配置，发布抽屉不再出现这两项。
 * - API：仍「一连接器≈一工具」工具粒度发布，沿用既有 TargetPublishSection（含安全属性区）+ listings 端点。
 *
 * 数据源：
 * - MCP：GET /fde/market/mcp-services/{id}/publish-status（按 target 聚合态）；
 *        POST .../publish | delist | relist | withdraw（服务级批量）。
 * - API：GET /fde/tools/available + /fde/market/listings（按 toolCode 归并两目标行）；
 *        POST /fde/market/listings + 逐 listing 撤回/下架/重新上架。
 */
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import TargetPublishSection from '@/components/admin/TargetPublishSection.vue'
import {
  getAvailableTools,
  listMarketListings,
  createMarketListing,
  withdrawMarketListing,
  delistMarketListing,
  relistMarketListing,
  getMcpServicePublishStatus,
  publishMcpService,
  delistMcpService,
  relistMcpService,
  withdrawMcpService
} from '@/api/market'
import {
  getBizSystemPublication,
  submitBizSystemPublish,
  delistBizSystem,
  relistBizSystem
} from '@/api/admin'
import {
  TARGETS,
  targetLabel,
  statusMeta,
  publishOutcomeLabel,
  isPublishOutcomeOk,
  mcpAggStatusMeta,
  mcpServiceActions
} from '@/utils/marketMeta'
// 目标态→可执行操作（NONE/REJECTED→publish；PENDING→withdraw；PUBLISHED→delist；DELISTED→relist），
// API 工具粒度复用 skillPublication.targetActions 口径，避免重复定义。
import { targetActions } from '@/utils/skillPublication'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 当前连接器：{ id, name, type:'MCP'|'API' }
  connector: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'done'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const connType = computed(() => props.connector?.type || 'MCP')
const isMcp = computed(() => connType.value === 'MCP')
// 业务系统（BIZ_SYSTEM）：整系统为单发布单元、双目标（FDE 工作台/用户端）各自独立态。无工具粒度。
const isBiz = computed(() => connType.value === 'BIZ_SYSTEM')

const loading = ref(false)
const loadError = ref(false)

/* ============================ MCP 服务级状态 ============================ */
// 服务级聚合：{ mcpId, mcpCode, toolTotal, targets:[{ target, aggregateStatus, *Count, missingCount }] }
const mcpStatus = ref(null)
// 服务级一键发布的目标多选（默认勾全部可发布目标）
const mcpChecked = ref([])
const mcpBusy = ref(false) // 服务级动作进行中（发布/撤回/下架/重新上架）

// 服务级两目标态行（固定 TARGETS 顺序；缺该 target 段时回退 NOT_PUBLISHED）
const mcpTargetRows = computed(() => {
  const byTarget = {}
  for (const seg of mcpStatus.value?.targets || []) {
    if (seg?.target) byTarget[seg.target] = seg
  }
  return TARGETS.map((t) => {
    const seg = byTarget[t] || null
    const status = seg?.aggregateStatus || 'NOT_PUBLISHED'
    return {
      target: t,
      label: targetLabel(t),
      status,
      meta: mcpAggStatusMeta(status),
      actions: mcpServiceActions(status),
      publishedCount: seg?.publishedCount ?? 0,
      missingCount: seg?.missingCount ?? 0
    }
  })
})

// 可一键发布（含 publish 动作）的目标集合
const mcpPublishableTargets = computed(() =>
  mcpTargetRows.value.filter((r) => r.actions.includes('publish')).map((r) => r.target)
)
// 勾选区显示的目标行（仅可发布目标）
const mcpPublishableRows = computed(() =>
  mcpTargetRows.value.filter((r) => mcpPublishableTargets.value.includes(r.target))
)

const toolTotal = computed(() => mcpStatus.value?.toolTotal ?? 0)

// 服务级单目标动作元数据（撤回/下架/重新上架；作用于该 target 该服务对应态全部工具）
const MCP_ACTION_META = {
  withdraw: {
    btn: '撤回',
    btnType: 'warning',
    api: withdrawMcpService,
    confirm: (label) => `撤回「${label}」下该服务全部待审工具后，这些工具将回到未发布态。确认撤回？`,
    ok: '已撤回该目标下全部待审工具'
  },
  delist: {
    btn: '停用',
    btnType: 'warning',
    api: delistMcpService,
    // V99：下架改为过审后生效。提交后进入审核，审核通过前对客户端仍可用，通过后才真正断供。
    confirm: (label) => `提交后进入审核，审核通过前「${label}」下该服务已上架工具对客户端仍然可用；审核通过后这些工具将不再可用。确认提交停用？`,
    ok: '已提交停用审核'
  },
  relist: {
    btn: '重新上架',
    btnType: 'success',
    api: relistMcpService,
    confirm: (label) => `重新上架「${label}」下该服务全部已下架工具后，这些工具将恢复可用。确认上架？`,
    ok: '已重新上架该目标下全部已下架工具'
  }
}

/* ============================ API 工具粒度状态（沿用既有逻辑） ============================ */
const tools = ref([]) // 该连接器下的工具项（available 过滤后）
const formMap = ref({}) // { [toolCode]: { checked } }（仅发布目标勾选；安全属性已不在此配置）
const listingMap = ref({}) // { [toolCode]: [ListingVO...] }
const busyTool = ref(null) // 进行中的 toolCode（复合行锁）

function statusTagType(status) {
  return statusMeta(status).type
}
function statusLabelFn(status) {
  return statusMeta(status).label
}

const API_ACTION_META = {
  withdraw: {
    btn: '撤回',
    btnType: 'warning',
    api: withdrawMarketListing,
    confirm: (label) => `撤回「${label}」的发布申请后，该目标将回到未发布态。确认撤回？`,
    ok: '已撤回发布申请'
  },
  delist: {
    btn: '停用',
    btnType: 'warning',
    api: delistMarketListing,
    // V99：下架改为过审后生效。提交后进入审核，审核通过前对客户端仍可用，通过后才真正断供。
    confirm: (label) => `提交后进入审核，审核通过前「${label}」对客户端仍然可用；审核通过后该目标侧将不再可用。确认提交停用？`,
    ok: '已提交停用审核'
  },
  relist: {
    btn: '重新上架',
    btnType: 'success',
    api: relistMarketListing,
    confirm: (label) => `重新上架「${label}」后，该目标侧将恢复可用。确认上架？`,
    ok: '已重新上架'
  }
}

function rowsOfTool(toolCode) {
  const listings = listingMap.value[toolCode] || []
  const byTarget = {}
  for (const l of listings) {
    if (l?.target) byTarget[l.target] = l
  }
  return TARGETS.map((t) => {
    const l = byTarget[t] || null
    const rawStatus = l?.status || 'NONE'
    // V99「停用也过审」：待审下架的 listing 其 status 仍是 PUBLISHED、另带 pendingAction=DELIST。
    // 展示态归一为 PENDING_REVIEW（显「待审核」+ 给「撤回」动作），避免误显「已发布」让运营重复点停用。
    const isPendingDelist = l?.pendingAction === 'DELIST' && rawStatus === 'PUBLISHED'
    const status = isPendingDelist ? 'PENDING_REVIEW' : rawStatus
    return {
      target: t,
      label: targetLabel(t),
      status,
      actions: targetActions(status),
      rejectComment: status === 'REJECTED' ? l?.reviewComment || '' : '',
      listingId: l?.id ?? null
    }
  })
}

const toolSegments = computed(() =>
  tools.value.map((t) => ({
    tool: t,
    rows: rowsOfTool(t.code),
    form: formMap.value[t.code] || { checked: [] }
  }))
)

/* ============================ 载入：按类型分流 ============================ */
async function load() {
  if (props.connector?.id == null) return
  loading.value = true
  loadError.value = false
  try {
    if (isMcp.value) {
      await loadMcp()
    } else if (isBiz.value) {
      await loadBiz()
    } else {
      await loadApi()
    }
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function loadMcp() {
  const data = await getMcpServicePublishStatus(props.connector.id)
  mcpStatus.value = data || { toolTotal: 0, targets: [] }
  // 默认勾全部可一键发布目标
  mcpChecked.value = mcpPublishableTargets.value
}

async function loadApi() {
  const [avail, listData] = await Promise.all([
    getAvailableTools(),
    listMarketListings({ toolType: 'API' })
  ])
  const cid = props.connector?.id
  tools.value = (avail?.api || []).filter((t) => t.apiDefId === cid)
  const lm = {}
  for (const l of listData?.list || []) {
    ;(lm[l.toolCode] ||= []).push(l)
  }
  listingMap.value = lm
  // 表单态只保留发布目标勾选（默认勾全部可提交目标）；
  // 安全属性（writeClass/requiresConfirmation）不再在发布抽屉配置，故不入表单。
  const fm = {}
  for (const t of tools.value) {
    const rows = rowsOfTool(t.code)
    fm[t.code] = {
      checked: rows.filter((r) => r.actions.includes('publish')).map((r) => r.target)
    }
  }
  formMap.value = fm
}

watch(
  () => [visible.value, props.connector?.id],
  ([open]) => {
    if (open && props.connector?.id != null) load()
  },
  { immediate: true }
)

/* ============================ MCP 服务级动作 ============================ */
async function submitMcpPublish() {
  const targets = [...mcpChecked.value]
  if (!targets.length) {
    ElMessage.warning('请至少选择一个发布目标')
    return
  }
  mcpBusy.value = true
  try {
    const res = await publishMcpService(props.connector.id, { targets })
    reportMcpPublishResult(res)
    await loadMcp()
    emit('done')
  } catch (e) {
    ElMessage.error(e?.message || '一键发布失败')
  } finally {
    mcpBusy.value = false
  }
}

// 服务级发布结果汇总：results 逐 (工具, target)；统计成功(CREATED/RESUBMITTED) 与冲突(CONFLICT) 数。
function reportMcpPublishResult(res) {
  const results = res?.results || []
  if (!results.length) {
    ElMessage.success('已提交服务级发布，等待审核')
    return
  }
  const ok = results.filter((r) => isPublishOutcomeOk(r.outcome))
  const conflict = results.filter((r) => !isPublishOutcomeOk(r.outcome))
  if (!conflict.length) {
    ElMessage.success(`已提交全部 ${ok.length} 项（工具×目标）发布，等待审核`)
    return
  }
  const parts = []
  if (ok.length) parts.push(`已提交 ${ok.length} 项`)
  if (conflict.length) parts.push(`跳过 ${conflict.length} 项（${publishOutcomeLabel(conflict[0].outcome)}等）`)
  ElMessage.warning(parts.join('，'))
}

async function runMcpAction({ action, row }) {
  const meta = MCP_ACTION_META[action]
  if (!meta) return
  try {
    await ElMessageBox.confirm(meta.confirm(row.label), '确认服务级操作', { type: 'warning' })
  } catch {
    return
  }
  mcpBusy.value = true
  try {
    // 服务级动作按 target 作用：仅传当前 target，使该 target 下该服务对应态工具批量流转。
    const res = await meta.api(props.connector.id, { targets: [row.target] })
    const affected = res?.affected ?? 0
    const skipped = res?.skipped ?? 0
    ElMessage.success(skipped ? `${meta.ok}（${affected} 个，跳过 ${skipped} 个）` : `${meta.ok}（${affected} 个）`)
    await loadMcp()
    emit('done')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    mcpBusy.value = false
  }
}

/* ============================ API 工具粒度动作（沿用既有逻辑） ============================ */
async function submitPublish(tool, targets) {
  if (!targets.length) {
    ElMessage.warning('请至少选择一个发布目标')
    return
  }
  busyTool.value = tool.code
  try {
    // writeClass/requiresConfirmation 不再随发布提交（后端 PublishListingRequest 已删除这两字段，
    // API 侧由后端从 api_def 读取）；此处只提交目标 + 展示元数据。
    const res = await createMarketListing({
      toolType: 'API',
      toolCode: tool.code,
      targets: [...targets],
      displayName: tool.bizName || tool.toolName || undefined,
      description: tool.description || undefined
    })
    reportPublishResult(Array.isArray(res) ? res : res?.list || [])
    await loadApi()
    emit('done')
  } catch (e) {
    ElMessage.error(e?.message || '提交发布失败')
  } finally {
    busyTool.value = null
  }
}

function reportPublishResult(results) {
  if (!results.length) {
    ElMessage.success('已提交发布，等待审核')
    return
  }
  const ok = results.filter((r) => isPublishOutcomeOk(r.outcome))
  const skipped = results.filter((r) => !isPublishOutcomeOk(r.outcome))
  if (!skipped.length) {
    ElMessage.success(`已提交发布到 ${ok.map((r) => targetLabel(r.target)).join(' / ')}，等待审核`)
    return
  }
  const okText = ok.length ? `已提交：${ok.map((r) => targetLabel(r.target)).join(' / ')}` : ''
  const skipText = skipped
    .map((r) => `${targetLabel(r.target)}（${r.message || publishOutcomeLabel(r.outcome)}）`)
    .join('；')
  ElMessage.warning([okText, `跳过：${skipText}`].filter(Boolean).join('。'))
}

async function runAction(tool, { action, row }) {
  const meta = API_ACTION_META[action]
  if (!meta || row.listingId == null) return
  try {
    await ElMessageBox.confirm(meta.confirm(row.label), '确认操作', { type: 'warning' })
  } catch {
    return
  }
  busyTool.value = tool.code
  try {
    await meta.api(row.listingId)
    ElMessage.success(meta.ok)
    await loadApi()
    emit('done')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    busyTool.value = null
  }
}

function onCheckedUpdate(toolCode, val) {
  if (formMap.value[toolCode]) formMap.value[toolCode].checked = val
}

/* ============================ 业务系统（BIZ_SYSTEM）双目标发布 ============================ */
// 后端 publication 返回两目标态数组：[{ target, status, version, reviewComment }]，status=null 表示未发布。
const bizPubs = ref([]) // 原始双目标态
const bizChecked = ref([]) // 提交发布勾选目标
const bizBusy = ref(false)

// bz 后端状态（PENDING_REVIEW/PUBLISHED/REJECTED/DELISTED/null）→ TargetPublishSection 行 status（null→NONE）。
function bizStatusOf(p) {
  return p?.status || 'NONE'
}
// bz 双目标态行（复用 targetActions：NONE/REJECTED→publish，PUBLISHED→delist，DELISTED→relist，PENDING→无）。
const bizTargetRows = computed(() => {
  const byTarget = {}
  for (const p of bizPubs.value) byTarget[p.target] = p
  return TARGETS.map((t) => {
    const p = byTarget[t] || null
    const status = bizStatusOf(p)
    return {
      target: t,
      label: targetLabel(t),
      status,
      actions: targetActions(status),
      rejectComment: status === 'REJECTED' ? p?.reviewComment || '' : ''
    }
  })
})

// bz 启停动作元数据（下架/重新上架；撤回态 bz 无——提交后即待审，无撤回入口，与 API 差异）。
const BIZ_ACTION_META = {
  delist: {
    btn: '下架',
    btnType: 'danger',
    api: delistBizSystem,
    confirm: (label) => `下架「${label}」后，该目标侧将不再可用（可随后重新上架）。确认下架？`,
    ok: '已下架'
  },
  relist: {
    btn: '重新上架',
    btnType: 'success',
    api: relistBizSystem,
    confirm: (label) => `重新上架「${label}」后，该目标侧将恢复可用。确认上架？`,
    ok: '已重新上架'
  }
}

async function loadBiz() {
  const data = await getBizSystemPublication(props.connector.id)
  bizPubs.value = Array.isArray(data) ? data : data?.list || []
  // 默认勾全部可提交目标（NONE/REJECTED）。
  bizChecked.value = bizTargetRows.value
    .filter((r) => r.actions.includes('publish'))
    .map((r) => r.target)
}

async function submitBizPublish(targets) {
  if (!targets.length) {
    ElMessage.warning('请至少选择一个发布目标')
    return
  }
  bizBusy.value = true
  try {
    const res = await submitBizSystemPublish(props.connector.id, [...targets])
    const results = Array.isArray(res) ? res : res?.list || []
    const ok = results.filter((r) => r.outcome === 'OK')
    const conflict = results.filter((r) => r.outcome !== 'OK')
    if (!conflict.length) {
      ElMessage.success(`已提交发布到 ${ok.map((r) => targetLabel(r.target)).join(' / ')}，等待审核`)
    } else {
      const parts = []
      if (ok.length) parts.push(`已提交：${ok.map((r) => targetLabel(r.target)).join(' / ')}`)
      parts.push(`跳过：${conflict.map((r) => `${targetLabel(r.target)}（${r.message || '冲突'}）`).join('；')}`)
      ElMessage.warning(parts.join('。'))
    }
    await loadBiz()
    emit('done')
  } catch (e) {
    ElMessage.error(e?.message || '提交发布失败')
  } finally {
    bizBusy.value = false
  }
}

async function runBizAction({ action, row }) {
  const meta = BIZ_ACTION_META[action]
  if (!meta) return
  try {
    await ElMessageBox.confirm(meta.confirm(row.label), '确认操作', { type: 'warning' })
  } catch {
    return
  }
  bizBusy.value = true
  try {
    await meta.api(props.connector.id, row.target)
    ElMessage.success(meta.ok)
    await loadBiz()
    emit('done')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    bizBusy.value = false
  }
}

function onBizCheckedUpdate(val) {
  bizChecked.value = val
}
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="connector?.name || '发布管理'"
    size="520px"
    direction="rtl"
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="cpd-head">
        <span class="cpd-name">{{ connector?.name }}</span>
        <el-tag size="small" effect="plain">{{ connType }}</el-tag>
        <span v-if="isMcp && !loading && !loadError" class="cpd-summary">
          共 {{ toolTotal }} 个工具
        </span>
      </div>
    </template>

    <div v-loading="loading" class="cpd-body">
      <el-empty v-if="!loading && loadError" :image-size="96" description="加载失败">
        <el-button @click="load">重试</el-button>
      </el-empty>

      <!-- ============ MCP：服务级发布 ============ -->
      <template v-else-if="isMcp && !loading">
        <el-empty
          v-if="!toolTotal"
          :image-size="96"
          description="该 MCP 服务下暂无工具，请先在编辑里「拉取工具」从 server 同步（无工具的 MCP 不可发布）"
        />
        <template v-else>
          <div class="cpd-svc-hint">
            发布以整个 MCP 服务为单位：一键发布即把该服务下全部 {{ toolTotal }} 个工具一起提交到所选目标。
            工具的读/写性质在 MCP 编辑器逐工具标注，此处不再设置。
          </div>

          <!-- 两目标服务级聚合态 + 服务级动作 -->
          <div class="cpd-svc-targets">
            <div v-for="r in mcpTargetRows" :key="r.target" class="cpd-svc-row">
              <span class="cpd-svc-tname">{{ r.label }}</span>
              <StatusTag :type="r.meta.type">{{ r.meta.label }}</StatusTag>
              <span
                v-if="r.status === 'PARTIAL' && r.missingCount"
                class="cpd-svc-sub"
              >已上架 {{ r.publishedCount }}/{{ toolTotal }}，{{ r.missingCount }} 个未发布</span>
              <span class="cpd-svc-sp"></span>
              <template v-for="a in r.actions" :key="a">
                <el-button
                  v-if="a !== 'publish' && MCP_ACTION_META[a]"
                  link
                  :type="MCP_ACTION_META[a].btnType"
                  :disabled="mcpBusy"
                  @click="runMcpAction({ action: a, row: r })"
                >
                  {{ MCP_ACTION_META[a].btn }}
                </el-button>
              </template>
            </div>
          </div>

          <!-- 一键发布区：勾选目标（仅可发布目标） + 提交 -->
          <div v-if="mcpPublishableRows.length" class="cpd-svc-publish">
            <div class="cpd-svc-pub-title">一键发布到</div>
            <el-checkbox-group v-model="mcpChecked" :disabled="mcpBusy">
              <el-checkbox v-for="r in mcpPublishableRows" :key="r.target" :value="r.target">
                {{ r.label }}
                <span class="cpd-svc-re">（{{ r.meta.label }}）</span>
              </el-checkbox>
            </el-checkbox-group>
            <div class="cpd-svc-actions">
              <el-button
                type="primary"
                :loading="mcpBusy"
                :disabled="!mcpChecked.length"
                @click="submitMcpPublish"
              >
                一键发布整服务
              </el-button>
            </div>
          </div>
          <div v-else class="cpd-svc-allset">两个目标该服务均已整齐上架/在审，无可新发布的目标。</div>
        </template>
      </template>

      <!-- ============ 业务系统：整系统双目标发布（复用 TargetPublishSection） ============ -->
      <template v-else-if="isBiz && !loading">
        <div class="cpd-svc-hint">
          业务系统整体为一个发布单元，可分别发布到「FDE 工作台」和「用户端」。发布到用户端并审核通过后，
          客户端连接器市场可见；发布到 FDE 工作台并通过后，FDE 侧可见。
        </div>
        <TargetPublishSection
          :target-rows="bizTargetRows"
          :status-tag-type="statusTagType"
          :status-label="statusLabelFn"
          :action-meta="BIZ_ACTION_META"
          :busy="bizBusy"
          :checked="bizChecked"
          @update:checked="onBizCheckedUpdate"
          @submit="submitBizPublish"
          @action="runBizAction"
        />
      </template>

      <!-- ============ API：工具粒度发布（沿用既有范式） ============ -->
      <template v-else-if="!isMcp && !isBiz && !loading">
        <el-empty
          v-if="!tools.length"
          :image-size="96"
          description="该连接器暂无工具，请先在编辑里登记工具"
        />
        <div v-for="seg in toolSegments" :key="seg.tool.code" class="cpd-seg">
          <div class="cpd-seg-head">
            <span class="cpd-tool-name">{{ seg.tool.bizName || seg.tool.toolName || seg.tool.code }}</span>
            <code class="cpd-tool-code">{{ seg.tool.code }}</code>
          </div>
          <!-- 安全属性区已删除（V40 下沉工具定义层）：writeClass/requiresConfirmation
               不在发布抽屉配置（后端从 api_def 读取），仅保留目标态 + 提交/启停。 -->
          <TargetPublishSection
            :target-rows="seg.rows"
            :status-tag-type="statusTagType"
            :status-label="statusLabelFn"
            :action-meta="API_ACTION_META"
            :busy="busyTool === seg.tool.code"
            :checked="seg.form.checked"
            @update:checked="(v) => onCheckedUpdate(seg.tool.code, v)"
            @submit="(targets) => submitPublish(seg.tool, targets)"
            @action="(payload) => runAction(seg.tool, payload)"
          />
        </div>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.cpd-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.cpd-name {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.cpd-summary {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.cpd-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 120px;
}
/* ---- MCP 服务级 ---- */
.cpd-svc-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  line-height: 1.6;
}
.cpd-svc-targets {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--bg-sunken);
  border-radius: var(--radius-md);
}
.cpd-svc-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.cpd-svc-tname {
  font-size: var(--fs-sm);
  color: var(--c-text);
  min-width: 84px;
}
.cpd-svc-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.cpd-svc-sp {
  flex: 1;
}
.cpd-svc-publish {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.cpd-svc-pub-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text);
}
.cpd-svc-re {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.cpd-svc-actions {
  display: flex;
  justify-content: flex-end;
}
.cpd-svc-allset {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}
/* ---- API 工具粒度（沿用） ---- */
.cpd-seg {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.cpd-seg + .cpd-seg {
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-base);
}
.cpd-seg-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cpd-tool-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--c-text-strong);
}
.cpd-tool-code {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  word-break: break-all;
}
</style>
