<script setup>
/**
 * MCP 定义管理（Sprint 2.1 契约 §2 + 真实运行时契约；2026-08-20 改造：对齐「模型」页表格形态 + 服务级三态发布）。
 *
 * 【形态】列表由行卡（np-row）改为 el-table 表格，列与操作区节奏对齐「模型」页 / 「平台技能」页。
 *   列：名称 / 传输 / 工具数 / 被引用 / 检活 / 状态 / 操作。
 *
 * 【发布口径（2026-08-20 决策）】一个 MCP 服务是<b>一个发布单位</b>，三态：未发布 / 审核中 / 已发布。
 *   - 与模型一样，发布后即面向产品平台各项服务，<b>不再区分 FDE 工作台 / 用户端做二次审核</b>——
 *     底层只写 target=USER_END 单行（那也正是客户端在架门禁读的那个值）。
 *   - 「同一服务下全部当前工具恒处于同一发布态」是强不变量：后端逐工具端点对 MCP 拒绝、
 *     审核台按服务聚合为一条批量审批、拉取工具后新工具自动继承服务发布态。故列表不再出现
 *     「部分已上架」（保留兜底映射防存量脏数据，见 utils/marketMeta.mcpListStateMeta）。
 *   - 发布后调整 MCP Server 配置<b>实时生效</b>，无需重新发布。
 *
 * 【操作区】查看 / 编辑 / 发布·撤回·停用 / 删除（验证入口在「验证」列，同模型页）。
 *   配色对齐模型页：常规=primary、正向状态操作（发布）=success、
 *   负向状态操作（撤回/停用）=warning、危险操作（删除）=danger。
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listMcp, deleteMcp, healthCheckTool } from '@/api/admin'
import {
  getMcpServicePublishStatus,
  publishMcpService,
  delistMcpService,
  withdrawMcpService
} from '@/api/market'
import { resolveDisplayStatus } from '@/utils/mcpMeta'
import { fmtTime } from '@/utils/docMeta'
import { explainMcpError } from '@/utils/mcpVerify'
import { mcpListStateMeta } from '@/utils/marketMeta'
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import StatusTag from '@/components/StatusTag.vue'
import HealthTag from '@/components/HealthTag.vue'
import McpEditor from '@/components/admin/McpEditor.vue'
import { iconIsUrl } from '@/utils/iconDisplay'

// 初值 true：首屏即 loading 态（v-loading 遮罩），避免挂载首帧 loading=false+空列表先闪空态。
// fetchList 在 onMounted 调用，try/finally 任何路径（成功/失败）都会把 loading 置回 false，不会卡死。
const query = reactive({ keyword: '', state: '' })

// 服务端分页：后端 /api/fde/connectors/mcp?page=&size= 返回当前页 list + 过滤后全量 total。

const editorVisible = ref(false)
const editingId = ref(null)
// 只读查看态（与模型页同口径：查看/编辑共用一个编辑器，靠 readonly 区分）
const editorReadonly = ref(false)
const checkBusy = ref(null) // 立即检活进行中的行 id

// 行内动作 busy 态：{ [id]: 'publish' | 'delist' | 'withdraw' | 'delete' }
const busy = ref({})

// 服务级发布态：{ [mcpDefId]: aggregateStatus }。消费后端服务级聚合端点（单目标端 USER_END）。
const pubAgg = ref({})

// 列表页状态筛选（三态）——前端按聚合态过滤，后端 listMcp 的 status 是「启用/停用」另一维度，不复用。
const STATE_OPTIONS = [
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'PENDING_REVIEW', label: '审核中' },
  { value: 'NOT_PUBLISHED', label: '未发布' }
]

/**
 * 验证列悬浮文案（三态，对齐模型页 verifyTip 的职责）：
 * 验证中 / 异常（带失败原因与时间）/ 正常或未检测（带最近检测时间）。
 *
 * <p>之所以把精确信息放悬浮而非列内：列内只给「结论 + 多久以前」两个人能一眼扫的信息，
 * 技术原文（错误码、超时毫秒数）放悬浮，避免撑爆列宽。</p>
 */
