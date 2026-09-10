<script setup>
/**
 * 岗位详情 · 「Agent 与技能」页签（2026-09-09 原型复刻批次 4C）。
 *
 * 形态按负责人 Q383 决议 + 补充说明第 5 条「采纳 A」：二维表（两级），不做泳道、也不做
 * ◆ 技能分类分组的三级结构——行维度 = Agent（◆）与其下技能（·），列维度 = 名称 /
 * 职责描述·分类 / 工具 / 操作，同一列在两级上承载各自语义。
 *
 * 2026-09-10 病 A 拆分（docs/调研讨论/2026-09-09-代码冗余治理第二批方案.md 第 5 项）：
 * 自 PositionDetailTabs.vue 原样抽出，DOM 结构 / class / 交互零变更（含 Agent 抽屉）。
 * - 数据直接走 usePositionStore（agents 增删改 / 技能 assign·detach 都是 store 动作）；
 * - 新建态先落库编排 ensurePersisted 归父壳（保存链路），经父层 provide 注入。
 */
import { ref, computed, watch, inject } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { usePositionStore } from '@/stores/position'
import { listSkills } from '@/api/position'
import { LIMITS } from '@/utils/positionModel'
import { categoryLabel } from '@/utils/skillCategory'
import DrawerEditor from '@/components/admin/DrawerEditor.vue'

defineProps({
  // 只读态（列表【查看】进入 / 审核中锁定），由父层统一推导
  isReadonly: { type: Boolean, default: false }
})

const store = usePositionStore()
const router = useRouter()

// 新建 Agent 前的落库编排（岗位名空则提示先填名）在父层，经 provide 注入（拆分前为同文件闭包引用）。
const ensurePersisted = inject('pdEnsurePersisted', async () => true)

/* ---------- Agent 增删改 ---------- */
const agentAtLimit = computed(() => store.agents.length >= LIMITS.AGENT_MAX)

