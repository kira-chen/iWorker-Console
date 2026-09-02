<script setup>
/**
 * API 连接器列表页（2026-09-01 对齐 PRD-20260828《03能力/连接器/API/prd-API.md》）。
 *
 * 【结构】两层聚合——「服务提供系统分组（可折叠节头）→ 其下 API 表格」。
 *   列：API（图标+名称+状态标签，名称下描述）/ 请求方式 / 性质（读·写）/ 引用情况（点击弹引用清单）/
 *       最近更新时间（可排序）/ 验证 / 操作。
 *   - 服务提供系统仅作聚合容器（名称 + 描述 + API 数），不设启用/停用（PRD §二.5）。
 *
 * 【状态机（PRD §二.4）】三态：未发布 / 审核中 / 已发布。
 *   发布 → 提交发布审核（前置：连通性验证通过）；停用 → 提交停用审核（审核中仍可用）；
 *   撤回按待审类型恢复：待审发布 → 未发布，待审停用 → 已发布；
 *   删除：仅未发布态出删除入口，被技能引用也可删（软引用，确认影响后继续删）。
 *
 * 【查询（PRD §一）】搜索名称或描述 + 状态筛选，点【查询】按当前条件刷新（Enter 同）；
 *   搜索/筛选后只展示存在匹配 API 的分组，无筛选时展示全部分组（含空分组）。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listApis,
  deleteApi,
  healthCheckApi,
  publishApi,
  withdrawApi,
  deactivateApi,
  listProviderSystems,
  deleteProviderSystem
} from '@/api/apiConnector'
import { resolveDisplayStatus } from '@/utils/mcpMeta'
import { fmtRelative, fmtTime } from '@/utils/docMeta'
import { explainMcpError } from '@/utils/mcpVerify'
import { writeClassMeta } from '@/utils/marketMeta'
import { COL, opsWidth } from '@/utils/tableLayout'
import StatusTag from '@/components/StatusTag.vue'
import HealthTag from '@/components/HealthTag.vue'
import ApiEditor from '@/components/admin/ApiEditor.vue'
import ProviderSystemEditor from '@/components/admin/ProviderSystemEditor.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { iconIsUrl } from '@/utils/iconDisplay'

const loading = ref(true)
const loadError = ref(false)
const providerSystems = ref([]) // [{ id, name, description, apiCount }]
const apis = ref([]) // 当前条件下的 API（含 providerSystemId/providerSystemName），客户端按分组归并
// 输入区（暂存）与已应用条件分离：点【查询】才生效（PRD §一.2）
const query = reactive({ keyword: '', state: '' })
const applied = reactive({ keyword: '', state: '' })

// 折叠态：默认全部展开；记录被折叠的分组 id 集合
const collapsed = ref(new Set())

const checkBusy = ref(null) // 立即检活中的 API id
const psDelBusy = ref(null) // 删除中的服务提供系统 id
// 行内动作 busy 态：{ [apiId]: 'publish' | 'withdraw' | 'deactivate' | 'delete' }
const busy = ref({})

// API 编辑器（查看/编辑共用，靠 readonly 区分）
const editorVisible = ref(false)
const editingId = ref(null)
const editorReadonly = ref(false)
const editorDefaultPsId = ref(null) // 新建时预选的所属分组

// 服务提供系统编辑器
const psEditorVisible = ref(false)
const psEditingId = ref(null)

// 引用清单弹窗（PRD §二.1：点「N 个技能引用」弹出）
const refsDialog = reactive({ visible: false, apiName: '', skills: [] })

// 状态筛选（PRD §一.1 顺序：未发布 / 审核中 / 已发布）
const STATE_OPTIONS = [
  { value: 'NOT_PUBLISHED', label: '未发布' },
  { value: 'PENDING_REVIEW', label: '审核中' },
  { value: 'PUBLISHED', label: '已发布' }
]
const STATE_META = {
  PUBLISHED: { type: 'success', label: '已发布' },
  PENDING_REVIEW: { type: 'warning', label: '审核中' },
  NOT_PUBLISHED: { type: 'info', label: '未发布' }
}
function stateMeta(row) {
  return STATE_META[row.status] || STATE_META.NOT_PUBLISHED
}

/* ---------------- 状态 → 可执行动作（PRD §二.2） ---------------- */
function canPublish(row) {
  return row.status === 'NOT_PUBLISHED'
}
function canWithdraw(row) {
  return row.status === 'PENDING_REVIEW'
}
function canDeactivate(row) {
  return row.status === 'PUBLISHED'
}
// 删除入口仅未发布态（PRD §二.2 按钮组合）；被引用也可删（软引用，确认弹窗承接影响提示）
function canDelete(row) {
  return row.status === 'NOT_PUBLISHED'
}
// 审核中不可编辑（改了会让审核对象与提交内容不一致）
function isLocked(row) {
  return row.status === 'PENDING_REVIEW'
}
// 发布前置：连通性验证通过（PRD §二.3：未验证或验证失败不允许发布）
function verifyPassed(row) {
  return resolveDisplayStatus(row) === 'HEALTHY'
}

