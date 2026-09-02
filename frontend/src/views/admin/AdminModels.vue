<script setup>
/**
 * 模型配置页（ADMIN 专属，V76；V96 定稿：只保留上架/下架，不走审核流程）。
 *
 * 【发布口径】上架成功=已发布，下架成功=未发布。模型是「活配置」——客户端直接读主表当前值，
 *   上架即生效、无版本快照、无审核中间态。前置仅一条：连通性验证 SUCCESS 才可上架
 *   （上架意味着客户端会真的拿它去调用，连不上就上架等于把故障推给终端用户）。
 *   改连接字段会清空验证态并回落草稿，等价于「改完必须重验才能再上架」。
 *
 * 【列】模型名称 / 类别（标签） / 上下文 / 温度 / 验证（含「验证」入口） / 状态 / 操作。
 *
 * 【操作区】查看 / 编辑 / 上架·下架 / 设为默认 / 删除。
 *   规则：上架↔删除并存（未发布态），下架↔设为默认并存（已发布态）。
 *   配色对齐「平台技能」页：常规=primary、上架=success、下架=warning、删除=danger。
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import ModelConfigEditDialog from '@/components/admin/ModelConfigEditDialog.vue'
import HealthTag from '@/components/HealthTag.vue'
import {
  listModels,
  deleteModel,
  publishModel,
  delistModel,
  withdrawModel,
  setDefaultModel,
  verifyModel
} from '@/api/adminModel'
import {
  explainVerifyError,
  verifyHealthStatus,
  verifyPhaseText,
  verifyPhaseOf
} from '@/utils/modelVerify'
import {
  MODEL_CATEGORY_LABELS,
  MODEL_CATEGORY_OPTIONS,
  MODEL_PROVIDER_LABELS
} from '@/utils/modelPresets'
import { fmtTime } from '@/utils/docMeta'
// 列宽单一真相源（11 个列表页统一）：不再本页自定数值，避免同语义列在页面间对不齐
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'

// 状态展示口径（V96）：上架成功=已发布，下架成功=未发布。
// PENDING_REVIEW/REJECTED 为 V95 审核制遗留态，V96 迁移已归一为 DRAFT；此处保留兜底映射，
// 防存量脏数据或回滚场景下渲染出裸枚举。
// 三态（V98）：发布与停用两条都要过审，中间同为「审核中」。
// DELISTED/REJECTED 为历史遗留态，V98 迁移已归一为 DRAFT；保留兜底映射防存量脏数据渲染裸枚举。
const STATE_META = {
  DRAFT: { label: '未发布', type: 'info' },
  DELISTED: { label: '未发布', type: 'info' },
  REJECTED: { label: '未发布', type: 'info' },
  PENDING_REVIEW: { label: '审核中', type: 'warning' },
  PUBLISHED: { label: '已发布', type: 'success' }
}
const STATUS_OPTIONS = [
  { value: 'DRAFT', label: '未发布' },
  { value: 'PENDING_REVIEW', label: '审核中' },
  { value: 'PUBLISHED', label: '已发布' }
]

const keyword = ref('')
const statusFilter = ref('')
const categoryFilter = ref('')
// 最近更新时间列排序方向（2026-09-01 PRD 对齐：列头可点排序，默认由近到远；
// 默认模型在前的分区由 mock/后端保证，排序只作用于两区内部）
const sortOrder = ref('desc')

const editorVisible = ref(false)
const editingModel = ref(null)
const editorReadonly = ref(false)
// 请求层失败提示（网络断 / 409 / 60s 超时）——与「探测结论失败」性质不同，不改验证态
const verifyRequestError = ref('')

/**
 * 行内验证进行态：{ [id]: { phase, timer, controller } }。
 *
 * 验证跑在「行」上而不是弹窗里——40 秒缩不短，但能让它不挡着人干别的。
 * phase 由已开始时长推断（后端单次阻塞调用不回传进度，但探测时序确定，见 utils/modelVerify）。
 */
const verifying = reactive({})