function verifyTip(row) {
  if (checkBusy.value === row.id) {
    return '正在验证连通性…'
  }
  const at = row.lastCheckAt || row.lastCheckedAt
  if (!at) {
    return '尚未验证过，点击发起验证'
  }
  const when = `最近验证：${fmtTime(at)}`
  if (resolveDisplayStatus(row) === 'UNHEALTHY') {
    // 三段式（与模型页失败态同格式）：最近验证 + 错误原因（人话）+ 错误码（供排障时报给同事）。
    // 列表标签只留「异常」二字，原因与错误码都收进悬浮——列表不是排障的地方。
    const e = explainMcpError(row.lastCheckError)
    return `${when}\n错误原因：${e.reason || '未知原因'}\n错误码：${e.code}`
  }
  // 正常/未检测：只给「最近验证」一行（用户口径 2026-08-21）——
  // 连接正常时没有别的要说，多一行「连接正常」是重复标签已经表达过的信息。
  return when
}


/**
 * 图标是否为图片 URL（V97）。判别口径与岗位头像一致：以 /api/public/icons/ 开头 = 上传的图片
 * （<img> 直接 GET，免 token）；否则按 emoji 字符渲染。
 */


/** 最近验证时间短格式（PRD §二.1：MM-DD HH:mm）；完整时间收进悬浮 verifyTip。 */
function fmtShortTime(t) {
  const s = fmtTime(t)
  return s ? s.slice(5) : ''
}

/** 引用情况悬浮：引用该 MCP 的技能名清单（PRD §二.1；mock 列表行随详情带出 referencedBySkills）。 */
function refsTip(row) {
  const names = (row.referencedBySkills || []).map((s) => s.skillName).filter(Boolean)
  return names.length ? names.join('、') : ''
}

/** 该行服务级聚合态（缺失=未拉到，按未发布处理）。 */
function aggOf(row) {
  return pubAgg.value[row.id] || 'NOT_PUBLISHED'
}
/** 三态展示元数据（六态聚合归三态，见 marketMeta.mcpListStateMeta）。 */
function stateMeta(row) {
  return mcpListStateMeta(aggOf(row))
}
/** 归一到三态键，供筛选比对（DELISTED/REJECTED/PARTIAL 均归「未发布」）。 */
function stateKey(row) {
  const a = aggOf(row)
  if (a === 'PUBLISHED') return 'PUBLISHED'
  if (a === 'PENDING_REVIEW') return 'PENDING_REVIEW'
  return 'NOT_PUBLISHED'
}

// 三态 → 可执行的服务级动作（列表操作区按此显隐）。
//   未发布（含已停用/已驳回）→ 发布；审核中 → 撤回；已发布 → 停用。
// V99 起与模型页一致：已停用不再有「重新上架」免重审通道，统一重新走发布过审。
/**
 * 可提交发布：未发布 / 已驳回 / 已停用（V99 起「已停用」也走这里）。
 *
 * <p>与模型页一致——已停用的服务不再有「重新上架」免重审通道，统一重新走发布过审。</p>
 */
function canPublish(row) {
  const a = aggOf(row)
  return a === 'NOT_PUBLISHED' || a === 'REJECTED' || a === 'PARTIAL' || a === 'DELISTED'
}
/**
 * 发布前置：连通性验证通过（与模型页同口径——上架意味着客户端会真的拿它去调用，
 * 连不上就发布等于把故障推给终端用户）。
 *
 * <p>MCP 复用检活四态：HEALTHY 即视为验证通过；UNKNOWN（未检测）/ UNHEALTHY 均不放行。</p>
 */
