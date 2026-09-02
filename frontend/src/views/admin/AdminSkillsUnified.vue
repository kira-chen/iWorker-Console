<script setup>
/**
 * 「技能」页（三类合一）——2026-09-01 PRD 对齐改造（对齐交互原型 v2 最终覆写态 renderSkills/skillActions）。
 *
 * 【本轮口径】
 * - 类型词汇表：POSITION 岗位私有 / PLATFORM 市场技能 / SYSTEM_DEFAULT 通用技能（api/unifiedSkill.js 单一真相）。
 * - 状态三态：未发布 / 审核中 / 已发布——三类技能统一由 publications 经 derivePlatformState 收拢
 *   （岗位私有已接入同构审核状态机，旧「发布/撤回草稿」本体开关废弃）。
 * - 列结构：技能名(图标+名称+状态标签) | 技能描述 | 技能类型 | 技能分类 | 工具数 | 引用情况 |
 *   最新版本 | 最近更新时间(排序，默认由近到远) | 操作。
 * - 操作列三类一致：固定【查看】【编辑】；未发布 +【发布】(就绪门)【删除】；审核中 +【撤回】；
 *   已发布 +【停用】【版本管理】。发布就绪门与编辑页共用 skillPublishReadiness（api/unifiedSkill.js）。
 * - 查看/编辑同标签路由跳转（整页编辑器【← 返回】回列表）；「查看」= 编辑路由 + ?view=1 只读。
 * - 数据层：demo 默认走 unifiedSkillMock（分流在 api 层，本页无感）。
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus } from '@element-plus/icons-vue'
import {
  listUnifiedSkills,
  apiFor,
  typeLabel,
  createSkillOfType,
  skillPublishReadiness,
  publishDisabledTitle,
  PUBLISH_READY_TIP,
  SKILL_TYPE,
  SKILL_TYPE_LABEL,
  SKILL_TYPE_OPTIONS,
  SKILL_EDIT_ROUTE
} from '@/api/unifiedSkill'
import { getSkill } from '@/api/position'
import { EFFECT_TEST_ENABLED } from '@/utils/featureFlags'
// 技能分类选项统一同源 fieldDict（固定 8 类，2026-09-01 疑点8 处置），不再调 skillCategory.js 后端接口。
import { listFieldDict } from '@/api/fieldDict'
import StatusTag from '@/components/StatusTag.vue'
import PageHeader from '@/components/PageHeader.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import SkillCreateDialog from '@/components/skill/SkillCreateDialog.vue'
import VersionDrawer from '@/components/admin/VersionDrawer.vue'
import { derivePlatformState, stateActions } from '@/utils/skillPublication'
import { COL, opsWidth, NA } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListPagination from '@/components/admin/ListPagination.vue'
import { iconIsUrl } from '@/utils/iconDisplay'
// 效果测试台异步加载：仅在点开时才拉（当前 flag=false，入口隐藏）。
const EffectTestStage = defineAsyncComponent(() => import('@/components/test/EffectTestStage.vue'))

const router = useRouter()
const route = useRoute()

// referenced 存 UI 口径的 '' | 'yes' | 'no'，下发前转成 mock/后端要的布尔（见 params）。
const query = reactive({ type: '', keyword: '', status: '', categoryId: '', referenced: '' })

const list = useAdminList(listUnifiedSkills, {
  params: () => {
    const { referenced, ...rest } = query
    // 引用筛选只对岗位私有有意义（疑点7 保留 + ?referenced 深链），仅 type=POSITION 时下发。
    const onlyPosition = rest.type === SKILL_TYPE.POSITION
    return {
      ...rest,
      referenced: onlyPosition && referenced ? referenced === 'yes' : undefined
    }
  }
})
const { rows, total, loading, loadError, page, pageSize, isEmpty } = list

const categoryOptions = ref([])
const actionBusy = ref(null) // 行级互斥：停用/删除/撤回共用（一次只允许一行在途）

const fetchList = list.reload
const reload = list.search

// 引用状态筛选只对岗位私有有意义（只有它进岗位引用表）。
const referencedFilterEnabled = computed(() => query.type === SKILL_TYPE.POSITION)

// 深链在 onMounted 里预置 query.type 会异步触发本 watch，导致首屏重复请求一次；一次性抑制标记跳过。
let suppressTypeWatchOnce = false

watch(
  () => query.type,
  () => {
    if (!referencedFilterEnabled.value) query.referenced = ''
    if (suppressTypeWatchOnce) {
      suppressTypeWatchOnce = false
      return
    }
    reload()
  }
)

/* ============================ 行派生 ============================ */