function isVerifying(row) {
  return !!verifying[row.id]
}
function phaseOf(row) {
  return verifying[row.id]?.phase || 1
}
/**
 * 刷新图标的悬浮提示（三态）：
 *  - 验证中：说明当前阶段，并点破「可以走开」——40 秒里用户不必守着；
 *  - 成功：最近验证 + 首响时间（两行）；
 *  - 失败：最近验证 + 错误原因 + 错误码（三行）。列表标签只留「异常」，
 *    原因与错误码都收进提示——列表不是排障的地方，而错误码要能被选中复制给同事。
 * 从未验证过则给动作引导。
 */
function verifyTip(row) {
  if (isVerifying(row)) {
    return `${verifyPhaseText(phaseOf(row))}（约需 40 秒，可先去忙别的）`
  }
  if (!row.verifiedAt) return '点击验证连通性'
  // 「最近验证」而非「测试时间」：与 MCP 页统一措辞（2026-08-21 用户口径）。
  const at = `最近验证：${fmtTime(row.verifiedAt)}`
  if (row.verifyStatus === 'SUCCESS') {
    // 两段式：最近验证 + 首响时间。带标签前缀（「最近验证：」「首响时间：」）而非用「·」串接，
    // 分行对齐更易扫读，也与失败态的三段式格式统一。
    return row.verifyLatencyMs
      ? `${at}\n首响时间：${row.verifyLatencyMs} ms`
      : at
  }
  if (row.verifyStatus === 'FAILED') {
    // 三段式：最近验证 + 错误原因（人话）+ 错误码（技术前缀，供排障时报给同事）。
    // 列表标签只留「异常」二字，原因与错误码都收进此处——列表不是排障的地方。
    const e = explainVerifyError(row.verifyError)
    const reason = e?.brief || e?.label || '未知原因'
    return `${at}\n错误原因：${reason}\n错误码：${errorCodeOf(row.verifyError)}`
  }
  return '点击验证连通性'
}

/** 从 verify_error 原文取技术分类前缀作「错误码」（形如 `AUTH_FAILED: …` → AUTH_FAILED）。 */
function errorCodeOf(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return '未知'
  const i = text.indexOf(':')
  return i > 0 ? text.slice(0, i).trim() : '未知'
}

// 行内动作 busy 态：{ [id]: 'submit' | 'delist' | ... }
const busy = ref({})

/**
 * 状态展示口径（V98）。
 *
 * 待审「停用」的行 status 仍是 PUBLISHED（审核期间对客户端仍可用），但管理员看到的应是
 * 「审核中」——他关心的是「这个模型有没有在走流程」。故以 pendingAction 优先判定。
 */
function stateMeta(row) {
  if (row.pendingAction) return STATE_META.PENDING_REVIEW
  return STATE_META[row.status] || { label: row.status, type: 'info' }
}
/** 审核中：待审的是发布还是停用（用于按钮显隐与文案）。 */
function isPending(row) {
  return !!row.pendingAction
}
function categoryLabel(c) {
  return MODEL_CATEGORY_LABELS[c] || c || '—'
}
/**
 * 名称列厂商首字 logo 块（2026-09-01 PRD 对齐，MQ3 指示：不加图标字段，用厂商首字）。
 * 取厂商中文 label 里的首个 ASCII 字母（「阿里Qwen」→ Q、「月之暗面Kimi」→ K），
 * 无 ASCII 字母则取首字（「其他」→ 其）；无厂商信息回落模型名首字。
 */