function verifyPassed(row) {
  return resolveDisplayStatus(row) === 'HEALTHY'
}
function canWithdraw(row) {
  return aggOf(row) === 'PENDING_REVIEW'
}
function canDelist(row) {
  return aggOf(row) === 'PUBLISHED' || aggOf(row) === 'PARTIAL'
}
/** 删除守卫：仅未发布可删（已发布/审核中的服务客户端在用或在途，后端亦有引用保护）。 */
function canDelete(row) {
  return stateKey(row) === 'NOT_PUBLISHED'
}
/** 编辑锁定：审核中不可改（改了会让审核对象与提交内容不一致）。 */
function isLocked(row) {
  return aggOf(row) === 'PENDING_REVIEW'
}

// 注：原页头「N 个已发布服务连通异常」红点角标已移除（2026-08-22 负责人口径）——
// 每行「验证」列本就显红色「异常」，顶部再报一遍属重复提示。三个页面（MCP / API / 模型）同步移除。

// 按三态筛选后的行（服务端不认聚合态，故在前端过滤当前页）
const visibleRows = computed(() => {
  if (!query.state) return rows.value
  return rows.value.filter((r) => stateKey(r) === query.state)
})

// 逐行拉取服务级聚合态（按本页 rows 并发；单行失败不阻断他行，缺失按未发布处理）。
async function loadPubSummary() {
  const ids = rows.value.map((r) => r.id).filter((id) => id != null)
  if (!ids.length) {
    pubAgg.value = {}
    return
  }
  const acc = {}
  await Promise.all(
    ids.map(async (id) => {
      try {
        const data = await getMcpServicePublishStatus(id)
        // 单目标端（2026-08-20）：后端只返回 USER_END 一段，取其聚合态即服务发布态。
        const seg = (data?.targets || [])[0]
        if (seg?.aggregateStatus) acc[id] = seg.aggregateStatus
      } catch (e) {
        // 单行聚合失败：忽略（按未发布展示），不阻断列表
      }
    })
  )
  pubAgg.value = acc
}

// 取数编排统一走 useAdminList（见 docs/frontend/规范-管理后台列表页.md）。
// 发布态摘要（loadPubSummary）依赖列表结果，故作为 mapRow 之后的副作用单独触发。
// 每页固定 10 条（PRD §二.5）
const list = useAdminList(listMcp, { params: () => ({ ...query }), pageSize: 10 })
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list

async function fetchList() {
  await list.reload()
  // 列表取到后再拉发布态摘要（失败不影响列表本身，内部已自行兜底）
  if (!loadError.value) await loadPubSummary()
}

function reload() {
  page.value = 1
  return fetchList()
}


onMounted(fetchList)

// 关键词实时搜索：300ms 防抖（手写，不引入新依赖）→ 调 reload（回第 1 页）。
let kwTimer = null
watch(
  () => query.keyword,
  () => {
    if (kwTimer) clearTimeout(kwTimer)
    kwTimer = setTimeout(reload, 300)
  }
)
onBeforeUnmount(() => {
  if (kwTimer) clearTimeout(kwTimer)
})

function openCreate() {
  editingId.value = null
  editorReadonly.value = false
  editorVisible.value = true
}
function openEdit(row) {
  editingId.value = row.id
  editorReadonly.value = false
  editorVisible.value = true
}
/** 查看：只读打开定义详情——审核锁定期与日常复核走这里，避免误改。 */
function openView(row) {
  editingId.value = row.id
  editorReadonly.value = true
  editorVisible.value = true
}
function onSaved() {
  // 新建/编辑保存后回第 1 页刷新（新建项常在首页，且避免停在越界页）
  reload()
}

