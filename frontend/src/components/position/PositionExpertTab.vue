<script setup>
/**
 * 岗位详情 · 「专家与专家团」页签（产品优化需求-202611 R13，2026-11-09 新增）。
 *
 * - 上下两块：专家 / 专家团，各自右上角【添加】打开选择抽屉；
 * - 候选：已发布、未回收、不在审核中的岗位私有专家 / 专家团，排除本岗位已引用的；
 * - 绑定关系只存一处（专家 / 团的 positionIds），岗位侧引用、移除即改它；专家页「所属岗位」改为只读；
 * - 添加专家团时，团里有本岗位还没引用的岗位私有成员，确认后可一起添加（否则本岗位员工用不了这个团）；
 * - 移除：正被自动化任务选为执行对象时先预检、直接提示不弹确认（数据层再兜底）；移除的专家是本岗位某个专家团的成员时，确认窗口追加提示；
 * - 停用 / 回收 / 缺员 / 成员没加入本岗位：行内标出，岗位发布前检查阻断（positionModel.positionExpertIssues）。
 */
import { ref, computed, inject } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePositionStore } from '@/stores/position'
import { listPositionExpertCandidates, checkUnbindPositionExpert, checkUnbindPositionTeam } from '@/api/position'
import { iconIsUrl } from '@/utils/iconDisplay'
import StatusTag from '@/components/StatusTag.vue'
import RevokedTag from '@/components/admin/RevokedTag.vue'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import ExpertEditor from '@/components/admin/ExpertEditor.vue'
import ExpertTeamEditor from '@/components/admin/ExpertTeamEditor.vue'