function providerLogo(row) {
  const label = MODEL_PROVIDER_LABELS[row.providerName] || row.providerName || row.name || ''
  const ascii = String(label).match(/[A-Za-z]/)
  return (ascii ? ascii[0].toUpperCase() : String(label).charAt(0)) || '—'
}
/** 时间短格式 MM-DD HH:mm（验证列用；悬浮提示仍带完整时间）。 */
function fmtShort(iso) {
  const full = fmtTime(iso)
  return full ? full.slice(5) : ''
}
/** 上下文窗口简写（65536 → 64K，1048576 → 1M）。 */
function formatWindow(v) {
  if (v == null) return ''
  if (v >= 1048576 && v % 1048576 === 0) return `${v / 1048576}M`
  return v >= 1024 && v % 1024 === 0 ? `${v / 1024}K` : String(v)
}
/** 未发布（草稿 / 已下架，含审核制遗留态）——此态可「上架」与「删除」。 */
/** 未发布且无待审——此态可「发布」与「删除」。 */
function isOffline(row) {
  return row.status !== 'PUBLISHED' && !isPending(row)
}
/** 已发布且无待审——此态可「停用」与「设为默认」。 */
function isOnline(row) {
  return row.status === 'PUBLISHED' && !isPending(row)
}
/** 能提交发布的前置：连通性验证通过。未过则按钮禁用并说明原因。 */
function canPublish(row) {
  return row.verifyStatus === 'SUCCESS'
}
/** 删除守卫：仅未发布且无待审可删（审核中删除会让审核台留下悬空记录）。 */
function canDelete(row) {
  return isOffline(row)
}

// 取数编排统一走 useAdminList（见 docs/frontend/规范-管理后台列表页.md）。
// 模型量级恒定极小且后端返全量，故 paged:false —— 不分页、不下发 page/size。
const list = useAdminList(listModels, {
  paged: false,
  params: () => ({
    keyword: keyword.value.trim(),
    status: statusFilter.value,
    category: categoryFilter.value,
    sort: sortOrder.value
  })
})
const { rows, loading, loadError, isEmpty } = list
const fetchList = list.reload

onMounted(fetchList)

/** 最近更新时间列头点击排序：切方向后按当前条件重取（分区规则不变）。 */
function onSortChange({ prop, order }) {
  if (prop !== 'updatedAt') return
  sortOrder.value = order === 'ascending' ? 'asc' : 'desc'
  fetchList()
}

// 空态文案（2026-09-01 PRD 对齐）：有筛选条件时提示是条件问题，不是没数据。
const hasFilter = computed(
  () => !!(keyword.value.trim() || statusFilter.value || categoryFilter.value)
)
const emptyText = computed(() =>
  hasFilter.value ? '没有符合条件的模型' : '还没有接入模型 · 点「接入模型」配置第一个'
)

function openCreate() {
  editingModel.value = null
  editorReadonly.value = false
  editorVisible.value = true
}
function openEdit(row) {
  editingModel.value = { ...row }
  editorReadonly.value = false
  editorVisible.value = true
}
/** 查看：只读打开配置详情（审核锁定期与日常复核都走这里，避免误改）。 */
function openView(row) {
  editingModel.value = { ...row }
  editorReadonly.value = true
  editorVisible.value = true
}
/**
 * 编辑弹窗保存成功：先刷新列表，再对该行发起行内验证。
 *
 * 保存与验证由此解耦——用户点「保存」1 秒内就拿回控制权，40 秒的验证在行上跑，
 * 他可以继续看别的、也可以直接离开页面。
 */
async function onSaved(payload) {
  await fetchList()
  const id = payload?.verifyId
  if (!id) return
  const row = rows.value.find((r) => r.id === id)
  if (row) startVerify(row)
}
/**
 * 发起行内验证。
 *
 * 与旧实现的差别：不再把用户扣在弹窗里。验证跑在行上，用户可以继续操作、可以关掉抽屉、
 * 甚至切走页面（后端照样跑完并落库，回来重拉就能看到结果）。
 *
 * 【阶段推断】后端单次阻塞调用不回传进度，但探测时序确定（阶段一上限 20s），
 * 故用计时器在 20s 时切到阶段二。只做两格离散推进，不做百分比动画。
 */
