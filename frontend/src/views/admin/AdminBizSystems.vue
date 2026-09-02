<script setup>
/**
 * 业务系统连接配置页（2026-09-01 对齐 PRD-20260828 交互原型 v2 renderBiz 终版 L803）。
 *
 * 【列】5 列：业务系统（图标+名称+状态标签，第二行描述）｜登录地址｜引用情况（点击弹引用清单）｜
 *   最近更新时间（列头排序）｜操作。一次展示全量，不分页。
 *
 * 【状态机（与 API 连接器同口径）】三态：未发布 / 审核中 / 已发布。
 *   发布 → 提交发布审核；停用 → 提交停用审核（审核期间技能仍可执行）；
 *   撤回按待审类型恢复：待审发布 → 未发布，待审停用 → 已发布；
 *   删除：仅未发布态出删除入口，被技能引用也可删（软引用，确认影响后继续删）。
 *
 * 【取数】列表行内直接带 display 字段（status/pendingAction/refs/icon/时间），
 *   免去旧版每行再拉 publication 的双请求编排（2026-09-01 mock 化收敛）。
 *
 * 【查询】搜索系统名称或描述 + 状态筛选（未发布/审核中/已发布），点【查询】按当前条件刷新（Enter 同）。
 */
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listBizSystems,
  deleteBizSystem,
  submitBizSystemPublish,
  withdrawBizSystem,
  delistBizSystem
} from '@/api/admin'
import { fmtTime } from '@/utils/docMeta'
import { COL, opsWidth } from '@/utils/tableLayout'
import { useAdminList } from '@/composables/useAdminList'
import ListStates from '@/components/admin/ListStates.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import StatusTag from '@/components/StatusTag.vue'
import BizSystemEditor from '@/components/admin/BizSystemEditor.vue'
import { iconIsUrl } from '@/utils/iconDisplay'

// 输入区（暂存）与已应用条件分离：点【查询】才生效（与 API 连接器页同口径）
const query = reactive({ keyword: '', state: '' })
const applied = reactive({ keyword: '', state: '' })

const editorVisible = ref(false)
const editingId = ref(null)
const editorReadonly = ref(false)

// 行内动作 busy 态：{ [bizId]: 'publish' | 'withdraw' | 'deactivate' | 'delete' }
const busy = ref({})

// 引用清单弹窗（B3：点「N 个技能引用」弹出，标题「被技能引用」）
const refsDialog = reactive({ visible: false, skills: [] })

// 状态选项（B4 顺序：未发布 / 审核中 / 已发布）
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

/* ---------------- 状态 → 可执行动作（原型 bizActions 终版 L797-802） ---------------- */
function canPublish(row) {
  return row.status === 'NOT_PUBLISHED'
}
function canWithdraw(row) {
  return row.status === 'PENDING_REVIEW'
}
function canDeactivate(row) {
  return row.status === 'PUBLISHED'
}
// 删除入口仅未发布态；被引用也可删（软引用，确认弹窗承接影响提示，B8）
function canDelete(row) {
  return row.status === 'NOT_PUBLISHED'
}
// 审核中不可编辑（改了会让审核对象与提交内容不一致）
function isLocked(row) {
  return row.status === 'PENDING_REVIEW'
}
// 图标：URL/dataURL 按图片渲染，否则按 emoji/字符（全站统一判断，见 utils/iconDisplay）

// 取数编排统一走 useAdminList；一次展示全量（B5 移除分页），故 paged:false。
const list = useAdminList(listBizSystems, { paged: false, params: () => ({ ...applied }) })
const { rows, loading, loadError, isEmpty } = list
const fetchList = list.reload

// 点【查询】/ 回车：把输入区条件应用后刷新
function search() {
  applied.keyword = query.keyword.trim()
  applied.state = query.state
  fetchList()
}

onMounted(fetchList)

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
/** 查看：只读打开定义详情——审核锁定期与日常复核走这里，避免误改（同 MCP/API 页）。 */
function openView(row) {
  editingId.value = row.id
  editorReadonly.value = true
  editorVisible.value = true
}
function onSaved() {
  fetchList()
}

/* ---------------- 引用清单（B3） ---------------- */
function openRefs(row) {
  refsDialog.skills = row.referencedBySkills || []
  refsDialog.visible = true
}

/* ---------------- 发布 / 撤回 / 停用 / 删除（状态机动作） ---------------- */
async function runAction(row, action, fn, successMsg) {
  busy.value[row.id] = action
  try {
    await fn()
    if (successMsg) ElMessage.success(successMsg)
    await fetchList()
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
      '发布业务系统',
      { type: 'warning', confirmButtonText: '提交审核' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'publish', () => submitBizSystemPublish(row.id, ['USER_END']), '已提交发布审核')
}

/** 撤回（B7）：按待审类型恢复——待审发布 → 未发布；待审停用 → 已发布。 */
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
  runAction(row, 'withdraw', () => withdrawBizSystem(row.id, 'USER_END'), '已撤回')
}

/** 停用（B6）：提交停用审核（审核通过前技能仍可执行，通过后变未发布）。 */
async function deactivate(row) {
  try {
    await ElMessageBox.confirm(
      `停用后技能仍可执行，但运行效果可能受限或出现报错。确认继续停用「${row.name}」？`,
      '停用业务系统',
      { type: 'warning', confirmButtonText: '继续停用' }
    )
  } catch (e) {
    return
  }
  runAction(row, 'deactivate', () => delistBizSystem(row.id, 'USER_END'), '已提交停用审核')
}