// 编辑器内「拉取工具」探测后，就地更新该行连接标签（免重拉整表；契约 §3）。
// 注：拉取工具可能新增工具，后端已按「新工具继承服务当前发布态」自动补齐 listing，
// 故这里一并刷新发布态，让状态列跟上（避免界面显示滞后于实际）。
function onProbed(p) {
  if (!p || p.id == null) return
  const row = rows.value.find((r) => r.id === p.id)
  if (!row) return
  if (p.connStatus) row.connStatus = p.connStatus
  if (p.displayStatus) row.displayStatus = p.displayStatus
  if (p.lastCheckedAt) row.lastCheckedAt = p.lastCheckedAt
  if (p.toolCount != null) row.toolCount = p.toolCount
  loadPubSummary()
}

// 立即检活（契约 §4.4.1）：调手动检活端点 → loading → 就地刷新该行四态 + 反馈
async function checkNow(row) {
  checkBusy.value = row.id
  try {
    const res = await healthCheckTool('MCP', row.id)
    if (res?.displayStatus) row.displayStatus = res.displayStatus
    if (res?.checkedAt) row.lastCheckedAt = res.checkedAt
    const ds = resolveDisplayStatus(row)
    if (ds === 'HEALTHY') ElMessage.success('检活完成 · 连接正常')
    else if (ds === 'UNHEALTHY') ElMessage.warning('检活完成 · 连接异常')
    else ElMessage.info('检活完成')
  } catch (e) {
    ElMessage.error(e?.message || '检活失败，请稍后重试')
  } finally {
    checkBusy.value = null
  }
}

// 行内服务级动作统一封装：busy 态 + 失败 message 提示 + 成功刷新发布态
async function runAction(row, action, fn, successMsg) {
  busy.value[row.id] = action
  try {
    await fn(row.id)
    if (successMsg) ElMessage.success(successMsg)
    await loadPubSummary()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    delete busy.value[row.id]
  }
}

/**
 * 发布：整个服务下全部当前工具一起提交审核。
 *
 * 不再选目标端（2026-08-20）——发布后即面向产品平台各项服务。故弹窗只做一次确认，不带表单。
 */
async function publish(row) {
  const n = row.toolCount ?? 0
  if (!n) {
    ElMessage.warning('该 MCP 服务下暂无可发布的工具，请先在编辑器内「拉取工具」')
    return
  }
  try {
    // 文案对齐原型 modal（PRD §二.3.4）
    await ElMessageBox.confirm(
      `将把「${row.name}」下全部 ${n} 个工具作为一个整体提交审核，审核通过后才对平台各项服务开放。`,
      '发布 MCP 服务',
      { type: 'warning', confirmButtonText: '提交审核' }
    )
  } catch (e) {
    return
  }
  // targets 后端已忽略并归一为 USER_END，此处不再传目标端。
  runAction(row, 'publish', (id) => publishMcpService(id, {}), '已提交发布审核')
}