async function startVerify(row) {
  if (verifying[row.id]) return   // 同一行同时刻只允许一个在途验证
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setInterval(() => {
    const st = verifying[row.id]
    if (st) st.phase = verifyPhaseOf(Date.now() - startedAt)
  }, 1000)
  verifying[row.id] = { phase: 1, timer, controller }
  verifyRequestError.value = ''

  try {
    const r = await verifyModel(row.id, { signal: controller.signal })
    // 结论已落库，重拉列表让验证态/能力标签跟着刷新
    await fetchList()
    // 检活提示统一口径（2026-09-01 PRD 对齐，与连接器页同文案）
    if (r?.verifyStatus === 'SUCCESS') {
      ElMessage.success('检活完成 · 连接正常')
    } else if (r?.verifyStatus === 'FAILED') {
      ElMessage.warning('检活完成 · 连接异常')
    } else {
      ElMessage.info('检活完成')
    }
  } catch (e) {
    if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') {
      // 取消只是「不等了」，后端仍会跑完并落库——必须说清楚，否则用户以为什么都没发生
      ElMessage.info('已停止等待。后台仍在验证，稍后刷新列表可看到结果。')
    } else {
      // 请求层失败：模型状况未知，绝不能把行标成「异常」（那是冤枉它）
      verifyRequestError.value = requestErrorText(e)
      ElMessage.error(verifyRequestError.value)
    }
  } finally {
    clearInterval(timer)
    delete verifying[row.id]
  }
}

/** 请求层失败文案：区分 409（配置被改）/ 超时 / 其它，都要点破「验证态未改变」。 */
function requestErrorText(e) {
  if (e?.code === 409) {
    return '验证期间该模型的连接配置被修改，本次结果已作废，请重新验证。'
  }
  if (e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '')) {
    return '等待超时（60 秒）。后台可能仍在验证，请稍后刷新列表查看结果。'
  }
  // 失败且拿不到原因：统一口径「检活失败，请稍后重试」（2026-09-01 PRD 对齐）
  if (!e?.message) return '检活失败，请稍后重试'
  return `验证请求未能完成（${e.message}），模型的连通状态未改变，请稍后重试。`
}

/**
 * 中止前端等待（后端不受影响，仍会跑完并落库）。
 *
 * 界面上不再提供「取消」按钮——验证收进列表后，进行中只占一个转圈图标、不挡任何操作，
 * 用户没有取消的动机；且「取消」二字会让人误以为能停掉后端（实际停不掉）。
 * 保留本函数供组件卸载时统一中止在途请求，避免离开页面后仍回写状态、弹出幽灵 toast。
 */
function cancelVerify(row) {
  verifying[row.id]?.controller?.abort()
}

// 页面卸载时清掉所有计时器，避免离开后仍在跑
onBeforeUnmount(() => {
  Object.values(verifying).forEach((v) => {
    clearInterval(v.timer)
    v.controller?.abort()   // 不中止的话，离开页面后仍会回写状态并弹出跨页 toast
  })
})

// 注：原页头「N 个已发布模型连通异常」红点角标已移除（2026-08-22 负责人口径）——
// 每行「验证」列本就显红色「异常」，顶部再报一遍属重复提示。三个页面（MCP / API / 模型）同步移除。

// 行内动作统一封装：busy 态 + 失败 message 提示 + 成功刷新
async function runAction(row, action, fn, successMsg) {
  busy.value[row.id] = action
  try {
    await fn(row.id)
    if (successMsg) ElMessage.success(successMsg)
    await fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    delete busy.value[row.id]
  }
}

/**
 * 上架：填「发布说明（选填）」→ 确认 → 上架生效。
 *
 * 上架即对客户端开放，故给一次弹窗确认（同时可留一句说明便于同事了解这个模型的用途）；
 * 说明不强制——首次接入往往没什么可写的，强制填只会逼人敷衍。
 */
