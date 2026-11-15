import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getPosition,
  updatePosition,
  updateSkill,
  attachPositionSkill,
  detachPositionSkill,
  getSkill,
  getPositionExperts,
  bindPositionExpert,
  unbindPositionExpert,
  bindPositionTeam,
  unbindPositionTeam
} from '@/api/position'

/**
 * 岗位白板工作台 store。
 *
 * 职责：加载岗位详情（身份卡 + 技能引用 + 专家与专家团引用），维护工作台编辑态，封装技能 / 专家引用的增删，
 * 向组件暴露稳定的派生视图。
 *
 * 2026-11-09 产品优化需求-202611：R1 取消 Agent，技能直接引用到岗位（detail.skills[]）；
 * R13 新增「专家与专家团」引用（expertRefs，单独接口加载，见 api/positionMock.js getPositionExperts 注释）。
 *
 * 不在 store 内做 UI（聚焦/工具坞/弹窗）状态——那些是组件本地态；
 * store 只持有「数据真相 + 后端读写」，组件按需取派生数据。
 */

export const usePositionStore = defineStore('position', () => {
  const detail = ref(null) // PositionDetailVO（含 skills[]）
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('') // 加载失败信息（错误态）

  // 身份卡基本信息（就地编辑双向同步源）——从 detail 拆出，便于局部更新而不整树替换
  const basic = ref(null)

  /* ---------- 派生视图 ---------- */
  const positionId = computed(() => detail.value?.positionId ?? null)
  const status = computed(() => detail.value?.status || 'draft')
  const isPublished = computed(() => status.value === 'published')

  // 岗位引用的技能（保持 sortOrder）
  const skills = computed(() => detail.value?.skills || [])

  // 岗位引用的岗位私有专家 / 专家团（R13）：{ experts[], teams[], execTargetIssues[] }
  // execTargetIssues = 执行对象已不能用的自动化任务（发布前检查阻断项）
  const expertRefs = ref({ experts: [], teams: [], execTargetIssues: [] })
  const experts = computed(() => expertRefs.value.experts || [])
  const teams = computed(() => expertRefs.value.teams || [])

  // 发布前检查所需的聚合数据（供 computePublishCheck）
  // 2026-09-04 PRD-20260903 对齐：推荐问题 4 条 → 示例问题 3 条。
  // 2026-09-08 PRD-20260908 对齐：清单改 md §9.2 四项（名称与描述 / 示例问题 / SOP / 技能警告），补 description、positionSop。
  // R13：带上专家 / 专家团引用，供「引用不可用对象」动态阻断项（computePublishCheck）。
  const checkInput = computed(() => ({
    name: basic.value?.name,
    icon: basic.value?.icon,
    intro: basic.value?.intro,
    description: basic.value?.description,
    claimDescriptions: basic.value?.claimDescriptions || [],
    positionSop: basic.value?.positionSop,
    intakeSchema: basic.value?.intakeSchema || [],
    exampleQuestions: basic.value?.exampleQuestions || [],
    skills: skills.value,
    experts: experts.value,
    teams: teams.value,
    execTargetIssues: expertRefs.value.execTargetIssues || []
  }))

  /* ---------- 加载 ---------- */
  // silent=true：后台静默刷新（不切 loading 骨架），用于「整页编辑后回白板 window-focus refetch」，
  // 避免每次切回标签都把白板闪成骨架屏（窗口聚焦/可见性回切时的闪烁修复）。
  // R13：专家与专家团引用走单独接口，与详情并行拉取。
  async function load(id, { silent = false } = {}) {
    if (!silent) loading.value = true
    error.value = ''
    try {
      const [data, refs] = await Promise.all([getPosition(id), loadExpertRefs(id)])
      hydrate(data)
      expertRefs.value = refs
      return data
    } catch (e) {
      // 静默刷新失败不打扰：保留现有详情，不置 error 态（避免回切标签时整页变错误态）。
      if (!silent) error.value = e?.message || '加载岗位失败'
      if (!silent) throw e
    } finally {
      if (!silent) loading.value = false
    }
  }

  // 专家与专家团引用取失败不拖垮整页：降级为空（页签显示空态，发布前检查少了这一类动态阻断项）
  async function loadExpertRefs(id) {
    try {
      return (await getPositionExperts(id)) || { experts: [], teams: [] }
    } catch {
      return { experts: [], teams: [] }
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
      // 2026-09-04 PRD-20260903 对齐：领用页文案 claimDescriptions（纯文本列表，2026-09-08 改名）/ 示例问题（3 条）/ 岗位 SOP / 引用业务系统
      claimDescriptions: Array.isArray(data.claimDescriptions) ? data.claimDescriptions : [],
      exampleQuestions: normalizeExample(data.exampleQuestions),
      positionSop: data.positionSop || '',
      positionSopBrief: data.positionSopBrief || '', // SOP 简版（产品优化需求-202611 修改点 18）
      businessSystemIds: Array.isArray(data.businessSystemIds) ? data.businessSystemIds : [],
      // 连接器页签的岗位私有 MCP / API 引用清单（md 岗位 §8.1 L498 / §8.2 L516）。此前漏了这两个键，
      // 页签读到恒 undefined，四个种子岗位的私有 MCP / API 区域永远是空的（待办 yuepu#42）
      connectorMcpIds: Array.isArray(data.connectorMcpIds) ? data.connectorMcpIds : [],
      connectorApiIds: Array.isArray(data.connectorApiIds) ? data.connectorApiIds : [],
      persona: data.persona || '',
      intakeSchema: Array.isArray(data.intakeSchema) ? data.intakeSchema : []
    }
  }

  // 示例问题归一为固定 3 格（2026-09-04 PRD-20260903 对齐）。
  function normalizeExample(list) {
    const arr = Array.isArray(list) ? list.map((q) => (q == null ? '' : String(q))) : []
    return [0, 1, 2].map((i) => arr[i] ?? '')
  }

  // 新建态：未落库的空白岗位（id=null），保存后由调用方 hydrate 真实详情
  function initNew() {
    detail.value = { positionId: null, status: 'draft', skills: [] }
    expertRefs.value = { experts: [], teams: [] }
    basic.value = {
      name: '',
      intro: '',
      description: '',
      icon: '',
      iconSource: 'library',
      claimDesc: [], // 领用页文案多条数组（设计 §3）
      claimDescriptions: [], // 领用页文案（原岗位认领说明，2026-09-08 PRD-20260908 改名）
      exampleQuestions: ['', '', ''], // 示例问题固定 3 条
      positionSop: '',
      positionSopBrief: '',
      businessSystemIds: [],
      connectorMcpIds: [],
      connectorApiIds: [],
      persona: '',
      intakeSchema: []
    }
  }

  /* ---------- 身份卡保存（基本信息 + 采集 schema） ---------- */
  // 返回 { warnings }；失败抛 ApiError（字段级回显由组件处理）。
  async function saveBasic(payload) {
    saving.value = true
    try {
      const data = await updatePosition(positionId.value, payload)
      hydrate(data)
      return { warnings: data?.warnings || [] }
    } finally {
      saving.value = false
    }
  }

  /* ---------- 技能引用（R1：直接引用到岗位） ---------- */
  async function attachSkill(skillId) {
    const ref = await attachPositionSkill(positionId.value, skillId)
    if (!skills.value.some((s) => s.skillId === ref.skillId)) detail.value.skills = [...skills.value, ref]
    return ref
  }

  // 移除引用（可逆：技能本体留库，可在「技能」管理页查看、再引用）
  async function detachSkill(skillId) {
    await detachPositionSkill(positionId.value, skillId)
    detail.value.skills = skills.value.filter((s) => s.skillId !== skillId)
  }

  /* ---------- 专家与专家团引用（R13） ---------- */
  // 发布前重拉一次：自动化任务的执行对象可能刚在「自动化任务」页签改过，execTargetIssues 要跟着变
  async function refreshExpertRefs() {
    if (positionId.value == null) return
    expertRefs.value = await loadExpertRefs(positionId.value)
  }

  async function bindExpert(expertId) {
    expertRefs.value = await bindPositionExpert(positionId.value, expertId)
  }
  async function unbindExpert(expertId) {
    expertRefs.value = await unbindPositionExpert(positionId.value, expertId)
  }
  async function bindTeam(teamId) {
    expertRefs.value = await bindPositionTeam(positionId.value, teamId)
  }
  async function unbindTeam(teamId) {
    expertRefs.value = await unbindPositionTeam(positionId.value, teamId)
  }

  /* ---------- 技能本体编辑 ---------- */

  // 编辑技能本体（name/triggers/skillMd/sortOrder 等）。返回 { skill, warnings }。
  async function patchSkill(skillId, payload) {
    const skill = await updateSkill(skillId, payload)
    applySkillUpdate(skillId, skill)
    return { skill, warnings: skill?.warnings || [] }
  }

  // 把后端返回的技能本体字段原地合并回岗位的技能引用。
  //
  // 形状归一（修复「关闭编辑器后技能卡工具行闪现几秒后消失」）：
  // 技能本体编辑走 PUT /skills/{id}，回显是「detail 形状」（可能带 referencedTools），而岗位页签
  // 渲染走「列表 summary 形状」。这里在合并时剥离 detail-only 字段（referencedTools），让行在
  // 总览态始终保持 summary 形状；referencedTools 的权威来源是列表/详情加载，不由本体编辑的 PUT 回显引入。
  function applySkillUpdate(skillId, skill) {
    const { referencedTools, ...summary } = skill || {}
    if (!skills.value.some((s) => s.skillId === skillId)) return
    detail.value.skills = skills.value.map((s) => (s.skillId === skillId ? { ...s, ...summary } : s))
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
    expertRefs.value = { experts: [], teams: [] }
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
    skills,
    experts,
    teams,
    checkInput,
    load,
    hydrate,
    initNew,
    saveBasic,
    attachSkill,
    detachSkill,
    refreshExpertRefs,
    bindExpert,
    unbindExpert,
    bindTeam,
    unbindTeam,
    patchSkill,
    fetchSkillDetail,
    reset
  }
})