/**
 * 三类技能统一三态（未发布/审核中/已发布）：由 publications 经 derivePlatformState 收拢。
 * 岗位私有已接入同构状态机（mock 层为其派生 publications）；无 publications 的存量行按本体 status 兜底。
 */
const PUB_STATE_TO_DISPLAY = {
  PUBLISHED: 'PUBLISHED',
  REVIEWING: 'REVIEWING',
  PUBLISHED_REVIEWING: 'REVIEWING',
  DELISTED_REVIEWING: 'REVIEWING',
  PUBLISHED_DELISTING: 'REVIEWING', // V100 停用审核中 → 审核中
  INITIAL: 'UNPUBLISHED',
  REJECTED: 'UNPUBLISHED',
  DELISTED: 'UNPUBLISHED'
}
const DISPLAY_STATE_LABEL = {
  PUBLISHED: '已发布',
  REVIEWING: '审核中',
  UNPUBLISHED: '未发布'
}
const DISPLAY_STATE_TAG = {
  PUBLISHED: 'success',
  REVIEWING: 'warning',
  UNPUBLISHED: 'info'
}

function displayState(row) {
  if (Array.isArray(row.publications)) {
    const raw = derivePlatformState(row.publications)
    const mapped = PUB_STATE_TO_DISPLAY[raw]
    if (!mapped) {
      console.warn(`[技能页] 未映射的发布态 "${raw}"，暂按「未发布」展示，请补 PUB_STATE_TO_DISPLAY`)
      return 'UNPUBLISHED'
    }
    return mapped
  }
  // 兜底：无 publications 的行按本体开关（不该出现在 mock 数据中）
  return row.status === 'published' ? 'PUBLISHED' : 'UNPUBLISHED'
}

function displayStateLabel(row) {
  return DISPLAY_STATE_LABEL[displayState(row)]
}

function displayStateTag(row) {
  return DISPLAY_STATE_TAG[displayState(row)]
}

/** 「最新版本」列：当前已发布的最新版本号（新版在审时仍显线上那一版）。 */
function latestVersion(row) {
  return row.versionLabel || ''
}

/* ---------- 引用情况（原型 skillReferenceNames 口径） ---------- */

/** 引用主体：岗位私有被岗位引用，市场技能被专家引用；通用技能不参与引用。 */
function refSubject(row) {
  return row.type === SKILL_TYPE.POSITION ? '岗位' : '专家'
}
function refCountOf(row) {
  if (row.refCount != null) return row.refCount
  // 兼容旧 VO 字段
  return row.type === SKILL_TYPE.POSITION
    ? row.referencedByPositionCount || 0
    : row.referencedByExpertCount || 0
}
function refNamesOf(row) {
  return Array.isArray(row.refNames) ? row.refNames : []
}

// 引用清单弹窗：标题「被岗位引用 / 被专家引用」，正文名称顿号连接。
const refsVisible = ref(false)
const refsRow = ref(null)
const refsTitle = computed(() => (refsRow.value ? `被${refSubject(refsRow.value)}引用` : ''))
const refsText = computed(() => refNamesOf(refsRow.value || {}).join('、'))
function openRefs(row) {
  refsRow.value = row
  refsVisible.value = true
}

/* ---------- 发布就绪门（与编辑页共用 skillPublishReadiness） ---------- */

function readinessOf(row) {
  return skillPublishReadiness(row)
}
function publishTitle(row) {
  const r = readinessOf(row)
  return r.ready ? PUBLISH_READY_TIP : publishDisabledTitle(r)
}

