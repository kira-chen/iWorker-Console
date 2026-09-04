import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getPosition,
  updatePosition,
  createAgent,
  updateAgent,
  deleteAgent,
  createSkill,
  updateSkill,
  assignSkill,
  getSkill,
  deleteSkill,
  detachSkill as detachSkillApi
} from '@/api/position'

/**
 * 岗位白板工作台 store。
 *
 * 职责：加载岗位详情树（身份卡 + Agent 泳道 + 技能卡），维护工作台编辑态，封装 Agent/技能的增删改，
 * 向组件暴露稳定的派生视图。
 *
 * 不在 store 内做 UI（聚焦/工具坞/弹窗）状态——那些是组件本地态；
 * store 只持有「数据真相 + 后端读写」，组件按需取派生数据。
 *
 * 删 Agent（新口径·用户拍板「删Agent技能脱钩」）：其下技能**彻底脱离岗位变游离技能**，不再以「未绑定 Agent」
 * 收纳泳道留在白板。白板只呈现「岗位 → Agent → 已挂载技能」；游离技能只在「技能」管理页(/admin/skills)以
 * 「未被引用」呈现。故 store 不再持有 orphanSkills / loadUnboundSkills / ORPHAN_AGENT_ID 等收纳区概念（已退役）。
 */

export const usePositionStore = defineStore('position', () => {
  const detail = ref(null) // PositionDetailVO（含 agents[].skills[]）
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('') // 加载失败信息（错误态）

  // 身份卡基本信息（就地编辑双向同步源）——从 detail 拆出，便于局部更新而不整树替换
  const basic = ref(null)

  /* ---------- 派生视图 ---------- */
  const positionId = computed(() => detail.value?.positionId ?? null)
  const status = computed(() => detail.value?.status || 'draft')
  const isPublished = computed(() => status.value === 'published')

  // 绑定到 Agent 的泳道（agentId 非空），保持 sortOrder
  const agents = computed(() => detail.value?.agents || [])

  // 全岗位（已挂载）技能扁平列表（全局搜索 + 跨 Agent 跳用）：[{ skill, agentId, agentName }]。
  // 收纳区已退役 → 仅含挂在某 Agent 下的技能（游离技能不在白板、不在此列表）。
  const allSkills = computed(() => {
    const out = []
    for (const a of agents.value) {
      for (const s of a.skills || []) out.push({ skill: s, agentId: a.agentId, agentName: a.name })
    }
    return out
  })

  // 发布前检查所需的聚合数据（供 computePublishCheck）
  // 2026-09-04 PRD-20260903 对齐：推荐问题 4 条 → 示例问题 3 条。
  const checkInput = computed(() => ({
    name: basic.value?.name,
    intro: basic.value?.intro,
    intakeSchema: basic.value?.intakeSchema || [],
    exampleQuestions: basic.value?.exampleQuestions || [],
    agents: agents.value
  }))

  /* ---------- 加载 ---------- */
  // silent=true：后台静默刷新（不切 loading 骨架），用于「整页编辑后回白板 window-focus refetch」，
  // 避免每次切回标签都把白板闪成骨架屏（窗口聚焦/可见性回切时的闪烁修复）。
  // req3（§4.1/§7-B2）：Agent 级引用平台技能直接引用通道已下线——load 不再并行拉 skillRefs。
  async function load(id, { silent = false } = {}) {
    if (!silent) loading.value = true
    error.value = ''
    try {
      const data = await getPosition(id)
      hydrate(data)
      return data
    } catch (e) {
      // 静默刷新失败不打扰：保留现有详情，不置 error 态（避免回切标签时整页变错误态）。
      if (!silent) error.value = e?.message || '加载岗位失败'
      if (!silent) throw e
    } finally {
      if (!silent) loading.value = false
    }
  }

  // 把详情灌入 store，拆出 basic（身份卡字段）。收纳区已退役，不再处理 orphanSkills 字段。
  // （此前为修「收纳泳道闪烁」做的 orphanSkills 保留防御随收纳区下线一并删除——问题域已消失。）
  function hydrate(data) {
    if (!data) return
    detail.value = data
    basic.value = {
      name: data.name || '',
      intro: data.intro || '',
      // 岗位描述（2026-08-26 开放编辑）：展示给使用者的一段介绍，对外 positions[].description
      description: data.description || '',
      icon: data.icon || '',
      iconSource: data.iconSource || 'library',
      // claimDesc 由 String → 数组 [{emoji,content}]（后端兜底恒为数组）；防御非数组回退空数组
      claimDesc: Array.isArray(data.claimDesc) ? data.claimDesc : [],
      // 2026-09-04 PRD-20260903 对齐：岗位认领说明（纯文本列表）/ 示例问题（3 条）/ 岗位 SOP / 引用业务系统
      claimDescriptions: Array.isArray(data.claimDescriptions) ? data.claimDescriptions : [],
      exampleQuestions: normalizeExample(data.exampleQuestions),
      positionSop: data.positionSop || '',
      businessSystemIds: Array.isArray(data.businessSystemIds) ? data.businessSystemIds : [],
      persona: data.persona || '',
      intakeSchema: Array.isArray(data.intakeSchema) ? data.intakeSchema : [],
      // N4 岗位推荐问题（客户端会谈 R2）：固定 4 格。存量未配置回填空 4 格，保证编辑器始终渲染 4 个输入框。
      recommendedQuestions: normalizeRecommended(data.recommendedQuestions)
    }
  }

  // 示例问题归一为固定 3 格（2026-09-04 PRD-20260903 对齐）。
  function normalizeExample(list) {
    const arr = Array.isArray(list) ? list.map((q) => (q == null ? '' : String(q))) : []
    return [0, 1, 2].map((i) => arr[i] ?? '')
  }

  // N4：把后端返回的推荐问题归一为固定 4 格数组（不足补空、超出截断），供编辑器 4 个输入框稳定绑定。
  function normalizeRecommended(list) {
    const arr = Array.isArray(list) ? list.map((q) => (q == null ? '' : String(q))) : []
    return [0, 1, 2, 3].map((i) => arr[i] ?? '')
  }

  // 新建态：未落库的空白岗位（id=null），保存后由调用方 hydrate 真实详情
  function initNew() {
    detail.value = { positionId: null, status: 'draft', agents: [] }
    basic.value = {
      name: '',
      intro: '',
      description: '',
      icon: '',
      iconSource: 'library',
      claimDesc: [], // 领用页文案多条数组（设计 §3）
      claimDescriptions: [], // 岗位认领说明（2026-09-04 PRD-20260903 对齐）
      exampleQuestions: ['', '', ''], // 示例问题固定 3 条
      positionSop: '',
      businessSystemIds: [],
      persona: '',
      intakeSchema: [],
      recommendedQuestions: ['', '', '', ''] // N4 固定 4 格
    }
  }

  /* ---------- 身份卡保存（基本信息 + 采集 schema） ---------- */
  // 返回 { warnings }；失败抛 ApiError（字段级回显由组件处理）。
  async function saveBasic(payload) {
    saving.value = true
    try {
      // 推荐问题部分更新语义：payload 未含 recommendedQuestions 即「不改」（半填时不上送，见工作台 buildBasicPayload）。
      // 此时须保留本地正在编辑的半填内容——否则 hydrate 用服务端旧值/空回显整体重灌 basic，会把用户尚未填满的
      // 输入清空（「编辑人格·推荐问题」输入几秒后被自动保存清空 bug 的根因）。
      const keepRecommended =
        payload.recommendedQuestions === undefined ? basic.value?.recommendedQuestions : null
      const data = await updatePosition(positionId.value, payload)
      hydrate(data)
      if (keepRecommended) basic.value.recommendedQuestions = keepRecommended
      return { warnings: data?.warnings || [] }
    } finally {
      saving.value = false
    }
  }

  /* ---------- Agent 增删改 ---------- */
  async function addAgent(payload) {
    const agent = await createAgent(positionId.value, payload)
    const a = { ...agent, skills: agent.skills || [] }
    detail.value.agents = [...agents.value, a]
    return a
  }

  async function patchAgent(agentId, payload) {
    const updated = await updateAgent(agentId, payload)
    detail.value.agents = agents.value.map((a) =>
      a.agentId === agentId ? { ...a, ...updated, skills: a.skills } : a
    )
    return updated
  }

  // 删 Agent（新口径）：后端把其下技能**彻底脱离岗位变游离技能**（agent_id + position_id 一并置空，回
  // orphanedSkillCount = 受影响技能数）。前端只需把该 Agent 从白板移除——游离技能不再出现在白板任何位置
  // （收纳区已退役），其去向是「技能」管理页的「未被引用」。返回 res 供组件读 orphanedSkillCount 做提示/跳转。
  async function removeAgent(agentId) {
    const res = await deleteAgent(agentId)
    detail.value.agents = agents.value.filter((a) => a.agentId !== agentId)
    return res
  }

  /* ---------- 技能增删改 ---------- */
  async function addSkill(agentId, payload) {
    const skill = await createSkill(agentId, payload)
    detail.value.agents = agents.value.map((a) =>
      a.agentId === agentId ? { ...a, skills: [...(a.skills || []), skill] } : a
    )
    return skill
  }

  // 编辑技能本体（name/triggers/skillMd/sortOrder 等，不含 Agent 归属变更）。返回 { skill, warnings }。
  // Agent 归属变更 / 重分配统一走 assignSkillToAgent（PUT /skills/{id}/assign），不再用此端点的 targetAgentId。
  async function patchSkill(skillId, payload) {
    const skill = await updateSkill(skillId, payload)
    applySkillUpdate(skillId, skill)
    return { skill, warnings: skill?.warnings || [] }
  }

  // 把后端返回的技能本体字段原地合并回树（不改归属）。技能可能在某 Agent 或收纳区。
  //
  // 形状归一（修复「关闭编辑器后技能卡工具行闪现几秒后消失」）：
  // 技能本体编辑走 PUT /skills/{id}，回显是「detail 形状」（可能带 referencedTools），而总览态
  // 技能卡渲染走「列表 summary 形状」。若把 detail 的 referencedTools 灌进总览卡，会让卡片瞬时
  // 多出工具徽标行，随后任意 refetch（summary 形状）又把它覆盖 → 跳变。
  // 这里在合并时剥离 detail-only 字段（referencedTools），让卡片在总览态始终保持 summary 形状、
  // 关闭编辑器前后一致；referencedTools 的权威来源是列表/详情加载，不由本体编辑的 PUT 回显引入。
  function applySkillUpdate(skillId, skill) {
    const { referencedTools, ...summary } = skill || {}
    let curAgentId = null
    let found = false
    for (const a of agents.value) {
      if ((a.skills || []).some((s) => s.skillId === skillId)) {
        curAgentId = a.agentId
        found = true
        break
      }
    }
    if (found) {
      detail.value.agents = agents.value.map((a) =>
        a.agentId === curAgentId
          ? { ...a, skills: (a.skills || []).map((s) => (s.skillId === skillId ? { ...s, ...summary } : s)) }
          : a
      )
    }
  }

  // 分配 / 改挂 Agent（统一端点 PUT /skills/{id}/assign）。收纳区退役后，仅服务**白板 Agent↔Agent 跨泳道迁移**
  // （拖拽把技能从一个 Agent 拖到另一个 Agent）。游离技能不在白板、无重绑入口（后端亦守卫游离技能不可 assign）。
  async function assignSkillToAgent(skillId, targetAgentId) {
    const skill = await assignSkill(skillId, targetAgentId)
    applySkillAssign(skillId, targetAgentId, skill)
    return { skill, warnings: skill?.warnings || [] }
  }

  // 把技能从原 Agent 移动到目标 Agent（Agent↔Agent 迁移），并合并后端回显字段。
  function applySkillAssign(skillId, targetAgentId, skill) {
    let curAgentId = null
    let moved = null
    for (const a of agents.value) {
      const hit = (a.skills || []).find((s) => s.skillId === skillId)
      if (hit) {
        curAgentId = a.agentId
        moved = hit
        break
      }
    }
    if (curAgentId === targetAgentId) {
      // 归属未变（兜底）：仅原地合并
      applySkillUpdate(skillId, skill || {})
      return
    }
    // 从原 Agent 移除
    detail.value.agents = agents.value.map((a) =>
      a.agentId === curAgentId ? { ...a, skills: (a.skills || []).filter((s) => s.skillId !== skillId) } : a
    )
    // 落到目标 Agent（合并后端回显，置 agentId）
    const next = { ...(moved || {}), ...(skill || {}), agentId: targetAgentId }
    detail.value.agents = agents.value.map((a) =>
      a.agentId === targetAgentId ? { ...a, skills: [...(a.skills || []), next] } : a
    )
  }

  async function removeSkill(skillId) {
    await deleteSkill(skillId)
    detail.value.agents = agents.value.map((a) => ({
      ...a,
      skills: (a.skills || []).filter((s) => s.skillId !== skillId)
    }))
  }

  // 从指定 Agent 移除技能引用（V84 引用模型，可逆：调 detach 端点删引用行，技能本体留库可再引用）。
  // 白板本地把该技能从该 Agent 泳道移除；技能仍在「技能」管理页可见、可再拉入任意 Agent。
  async function detachSkillFromAgent(agentId, skillId) {
    await detachSkillApi(agentId, skillId)
    detail.value.agents = agents.value.map((a) =>
      a.agentId === agentId ? { ...a, skills: (a.skills || []).filter((s) => s.skillId !== skillId) } : a
    )
  }

  /* ---------- 调序（决议 9：逐条 PUT 持久化；跨泳道迁移见 assignSkillToAgent） ---------- */
  // 同泳道内技能重排：本地先更新顺序，再按新顺序逐条 PUT sortOrder（最小代价持久化）。
  function reorderSkillsLocal(agentId, newSkills) {
    detail.value.agents = agents.value.map((a) =>
      a.agentId === agentId ? { ...a, skills: newSkills } : a
    )
  }

  // 取某技能详情（聚焦态加载 referencedTools）
  function fetchSkillDetail(skillId) {
    return getSkill(skillId)
  }

  function reset() {
    detail.value = null
    basic.value = null
    loading.value = false
    saving.value = false
    error.value = ''
  }

  return {
    detail,
    basic,
    loading,
    saving,
    error,
    positionId,
    status,
    isPublished,
    agents,
    allSkills,
    checkInput,
    load,
    hydrate,
    initNew,
    saveBasic,
    addAgent,
    patchAgent,
    removeAgent,
    addSkill,
    patchSkill,
    assignSkillToAgent,
    removeSkill,
    detachSkillFromAgent,
    reorderSkillsLocal,
    fetchSkillDetail,
    reset
  }
})