defineProps({
  // 只读态（列表【查看】进入 / 审核中锁定），由父层统一推导
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()
const ensurePersisted = inject('pdEnsurePersisted', async () => true)

/**
 * 行内状态：可用显「已发布」；不可用显原因（「已停用」/ 存量的「未发布」）。
 * 已回收只出 RevokedTag 红标、不再叠灰色「未发布」（修改点 2：标「已停用」或红色「已回收」二者之一），返回 null。
 */
function statusOf(row) {
  if (!row.unavailable) return { type: 'success', label: '已发布' }
  if (row.unavailable === '已回收') return null
  return { type: 'warning', label: row.unavailable }
}

/**
 * 不可用状态的悬停说明：存量数据里会有「未发布」「已停用」的引用（R13 之前专家侧绑岗位不看发布状态），
 * 添加抽屉的候选里不会有它们；悬停说明发布时会被拦下，避免误以为未发布的也能加进来。
 * @param {'专家'|'专家团'} kind
 */
function statusTipOf(row, kind) {
  if (row.unavailable === '未发布') return '该' + kind + '还没发布，岗位发布时会被拦下。请移除，或等' + kind + '发布后再发布岗位'
  if (row.unavailable === '已停用') return '该' + kind + '已停用，岗位发布时会被拦下，请移除'
  return ''
}

/* ---------- 查看：复用专家 / 专家团页的只读抽屉，不跳转 ---------- */
const viewExpertId = ref(null)
const viewExpertOpen = ref(false)
const viewTeamId = ref(null)
const viewTeamOpen = ref(false)
function viewExpert(row) {
  viewExpertId.value = row.expertId
  viewExpertOpen.value = true
}
function viewTeam(row) {
  viewTeamId.value = row.teamId
  viewTeamOpen.value = true
}

/* ---------- 添加抽屉（专家 / 专家团共用一个，kind 区分） ---------- */
const pickKind = ref('expert') // 'expert' | 'team'
const pickOpen = ref(false)
const pickLoading = ref(false)
const pickSaving = ref(false)
const pickKeyword = ref('')
const candidates = ref({ experts: [], teams: [] })
const picked = ref([])

const pickTitle = computed(() => (pickKind.value === 'expert' ? '添加专家' : '添加专家团'))
const pickList = computed(() => {
  const list = pickKind.value === 'expert' ? candidates.value.experts : candidates.value.teams
  const kw = pickKeyword.value.trim()
  return kw ? list.filter((x) => x.name.includes(kw)) : list
})
const idOf = (row) => (pickKind.value === 'expert' ? row.expertId : row.teamId)

async function openPick(kind) {
  if (!(await ensurePersisted())) return
  pickKind.value = kind
  picked.value = []
  pickKeyword.value = ''
  pickOpen.value = true
  pickLoading.value = true
  try {
    candidates.value = await listPositionExpertCandidates(store.positionId)
  } catch (e) {
    ElMessage.error(e?.message || '加载候选失败')
    candidates.value = { experts: [], teams: [] }
  } finally {
    pickLoading.value = false
  }
}

function togglePick(id) {
  const i = picked.value.indexOf(id)
  if (i > -1) picked.value.splice(i, 1)
  else picked.value.push(id)
}

/**
 * 勾选的团里，本岗位还没引用的岗位私有成员：groups 按团列（同一位专家在两个团里都缺，两处都列，提示才说得清），
 * members 是去重后要一起添加的名单。
 */
function lackingMembersOf(teamIds) {
  const groups = candidates.value.teams
    .filter((t) => teamIds.includes(t.teamId) && (t.unboundMembers || []).length)
    .map((t) => ({ teamName: t.name, members: t.unboundMembers }))
  const members = new Map()
  for (const g of groups) for (const m of g.members) if (!members.has(m.expertId)) members.set(m.expertId, m)
  return { groups, members: [...members.values()] }
}

/**
 * 「一起添加」确认文案，逐个团点名（修改点 2）：单团即 PRD 原句「专家团「团名」的成员「专家名」还没加入本岗位，是否一起添加？」；
 * 多团用顿号接成「专家团「A」的成员「x」、专家团「B」的成员「y」还没加入本岗位，是否一起添加？」。
 */
function lackingConfirmText(groups) {
  const parts = groups.map((g) => '专家团「' + g.teamName + '」的成员' + g.members.map((m) => '「' + m.name + '」').join(''))
  return parts.join('、') + '还没加入本岗位，是否一起添加？'
}

async function confirmPick() {
  if (!picked.value.length) {
    ElMessage.warning(pickKind.value === 'expert' ? '请至少勾选 1 位专家' : '请至少勾选 1 个专家团')
    return
  }
  pickSaving.value = true
  try {
    if (pickKind.value === 'expert') {
      for (const id of picked.value) await store.bindExpert(id)
      ElMessage.success('专家已添加')
    } else {
      // R13 §3「添加专家团时带上成员」
      const lacking = lackingMembersOf(picked.value)
      let withMembers = false
      if (lacking.members.length) {
        try {
          await ElMessageBox.confirm(
            lackingConfirmText(lacking.groups),
            '添加专家团',
            { type: 'info', confirmButtonText: '一起添加', cancelButtonText: '只添加专家团', distinguishCancelAndClose: true }
          )
          withMembers = true
        } catch (action) {
          // 点右上角关闭 = 不添加；点【只添加专家团】= 只加团
          if (action === 'close') return
        }
      }
      if (withMembers) for (const m of lacking.members) await store.bindExpert(m.expertId)
      for (const id of picked.value) await store.bindTeam(id)
      ElMessage.success('专家团已添加')
    }
    pickOpen.value = false
  } catch (e) {
    ElMessage.error(e?.message || '添加失败')
  } finally {
    pickSaving.value = false
  }
}

/* ---------- 移除 ----------
 * 修改点 2：正被本岗位自动化任务选为执行对象的不能移除——先预检，拦下就直接提示原因、不弹确认
 * （文案由数据层给，与 unbind 的兜底拦截同源）。预检失败不拦，交给 unbind 兜底。 */
async function blockedByTask(check, id, title) {
  const blocked = await check(store.positionId, id).catch(() => '')
  if (blocked) ElMessageBox.alert(blocked, title, { confirmButtonText: '知道了', type: 'warning' }).catch(() => {})
  return !!blocked
}

async function removeExpert(row) {
  if (await blockedByTask(checkUnbindPositionExpert, row.expertId, '移除专家')) return
  // 移除的专家是本岗位某个专家团的成员：移除后岗位发布会被阻断（团的岗位私有成员须同样被本岗位引用）
  const inTeams = store.teams.filter((t) => (t.memberIds || []).includes(row.expertId))
  let msg = '仅解除「' + row.name + '」与当前岗位的关联，不删除专家本身。确认移除？'
  if (inTeams.length) msg += '本岗位的专家团「' + inTeams.map((t) => t.name).join('」「') + '」包含该专家，移除后岗位发布会被阻断。'
  try {
    await ElMessageBox.confirm(msg, '移除专家', { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    await store.unbindExpert(row.expertId)
    ElMessage.success('已移除')
  } catch (e) {
    // 预检之后才变成执行对象等情况：数据层兜底拦截，原因原样提示
    ElMessage.error(e?.message || '移除失败')
  }
}

async function removeTeam(row) {
  if (await blockedByTask(checkUnbindPositionTeam, row.teamId, '移除专家团')) return
  try {
    await ElMessageBox.confirm(
      '仅解除「' + row.name + '」与当前岗位的关联，不删除专家团本身。确认移除？',
      '移除专家团',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await store.unbindTeam(row.teamId)
    ElMessage.success('已移除')
  } catch (e) {
    ElMessage.error(e?.message || '移除失败')
  }
}
</script>

<template>
  <div class="pd-pane">
    <!-- 专家 -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">专家</span>
        <span class="pd-card-sub">本岗位引用的岗位私有专家 · 随岗位下发给领用的员工</span>
        <span class="pd-card-spacer"></span>
        <el-button v-if="!isReadonly" type="primary" size="small" @click="openPick('expert')">＋ 添加专家</el-button>
      </div>
      <div class="pd-card-body pd-card-body--flush">
        <el-table :data="store.experts" class="pd-table--flat" row-key="expertId"
                  empty-text="暂无专家 · 点「添加专家」引用岗位私有专家">
          <el-table-column label="专家名" min-width="220">
            <template #default="{ row }">
              <span class="pd-ref-name">
                <span class="pd-avatar" :style="row.backgroundColor ? { backgroundColor: row.backgroundColor } : undefined">
                  <img v-if="iconIsUrl(row.avatar)" :src="row.avatar" alt="" class="pd-avatar-img" />
                  <span v-else>{{ row.avatar || '☆' }}</span>
                </span>
                {{ row.name }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="120">
            <template #default="{ row }">{{ row.category || '—' }}</template>
          </el-table-column>
          <el-table-column label="技能数" width="100" align="center">
            <template #default="{ row }">{{ row.skillCount ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="状态" width="180">
            <template #default="{ row }">
              <el-tooltip v-if="statusTipOf(row, '专家')" :content="statusTipOf(row, '专家')" placement="top">
                <StatusTag :type="statusOf(row).type">{{ statusOf(row).label }}</StatusTag>
              </el-tooltip>
              <StatusTag v-else-if="statusOf(row)" :type="statusOf(row).type">{{ statusOf(row).label }}</StatusTag>
              <RevokedTag :info="row.revoked" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="viewExpert(row)">查看</el-button>
              <el-button v-if="!isReadonly" link type="danger" @click="removeExpert(row)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <!-- 专家团 -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">专家团</span>
        <span class="pd-card-sub">团里的岗位私有成员须同样加入本岗位，否则本岗位员工用不了这个团</span>
        <span class="pd-card-spacer"></span>
        <el-button v-if="!isReadonly" type="primary" size="small" @click="openPick('team')">＋ 添加专家团</el-button>
      </div>
      <div class="pd-card-body pd-card-body--flush">
        <el-table :data="store.teams" class="pd-table--flat" row-key="teamId"
                  empty-text="暂无专家团 · 点「添加专家团」引用岗位私有专家团">
          <el-table-column label="团名" min-width="200">
            <template #default="{ row }">
              <span class="pd-ref-name">
                <span class="pd-avatar">
                  <img v-if="iconIsUrl(row.avatar)" :src="row.avatar" alt="" class="pd-avatar-img" />
                  <span v-else>{{ row.avatar || '◈' }}</span>
                </span>
                {{ row.name }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="110">
            <template #default="{ row }">{{ row.category || '—' }}</template>
          </el-table-column>
          <el-table-column label="成员数" width="90" align="center">
            <template #default="{ row }">{{ row.memberCount }}</template>
          </el-table-column>
          <el-table-column label="主理人" width="150">
            <template #default="{ row }">
              <span v-if="row.leaderName">{{ row.leaderName }}</span>
              <span v-else class="pd-faint">未设主理人</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="220">
            <template #default="{ row }">
              <el-tooltip v-if="statusTipOf(row, '专家团')" :content="statusTipOf(row, '专家团')" placement="top">
                <StatusTag :type="statusOf(row).type">{{ statusOf(row).label }}</StatusTag>
              </el-tooltip>
              <StatusTag v-else-if="statusOf(row)" :type="statusOf(row).type">{{ statusOf(row).label }}</StatusTag>
              <RevokedTag :info="row.revoked" />
              <el-tooltip v-if="row.missingCount > 0" :content="row.missing.map((m) => m.name + '（' + m.reason + '）').join('、')" placement="top">
                <span class="pd-warn-tag">缺员 {{ row.missingCount }}</span>
              </el-tooltip>
              <el-tooltip v-if="row.unboundMembers.length" :content="'没有加入本岗位：' + row.unboundMembers.map((m) => m.name).join('、')" placement="top">
                <span class="pd-warn-tag">成员未加入本岗位</span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="viewTeam(row)">查看</el-button>
              <el-button v-if="!isReadonly" link type="danger" @click="removeTeam(row)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>

  <!-- 添加抽屉 -->
  <DrawerEditor v-model:visible="pickOpen" :title="pickTitle" size="620px" append-to-body>
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">{{ pickKind === 'expert' ? '选择专家' : '选择专家团' }}</span>
        <span class="pd-card-sub">已发布的岗位私有{{ pickKind === 'expert' ? '专家' : '专家团' }}，已引用的不再列出</span>
        <span class="pd-card-spacer"></span>
        <span class="pd-faint">已勾选 {{ picked.length }}</span>
      </div>
      <div class="pd-card-body">
        <el-input v-model="pickKeyword" placeholder="按名称搜索" clearable />
        <div v-loading="pickLoading" class="pd-pick-list">
          <div v-if="!pickLoading && !pickList.length" class="pd-pick-empty">
            暂无可添加的岗位私有{{ pickKind === 'expert' ? '专家' : '专家团' }}
          </div>
          <el-checkbox
            v-for="row in pickList"
            :key="idOf(row)"
            :model-value="picked.includes(idOf(row))"
            class="pd-pick-row"
            @change="togglePick(idOf(row))"
          >
            <span class="pd-pick-main">
              <strong>{{ row.name }}<em v-if="row.category">{{ row.category }}</em></strong>
              <small>{{ row.intro || '暂无简介' }}</small>
              <small v-if="pickKind === 'team'">
                {{ row.memberCount }} 位成员 · {{ row.leaderName ? '主理人：' + row.leaderName : '未设主理人' }}
              </small>
            </span>
          </el-checkbox>
        </div>
      </div>
    </section>
    <template #footer>
      <el-button @click="pickOpen = false">取消</el-button>
      <el-button type="primary" :loading="pickSaving" @click="confirmPick">添加</el-button>
    </template>
  </DrawerEditor>

  <ExpertEditor v-model:visible="viewExpertOpen" :expert-id="viewExpertId" readonly />
  <ExpertTeamEditor v-model:visible="viewTeamOpen" :team-id="viewTeamId" readonly />
</template>

<style scoped>
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.pd-ref-name {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--c-text-base);
}
/* 头像块与专家列表 .ex-avatar 同款（32px 小方块，底色取专家背景色） */
.pd-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  font-size: 16px;
  line-height: 1;
  border-radius: 8px;
  background: var(--bg-sunken);
  overflow: hidden;
}
.pd-avatar[style*='background'] {
  color: #1f1f1f; /* 定值：调色板全是浅色底，暗色主题下令牌字色会翻成近白 */
}
.pd-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pd-faint {
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
}
.pd-warn-tag {
  display: inline-block;
  margin-left: var(--space-1);
  padding: 0 6px;
  font-size: var(--fs-xs);
  line-height: 20px;
  border-radius: 4px;
  color: var(--c-danger);
  background: var(--c-danger-soft, rgba(245, 108, 108, 0.12));
  cursor: default;
}

/* 卡内表格紧凑密度：与「技能」页签同款 */
.pd-table--flat.el-table :deep(th.el-table__cell),
.pd-table--flat.el-table :deep(td.el-table__cell) {
  height: auto;
  padding: 0;
}
.pd-table--flat.el-table :deep(.el-table__cell .cell) {
  padding: 11px 12px;
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.pd-table--flat.el-table {
  --el-table-header-bg-color: var(--bg-admin-card-head);
}
.pd-table--flat.el-table :deep(th.el-table__cell) {
  font-weight: var(--fw-semibold);
}
.pd-table--flat.el-table :deep(.el-table__cell:first-child .cell) {
  padding-left: var(--space-5);
}

/* ---- 添加抽屉勾选区 ---- */
.pd-pick-list {
  max-height: 52vh;
  overflow-y: auto;
  min-height: 240px;
}
.pd-pick-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  height: auto;
  margin: 0;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-soft);
}
.pd-pick-row :deep(.el-checkbox__label) {
  flex: 1;
  min-width: 0;
  white-space: normal;
}
.pd-pick-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pd-pick-main strong {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.pd-pick-main em {
  margin-left: var(--space-2);
  font-style: normal;
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.pd-pick-main small {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}
.pd-pick-empty {
  padding: var(--space-6);
  text-align: center;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

/* ---- .pd-card 家族：与人格 / 技能 / 知识页签同源 ---- */
.pd-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-admin-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.pd-card-head {
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border-admin-card);
  background: var(--bg-admin-card-head);
}
.pd-card-title {
  display: inline-flex;
  align-items: center;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
  white-space: nowrap;
}
.pd-card-sub {
  font-size: var(--fs-xs);
  font-weight: var(--fw-regular);
  color: var(--c-text-muted);
}
.pd-card-spacer {
  margin-left: auto;
}
.pd-card-body {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.pd-card-body--flush {
  display: block;
  padding: 0;
  gap: 0;
}
</style>