/* ============================ 行操作（对齐原型 skillActions 最终覆写态） ============================ */

const isReviewing = (row) => displayState(row) === 'REVIEWING'
const isPublished = (row) => displayState(row) === 'PUBLISHED'
const isUnpublished = (row) => displayState(row) === 'UNPUBLISHED'

function editRouteOf(row) {
  const name = SKILL_EDIT_ROUTE[row.type]
  if (!name) {
    ElMessage.error(`未知技能类型，无法定位编辑器: ${row.type}`)
    return null
  }
  return name
}

/** 编辑：同标签路由跳转（整页编辑器覆盖主内容区，【← 返回】回列表刷新）。 */
function openEdit(row) {
  if (isReviewing(row)) return // 审核中不可编辑（按钮已置灰，此处兜底）
  const name = editRouteOf(row)
  if (name) router.push({ name, params: { id: row.id } })
}

/** 查看：只读入口（编辑页已支持只读态；?view=1 由 AdminSkillEditPage 识别为只读查看）。 */
function openView(row) {
  const name = editRouteOf(row)
  if (name) router.push({ name, params: { id: row.id }, query: { view: '1' } })
}

/** 引用拦截弹窗（停用/删除共用）：正文携引用清单，仅【知道了】。 */
function alertRefBlocked(row, action, title) {
  const names = refNamesOf(row)
  const listText = names.length ? `（${names.join('、')}）` : ''
  return ElMessageBox.alert(
    `该技能被 ${refCountOf(row)} 个${refSubject(row)}引用${listText}，需先解除引用后再${action}。`,
    title,
    { confirmButtonText: '知道了', type: 'warning' }
  ).catch(() => {})
}

/** 停用（V100 双门审核）：被引用拦截；无引用 → 提交停用审核（审核通过前客户端仍可使用）。 */
async function stopSkill(row) {
  if (actionBusy.value != null) return
  if (refCountOf(row) > 0) {
    alertRefBlocked(row, '停用', '停用技能')
    return
  }
  try {
    await ElMessageBox.confirm(
      `停用「${row.name}」需提交停用审核。审核通过前客户端仍可使用。`,
      '停用技能',
      { type: 'warning', confirmButtonText: '提交停用审核' }
    )
  } catch {
    return
  }
  actionBusy.value = row.id
  try {
    await apiFor(row).delist(row.id)
    ElMessage.success('已提交停用审核')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    actionBusy.value = null
  }
}