/* ---------------- 枚举展示 ---------------- */
function natureMeta(row) {
  const k = (row.readWrite || 'read').toUpperCase()
  return writeClassMeta(k) || { label: '读', type: 'info' }
}
// 图标：URL/dataURL 按图片渲染，否则按 emoji 字符（全站统一判断，见 utils/iconDisplay）

/**
 * 验证列悬浮文案（三态）：验证中 / 异常（带失败原因与错误码）/ 正常或未探测。
 */
function verifyTip(row) {
  if (checkBusy.value === row.id) {
    return '正在验证连通性…'
  }
  if (!row.lastCheckedAt) {
    return '尚未验证过，点击发起验证'
  }
  const when = `最近验证：${fmtTime(row.lastCheckedAt)}`
  if (resolveDisplayStatus(row) === 'UNHEALTHY') {
    const e = explainMcpError(row.lastCheckError)
    return `${when}\n错误原因：${e.reason || '未知原因'}\n错误码：${e.code}`
  }
  return when
}

// 零分组前置约束：无任何服务提供系统时禁建 API（每个 API 必落真实分组）。加载中不算零分组。
const hasNoGroups = computed(() => !loading.value && providerSystems.value.length === 0)

// 两层数据：每个分组 + 其下 API。搜索/筛选时只展示有命中 API 的分组（PRD §一.2）。
const groups = computed(() => {
  const byPs = {}
  for (const a of apis.value) {
    const k = a.providerSystemId ?? '__none__'
    ;(byPs[k] ||= []).push(a)
  }
  const searching = !!applied.keyword || !!applied.state
  return providerSystems.value
    .map((ps) => ({ ps, apis: byPs[ps.id] || [] }))
    .filter((g) => !searching || g.apis.length > 0)
})

// 分组下 API 数：优先后端聚合 apiCount，缺失回退本页归并数。
function groupApiCount(g) {
  return g.ps.apiCount ?? g.apis.length
}