/** 删除（B8/BQ2）：软引用——被技能引用也可删，确认影响后继续。 */
async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `删除后技能仍可执行，但运行效果可能受限或出现报错。确认删除「${row.name}」？`,
      '删除业务系统',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch (e) {
    return
  }
  busy.value[row.id] = 'delete'
  try {
    await deleteBizSystem(row.id)
    ElMessage.success('已删除')
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
      <el-input
        v-model="query.keyword"
        placeholder="搜索系统名称或描述"
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
        <el-button type="primary" class="lt-create" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建业务系统
        </el-button>
      </template>
    </ListToolbar>

    <ListStates
      :loading="loading"
      :error="loadError"
      :empty="isEmpty"
      empty-text="没有匹配的业务系统"
      @retry="fetchList"
    >
      <el-table
        v-loading="loading"
        :data="rows"
        row-key="id"
        :default-sort="{ prop: 'updatedAt', order: 'descending' }"
      >
        <!-- 业务系统：图标 + 名称 + 状态标签，第二行描述（缩略，悬停看全文）（B2） -->
        <el-table-column label="业务系统" :min-width="240">
          <template #default="{ row }">
            <div class="biz-cell">
              <span class="biz-cell-icon" :class="{ 'is-empty': !row.icon }">
                <img v-if="iconIsUrl(row.icon)" :src="row.icon" alt="" class="biz-cell-icon-img" />
                <span v-else-if="row.icon">{{ row.icon }}</span>
                <span v-else>—</span>
              </span>
              <div class="biz-cell-text">
                <div class="biz-cell-name-line">
                  <span class="biz-cell-name" :title="row.name">{{ row.name }}</span>
                  <StatusTag :type="stateMeta(row).type">{{ stateMeta(row).label }}</StatusTag>
                </div>
                <div class="biz-cell-desc" :title="row.description || ''">
                  {{ row.description || '—' }}
                </div>
              </div>
            </div>
          </template>
        </el-table-column>

        <!-- 登录地址：长 URL 溢出省略，悬浮看全 -->
        <el-table-column label="登录地址" :min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.loginUrl">{{ row.loginUrl }}</span>
            <span v-else class="cell-na">—</span>
          </template>
        </el-table-column>

        <!-- 引用情况（B3）：N 个技能引用（悬停技能名清单，点击弹窗）/ 暂无引用 -->
        <el-table-column label="引用情况" :min-width="110">
          <template #default="{ row }">
            <el-button
              v-if="row.referencedBySkillCount > 0"
              link
              type="primary"
              :title="(row.refs || []).join('、')"
              @click="openRefs(row)"
            >{{ row.referencedBySkillCount }} 个技能引用</el-button>
            <span v-else class="cell-na">暂无引用</span>
          </template>
        </el-table-column>

        <!-- 最近更新时间：精确到分钟，列头点击排序（B2） -->
        <el-table-column label="最近更新时间" prop="updatedAt" sortable :width="COL.TIME + 24">
          <template #default="{ row }">
            <span v-if="row.updatedAt">{{ fmtTime(row.updatedAt) }}</span>
            <span v-else class="cell-na">—</span>
          </template>
        </el-table-column>

        <!-- 操作：查看/编辑/发布·撤回·停用/删除（原型 bizActions 终版按状态组合） -->
        <el-table-column label="操作" :width="opsWidth(4)" fixed="right">
          <template #default="{ row }">
            <div class="tbl-ops">
              <!-- ① 查看（只读）/ 编辑 -->
              <el-button link type="primary" @click="openView(row)">查看</el-button>
              <el-tooltip v-if="isLocked(row)" content="审核中不可编辑，如需修改请先撤回" placement="top">
                <span class="tbl-ops-wrap">
                  <el-button link type="primary" disabled>编辑</el-button>
                </span>
              </el-tooltip>
              <el-button v-else link type="primary" @click="openEdit(row)">编辑</el-button>

              <span class="tbl-ops-sep" aria-hidden="true"></span>

              <!-- ② 发布 / 撤回 / 停用（同一位置随状态切换，互斥 if/else-if 链）。
                   canPublishGate（停用系统禁发布）已随「状态」配置项一并移除（B8）。 -->
              <el-button
                v-if="canWithdraw(row)"
                link
                type="warning"
                :loading="busy[row.id] === 'withdraw'"
                @click="withdraw(row)"
              >
                撤回
              </el-button>
              <el-button
                v-else-if="canPublish(row)"
                link
                type="success"
                :loading="busy[row.id] === 'publish'"
                @click="publish(row)"
              >
                发布
              </el-button>
              <el-button
                v-else-if="canDeactivate(row)"
                link
                type="warning"
                :loading="busy[row.id] === 'deactivate'"
                @click="deactivate(row)"
              >
                停用
              </el-button>

              <!-- ③ 危险操作置末：仅未发布可删（软引用，被引用也可删） -->
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

    <BizSystemEditor
      v-model:visible="editorVisible"
      :biz-id="editingId"
      :readonly="editorReadonly"
      @saved="onSaved"
    />

    <!-- 引用清单弹窗（B3：标题「被技能引用」，正文技能名列表，按钮【关闭】） -->
    <el-dialog v-model="refsDialog.visible" title="被技能引用" width="420px">
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
.cell-na {
  color: var(--c-text-faint);
}

/* ===== 业务系统主列：图标 + 名称/状态 + 描述两行（与 API 列表 api-cell 同构） ===== */
.biz-cell {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}
.biz-cell-icon {
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
.biz-cell-icon.is-empty {
  color: var(--c-text-faint);
}
.biz-cell-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.biz-cell-text {
  min-width: 0;
}
.biz-cell-name-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.biz-cell-name {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.biz-cell-desc {
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
</style>
