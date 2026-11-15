<script setup>
/**
 * 岗位详情 · 「技能」页签（产品优化需求-202611 R1：取消 Agent，技能直接引用到岗位）。
 *
 * 由原「Agent 与技能」页签（PositionAgentSkillTab.vue，2026-09-09 批次 4C 二维表 + Agent 抽屉）改成：
 * - 单层表格，一行一个技能：技能名称 / 技能分类 / 工具数量 / 行内【编辑】【移除】；
 * - 右上角【添加技能】打开选择抽屉（勾选已发布、未被本岗位引用的岗位私有技能，已勾选 N/100）；
 * - 引用 / 移除都是 store 动作（attachSkill / detachSkill），立即生效，与原 Agent 抽屉的增量 assign / detach 同口径；
 * - 新建态先落库编排 ensurePersisted 归父壳（保存链路），经父层 provide 注入。
 *
 * 产品优化需求-202611 修改点 1 走查补齐：
 * - 候选「已发布」按技能本体状态判（有新版本 / 停用在审核中的仍算），与引用时的数据层校验同一把尺；
 * - 被本岗位自动化任务引用的技能，点【移除】先预检、直接提示原因，不再先弹确认；
 * - 「每个岗位最多引用 100 个技能」：抽屉达上限时内联展示；已满 100 时【添加技能】置灰并悬停提示同一句。
 */
import { ref, computed, watch, inject } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { usePositionStore } from '@/stores/position'
import { listPositionSkillCandidates, checkDetachPositionSkill } from '@/api/position'
import { LIMITS } from '@/utils/positionModel'
import { categoryLabel } from '@/utils/skillCategory'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'
import RevokedTag from '@/components/admin/RevokedTag.vue'