/* ---------------- 数据加载 ---------------- */
async function fetchAll() {
  loading.value = true
  loadError.value = false
  try {
    const apiParams = {}
    if (applied.keyword) apiParams.keyword = applied.keyword
    if (applied.state) apiParams.state = applied.state
    const [psData, apiData] = await Promise.all([listProviderSystems({}), listApis(apiParams)])
    providerSystems.value = psData?.list || []
    apis.value = apiData?.list || []
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// 点【查询】/ 回车：把输入区条件应用后刷新（PRD §一.2）
function search() {
  applied.keyword = query.keyword.trim()
  applied.state = query.state
  fetchAll()
}

onMounted(fetchAll)

function toggleCollapse(psId) {
  const next = new Set(collapsed.value)
  if (next.has(psId)) next.delete(psId)
  else next.add(psId)
  collapsed.value = next
}
function isCollapsed(psId) {
  return collapsed.value.has(psId)
}

/* ---------------- API 新建/编辑/查看 ---------------- */
function openCreateApi(psId = null) {
  if (hasNoGroups.value) {
    ElMessage.warning('请先创建一个服务提供系统，再在其下新建 API')
    return
  }
  editingId.value = null
  editorReadonly.value = false
  editorDefaultPsId.value = psId
  editorVisible.value = true
}
function openEditApi(row) {
  editingId.value = row.id
  editorReadonly.value = false
  editorDefaultPsId.value = null
  editorVisible.value = true
}
/** 查看：只读打开定义详情——审核锁定期与日常复核走这里，避免误改。 */
function openViewApi(row) {
  editingId.value = row.id
  editorReadonly.value = true
  editorDefaultPsId.value = null
  editorVisible.value = true
}
function onApiSaved() {
  fetchAll()
}

/* ---------------- 引用清单（PRD §二.1） ---------------- */
function openRefs(row) {
  refsDialog.apiName = row.name
  refsDialog.skills = row.referencedBySkills || []
  refsDialog.visible = true
}

/* ---------------- 服务提供系统 新建/编辑/删除 ---------------- */
function openCreatePs() {
  psEditingId.value = null
  psEditorVisible.value = true
}
function openEditPs(ps) {
  psEditingId.value = ps.id
  psEditorVisible.value = true
}
function onPsSaved() {
  fetchAll()
}

async function removePs(g) {
  const ps = g.ps
  if (groupApiCount(g) > 0) return // 按钮已置灰，双保险
  try {
    // PRD §二.5：空系统删除前二次确认
    await ElMessageBox.confirm('删除后该 API 分组不可恢复，确认删除？', '删除服务提供系统', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger'
    })
    psDelBusy.value = ps.id
    await deleteProviderSystem(ps.id)
    ElMessage.success('已删除')
    fetchAll()
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e?.message || '删除失败')
  } finally {
    psDelBusy.value = null
  }
}