/** 发布：提交审核（不立即生效），审核通过后模型才对客户端开放。 */
async function publish(row) {
  try {
    await ElMessageBox.confirm(
      `提交后进入审核，审核通过后模型「${row.name}」才会对客户端开放调用。确认提交发布？`,
      '发布模型',
      { type: 'warning', confirmButtonText: '提交审核' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'publish', publishModel, '已提交发布审核')
}

/**
 * 停用：同样要过审。审核期间模型对客户端**仍然可用**，审核通过才真正下线——
 * 这一点必须讲清楚，否则管理员会以为点完就停了、故障还在继续。
 */
async function disable(row) {
  try {
    await ElMessageBox.confirm(
      (row.isDefault ? '该模型当前是默认模型，停用生效后将同时取消其默认标记。' : '') +
        `提交后进入审核，**审核通过前该模型对客户端仍然可用**；` +
        `审核通过后客户端将无法再获取模型「${row.name}」的调用配置。确认提交停用？`,
      '停用模型',
      { type: 'warning', confirmButtonText: '提交审核', dangerouslyUseHTMLString: false }
    )
  } catch (e) {
    return
  }
  runAction(row, 'delist', delistModel, '已提交停用审核')
}

/** 撤回待审提交：退回操作前的原状（待审发布→未发布，待审停用→已发布）。 */
async function withdraw(row) {
  const isPublishPending = row.pendingAction === 'PUBLISH'
  try {
    await ElMessageBox.confirm(
      isPublishPending
        ? `撤回后模型「${row.name}」回到未发布状态，可修改后重新提交。确认撤回？`
        : `撤回后模型「${row.name}」保持已发布、继续对客户端提供服务。确认撤回？`,
      '撤回',
      { type: 'warning', confirmButtonText: '撤回' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'withdraw', withdrawModel, '已撤回')
}

async function setDefault(row) {
  try {
    await ElMessageBox.confirm(
      `设为默认后，「${categoryLabel(row.category)}」类别将以「${row.name}」为默认模型（该类别原默认模型自动取消，不影响其它类别）。确认设置？`,
      '设为默认模型',
      { type: 'warning', confirmButtonText: '设为默认' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'setDefault', setDefaultModel, '已设为默认模型')
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `删除后模型「${row.name}」的配置与密钥将不可恢复。确认删除？`,
      '删除模型',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'delete', deleteModel, '已删除')
}
</script>

<template>
  <div class="list-page">
    <PageHeader
      title="模型"
      subtitle="接入 OpenAI 协议第三方大模型：配置鉴权 → 验证连通性 → 上架后开放客户端下载"
    />

    <ListToolbar>
      <el-input
        v-model="keyword"
        placeholder="搜索模型名称或模型标识"
        clearable
        class="lt-search"
        @keyup.enter="fetchList"
        @clear="fetchList"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select
        v-model="categoryFilter"
        placeholder="全部类别"
        clearable
        class="lt-filter"
        @change="fetchList"
      >
        <el-option
          v-for="o in MODEL_CATEGORY_OPTIONS"
          :key="o.value"
          :label="o.label"
          :value="o.value"
        />
      </el-select>
      <el-select
        v-model="statusFilter"
        placeholder="全部状态"
        clearable
        class="lt-filter"
        @change="fetchList"
      >
        <el-option v-for="o in STATUS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="fetchList">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">
          <el-icon><Plus /></el-icon> 接入模型
        </el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        :empty-text="emptyText"
        @retry="fetchList"
      >
        <el-table
          v-loading="loading"
          :data="rows"
          row-key="id"
          :default-sort="{ prop: 'updatedAt', order: 'descending' }"
          @sort-change="onSortChange"
        >
          <!-- 模型名称：主列（2026-09-01 PRD 对齐原型 renderModels）：
               厂商首字 logo 块 + 名称 + 状态标签（未发布/审核中/已发布）+ 默认标签。
               状态并入名称格后不再设独立「状态」列。 -->
          <el-table-column label="模型名称" :min-width="COL.NAME_MIN + 60">
            <template #default="{ row }">
              <div class="md-name-cell">
                <span class="md-logo">{{ providerLogo(row) }}</span>
                <span class="md-name">{{ row.name }}</span>
                <StatusTag :type="stateMeta(row).type">{{ stateMeta(row).label }}</StatusTag>
                <el-tag v-if="row.isDefault" size="small" type="success" effect="plain" class="md-default-tag">
                  默认
                </el-tag>
              </div>
            </template>
          </el-table-column>

          <!-- 类别：标签格式（与能力/状态标签同族视觉，弱化为 info 不与状态争色） -->
          <el-table-column label="类别" :width="COL.TAG">
            <template #default="{ row }">
              <el-tag size="small" type="info" effect="plain">{{ categoryLabel(row.category) }}</el-tag>
            </template>
          </el-table-column>

          <el-table-column label="上下文" :width="COL.COUNT" align="center">
            <template #default="{ row }">
              <span v-if="row.contextWindow">{{ formatWindow(row.contextWindow) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!-- 温度：选填字段，未设＝跟随厂商默认，故空值显占位而非 0（0 是合法取值，不能混淆） -->
          <el-table-column label="温度" :width="COL.COUNT" align="center">
            <template #default="{ row }">
              <span v-if="row.defaultTemperature != null">{{ row.defaultTemperature }}</span>
              <el-tooltip v-else content="未设置，调用时跟随厂商默认值" placement="top" effect="dark">
                <span class="cell-na">—</span>
              </el-tooltip>
            </template>
          </el-table-column>

          <!-- 最近更新时间（2026-09-01 PRD 对齐，取代创建时间列）：列表排序依据
               （默认模型在前，两区内按最近更新时间由近到远，列头可点切换方向）。
               精确到分钟——同一天内改多个模型时需要能分辨先后。 -->
          <el-table-column
            label="最近更新时间"
            prop="updatedAt"
            sortable="custom"
            :sort-orders="['descending', 'ascending']"
            :width="COL.TIME + 24"
          >
            <template #default="{ row }">
              <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
              <span v-else class="cell-na">—</span>
            </template>
          </el-table-column>

          <!--
            验证列（交互设计-模型连通性验证 §3.2）：四态各自呈现。
              未验证 → HealthTag(未检测) + 主色「验证」（这行当前唯一该做的事）
              验证中 → 阶段文案 + 两格离散进度 + 取消（不做百分比动画：后端不回传真实进度，
                       平滑进度条在这里等于撒谎）
              正常   → HealthTag(正常) + 首次响应耗时·相对时间
              异常   → HealthTag(异常) + 中文分类名（4~6 字；详情/建议/原文都在抽屉里）
            整格可点开抽屉；行内**不放「重新验证」**——避免误点触发 40 秒对外请求。
          -->
          <!-- 独立「状态」列已删（2026-09-01 PRD 对齐）：状态标签并入名称格，与原型一致。 -->

          <!--
            验证列（全部收进列表，不再有抽屉/面板/弹窗）：
              结果标签 + 最近验证时间 + 刷新图标（点击即验证，图标自身的旋转表达进行中）。
            悬浮提示承载精确信息——成功：最近验证 + 首响耗时；失败：最近验证 + 错误原因 + 错误码。
            时间用相对值（「27 天前」）：「正常」是关于现在的断言、数据却是关于过去的记录，
            不显示新旧，一个 30 天前的绿标签会被读成「现在没问题」。
          -->
          <el-table-column label="验证" :min-width="230">
            <template #default="{ row }">
              <div class="md-vc">
                <!-- 结果标签：验证中沿用上一次结果（不闪成未知），由图标表达「正在重测」 -->
                <HealthTag :status="verifyHealthStatus(row.verifyStatus)" />

                <!-- 最近验证时间：验证中改为阶段文案，让用户知道正在做什么。
                     2026-09-01 PRD 对齐：相对时间改 MM-DD HH:mm 短格式（原型 verifyTime 形态），
                     悬浮提示仍保留完整时间。 -->
                <span v-if="isVerifying(row)" class="md-vc-time">
                  {{ verifyPhaseText(phaseOf(row)) }}
                </span>
                <span v-else-if="row.verifiedAt" class="md-vc-time">
                  {{ fmtShort(row.verifiedAt) }}
                </span>

                <!-- 刷新图标 = 验证入口。验证中转圈并禁用点击，转完即结果刷新。
                     tooltip 分三态：验证中 / 成功（最近验证+首响）/ 失败（最近验证+错误原因+错误码）。 -->
                <el-tooltip
                  :content="verifyTip(row)"
                  placement="top"
                  effect="dark"
                  popper-class="md-vc-tip"
                >
                  <el-icon
                    class="md-vc-refresh"
                    :class="{ 'is-spinning': isVerifying(row) }"
                    role="button"
                    :aria-label="isVerifying(row) ? '正在验证' : '重新验证连通性'"
                    @click.stop="!isVerifying(row) && startVerify(row)"
                  >
                    <Refresh />
                  </el-icon>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>

          <!--
            操作列配色：对齐「技能」页口径（AdminSkillsUnified.vue 操作列）——
              常规操作（查看/编辑/设为默认）= type="primary"；
              正向状态操作（上架）= type="success"，对应技能页的「上架」；
              负向状态操作（下架）= type="warning"，对应技能页的「下架」；
              危险操作（删除）= type="danger"，置末。
            不做自定义 color 覆盖（技能页同样零覆盖），保证两页视觉语言一致。
            仅保留 .md-ops 的 flex gap 统一控距——Element link 按钮默认 margin 在
            「有/无 tooltip 包裹」时不一致，是原先各行疏密不均的成因。
          -->
          <el-table-column label="操作" :width="opsWidth(5)" fixed="right">
            <template #default="{ row }">
              <div class="tbl-ops">
                <!-- ① 主操作组 -->
                <el-button link type="primary" @click="openView(row)">查看</el-button>
                <!-- 审核中锁编辑（2026-08-21）：待审期间改配置会让「审核对象」与「提交内容」不一致——
                     审核员批的是提交那一刻的版本，改了之后通过的就不是他看过的东西了。
                     与 MCP 页同口径：禁用 + 悬浮说明如何解锁，而不是静默不给点。 -->
                <el-tooltip v-if="isPending(row)" content="审核中不可编辑，如需修改请先撤回提交" placement="top">
                  <span class="tbl-ops-wrap">
                    <el-button link type="primary" disabled>编辑</el-button>
                  </span>
                </el-tooltip>
                <el-button v-else link type="primary" @click="openEdit(row)">编辑</el-button>

                <!-- ② 分隔线：主操作 ↔ 状态/危险操作 -->
                <span class="tbl-ops-sep" aria-hidden="true"></span>

                <!-- ③ 发布 / 停用 / 撤回（同一位置随状态切换）。
                     V98：发布与停用两条都要过审，故此处提交的是「审核」而非直接生效；
                     审核中则换为「撤回」——待审期间不允许再发起另一个动作。 -->
                <el-button
                  v-if="isPending(row)"
                  link
                  type="warning"
                  :loading="busy[row.id] === 'withdraw'"
                  @click="withdraw(row)"
                >
                  撤回
                </el-button>
                <template v-else-if="isOffline(row)">
                  <el-tooltip
                    v-if="!canPublish(row)"
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
                  v-else
                  link
                  type="warning"
                  :loading="busy[row.id] === 'delist'"
                  @click="disable(row)"
                >
                  停用
                </el-button>

                <!-- 设为默认：仅已发布且当前非默认（与「下架」并存） -->
                <el-button
                  v-if="isOnline(row) && !row.isDefault"
                  link
                  type="primary"
               
                  :loading="busy[row.id] === 'setDefault'"
                  @click="setDefault(row)"
                >
                  设为默认
                </el-button>

                <!-- ④ 危险操作置末：仅未发布可删（与「上架」并存） -->
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
      </ListStates>
    </div>

    <ModelConfigEditDialog
      v-model:visible="editorVisible"
      :model="editingModel"
      :readonly="editorReadonly"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>

.cell-na {
  color: var(--c-text-faint);
}
/* 名称格（2026-09-01 PRD 对齐）：厂商首字 logo 块 + 名称 + 状态标签 + 默认标签 */
.md-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.md-logo {
  flex: none;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}
.md-name {
  color: var(--c-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 默认模型：名称后小标签（表格内不用行角标）。
   收敛高度与字号，避免比名称还抢眼、并撑高行距。 */
.md-default-tag {
  margin-left: var(--space-2);
  vertical-align: middle;
}
.md-name {
  vertical-align: middle;
}
/* 发布状态列：版本号 + 旁挂状态 tag（与平台技能同款）。
   版本号定宽 + 等宽数字：让各行的状态标签起始位置对齐成一条竖线，
   不随 v1/v12/— 的字宽变化而参差。 */
.ver-cell {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.ver-num {
  flex: none;
  min-width: 28px;
  font-size: var(--fs-sm);
  color: var(--c-text-strong);
  font-variant-numeric: tabular-nums;
}
.ver-num.dim {
  color: var(--c-text-faint);
}
/* 驳回提示：以弱红文字承载，比实心图标克制——它是「为什么没启用」的补充说明，
   不是需要立即处置的报错，不该在表格里形成红点噪声。 */
.md-reject-hint {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  opacity: 0.85;
  cursor: help;
  white-space: nowrap;
}

/* ===== 验证列：结果 + 时间 + 刷新图标（全部就地，无抽屉/弹窗） ===== */
.md-vc {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 22px;
}
/* 最近验证时间：弱色次级信息，不与结果标签争视觉 */
.md-vc-time {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  white-space: nowrap;
}
/* 刷新图标 = 验证入口。静息弱色（不喧宾夺主），hover 升为主色提示可点，
   验证中持续旋转并禁用指针——图标自身的动效即进度表达，不再另设进度条。 */
.md-vc-refresh {
  flex: none;
  /* 紧跟在结果与时间之后，不用 margin-left:auto 推到列尾——
     推到最右会离它所描述的结果太远，视觉上像是属于隔壁的操作列。 */
  margin-left: 2px;
  color: var(--c-text-faint);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}
.md-vc-refresh:hover {
  color: var(--c-accent);
}
.md-vc-refresh.is-spinning {
  color: var(--c-accent);
  cursor: default;
  animation: md-vc-rotate 1s linear infinite;
}
@keyframes md-vc-rotate {
  to {
    transform: rotate(360deg);
  }
}

/* ===== 操作列：仅统一间距，配色沿用 Element 语义 type（对齐平台技能页） ===== */
/* 用 flex gap 统一控距，取代 el-button 默认外边距（默认值在有/无 tooltip 包裹时不一致，
   正是各行「疏密不均」的成因）。nowrap + 左对齐：各行按钮从同一条竖线起排，
   首个操作（查看）在所有行对齐，扫读时不必左右找。 */
.md-ops {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: nowrap;
  gap: var(--space-3);
}
/* Element link 按钮自带 margin-left，会叠加在 gap 上导致间距忽大忽小——统一清零 */
.md-ops :deep(.el-button + .el-button),
.md-ops :deep(.el-button) {
  margin: 0;
}
.md-op {
  font-size: var(--fs-sm);
  white-space: nowrap;
  /* 行高对齐：避免 loading 态出现时按钮高度跳动带动整行抖动 */
  height: 22px;
  padding: 0;
}
/* 配色一律交给 Element 的语义 type（primary/success/warning/danger），此处零覆盖——
   与「平台技能」页口径一致（那边操作列同样没有任何自定义 color）。
   只统一禁用态：Element 禁用后仍保留主色，看起来像可点，压到 faint 更诚实。 */
.md-ops :deep(.el-button.is-link.is-disabled) {
  color: var(--c-text-faint);
}
/* 主操作 ↔ 状态/危险操作 的分隔线：细、弱、不抢眼，仅作分组暗示 */
.md-op-sep {
  flex: none;
  width: 1px;
  height: 12px;
  background: var(--border-strong);
  opacity: 0.7;
}
/* disabled 按钮需外层包裹才能触发 tooltip（Element 禁用态不派发事件） */
.md-op-wrap,
.md-disabled-wrap {
  display: inline-flex;
  align-items: center;
  cursor: not-allowed;
}
</style>

<!-- tooltip 经 teleport 挂到 body，scoped 选择器命不中，故单开非 scoped 块 -->
<style>
/* 验证提示三行制（最近验证 / 错误原因 / 错误码）：保留换行并放宽宽度 */
.md-vc-tip {
  max-width: 320px;
}
.md-vc-tip .el-popper__content,
.md-vc-tip.el-popper {
  white-space: pre-line;
  line-height: 1.6;
}
</style>