defineProps({
  // 只读态（列表【查看】进入 / 审核中锁定），由父层统一推导
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()
const router = useRouter()

// 添加技能前的落库编排（岗位名空则提示先填名）在父层，经 provide 注入。
const ensurePersisted = inject('pdEnsurePersisted', async () => true)

/* ---------- 技能整页编辑（#15：同页跳转 + 返回回本页签） ----------
 * 当前标签路由跳转，并把来源岗位/页签写进 query，由技能编辑页的 backToList 据此回跳。 */
function openSkillFullPage(skillId) {
  router.push({
    name: 'AdminSkillEdit',
    params: { id: skillId },
    query: { fromPosition: String(store.positionId), fromTab: 'skills' }
  })
}
function openSkillView(skillId) {
  router.push({
    name: 'AdminSkillEdit',
    params: { id: skillId },
    query: { fromPosition: String(store.positionId), fromTab: 'skills', view: '1' }
  })
}

// 工具数量（md §6.4「工具数量」，2026-09-10 D1）：summary VO 自带 toolCount（mock 同源自技能本体 toolRefs 条数）；
// 聚焦态 detail 形状兜底数 referencedTools；均缺按 0 计。
function skillToolCount(sk) {
  if (Number.isFinite(sk?.toolCount)) return sk.toolCount
  return Array.isArray(sk?.referencedTools) ? sk.referencedTools.length : 0
}
// 技能分类 = 技能本体的分类名（displayCategoryName）。字段为空 = 没有分类或分类已在字段字典删掉 → 「未分类」
// （与技能列表同口径，产品优化需求-202611 修改点 15）；技能本体已删的悬空引用显「—」。
// 不带 displayCategoryName 的旧形状回落 category 原值（OPERATION / QUERY 派生类走 categoryLabel 译成「操作类 / 查询类」）。
const skillCategoryText = (row) => {
  if (row.deleted) return '—'
  if ('displayCategoryName' in row) return row.displayCategoryName || '未分类'
  return categoryLabel(row.category) || row.category || '—'
}

const skillAtLimit = computed(() => store.skills.length >= LIMITS.SKILL_MAX)
// 上限提示（修改点 1）：抽屉内联、置灰按钮的悬停、兜底 toast 共用这一句
const LIMIT_TIP = `每个岗位最多引用 ${LIMITS.SKILL_MAX} 个技能`

/* ---------- 添加技能抽屉 ----------
 * 候选（R1）：已发布、未回收的岗位私有技能，排除本岗位已引用的。由数据层 listPositionSkillCandidates 按岗位算好：
 * 「已发布」按技能本体 status 判，有新版本 / 停用在审核中的仍在候选里（不能用技能列表的「已发布」筛选——那是展示三态，
 * 审核中的会被漏掉）；停用、回收后技能回未发布，自然不在候选里。勾选后点【添加】逐条 attach。 */
const drawerOpen = ref(false)
const adding = ref(false)
const pickedIds = ref([])
const skillOptions = ref([])
const optionsLoading = ref(false)
const keyword = ref('')

const candidates = computed(() => {
  const used = new Set(store.skills.map((s) => String(s.skillId)))
  return skillOptions.value.filter((o) => !used.has(String(o.id)))
})
// 上限按「已引用 + 本次勾选」算（每个岗位最多 100 个）
const pickAtLimit = computed(() => store.skills.length + pickedIds.value.length >= LIMITS.SKILL_MAX)

async function loadSkillOptions() {
  optionsLoading.value = true
  try {
    const data = await listPositionSkillCandidates(store.positionId, keyword.value.trim() || undefined)
    skillOptions.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    ElMessage.error(e?.message || '加载技能库失败')
    skillOptions.value = []
  } finally {
    optionsLoading.value = false
  }
}
let searchTimer = null
watch(keyword, () => {
  if (!drawerOpen.value) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadSkillOptions, 300)
})

async function openAddDrawer() {
  if (!(await ensurePersisted())) return
  // 按钮满额已置灰（悬停见 LIMIT_TIP），此处兜底
  if (skillAtLimit.value) {
    ElMessage.warning(LIMIT_TIP)
    return
  }
  pickedIds.value = []
  keyword.value = ''
  drawerOpen.value = true
  loadSkillOptions()
}

// 达上限后未勾选项置灰、抽屉内联展示 LIMIT_TIP（置灰的复选框点不动，toast 到不了用户），此处只是兜底再拦一次。
function togglePick(skillId) {
  const list = pickedIds.value
  const i = list.indexOf(skillId)
  if (i > -1) {
    list.splice(i, 1)
    return
  }
  if (pickAtLimit.value) {
    ElMessage.warning(LIMIT_TIP)
    return
  }
  list.push(skillId)
}

async function confirmAdd() {
  if (!pickedIds.value.length) {
    ElMessage.warning('请至少勾选 1 个技能')
    return
  }
  adding.value = true
  try {
    for (const id of pickedIds.value) await store.attachSkill(id)
    drawerOpen.value = false
    ElMessage.success('技能已添加')
  } catch (e) {
    ElMessage.error(e?.message || '添加失败')
  } finally {
    adding.value = false
  }
}

/* ---------- 移除（可逆：只解除引用，技能本体留库） ----------
 * 修改点 1：本岗位自动化任务的「引用技能」里还引用着它时不能移除——先预检，拦下就直接提示原因、不弹确认
 * （文案由数据层给，与 detach 的兜底拦截同源）。预检失败不拦，交给 detach 兜底。 */
async function onRemoveSkill(row) {
  const blocked = await checkDetachPositionSkill(store.positionId, row.skillId).catch(() => '')
  if (blocked) {
    ElMessageBox.alert(blocked, '移除技能', { confirmButtonText: '知道了', type: 'warning' }).catch(() => {})
    return
  }
  try {
    await ElMessageBox.confirm(
      '仅解除技能与当前岗位的关联，不删除技能本身。确认移除？',
      '移除技能',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await store.detachSkill(row.skillId)
    ElMessage.success('技能已移除')
  } catch (e) {
    ElMessage.error(e?.message || '移除失败')
  }
}
</script>

<template>
  <div class="pd-pane">
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">技能</span>
        <span class="pd-card-sub">岗位直接引用的岗位私有技能 · 主实例直接调用</span>
        <span class="pd-card-spacer"></span>
        <span class="pd-skill-count">{{ store.skills.length }}/{{ LIMITS.SKILL_MAX }}</span>
        <!-- 满 100 个置灰，悬停提示上限（置灰按钮点不动，点击里的 toast 到不了用户；title 同人格页签【AI 生成】置灰提示的做法） -->
        <el-button
          v-if="!isReadonly"
          type="primary"
          size="small"
          :disabled="skillAtLimit"
          :title="skillAtLimit ? LIMIT_TIP : undefined"
          @click="openAddDrawer"
        >
          {{ skillAtLimit ? `已达 ${LIMITS.SKILL_MAX} 个上限` : '＋ 添加技能' }}
        </el-button>
      </div>
      <div class="pd-card-body pd-card-body--flush">
        <el-table :data="store.skills" class="pd-table pd-table--flat" row-key="skillId"
                  empty-text="暂无技能 · 点「添加技能」引用岗位私有技能">
          <el-table-column label="技能名称" min-width="240">
            <template #default="{ row }">
              <!-- 技能被强制回收（md §6.4）：引用保留，名称旁标「已回收」，【移除】仍可用 -->
              <span class="pd-skill-name">{{ row.name }}<RevokedTag :info="row.revoked" /></span>
            </template>
          </el-table-column>
          <el-table-column label="技能分类" min-width="200">
            <template #default="{ row }">
              <el-tag size="small" type="info" effect="plain">{{ skillCategoryText(row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="工具数量" width="120" align="center">
            <template #default="{ row }">{{ skillToolCount(row) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button v-if="isReadonly" link type="primary" @click="openSkillView(row.skillId)">查看</el-button>
              <template v-else>
                <el-button link type="primary" @click="openSkillFullPage(row.skillId)">编辑</el-button>
                <el-button link type="danger" @click="onRemoveSkill(row)">移除</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>

  <!-- 添加技能抽屉：勾选已发布的岗位私有技能；上限按「已引用 + 本次勾选」算，两个数分开展示 -->
  <DrawerEditor v-model:visible="drawerOpen" title="添加技能" size="680px" append-to-body>
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">选择技能</span>
        <span class="pd-card-sub">可引用已发布的岗位私有技能，已引用的不再列出</span>
        <span class="pd-card-spacer"></span>
        <span class="pd-skill-count">已勾选 {{ pickedIds.length }} · 已引用 {{ store.skills.length }} / 上限 {{ LIMITS.SKILL_MAX }}</span>
      </div>
      <div class="pd-card-body">
        <el-input v-model="keyword" placeholder="搜索技能名称、描述或标识" clearable />
        <!-- 已引用 + 本次勾选达到上限：未勾选项置灰，并在这里明说原因（修改点 1） -->
        <p v-if="pickAtLimit" class="pd-skill-limit-tip" data-testid="skill-limit-tip">{{ LIMIT_TIP }}</p>
        <div v-loading="optionsLoading" class="pd-skill-pick-list">
          <div v-if="!optionsLoading && !candidates.length" class="pd-skill-pick-empty">
            暂无可引用的岗位私有技能
          </div>
          <el-checkbox
            v-for="opt in candidates"
            :key="opt.id"
            :model-value="pickedIds.includes(opt.id)"
            :disabled="pickAtLimit && !pickedIds.includes(opt.id)"
            class="pd-skill-pick-row"
            @change="togglePick(opt.id)"
          >
            <span class="pd-skill-pick-main">
              <strong>{{ opt.name }}</strong>
              <small>{{ opt.description || '暂无描述' }}</small>
            </span>
          </el-checkbox>
        </div>
      </div>
    </section>

    <template #footer>
      <el-button @click="drawerOpen = false">取消</el-button>
      <el-button type="primary" :loading="adding" @click="confirmAdd">添加</el-button>
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* 样式沿用原「Agent 与技能」页签（PositionAgentSkillTab.vue）：.pd-card 家族与卡内紧凑表格密度；
   去掉 Agent 行底纹 / 二级缩进两段（单层表格不再需要）。 */
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.pd-skill-name {
  color: var(--c-text-base);
}
.pd-skill-count {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
}

/* 卡内表格紧凑密度（原型 .sync-table：行 43px / 表头 41px / 单元格 11px 12px / 字号 13px），
   特指度须压过 admin-shell.css 的 `body.admin-scope .el-table td.el-table__cell`。 */
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
.pd-table--flat.el-table :deep(.el-table__cell:last-child .cell) {
  padding-right: var(--space-5);
}

/* ---- 添加技能抽屉内的勾选区 ---- */
.pd-skill-pick-list {
  max-height: 46vh;
  overflow-y: auto;
  min-height: 282px;
}
.pd-skill-pick-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  height: auto;
  margin: 0;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-soft);
}
.pd-skill-pick-row :deep(.el-checkbox__label) {
  flex: 1;
  min-width: 0;
  white-space: normal;
}
.pd-skill-pick-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pd-skill-pick-main strong {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.pd-skill-pick-main small {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-skill-limit-tip {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-warning);
}
.pd-skill-pick-empty {
  padding: var(--space-6);
  text-align: center;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

/* ---- .pd-card 家族（白底 / 描边 / 圆角卡，头行 + 分隔线 + 体），与人格 / 采集 / 知识页签同源 ---- */
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
/* 表格直接贴卡体边（卡头已有分隔线）；必须排在 .pd-card-body 之后（同特指度靠源码顺序决胜）。 */
.pd-card-body--flush {
  display: block;
  padding: 0;
  gap: 0;
}
</style>