/* ---------------- 立即检活（PRD §二.3） ---------------- */
async function checkNow(row) {
  checkBusy.value = row.id
  try {
    const res = await healthCheckApi(row.id)
    if (res?.displayStatus) row.displayStatus = res.displayStatus
    if (res?.checkedAt) row.lastCheckedAt = res.checkedAt
    row.lastCheckError = res?.error || null
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

/* ---------------- 发布 / 撤回 / 停用 / 删除（PRD §二.4） ---------------- */
async function runAction(row, action, fn, successMsg) {
  busy.value[row.id] = action
  try {
    await fn()
    if (successMsg) ElMessage.success(successMsg)
    await fetchAll()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    delete busy.value[row.id]
  }
}

/** 发布：提交发布审核，审核通过后才对客户端开放。 */
async function publish(row) {
  try {
    await ElMessageBox.confirm(
      `将「${row.name}」提交审核，审核通过后才对客户端开放。`,
      '发布 API',
      { type: 'warning', confirmButtonText: '提交审核' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'publish', () => publishApi(row.id), '已提交发布审核')
}

/** 撤回：按待审类型恢复——待审发布 → 未发布；待审停用 → 已发布。 */
async function withdraw(row) {
  const backTo = row.pendingAction === 'DEACTIVATE' ? '已发布' : '未发布'
  try {
    await ElMessageBox.confirm(`撤回后「${row.name}」将回到${backTo}状态。`, '撤回审核', {
      type: 'warning',
      confirmButtonText: '撤回'
    })
  } catch (e) {
    return
  }
  runAction(row, 'withdraw', () => withdrawApi(row.id), '已撤回')
}

/** 停用：提交停用审核（审核通过前仍可用，通过后变未发布）。 */
async function deactivate(row) {
  try {
    await ElMessageBox.confirm(
      `停用后技能仍可执行，但运行效果可能受限或出现报错。确认继续停用「${row.name}」？`,
      '停用 API',
      { type: 'warning', confirmButtonText: '继续停用' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'deactivate', () => deactivateApi(row.id), '已提交停用审核')
}

/** 删除：软引用——被技能引用也可删，确认影响后继续（PRD §二.4）。 */
async function removeApi(row) {
  try {
    await ElMessageBox.confirm(
      `删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「${row.name}」？`,
      '删除 API',
      { type: 'warning', confirmButtonText: '继续删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch (e) {
    return
  }
  busy.value[row.id] = 'delete'
  try {
    await deleteApi(row.id)
    ElMessage.success('已删除')
    await fetchAll()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    delete busy.value[row.id]
  }
}
</script>

<template>
  <div class="list-page">
    <!-- toolbar：搜索 / 状态筛选 / 查询 ｜ 新建服务提供系统（PRD §一） -->
    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索 API 名称或描述"
        clearable
        class="lt-search"
        @keyup.enter="search"
        @clear="search"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.state" placeholder="全部状态" clearable class="lt-filter">
        <el-option v-for="o in STATE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button @click="search">查询</el-button>
      <template #right>
        <!-- 顶栏不设「新建 API」：API 必属某服务提供系统，统一走节头「在本系统下新建 API」入口 -->
        <el-button type="primary" class="lt-create" @click="openCreatePs">
          <el-icon><Plus /></el-icon> 新建服务提供系统
        </el-button>
      </template>
    </ListToolbar>

    <div v-loading="loading" class="conn-list">
      <el-empty v-if="!loading && loadError" :image-size="96" description="加载失败">
        <el-button @click="fetchAll">重试</el-button>
      </el-empty>
      <!-- 零分组空态：明确引导先建分组才能建 API（PRD §四） -->
      <el-empty
        v-else-if="!loading && hasNoGroups"
        :image-size="96"
        description="还没有服务提供系统 · 请先创建服务提供系统分组，再在其下新建 API"
      >
        <el-button type="primary" @click="openCreatePs">
          <el-icon><Plus /></el-icon> 新建服务提供系统
        </el-button>
      </el-empty>
      <!-- 搜索/筛选无命中（PRD §四：保留当前条件） -->
      <el-empty
        v-else-if="!loading && !groups.length"
        :image-size="96"
        description="没有匹配的 API"
      />

      <!-- 两层：服务提供系统分组 → 其下 API 表格 -->
      <div v-for="g in groups" :key="g.ps.id" class="aps-group">
        <!-- 分组节头（系统仅作聚合容器，不含启用/停用） -->
        <div class="aps-group-head">
          <el-button link class="aps-collapse-btn" @click="toggleCollapse(g.ps.id)">
            <el-icon><component :is="isCollapsed(g.ps.id) ? 'ArrowRight' : 'ArrowDown'" /></el-icon>
          </el-button>
          <span class="aps-group-name">{{ g.ps.name }}</span>
          <span v-if="g.ps.description" class="aps-group-desc">{{ g.ps.description }}</span>
          <span class="aps-group-count">{{ groupApiCount(g) }} 个 API</span>
          <span class="aps-group-sp"></span>
          <div class="aps-group-actions">
            <el-button link type="primary" @click="openCreateApi(g.ps.id)">
              <el-icon><Plus /></el-icon> 在本系统下新建 API
            </el-button>
            <el-button link type="primary" @click="openEditPs(g.ps)">编辑系统</el-button>
            <el-tooltip
              placement="top"
              :disabled="groupApiCount(g) === 0"
              :content="`该系统下有 ${groupApiCount(g)} 个 API，需先迁移或删除后才能删除系统`"
            >
              <span class="aps-del-wrap">
                <el-button
                  link
                  type="danger"
                  :loading="psDelBusy === g.ps.id"
                  :disabled="groupApiCount(g) > 0"
                  @click="removePs(g)"
                >删除系统</el-button>
              </span>
            </el-tooltip>
          </div>
        </div>

        <!-- 分组内 API 表格（列结构对齐 PRD §二.1） -->
        <div v-if="!isCollapsed(g.ps.id)" class="aps-group-body">
          <div v-if="!g.apis.length" class="aps-group-empty">
            该系统下暂无 API · 点「在本系统下新建 API」添加
          </div>
          <el-table
            v-else
            :data="g.apis"
            empty-text="该系统下暂无 API"
            row-key="id"
            :default-sort="{ prop: 'updatedAt', order: 'descending' }"
          >
            <!-- API：图标 + 名称 + 状态标签，名称下方描述（缩略，悬停看全文） -->
            <el-table-column label="API" :min-width="220">
              <template #default="{ row }">
                <div class="api-cell">
                  <span class="api-cell-icon" :class="{ 'is-empty': !row.icon }">
                    <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="api-cell-icon-img" />
                    <span v-else-if="row.icon">{{ row.icon }}</span>
                    <span v-else>—</span>
                  </span>
                  <div class="api-cell-text">
                    <div class="api-cell-name-line">
                      <span class="api-cell-name">{{ row.name }}</span>
                      <StatusTag :type="stateMeta(row).type">{{ stateMeta(row).label }}</StatusTag>
                    </div>
                    <el-tooltip
                      :content="row.description"
                      :disabled="!row.description"
                      placement="top"
                    >
                      <div class="api-cell-desc">{{ row.description || '—' }}</div>
                    </el-tooltip>
                  </div>
                </div>
              </template>
            </el-table-column>

            <!-- 请求方式：GET/POST/PUT/DELETE/PATCH -->
            <el-table-column label="请求方式" :width="COL.TAG - 4">
              <template #default="{ row }">
                <el-tag size="small" type="info" effect="plain">{{ row.method || '—' }}</el-tag>
              </template>
            </el-table-column>

            <!-- 性质：读/写 -->
            <el-table-column label="性质" :width="COL.COUNT" align="center">
              <template #default="{ row }">
                <StatusTag :type="natureMeta(row).type">{{ natureMeta(row).label }}</StatusTag>
              </template>
            </el-table-column>

            <!-- 引用情况：N 个技能引用（点击弹引用清单）/ 暂无引用 -->
            <el-table-column label="引用情况" :min-width="110">
              <template #default="{ row }">
                <el-button
                  v-if="row.referencedBySkillCount > 0"
                  link
                  type="primary"
                  @click="openRefs(row)"
                >{{ row.referencedBySkillCount }} 个技能引用</el-button>
                <span v-else class="cell-na">暂无引用</span>
              </template>
            </el-table-column>

            <!-- 最近更新时间：精确到分钟，支持点击排序 -->
            <el-table-column label="最近更新时间" prop="updatedAt" sortable :width="COL.TIME + 24">
              <template #default="{ row }">
                <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
                <span v-else class="cell-na">—</span>
              </template>
            </el-table-column>

            <!-- 验证：结果标签 + 最近验证时间 + 重新验证入口，悬浮承载排障信息 -->
            <el-table-column label="验证" :min-width="150">
              <template #default="{ row }">
                <div class="mc-vc">
                  <HealthTag :status="resolveDisplayStatus(row)" />
                  <span v-if="checkBusy === row.id" class="mc-vc-time">正在验证…</span>
                  <span v-else-if="row.lastCheckedAt" class="mc-vc-time">
                    {{ fmtRelative(row.lastCheckedAt) }}
                  </span>
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

            <!-- 操作：查看/编辑/发布·撤回·停用/删除（PRD §二.2 按状态组合） -->
            <el-table-column label="操作" :width="opsWidth(4)" fixed="right">
              <template #default="{ row }">
                <div class="tbl-ops">
                  <!-- ① 查看（只读）/ 编辑 -->
                  <el-button link type="primary" @click="openViewApi(row)">查看</el-button>
                  <el-tooltip v-if="isLocked(row)" content="审核中不可编辑，如需修改请先撤回" placement="top">
                    <span class="tbl-ops-wrap">
                      <el-button link type="primary" disabled>编辑</el-button>
                    </span>
                  </el-tooltip>
                  <el-button v-else link type="primary" @click="openEditApi(row)">编辑</el-button>

                  <span class="tbl-ops-sep" aria-hidden="true"></span>

                  <!-- ② 发布 / 撤回 / 停用（同一位置随状态切换，互斥 if/else-if 链） -->
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
                      content="连通性验证通过后才可提交发布"
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
                    v-else-if="canDeactivate(row)"
                    link
                    type="warning"
                    :loading="busy[row.id] === 'deactivate'"
                    @click="deactivate(row)"
                  >
                    停用
                  </el-button>

                  <!-- ③ 危险操作置末：删除（软引用，被引用也可删） -->
                  <el-button
                    v-if="canDelete(row)"
                    link
                    type="danger"
                    :loading="busy[row.id] === 'delete'"
                    @click="removeApi(row)"
                  >
                    删除
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </div>

    <ApiEditor
      v-model:visible="editorVisible"
      :api-id="editingId"
      :readonly="editorReadonly"
      :default-provider-system-id="editorDefaultPsId"
      @saved="onApiSaved"
    />

    <ProviderSystemEditor
      v-model:visible="psEditorVisible"
      :system-id="psEditingId"
      @saved="onPsSaved"
    />

    <!-- 引用清单弹窗（PRD §二.1） -->
    <el-dialog v-model="refsDialog.visible" :title="`「${refsDialog.apiName}」的技能引用`" width="420px">
      <div v-if="refsDialog.skills.length" class="refs-list">
        <div v-for="s in refsDialog.skills" :key="s.skillId" class="refs-item">
          <el-tag type="info" size="small">{{ s.skillName }}</el-tag>
        </div>
      </div>
      <div v-else class="cell-na">暂无引用</div>
      <template #footer>
        <el-button @click="refsDialog.visible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 两层结构：分组节 + 其下 API 表格。复用 connector.css 的 conn-* 令牌，仅补分组节 + 表格内小元素样式。 */
.aps-group {
  margin-bottom: var(--space-4);
}
.aps-group-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-1);
  border-bottom: 1px solid var(--border-base);
}
.aps-collapse-btn {
  padding: 0;
  color: var(--c-text-muted);
}
.aps-group-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.aps-group-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.aps-group-count {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
.aps-group-sp {
  flex: 1;
}
.aps-group-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}
.aps-del-wrap {
  display: inline-flex;
}
.aps-group-body {
  padding-top: var(--space-2);
}
.aps-group-empty {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  padding: var(--space-3) var(--space-2);
}

/* ===== API 主列：图标 + 名称/状态 + 描述两行 ===== */
.api-cell {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}
.api-cell-icon {
  flex: none;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  overflow: hidden;
}
.api-cell-icon.is-empty {
  color: var(--c-text-faint);
}
.api-cell-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.api-cell-text {
  min-width: 0;
}
.api-cell-name-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.api-cell-name {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.api-cell-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

/* ===== 引用清单弹窗 ===== */
.refs-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* ===== 验证列（外观与 MCP 页 .mc-vc 同构） ===== */
.mc-vc {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 22px;
}
.mc-vc-time {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  white-space: nowrap;
}
.mc-vc-refresh {
  flex: none;
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
</style>

<!-- tooltip 经 teleport 挂到 body，scoped 选择器命不中，故单开非 scoped 块（与 MCP 页同） -->
<style>
.mc-vc-tip {
  max-width: 320px;
}
.mc-vc-tip .el-popper__content,
.mc-vc-tip.el-popper {
  white-space: pre-line;
  line-height: 1.6;
}
</style>