/** 删除：被引用拦截；无引用 → 二次确认后删除。 */
async function remove(row) {
  if (actionBusy.value != null) return
  if (refCountOf(row) > 0) {
    alertRefBlocked(row, '删除', '删除技能')
    return
  }
  try {
    await ElMessageBox.confirm(`删除后「${row.name}」将不可用，确认删除？`, '删除技能', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  actionBusy.value = row.id
  try {
    await apiFor(row).remove(row.id)
    ElMessage.success('技能已删除')
    fetchList()
  } catch (e) {
    // 引用保护等较长指引用 alert 而非 toast（toast 会自动消失，用户来不及看清）。
    ElMessageBox.alert(e?.message || '该技能仍被引用，请先解除引用后再删除', '无法删除', {
      confirmButtonText: '知道了',
      type: 'warning'
    }).catch(() => {})
  } finally {
    actionBusy.value = null
  }
}

/** 撤回在审提交（发布/停用同入口）：清 pending*，按 version 空/非空恢复 未发布/已发布。 */
async function withdraw(row) {
  if (actionBusy.value != null) return
  try {
    await ElMessageBox.confirm('撤回本次提交后将回到修改前状态。确认撤回？', '撤回提交', {
      type: 'warning',
      confirmButtonText: '确认撤回'
    })
  } catch {
    return
  }
  actionBusy.value = row.id
  try {
    await apiFor(row).withdrawPublish(row.id)
    ElMessage.success('已撤回')
    fetchList()
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  } finally {
    actionBusy.value = null
  }
}

/* ---------- 效果测试台（feature flag 关闭中，保留链路） ---------- */
const testVisible = ref(false)
const testLoading = ref(false)
const testSkill = ref(null)
const testSkillId = ref(null)
const testPositionId = ref(null)
const testDisabledReason = ref('')
let testReqId = 0

async function openTest(row) {
  const reqId = ++testReqId
  testSkillId.value = row.id
  testPositionId.value = null
  testDisabledReason.value = ''
  testSkill.value = { name: row.name }
  testVisible.value = true
  testLoading.value = true
  try {
    const detail = await getSkill(row.id)
    if (reqId !== testReqId || !testVisible.value) return
    testSkill.value = detail || { name: row.name }
    testPositionId.value = detail?.positionId ?? null
    if (testPositionId.value == null) {
      testDisabledReason.value = '未被引用的技能不在任何岗位下运行，暂不支持效果测试。'
    }
  } catch {
    if (reqId !== testReqId) return
    testSkill.value = { name: row.name }
  } finally {
    if (reqId === testReqId) testLoading.value = false
  }
}
function closeTest() {
  testReqId++
  testVisible.value = false
  testSkill.value = null
  testSkillId.value = null
  testPositionId.value = null
  testDisabledReason.value = ''
  testLoading.value = false
}

/* ============================ 版本管理（三类技能同构，含【发布】入口） ============================ */

const verMgrVisible = ref(false)
const verMgrSkill = ref(null)

/** 【发布】与【版本管理】共用入口：打开统一版本管理抽屉（原型 skill-version）。 */
function openVersionManage(row) {
  verMgrSkill.value = row
  verMgrVisible.value = true
}
function openPublish(row) {
  if (!readinessOf(row).ready) return // 按钮已置灰，此处兜底
  openVersionManage(row)
}

/**
 * 技能版本适配器（喂给统一 VersionDrawer）。2026-09-01：三类技能同构（apiFor 分流），
 * 顶部状态标签收拢为三态；启用历史版本互斥（exclusiveActive）；最后启用版本禁「禁用」。
 */
const versionAdapter = computed(() => {
  const row = verMgrSkill.value
  if (!row) return null
  const api = apiFor(row)
  const sid = row.id ?? row.skillId
  return {
    title: '版本管理',
    entityLabel: '技能',
    entityKey: '技能名称',
    name: row.name,
    id: sid,
    deriveView: () => {
      const st = derivePlatformState(row.publications || [])
      const display = PUB_STATE_TO_DISPLAY[st] || 'UNPUBLISHED'
      return {
        state: st,
        label: DISPLAY_STATE_LABEL[display],
        tagType: DISPLAY_STATE_TAG[display],
        actions: stateActions(st)
      }
    },
    nextVersionLabel: (id) => api.nextVersionLabel(id),
    publish: (id, payload) => api.publish(id, payload),
    withdraw: (id) => api.withdrawPublish(id),
    listVersions: (id) => api.listSnapshots(id, 'USER_END'),
    mapRow: (sn) => ({ ...sn, verLabel: sn.versionLabel }),
    delist: (r) => api.delistSnapshot(sid, r.version, 'USER_END'),
    relist: (r) => api.relistSnapshot(sid, r.version, 'USER_END'),
    delistTerm: '禁用',
    relistTerm: '启用',
    activeLabel: '已启用',
    guardLastActive: true,
    lastActiveTip: '当前版本是该技能最后一个启用版本。如需停止对外提供，请先整体下架技能',
    exclusiveActive: true, // 启用某历史版本 → 其余启用版本自动禁用（原型 toggleHistory 口径）
    submitGate: () =>
      row.type === SKILL_TYPE.PLATFORM && !(row.displayCategoryId ?? null)
        ? '该技能还未选择「技能分类」，按规则不可提交发布。请到技能编辑页选择分类并保存后再来发布。'
        : '',
    // 疑点10：撤回确认保留现状分场景文案
    withdrawText: (state) =>
      state === 'REVIEWING'
        ? '撤回发布申请后将回到未发布态。确认撤回？'
        : '撤回在审新版后，改动回到「未提交」状态，线上版本不受影响。确认撤回？'
  }
})

async function onVersionDone() {
  await fetchList()
  const id = verMgrSkill.value?.id
  if (id) verMgrSkill.value = rows.value.find((r) => r.id === id) || verMgrSkill.value
}

/* ============================ 新建（类型 + 每包独立分类，2026-09-01） ============================ */

const createVisible = ref(false)

/** 类型选项：label / source（zip 导入前缀）打包给 SkillCreateDialog；createFn 统一走 createSkillOfType。 */
const CREATE_SOURCE = {
  [SKILL_TYPE.SYSTEM_DEFAULT]: 'system',
  [SKILL_TYPE.POSITION]: 'fde',
  [SKILL_TYPE.PLATFORM]: 'platform'
}
const createTypeOptions = computed(() =>
  SKILL_TYPE_OPTIONS.map((t) => ({
    value: t.value,
    label: t.label,
    source: CREATE_SOURCE[t.value],
    createFn: (payload) => createSkillOfType(t.value, payload)
  }))
)

function openCreate() {
  createVisible.value = true
}

/** 手动创建成功：toast + 同标签进入编辑页。 */
function onSkillCreated(payload) {
  const id = payload?.skillId || payload?.id
  const type = payload?.skillType
  createVisible.value = false
  ElMessage.success('技能已创建，已进入编辑页')
  if (id && SKILL_EDIT_ROUTE[type]) {
    router.push({ name: SKILL_EDIT_ROUTE[type], params: { id } })
    return
  }
  fetchList()
}

/** zip 导入完成统一返回列表（不自动进编辑页）。 */
function onSkillsCreatedBatch(payload) {
  createVisible.value = false
  const n = payload?.skillIds?.length
  if (n) ElMessage.success(`已导入 ${n} 个技能包，请从列表点击编辑继续配置`)
  fetchList()
}

/* ============================ 生命周期 ============================ */

// 从整页编辑器回到本页时自动刷新（同标签路由回列表会重挂载本页，此双监听兜「新标签/切应用」场景）。
let wasHidden = false
function onVisibility() {
  if (document.hidden) {
    wasHidden = true
  } else if (wasHidden) {
    wasHidden = false
    fetchList()
  }
}
function onWindowFocus() {
  if (wasHidden) {
    wasHidden = false
    fetchList()
  }
}

onMounted(async () => {
  // 深链 ?referenced=no|yes：自动落到「岗位私有 + 引用状态」视图（疑点7 保留）。
  const q = route.query?.referenced
  if (q === 'no' || q === 'yes') {
    suppressTypeWatchOnce = true
    query.type = SKILL_TYPE.POSITION
    query.referenced = q
  }
  fetchList()
  try {
    const dict = await listFieldDict()
    categoryOptions.value = (dict?.skillCategory || []).map((c) => ({ id: c.name, name: c.name }))
  } catch {
    categoryOptions.value = []
  }
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="list-page">
    <PageHeader title="技能" subtitle="平台全部技能 —— 通用技能 / 岗位私有 / 市场技能 统一管理" />

    <ListToolbar>
      <el-input
        v-model="query.keyword"
        placeholder="搜索技能名称或描述"
        clearable
        class="lt-search"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.type" placeholder="全部技能类型" clearable class="lt-filter">
        <el-option v-for="t in SKILL_TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <!-- 分类筛选：固定 8 类（fieldDict 同源），对全部技能类型开放 -->
      <el-select
        v-model="query.categoryId"
        placeholder="全部技能分类"
        clearable
        class="lt-filter"
        @change="reload"
      >
        <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <!-- 状态筛选：对外三态（未发布 / 审核中 / 已发布） -->
      <el-select v-model="query.status" placeholder="全部状态" clearable class="lt-filter" @change="reload">
        <el-option label="未发布" value="UNPUBLISHED" />
        <el-option label="审核中" value="REVIEWING" />
        <el-option label="已发布" value="PUBLISHED" />
      </el-select>
      <!-- 引用状态：仅岗位私有可用（疑点7 保留）；其余类型禁用而非隐藏，避免布局抖动 -->
      <el-tooltip :disabled="referencedFilterEnabled" content="引用状态仅岗位私有技能适用" placement="top">
        <span>
          <el-select
            v-model="query.referenced"
            placeholder="引用状态"
            clearable
            class="lt-filter"
            :disabled="!referencedFilterEnabled"
            @change="reload"
          >
            <el-option label="全部引用状态" value="" />
            <el-option label="已被引用" value="yes" />
            <el-option label="未被引用" value="no" />
          </el-select>
        </span>
      </el-tooltip>
      <el-button @click="reload">查询</el-button>
      <template #right>
        <el-button type="primary" class="lt-create" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建技能
        </el-button>
      </template>
    </ListToolbar>

    <div class="table-wrap">
      <ListStates
        :loading="loading"
        :error="loadError"
        :empty="isEmpty"
        empty-text="没有符合条件的技能"
        @retry="fetchList"
      >
        <el-table
          v-loading="loading"
          :data="rows"
          row-key="id"
          :default-sort="{ prop: 'updatedAt', order: 'descending' }"
        >
          <!-- 技能名：图标 + 名称（超长换行完整展示）+ 三态状态标签 -->
          <el-table-column label="技能名" :min-width="230">
            <template #default="{ row }">
              <div class="sk-title">
                <span v-if="row.icon" class="sk-icon">
                  <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="sk-icon-img" />
                  <span v-else>{{ row.icon }}</span>
                </span>
                <span class="sk-name">{{ row.name }}</span>
                <StatusTag :type="displayStateTag(row)">{{ displayStateLabel(row) }}</StatusTag>
              </div>
            </template>
          </el-table-column>
          <!-- 技能描述：独立列，单行缩略悬停全文；无描述占位符 -->
          <el-table-column label="技能描述" :min-width="205" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.description">{{ row.description }}</span>
              <span v-else class="cell-na">{{ NA }}</span>
            </template>
          </el-table-column>
          <!-- 技能类型：普通文本（原型 skill-type-text，不再用徽标） -->
          <el-table-column label="技能类型" :width="96">
            <template #default="{ row }">
              <span class="sk-type-text">{{ SKILL_TYPE_LABEL[row.type] }}</span>
            </template>
          </el-table-column>
          <el-table-column label="技能分类" :width="112">
            <template #default="{ row }">
              <span v-if="row.displayCategoryName">{{ row.displayCategoryName }}</span>
              <span v-else class="cell-na">{{ NA }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="toolCount" label="工具数" :width="COL.COUNT" align="center" />
          <!-- 引用情况：可点击弹引用清单弹窗；通用技能不参与引用（占位符） -->
          <el-table-column label="引用情况" :width="140">
            <template #default="{ row }">
              <el-button
                v-if="refCountOf(row) > 0"
                link
                type="primary"
                class="sk-ref-btn"
                :title="refNamesOf(row).join('、')"
                @click="openRefs(row)"
              >
                {{ refCountOf(row) }} 个{{ refSubject(row) }}引用
              </el-button>
              <span v-else-if="row.type === SKILL_TYPE.SYSTEM_DEFAULT" class="cell-na">{{ NA }}</span>
              <span v-else class="cell-na">暂无引用</span>
            </template>
          </el-table-column>
          <el-table-column label="最新版本" :width="100">
            <template #default="{ row }">
              <span v-if="latestVersion(row)" class="ver-num">{{ latestVersion(row) }}</span>
              <span v-else class="cell-na">{{ NA }}</span>
            </template>
          </el-table-column>
          <!-- 最近更新时间：排序列，默认由近到远（保存/提交审核后按新时间重排） -->
          <el-table-column prop="updatedAt" label="最近更新时间" :width="COL.TIME" sortable>
            <template #default="{ row }">
              <span v-if="row.updatedAt">{{ row.updatedAt }}</span>
              <span v-else class="cell-na">{{ NA }}</span>
            </template>
          </el-table-column>
          <!-- 操作：三类技能一致（原型 skillActions 最终覆写态） -->
          <el-table-column label="操作" :width="opsWidth(4)" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openView(row)">查看</el-button>
              <el-button
                link
                type="primary"
                :disabled="isReviewing(row)"
                :title="isReviewing(row) ? '审核中不可编辑' : ''"
                @click="openEdit(row)"
              >
                编辑
              </el-button>
              <!-- 效果测试：仅岗位私有；入口由 feature flag 统一门控（当前隐藏） -->
              <el-button
                v-if="EFFECT_TEST_ENABLED && row.type === SKILL_TYPE.POSITION"
                link
                type="primary"
                @click="openTest(row)"
              >
                🧪 测试
              </el-button>
              <!-- 审核中：撤回 -->
              <el-button
                v-if="isReviewing(row)"
                link
                type="warning"
                :loading="actionBusy === row.id"
                @click="withdraw(row)"
              >
                撤回
              </el-button>
              <!-- 未发布：发布（就绪门）+ 删除 -->
              <template v-else-if="isUnpublished(row)">
                <el-button
                  link
                  type="primary"
                  :disabled="!readinessOf(row).ready"
                  :title="publishTitle(row)"
                  @click="openPublish(row)"
                >
                  发布
                </el-button>
                <el-button
                  link
                  type="danger"
                  title="删除前需二次确认"
                  :loading="actionBusy === row.id"
                  @click="remove(row)"
                >
                  删除
                </el-button>
              </template>
              <!-- 已发布：停用 + 版本管理 -->
              <template v-else-if="isPublished(row)">
                <el-button
                  link
                  type="warning"
                  :loading="actionBusy === row.id"
                  @click="stopSkill(row)"
                >
                  停用
                </el-button>
                <el-button link type="primary" @click="openVersionManage(row)">版本管理</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
        <ListPagination v-model:page="page" :page-size="pageSize" :total="total" @change="fetchList" />
      </ListStates>
    </div>

    <!-- 引用清单弹窗：标题按引用主体切换，正文名称顿号连接 -->
    <el-dialog v-model="refsVisible" :title="refsTitle" width="420px" append-to-body>
      <p class="sk-refs-body">{{ refsText || NA }}</p>
      <template #footer>
        <el-button @click="refsVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 新建技能：类型单选 + zip 批量（每包独立必选分类）/ 手动创建（必选分类），全在一个弹窗内完成 -->
    <SkillCreateDialog
      v-model="createVisible"
      title="新建技能"
      :type-options="createTypeOptions"
      @created="onSkillCreated"
      @created-batch="onSkillsCreatedBatch"
    />

    <!-- 效果测试台（聚焦舞台浮层）：关闭走 v-if，组件 onUnmounted 内部 abort -->
    <div v-if="testVisible" class="focus-stage" v-loading="testLoading">
      <EffectTestStage
        mode="skill"
        :skill="testSkill || {}"
        :skill-id="testSkillId"
        :position-id="testPositionId"
        :disabled-reason="testDisabledReason"
        @close="closeTest"
      />
    </div>

    <!-- 版本管理抽屉（统一 VersionDrawer；三类技能同构，apiFor 分流） -->
    <VersionDrawer v-model="verMgrVisible" :adapter="versionAdapter" @done="onVersionDone" />
  </div>
</template>

<style scoped>
/* 技能名单元格：图标 + 名称（换行完整展示）+ 状态标签（原型 time-sort-and-full-skill-name-lock） */
.sk-title {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.sk-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-sm);
}
.sk-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--bg-active);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.sk-name {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.45;
  color: var(--c-text-strong);
}
/* 技能类型：弱化普通文本（原型 .skill-type-text） */
.sk-type-text {
  color: var(--c-text-muted);
}
.sk-ref-btn {
  padding: 0;
}
.sk-refs-body {
  margin: 0;
  line-height: 1.8;
  word-break: break-word;
  color: var(--c-text);
}
.ver-num {
  font-variant-numeric: tabular-nums;
}
/* 效果测试台浮层：覆盖视口承载 EffectTestStage（自带居中卡） */
.focus-stage {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mask);
}
</style>