/** 撤回：审核中 → 未发布（删除在审 listing 行，沿用后端服务级 withdraw 语义）。 */
async function withdraw(row) {
  try {
    await ElMessageBox.confirm(
      `撤回后「${row.name}」将回到未发布状态，需重新发布并再次审核。确认撤回？`,
      '撤回审核',
      { type: 'warning', confirmButtonText: '撤回' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'withdraw', (id) => withdrawMcpService(id, {}), '已撤回')
}

/**
 * 停用：提交停用审核（V99，与模型页「停用」同名同口径）。
 *
 * <p><b>不再立即生效</b>——提交后进入审核，<b>审核通过前该服务对客户端仍然可用</b>，
 * 通过后才真正断供。文案必须说清这一点，否则 FDE 会以为点完就已经停了。</p>
 *
 * <p>用「停用」而非「下架」：与模型页统一措辞，两页同一个动作不该有两个叫法。
 * 底层动作名（delist / delistMcpService）保持不变——那是既有接口语义，改名会牵动后端。</p>
 */
async function delist(row) {
  try {
    // 软引用口径（PRD §二.3.6）：确认按钮【继续停用】
    await ElMessageBox.confirm(
      `停用后技能仍可执行，但运行效果可能受限或出现报错。确认继续停用「${row.name}」？`,
      '停用 MCP 服务',
      { type: 'warning', confirmButtonText: '继续停用' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'delist', (id) => delistMcpService(id, {}), '已提交停用审核')
}

async function remove(row) {
  const refCount = row.referencedBySkillCount || 0
  try {
    // 软引用口径（PRD §二.3.7）：被引用不强制阻断，确认影响后可继续删；按钮【继续删除】
    await ElMessageBox.confirm(
      refCount > 0
        ? `该 MCP 被 ${refCount} 个技能引用，停用或删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「${row.name}」？`
        : `删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「${row.name}」？`,
      '删除 MCP',
      { type: 'warning', confirmButtonText: '继续删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch (e) {
    return
  }
  busy.value[row.id] = 'delete'
  try {
    await deleteMcp(row.id)
    ElMessage.success('已删除')
    // 兜底：若删的是当前页最后一条（删后本页将空）且不在第 1 页，则回退一页再拉，避免停在越界空页。
    if (rows.value.length === 1 && page.value > 1) {
      page.value -= 1
    }
    await fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    delete busy.value[row.id]
  }
}
</script>

<template>
  <div class="list-page">
    <!-- 页头标题已收口至 AdminConnector 容器；此处仅保留工具行 -->
    <ListToolbar>
      <el-input v-model="query.keyword" placeholder="搜索服务名称或描述" clearable class="lt-search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.state" placeholder="全部状态" clearable class="lt-filter">
        <el-option v-for="o in STATE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建 MCP
        </el-button>
      </template>
    </ListToolbar>

    <ListStates
      :loading="loading"
      :error="loadError"
      :empty="isEmpty"
      empty-text="还没有 MCP 服务 · 点「新建 MCP」登记第一个"
      @retry="fetchList"
    >
      <el-table
        v-loading="loading"
        :data="visibleRows"
        row-key="id"
        :default-sort="{ prop: 'updatedAt', order: 'descending' }"
      >
        <!-- 服务：合并列（PRD §二.1/原型 service-summary）——图标+名称加粗+发布状态标签，
             第二行描述缩略（hover 全文）；不设独立状态列与描述列。 -->
        <el-table-column label="服务" :min-width="260">
          <template #default="{ row }">
            <div class="mc-service">
              <div class="mc-service-name">
                <span v-if="row.icon" class="mc-icon">
                  <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="mc-icon-img" />
                  <span v-else>{{ row.icon }}</span>
                </span>
                <span class="mc-name">{{ row.name }}</span>
                <StatusTag :type="stateMeta(row).type">{{ stateMeta(row).label }}</StatusTag>
              </div>
              <div class="mc-service-desc" :title="row.description || ''">
                {{ row.description || '—' }}
              </div>
            </div>
          </template>
        </el-table-column>

        <!-- 传输方式：展示完整枚举值（stdio / streamable-http），无内容显示 — -->
        <el-table-column label="传输方式" :width="COL.TAG + 24">
          <template #default="{ row }">
            <el-tag size="small" type="info" effect="plain">{{ row.transport || '—' }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="工具数" :width="COL.COUNT" align="center">
          <template #default="{ row }">
            <span v-if="row.toolCount">{{ row.toolCount }}</span>
            <el-tooltip v-else content="尚未拉取到工具，请在编辑器内「拉取工具」" placement="top" effect="dark">
              <span class="cell-na">—</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <!-- 引用情况（PRD §二.1）：暂无引用 / N 个技能引用，悬停查看引用技能名 -->
        <el-table-column label="引用情况" :width="120">
          <template #default="{ row }">
            <span v-if="!row.referencedBySkillCount" class="cell-na">暂无引用</span>
            <el-tooltip v-else :content="refsTip(row)" placement="top" effect="dark">
              <span class="mc-refs">{{ row.referencedBySkillCount }} 个技能引用</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <!-- 最近更新时间（PRD §二.1）：配置/工具清单最近一次保存成功的时间，可排序（默认由近到远） -->
        <el-table-column label="最近更新时间" prop="updatedAt" sortable :width="COL.TIME + 24">
          <template #default="{ row }">
            <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
            <span v-else class="cell-na">—</span>
          </template>
        </el-table-column>

        <!--
          验证列（外观与交互对齐模型页 AdminModels 的验证列）：
            结果标签 + 最近验证时间 + 刷新图标（点击即发起，图标旋转表达进行中）。
          悬浮提示承载精确信息（最近检测时间 / 失败原因）。

          【数据口径】MCP 复用既有「检活」链路（check_status / lastCheckAt / lastCheckError），
          不新建一套 verify_* 字段——两套连通性数据并存只会让 FDE 困惑「该信哪个」。
          故这里是「模型页验证列的外观与交互」+「MCP 既有检活的数据与端点」。

          时间用相对值（「27 天前」）：「正常」是关于现在的断言、数据却是关于过去的记录，
          不显示新旧，一个 30 天前的绿标签会被读成「现在没问题」。
        -->
        <el-table-column label="验证" :min-width="168">
          <template #default="{ row }">
            <div class="mc-vc">
              <!-- 结果标签：验证中沿用上一次结果（不闪成未知），由图标旋转表达「正在重测」 -->
              <HealthTag :status="resolveDisplayStatus(row)" />

              <!-- 最近验证时间（PRD §二.2：MM-DD HH:mm；从未验证不展示，完整时间收进悬浮） -->
              <span v-if="checkBusy === row.id" class="mc-vc-time">正在验证…</span>
              <span v-else-if="row.lastCheckAt || row.lastCheckedAt" class="mc-vc-time">
                {{ fmtShortTime(row.lastCheckAt || row.lastCheckedAt) }}
              </span>

              <!-- 刷新图标 = 验证入口。验证中转圈并禁用点击，转完即结果刷新。 -->
              <el-tooltip
                :content="verifyTip(row)"
                placement="top"
                effect="dark"
                popper-class="mc-vc-tip"
              >
                <el-icon
                  class="mc-vc-refresh"
                  :class="{ 'is-spinning': checkBusy === row.id }"
                  role="button"
                  :aria-label="checkBusy === row.id ? '正在验证' : '重新验证连通性'"
                  @click.stop="checkBusy !== row.id && checkNow(row)"
                >
                  <Refresh />
                </el-icon>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>

        <!--
          操作列配色：对齐「模型」/「平台技能」页口径——
            常规操作（查看/编辑）= primary；正向状态操作（发布）= success；
            负向状态操作（撤回/停用）= warning；危险操作（删除）= danger，置末。
        -->
        <el-table-column label="操作" :width="opsWidth(4)" fixed="right">
          <template #default="{ row }">
            <div class="tbl-ops">
              <!-- ① 主操作组：查看（只读）/ 编辑，与模型页同构 -->
              <el-button link type="primary" @click="openView(row)">查看</el-button>
              <!-- 审核中锁编辑：待审期间改配置会让「审核对象」与「提交内容」不一致——
                   审核员批的是提交那一刻的版本。禁用 + 悬浮说明如何解锁，而非静默不给点；
                   要看内容仍可走「查看」。 -->
              <el-tooltip v-if="isLocked(row)" content="审核中不可编辑，如需修改请先撤回" placement="top">
                <span class="tbl-ops-wrap">
                  <el-button link type="primary" disabled>编辑</el-button>
                </span>
              </el-tooltip>
              <el-button v-else link type="primary" @click="openEdit(row)">编辑</el-button>

              <!-- ② 分隔线：主操作 ↔ 状态/危险操作 -->
              <span class="tbl-ops-sep" aria-hidden="true"></span>

              <!-- ③ 发布 / 撤回 / 停用（同一位置随状态切换，与模型页同为 if/else-if 链：
                   三者互斥，链式表达比三个独立 v-if 更贴合「同一按位随状态切换」的语义，
                   也杜绝状态判定万一重叠时同时冒出两个按钮）。
                   发布前置：验证通过才可提交（未过则禁用并说明原因，同模型页）。 -->
              <el-button
                v-if="canWithdraw(row)"
                link
                type="warning"
                :loading="busy[row.id] === 'withdraw'"
                @click="withdraw(row)"
              >
                撤回
              </el-button>
              <template v-else-if="canPublish(row)">
                <el-tooltip
                  v-if="!verifyPassed(row)"
                  content="连通性验证通过后才可提交发布（改过连接配置需重新验证）"
                  placement="top"
                >
                  <span class="tbl-ops-wrap">
                    <el-button link type="success" disabled>发布</el-button>
                  </span>
                </el-tooltip>
                <el-button
                  v-else
                  link
                  type="success"
                  :loading="busy[row.id] === 'publish'"
                  @click="publish(row)"
                >
                  发布
                </el-button>
              </template>
              <el-button
                v-else-if="canDelist(row)"
                link
                type="warning"
                :loading="busy[row.id] === 'delist'"
                @click="delist(row)"
              >
                停用
              </el-button>

              <!-- ④ 危险操作置末：仅未发布可删 -->
              <el-button
                v-if="canDelete(row)"
                link
                type="danger"
               
                :loading="busy[row.id] === 'delete'"
                @click="remove(row)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <ListPagination
        v-model:page="page"
        :page-size="pageSize"
        :total="total"
        @change="fetchList"
      />
    </ListStates>

    <McpEditor
      v-model:visible="editorVisible"
      :mcp-id="editingId"
      :readonly="editorReadonly"
      @saved="onSaved"
      @probed="onProbed"
    />
  </div>
</template>

<style scoped>

/* 服务合并列（PRD §二.1）：首行 图标+名称加粗+状态标签，次行描述缩略 */
.mc-service {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mc-service-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.mc-name {
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mc-service-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mc-refs {
  cursor: default;
}
/* ===== 验证列（外观与模型页 .md-vc 同构，仅前缀不同） ===== */
.mc-vc {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 22px;
}
/* 最近验证时间：弱色次级信息，不与结果标签争视觉 */
.mc-vc-time {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  white-space: nowrap;
}
/* 刷新图标 = 验证入口。静息弱色（不喧宾夺主），hover 升为主色提示可点，
   验证中持续旋转并禁用指针——图标自身的动效即进度表达，不再另设进度条。 */
.mc-vc-refresh {
  flex: none;
  /* 紧跟结果与时间之后，不用 margin-left:auto 推到列尾——
     推到最右会离它所描述的结果太远，视觉上像属于隔壁的操作列。 */
  margin-left: 2px;
  color: var(--c-text-faint);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}
.mc-vc-refresh:hover {
  color: var(--c-accent);
}
.mc-vc-refresh.is-spinning {
  color: var(--c-accent);
  cursor: default;
  animation: mc-vc-rotate 1s linear infinite;
}
@keyframes mc-vc-rotate {
  to {
    transform: rotate(360deg);
  }
}
.mc-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
}

/* 图标（V97）：定宽定高，emoji 与图片共用同一视觉框，避免不同形态导致行高参差。 */
.mc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  font-size: 15px;
  line-height: 1;
  vertical-align: middle;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.mc-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

</style>

<!-- tooltip 经 teleport 挂到 body，scoped 选择器命不中，故单开非 scoped 块 -->
<style>
/* 验证提示多行制（最近验证时间 / 超时定制 / 连接结论）：保留换行并放宽宽度。
   verifyTip 返回的是 \n 分隔的多行文本，没有 pre-line 会被压成一长行。 */
.mc-vc-tip {
  max-width: 320px;
}
.mc-vc-tip .el-popper__content,
.mc-vc-tip.el-popper {
  white-space: pre-line;
  line-height: 1.6;
}
</style>