// 新建 Agent 已并入抽屉（openAgentCreate / saveAgentDraft，2026-09-09 批次 4C）：
// 原「直建一条『新 Agent』空行」与 onAgentRename 就地改名的两段式退役。
// 删除 Agent（2026-09-04 PRD-20260903 对齐，md 三.6.3）：确认文案与 toast 逐字照 md。
async function onAgentDelete(agentId) {
  try {
    await ElMessageBox.confirm(
      '删除该 Agent 后会解除其技能关联，技能本身不会被删除。确认删除？',
      '删除 Agent',
      // md §6.3 确认按钮逐字为【确认删除】
      { type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  try {
    await store.removeAgent(agentId)
    ElMessage.success('Agent 已删除')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

/* ---------- 技能整页编辑（#15，2026-09-09 批次 4C：新标签 → 同页跳转 + 返回回本页签） ----------
 * 原实现 window.open 开新标签，返回时回不到岗位详情的 Agent 页签（md §6.4 要求
 * 「编辑完成后可【← 返回】回到岗位详情页」）。改为当前标签路由跳转，并把来源岗位/页签写进
 * query，由技能编辑页的 backToList 据此回跳。 */
function openSkillFullPage(skillId) {
  router.push({
    name: 'AdminSkillEdit',
    params: { id: skillId },
    query: { fromPosition: String(store.positionId), fromTab: 'agents' }
  })
}
/* ---------- Agent 与技能:层级列表（2026-08-22 列表化，对齐截图） ---------- */
// 扁平化为「Agent 行 + 其下技能行」，供 el-table 层级渲染（kind 区分）。
const agentSkillRows = computed(() => {
  const out = []
  for (const a of store.agents) {
    out.push({ kind: 'agent', agentId: a.agentId, name: a.name, description: a.description || '', skillCount: (a.skills || []).length })
    for (const sk of a.skills || []) {
      out.push({ kind: 'skill', rowKey: 's_' + a.agentId + '_' + sk.skillId, agentId: a.agentId, skillId: sk.skillId, name: sk.name, category: sk.category, tools: agentSkillToolCount(sk) })
    }
  }
  return out
})
// 工具数量（md §6.4：技能子行展示「工具数量」，2026-09-10 D1 修复——此前总览态恒显「—」）：
// 总览 summary VO 自带 toolCount（mock 同源自技能本体 toolRefs 条数）；聚焦态 detail 形状
// 兜底数 referencedTools；均缺按 0 计（md 未细化无工具口径，按数值 0 展示）。
function agentSkillToolCount(sk) {
  if (Number.isFinite(sk?.toolCount)) return sk.toolCount
  return Array.isArray(sk?.referencedTools) ? sk.referencedTools.length : 0
}
const skillCategoryText = (c) => (c ? categoryLabel(c) : '—')

/* ---------- Agent 抽屉：新建 / 编辑同一抽屉（2026-09-09 原型复刻批次 4C，#14） ----------
 * 原「＋ 新增 Agent」直建一条「新 Agent」空行 + 行内「＋技能」开弹窗挑技能的两段式，按负责人
 * Q383/Q378 决议合并为：新建与编辑都走同一个 680px 抽屉，抽屉内含「引用技能」勾选区，
 * 技能引用在保存时按勾选结果与既有引用做差集，增量 assign / detach。 */
const agentDrawerOpen = ref(false)
const agentDrawerIsNew = ref(false)
const agentEditId = ref(null)
const agentSaving = ref(false)
const agentDraft = ref({ name: '', description: '', skillIds: [] })
// 打开抽屉时的原始引用集合：保存时与 draft.skillIds 求差，决定 assign / detach 哪几条。
const agentSkillIdsBefore = ref([])

// 可引用技能候选（已发布 FDE 技能）——与 SkillPickerDialog 同源（listSkills status=published）。
const agentSkillOptions = ref([])
const agentSkillLoading = ref(false)
const agentSkillKeyword = ref('')
const agentSkillAtLimit = computed(() => agentDraft.value.skillIds.length >= LIMITS.SKILL_MAX)

async function loadAgentSkillOptions() {
  agentSkillLoading.value = true
  try {
    const kw = agentSkillKeyword.value.trim()
    const data = await listSkills({ page: 1, size: 200, status: 'published', ...(kw ? { keyword: kw } : {}) })
    agentSkillOptions.value = Array.isArray(data) ? data : data?.list || []
  } catch (e) {
    ElMessage.error(e?.message || '加载技能库失败')
    agentSkillOptions.value = []
  } finally {
    agentSkillLoading.value = false
  }
}
let agentSkillSearchTimer = null
watch(agentSkillKeyword, () => {
  if (!agentDrawerOpen.value) return
  if (agentSkillSearchTimer) clearTimeout(agentSkillSearchTimer)
  agentSkillSearchTimer = setTimeout(loadAgentSkillOptions, 300)
})

// 达上限后未勾选项置灰（模板已 disabled），此处兜底再拦一次并给文案（md §6.4 逐字）。
function toggleAgentSkill(skillId) {
  const list = agentDraft.value.skillIds
  const i = list.indexOf(skillId)
  if (i > -1) {
    list.splice(i, 1)
    return
  }
  if (list.length >= LIMITS.SKILL_MAX) {
    ElMessage.warning(`每个 Agent 最多引用 ${LIMITS.SKILL_MAX} 个技能`)
    return
  }
  list.push(skillId)
}

function openAgentDrawer(row, isNew) {
  agentDrawerIsNew.value = isNew
  agentEditId.value = isNew ? null : row.agentId
  const ids = isNew ? [] : (store.agents.find((a) => a.agentId === row.agentId)?.skills || []).map((s) => s.skillId)
  agentSkillIdsBefore.value = ids.slice()
  agentDraft.value = { name: isNew ? '' : row.name || '', description: isNew ? '' : row.description || '', skillIds: ids.slice() }
  agentSkillKeyword.value = ''
  agentDrawerOpen.value = true
  loadAgentSkillOptions()
}
async function openAgentCreate() {
  if (!(await ensurePersisted())) return
  if (agentAtLimit.value) {
    ElMessage.warning(`单岗位最多 ${LIMITS.AGENT_MAX} 个 Agent`)
    return
  }
  openAgentDrawer(null, true)
}
function openAgentEdit(row) {
  openAgentDrawer(row, false)
}

/** 把抽屉勾选结果同步到该 Agent 的技能引用：新增走 assign，取消走 detach。 */
async function syncAgentSkillRefs(agentId) {
  const before = agentSkillIdsBefore.value
  const after = agentDraft.value.skillIds
  for (const id of after.filter((x) => !before.includes(x))) {
    await store.assignSkillToAgent(id, agentId)
  }
  for (const id of before.filter((x) => !after.includes(x))) {
    await store.detachSkillFromAgent(agentId, id)
  }
}

async function saveAgentDraft() {
  const name = String(agentDraft.value.name || '').trim()
  const description = String(agentDraft.value.description || '').trim()
  if (!name) { ElMessage.warning('请填写 Agent 名称'); return }
  // md §6.2：职责描述必填（Q25④ 上限 500）
  if (!description) { ElMessage.warning('请填写职责描述'); return }
  agentSaving.value = true
  try {
    let agentId = agentEditId.value
    if (agentDrawerIsNew.value) {
      const created = await store.addAgent({ name, description, sortOrder: store.agents.length })
      agentId = created?.agentId
    } else {
      await store.patchAgent(agentId, { name, description })
    }
    if (agentId != null) await syncAgentSkillRefs(agentId)
    agentDrawerOpen.value = false
    // md §6.2：保存后提示「Agent 已保存」
    ElMessage.success('Agent 已保存')
  } catch (e) {
    ElMessage.error(e?.message || (e?.field === 'name' ? 'Agent 名已存在' : '保存失败'))
  } finally {
    agentSaving.value = false
  }
}

async function onReorderSkills(agentId, newSkills) {
  store.reorderSkillsLocal(agentId, newSkills)
  // 逐条 PUT sortOrder 持久化（决议 9 整体 PUT 思路，最小代价）
  try {
    await Promise.all(
      newSkills.map((s, i) => store.patchSkill(s.skillId, { sortOrder: i }))
    )
  } catch (e) {
    ElMessage.error('调序保存失败')
  }
}
// Agent↔Agent 跨泳道迁移：走 assign 端点（PUT /skills/{id}/assign）。收纳区退役后，仅服务白板内
// 把技能从一个 Agent 拖到另一个 Agent。
async function assignSkillTo(skillId, fromAgentId, toAgentId) {
  if (fromAgentId === toAgentId) return
  const target = store.agents.find((a) => a.agentId === toAgentId)
  try {
    await store.assignSkillToAgent(skillId, toAgentId)
    ElMessage.success(`已分配技能到 ${target?.name || 'Agent'}`)
  } catch (e) {
    // 1002 该 Agent 技能数上限 / 1003 跨岗位非法 / 其它
    if (e?.code === 1002) {
      ElMessage.error(`${target?.name || '该 Agent'} 技能数已达上限`)
    } else if (e?.code === 1003) {
      ElMessage.error('该技能不属于本岗位，无法分配')
    } else {
      ElMessage.error(e?.message || '分配失败')
    }
    // 失败：重拉详情回到后端真实态
    store.load(store.positionId)
  }
}

function onMoveSkill({ skillId, fromAgentId, toAgentId }) {
  assignSkillTo(skillId, fromAgentId, toAgentId)
}

/* ============================ 技能从 Agent 移除（V84 引用模型：可逆 detach） ============================
 * 从 Agent 移除 = 删该 Agent 对技能的引用行；技能本体留在库里、可在「技能」页查看，也可再拉入任意 Agent。
 * 取代旧「解绑=彻底游离、不可逆」语义（后端 detach 端点：DELETE /fde/agents/{agentId}/skills/{skillId}）。 */
async function onDeleteSkill({ agentId, skillId }) {
  try {
    // md 三.6.4：确认文案逐字「仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？」
    await ElMessageBox.confirm(
      '仅解除技能与当前 Agent 的关联，不删除技能本身。确认移除？',
      '移除技能',
      {
        type: 'warning',
        confirmButtonText: '移除',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  try {
    await store.detachSkillFromAgent(agentId, skillId)
    ElMessage.success('已移除')
  } catch (e) {
    ElMessage.error(e?.message || '移除失败')
  }
}
</script>

<template>
  <div class="pd-pane">
    <!-- #13 表格包卡：照原型 agent-task-feedback-refinement 的 sync-agent-card（卡头 + 卡体裹表） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">Agent 与技能</span>
        <span class="pd-card-sub">每个 Agent 是一组技能 · 主实例按职责描述委派子任务</span>
        <span class="pd-card-spacer"></span>
        <el-button v-if="!isReadonly" type="primary" size="small" :disabled="agentAtLimit" @click="openAgentCreate">
          {{ agentAtLimit ? `已达 ${LIMITS.AGENT_MAX} 个上限` : '＋ 新增 Agent' }}
        </el-button>
      </div>
      <div class="pd-card-body pd-card-body--flush">
        <el-table :data="agentSkillRows" class="pd-table pd-table--tree" row-key="rowKey"
                  :row-class-name="({ row }) => row.kind === 'agent' ? 'pd-row-agent' : 'pd-row-skill'"
                  empty-text="暂无 Agent，点「＋ 新增 Agent」创建">
          <el-table-column label="AGENT / 技能" min-width="220">
            <template #default="{ row }">
              <span v-if="row.kind === 'agent'" class="pd-agent-name">◆ {{ row.name }}</span>
              <span v-else class="pd-skill-name">· {{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="职责描述 / 分类" min-width="320">
            <template #default="{ row }">
              <span v-if="row.kind === 'agent'" class="pd-agent-desc">{{ row.description || '—' }}</span>
              <el-tag v-else size="small" type="info" effect="plain">{{ skillCategoryText(row.category) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="工具" width="120" align="center">
            <template #default="{ row }">
              <span v-if="row.kind === 'agent'" class="pd-faint">—</span>
              <span v-else>{{ row.tools }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <span v-if="isReadonly" class="pd-faint">只读</span>
              <!-- #14：Agent 行不再有「＋技能」（原型 L4025 已删该按钮），技能改在抽屉内勾选 -->
              <template v-else-if="row.kind === 'agent'">
                <el-button link type="primary" @click="openAgentEdit(row)">编辑</el-button>
                <el-button link type="danger" @click="onAgentDelete(row.agentId)">删除</el-button>
              </template>
              <template v-else>
                <!-- #15：技能「编辑」同页跳转整页编辑器，返回回到本页签 -->
                <el-button link type="primary" @click="openSkillFullPage(row.skillId)">编辑</el-button>
                <el-button link type="danger" @click="onDeleteSkill({ agentId: row.agentId, skillId: row.skillId })">移除</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>

  <!-- #14 新建 / 编辑 Agent 同一抽屉（680px，照原型 position-agent-drawer）：基本信息 + 引用技能勾选区 -->
  <DrawerEditor v-model:visible="agentDrawerOpen" :title="agentDrawerIsNew ? '新建 Agent' : '编辑 Agent'" size="680px" append-to-body>
    <!-- 2026-09-10 S3（岗位详情原型对齐排查·负责人裁决）：名称 / 职责描述包进「基本信息」分组卡
         （照原型抽屉分组形态，与下方「引用技能」卡同款 .pd-card 家族） -->
    <section class="pd-card">
      <div class="pd-card-head">
        <span class="pd-card-title">基本信息</span>
      </div>
      <div class="pd-card-body">
        <el-form label-position="top" class="pd-drawer-form">
          <!-- 字段上限按 md §6.2：名称 64（Q25⑤ 全局名称类统一 64，原型 60 不跟进）、
               职责描述必填 ≤500（Q25④ 补充说明「取 500，尽量减少例外情况」） -->
          <el-form-item label="Agent 名称" required>
            <el-input v-model="agentDraft.name" maxlength="64" show-word-limit placeholder="如：客户洞察" />
          </el-form-item>
          <el-form-item label="职责描述" required>
            <el-input v-model="agentDraft.description" type="textarea" :rows="5" maxlength="500" show-word-limit
                      placeholder="决定主实例把子任务委派给这个 Agent 时的执行口径" />
          </el-form-item>
        </el-form>
      </div>
    </section>

    <!-- 引用技能勾选区（md §6.4）：达 100 上限后未勾选项置灰 -->
    <section class="pd-card pd-agent-skills">
      <div class="pd-card-head">
        <span class="pd-card-title">引用技能</span>
        <span class="pd-card-sub">直接在当前编辑页勾选，可引用已发布技能</span>
        <span class="pd-card-spacer"></span>
        <span class="pd-agent-skill-count">已勾选：{{ agentDraft.skillIds.length }}/{{ LIMITS.SKILL_MAX }}</span>
      </div>
      <div class="pd-card-body">
        <el-input v-model="agentSkillKeyword" placeholder="搜索技能名称、描述或标识" clearable />
        <div v-loading="agentSkillLoading" class="pd-agent-skill-list">
          <div v-if="!agentSkillLoading && !agentSkillOptions.length" class="pd-agent-skill-empty">
            暂无可引用的已发布技能
          </div>
          <el-checkbox
            v-for="opt in agentSkillOptions"
            :key="opt.id"
            :model-value="agentDraft.skillIds.includes(opt.id)"
            :disabled="agentSkillAtLimit && !agentDraft.skillIds.includes(opt.id)"
            class="pd-agent-skill-row"
            @change="toggleAgentSkill(opt.id)"
          >
            <span class="pd-agent-skill-main">
              <strong>{{ opt.name }}</strong>
              <small>{{ opt.description || '暂无描述' }}</small>
            </span>
          </el-checkbox>
        </div>
      </div>
    </section>

    <template #footer>
      <el-button @click="agentDrawerOpen = false">取消</el-button>
      <el-button type="primary" :loading="agentSaving" @click="saveAgentDraft">{{ agentDrawerIsNew ? '新建' : '保存' }}</el-button>
    </template>
  </DrawerEditor>
</template>

<style scoped>
/* 样式随模板自 PositionDetailTabs.vue 原样搬入（病 A 拆分）：
   .pd-card 家族在人格与 Agent 两页签各自成 scope 复制一份——scoped 样式不穿子组件内层 DOM，
   留父层需改 :deep 且罩不住 append-to-body 的抽屉内容（抽屉里的引用技能卡），按页签就近持有。 */
/* 常规内容页：照原型 pd2-pane 居中限宽（max-width 1180px），卡片纵向排布 */
.pd-pane {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-5) 0 var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
/* ---- Agent 与技能：层级列表（Agent 行加粗，技能行缩进） ---- */
.pd-agent-name {
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.pd-skill-name {
  padding-left: var(--space-4);
  color: var(--c-text-base);
}
.pd-agent-desc {
  color: var(--c-text-base);
}
/* Agent 行底纹（原型 .sync-agent-row td{background:#f8faf9}）。
   原写法引的 --bg-subtle / --fill-subtle 两个令牌在 tokens.css 里都不存在，
   规则一直是哑的（对表实测底色 transparent）；改用确实存在且双主题都定义了的
   --bg-admin-card-head（浅色恰为 #f8faf9，暗色映射到 --bg-sunken）。
   背景要落在 td 上：EP 的单元格自带 background，打在 tr 上会被盖住。 */
.pd-table :deep(.pd-row-agent > td.el-table__cell) {
  background: var(--bg-admin-card-head);
}
/* 固定列（操作列 fixed="right"）在 theme.css 里被钉了不透明 --bg-surface 打底
   （防横向滚动透底），特指度高于上一条，Agent 行的底纹会在操作列断掉。
   这里按同款特指度把固定列也刷成 Agent 行底纹，保证整行一色。 */
.pd-table :deep(.el-table__body > tr.pd-row-agent > td.el-table-fixed-column--right),
.pd-table :deep(.el-table__body > tr.pd-row-agent > td.el-table-fixed-column--left) {
  background-color: var(--bg-admin-card-head);
}
.pd-table :deep(.pd-row-agent > td) {
  border-top: 1px solid var(--border-base);
}

/* ---- 2026-09-10 B 路逐像素对齐（原型 .sync-table，全量盒模型对表） ----
 * 原型表格是紧凑密度：行高 43px（表头 41px）、单元格 padding 11px 12px、
 * 首末列 18px 外边距、字号 13px；Agent 行整行加粗 + 底纹。现状继承站内通用
 * el-table 密度（行 60px / 表头 48px / 字号 14px），观感明显松散于原型。
 * 只在本页签的 .pd-table--tree 内收紧，不动 theme.css 的全站表格规则。 */
/* admin-shell.css 给全站列表表格钉了 th 48px / td 60px 的行高（那是列表页密度，
   照原型列表页定的）；本页签是卡内嵌套表，原型密度为 th 41px / 行 43px，故在
   .pd-table--tree 内把高度交回内容撑（height:auto），只保留单元格 padding。 */
/* 特指度须压过 admin-shell.css 的 `body.admin-scope .el-table td.el-table__cell`
   (0,2,3)，故这里带上 .el-table 一段凑到 (0,3,2)。 */
.pd-table--tree.el-table :deep(th.el-table__cell),
.pd-table--tree.el-table :deep(td.el-table__cell) {
  height: auto;
  padding: 0;
}
.pd-table--tree.el-table :deep(.el-table__cell .cell) {
  padding: 11px 12px;
  font-size: var(--fs-sm);
  line-height: 1.6;
}
/* 表头底色：原型卡内表头是浅灰 #f7f9f8（比列表页表头 --bg-admin-table-head
   #f2f5f3 更淡），与卡头灰条同层级，故复用 --bg-admin-card-head；
   字重跟原型的 600（站内列表页表头为 500）。 */
.pd-table--tree.el-table {
  --el-table-header-bg-color: var(--bg-admin-card-head);
}
.pd-table--tree.el-table :deep(th.el-table__cell) {
  font-weight: var(--fw-semibold);
}
/* 首末列贴卡边 18px（原型 .sync-agent-card-body 覆写） */
.pd-table--tree.el-table :deep(.el-table__cell:first-child .cell) {
  padding-left: var(--space-5);
}
.pd-table--tree.el-table :deep(.el-table__cell:last-child .cell) {
  padding-right: var(--space-5);
}
/* Agent 行整行加粗（原型 .sync-agent-row td{font-weight:600}） */
.pd-table--tree.el-table :deep(.pd-row-agent > td .cell) {
  font-weight: var(--fw-semibold);
}

/* ---- Agent 与技能：表格包卡 + 抽屉内引用技能勾选区（2026-09-09 原型复刻批次 4C #13/#14） ---- */
.pd-agent-skills {
  margin-top: var(--space-4);
}
.pd-agent-skill-count {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
}
.pd-agent-skill-list {
  max-height: 46vh;
  overflow-y: auto;
  /* 原型 .position-agent-skill-list 实测高 282px（约 4 行常显）；
     现状 min-height 100px 只露 2 行，勾选区显得局促。 */
  min-height: 282px;
}
.pd-agent-skill-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  height: auto;
  margin: 0;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-soft);
}
.pd-agent-skill-row :deep(.el-checkbox__label) {
  flex: 1;
  min-width: 0;
  white-space: normal;
}
.pd-agent-skill-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pd-agent-skill-main strong {
  color: var(--c-text-strong);
  font-weight: var(--fw-medium);
}
.pd-agent-skill-main small {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-agent-skill-empty {
  padding: var(--space-6);
  text-align: center;
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
/* ---- 人格页签卡片样式的 Agent 页签用份（照原型 pd2-section：白底/描边/圆角卡，头行 + 分隔线 + 体） ---- */
.pd-card {
  background: var(--bg-surface);
  /* 盒模型对表：卡描边走 --border-admin-card（浅色 #dde4e0 ≈ 原型 .sync-agent-card
     的 #dfe5e1，暗色自动落 --border-base）；--border-base 在浅色下是 10% 黑半透明，
     比原型描边淡一档。与采集 / 知识两页签同源。 */
  border: 1px solid var(--border-admin-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.pd-card-head {
  /* 原型 .pd2-task-section-head 实测 46px（现状 50px 略高半档） */
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 原型 .pd2-task-section-head：左右 18px、上下由 min-height 撑（无竖向 padding） */
  padding: 0 var(--space-5);
  /* 2026-09-10 像素账本 G3 附带：卡头分隔线与卡描边同浓度（原不透明 vs 半透明差一档） */
  border-bottom: 1px solid var(--border-admin-card);
  /* 卡头灰条走站内 --bg-admin-card-head（浅色 #f8faf9 = 原型同值，暗色有映射），
     与采集 / 知识两页签同源（PositionIntakeTab、PositionKnowledgeTab 已用此令牌）。 */
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
/* 表格直接贴卡体边（卡头已有分隔线，卡体不再补内边距）。
   原型 .sync-agent-card-body{padding:0} 且不是 flex 容器——现状 .pd-card-body
   的 display:flex + gap:8px 会在表格外再垫一圈，一并归零。
   注：必须排在 .pd-card-body 之后（同特指度靠源码顺序决胜）。 */
.pd-card-body--flush {
  display: block;
  padding: 0;
  gap: 0;
}
</style>
