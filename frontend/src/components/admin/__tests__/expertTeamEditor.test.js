// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { h, reactive } from 'vue'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * ExpertTeamEditor.vue 真实挂载用例（2026-10-12 专家团管理端）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家团.md §三（编辑页）：
 *   §三.1 三态标题与底部按钮 / §三.2 团类型未选时成员区置灰 / §三.3 成员与主理人（设主理人团分工说明）/
 *   §三.4 协作关系「没设主理人必填、设了选填」/ §三.7 AI 生成置灰条件 / §三.8 保存校验。
 * 真 Element Plus + 真 DrawerEditor，只 mock api 层。
 */

const api = {
  getTeam: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  listTeamMemberCandidates: vi.fn(),
}
vi.mock('@/api/expertTeam', () => api)
vi.mock('@/api/position', () => ({ listPositions: vi.fn().mockResolvedValue({ list: [] }) }))

const ExpertTeamEditor = (await import('@/components/admin/ExpertTeamEditor.vue')).default

const CANDIDATES = [
  { id: 201, name: '经营分析专家', intro: '汇总经营数据', avatar: '▤', backgroundColor: '#DCF5E4', category: '投资', type: 'PLATFORM' },
  { id: 202, name: '企业知识助手', intro: '检索制度', avatar: '⌕', backgroundColor: '#DCF5E4', category: '通用', type: 'SYSTEM_DEFAULT' },
  { id: 204, name: '研究报告专家', intro: '行业研究', avatar: '◎', backgroundColor: '#DCF5E4', category: '投资', type: 'PLATFORM' }
]
const detail = (over = {}) => ({
  id: 302, name: '知识问答团', type: 'SYSTEM_DEFAULT', positionIds: [], avatar: '⌕', backgroundColor: '#DCF5E4', category: '通用',
  intro: '解答制度类问题', leaderId: null, leaderDuty: '', collab: '先检索再补充',
  exampleQuestions: ['问一', '问二', '问三'], status: 'draft', pendingAction: null, latestVersionLabel: '',
  createdAt: '2026-09-06T09:20:00+08:00', updatedAt: '2026-09-09T11:00:00+08:00', publishedAt: null, revoked: null,
  members: [
    { expertId: 202, duty: '检索依据', name: '企业知识助手', category: '通用', avatar: '⌕', unavailable: '' },
    { expertId: 201, duty: '补充口径', name: '经营分析专家', category: '投资', avatar: '▤', unavailable: '' }
  ],
  ...over
})

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const drawerOf = () => mounted.container.querySelector('.el-drawer')
// 取组件内部的表单对象（失败态表单区被「重试」空态替换、不可见，只能读 setupState）
const formOf = () => {
  const el = mounted.container.querySelector('.el-drawer')
  let inst = el.__vueParentComponent
  while (inst && !inst.setupState?.form) inst = inst.parent
  return inst.setupState.form
}
const footBtns = () => [...drawerOf().querySelectorAll('.el-drawer__footer .el-button')].map((b) => b.textContent.trim())

describe('ExpertTeamEditor · 真实挂载', () => {
  it('新建态：标题「新建专家团」、底部【取消】【创建专家团】、未选团类型时成员区提示「请先选择团类型」，console.error 零调用（md §三.1 / §三.2）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: null })
    await flushAll(12)
    const drawer = drawerOf()
    expect(drawer.querySelector('.de-head-title').textContent).toBe('新建专家团')
    expect(footBtns()).toEqual(['取消', '创建专家团'])
    expect(drawer.querySelector('[data-testid="team-members-card"]').textContent).toContain('请先选择团类型')
    expect(drawer.textContent).toContain('专家团由多位已发布的专家组成')
    // 新建不展示时间条
    expect(drawer.querySelector('.et-meta')).toBeNull()
    expect(api.listTeamMemberCandidates).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('基本信息字段与顺序：团类型（分段选择，最前）→ 团名称 → 分类 → 图标 → 团介绍；岗位团多一个所属岗位；没有背景色；团介绍带 AI 生成（md §三.2）', async () => {
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: null })
    await flushAll(12)
    const drawer = drawerOf()
    const labels = () => [...drawer.querySelectorAll('.et-grid .el-form-item__label')].map((l) => (l.querySelector('.et-label-row > span') || l).textContent.replace('*', '').trim())
    expect(labels()).toEqual(['团类型', '团名称', '分类', '图标', '团介绍'])
    const seg = drawer.querySelector('[data-testid="team-type-seg"]')
    expect([...seg.querySelectorAll('.el-radio-button')].map((b) => b.textContent.trim())).toEqual(['岗位团', '市场团', '通用团'])
    expect(drawer.textContent).toContain('团类型建成后不可更改')
    expect(drawer.textContent).not.toContain('背景色')
    // 团介绍的 AI 生成：成员不足时置灰并提示
    const introAi = [...drawer.querySelectorAll('.et-grid .et-ai')][0]
    expect(introAi.textContent).toContain('AI 生成')
    expect(introAi.disabled).toBe(true)
    expect(introAi.title).toBe('请先选择至少 2 位成员')
    const click = async (label) => { [...seg.querySelectorAll('.el-radio-button')].find((b) => b.textContent.trim() === label).click(); await flushAll(6) }
    await click('岗位团')
    expect(labels()).toEqual(['团类型', '团名称', '分类', '所属岗位', '图标', '团介绍'])
    await click('通用团')
    expect(labels()).toEqual(['团类型', '团名称', '分类', '图标', '团介绍'])
  })

  it('团内负责什么选填：占位写明「不填则使用该专家的简介」；全空也能通过校验（md §三.3.1）', async () => {
    api.getTeam.mockResolvedValue(detail({ members: detail().members.map((m) => ({ ...m, duty: '', intro: '该专家的简介内容' })) }))
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    api.updateTeam.mockResolvedValue(detail())
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const input = drawerOf().querySelector('[data-testid="team-member-202"] input')
    expect(input.value).toBe('')
    expect(input.placeholder).toContain('不填则使用该专家的简介')
    const save = [...drawerOf().querySelectorAll('.el-drawer__footer .el-button')].find((b) => b.textContent.trim() === '保存')
    save.click()
    await flushAll(8)
    expect(api.updateTeam).toHaveBeenCalledWith(302, expect.objectContaining({ members: [expect.objectContaining({ expertId: 202, duty: '' }), expect.objectContaining({ expertId: 201, duty: '' })] }))
    expect(drawerOf().textContent).not.toContain('请填写每位成员')
  })

  it('字段顺序对齐专家详情页：基本信息卡（类型 / 名称 / 分类 / 图标 / 团介绍 + 末尾「团队帮你做」子分区）→ 团队成员与主理人（卡内含团队协作关系）；团介绍在成员之前', async () => {
    api.getTeam.mockResolvedValue(detail())
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    const cards = [...drawer.querySelectorAll('.section-card')]
    expect(cards.map((c) => c.dataset.testid || c.querySelector('.section-title').textContent.trim().slice(0, 4))).toEqual(['基本信息', 'team-members-card'])
    // 团队协作关系并入成员卡，不再是独立卡；不再有「团的用途」
    expect(cards[1].querySelector('[data-testid="team-collab-card"]')).toBeTruthy()
    expect(drawer.querySelector('[data-testid="team-purpose"]')).toBeNull()
    expect(drawer.textContent).not.toContain('团的用途')
    // 「团队帮你做」是基本信息卡内的子分区，不是独立卡；排在团介绍之后
    const basic = cards[0]
    expect(basic.querySelector('[data-testid="team-examples"]')).toBeTruthy()
    expect(basic.querySelectorAll('.et-q-row').length).toBe(3)
    expect(cards.slice(1).some((c) => c.querySelector('.et-q-row'))).toBe(false)
  })

  it('AI 生成置灰时，原因直接显示在按钮旁（不靠悬停）：成员不足 2 位 → 团介绍 / 协作关系都写明；补够后提示消失', async () => {
    api.getTeam.mockResolvedValue(detail({ members: [detail().members[0]] }))
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    const introHint = () => drawer.querySelector('[data-testid="team-intro-ai-hint"]')
    expect(introHint().textContent).toBe('请先选择至少 2 位成员')
    expect([...drawer.querySelectorAll('.et-ai-hint')].map((h) => h.textContent)).toEqual(['请先选择至少 2 位成员', '请先选择至少 2 位成员'])
    const introBtn = [...drawer.querySelectorAll('.et-grid .et-ai')][0]
    expect(introBtn.disabled).toBe(true)
    drawer.querySelector('[data-testid="team-cand-201"] input').click()
    await flushAll(6)
    expect(introHint()).toBeNull()
    expect([...drawer.querySelectorAll('.et-grid .et-ai')][0].disabled).toBe(false)
  })

  it('新建态直接点【创建专家团】：必填项标红、不调用创建接口（md §三.8 保存校验）', async () => {
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: null })
    await flushAll(12)
    const create = [...drawerOf().querySelectorAll('.el-drawer__footer .el-button')].find((b) => b.textContent.trim() === '创建专家团')
    create.click()
    // element-plus 的 ElFormItem 红字过 100ms 防抖才进 DOM（同 modelConfigEditDialogSmoke 的说明），这里真等一下
    await new Promise((r) => setTimeout(r, 400))
    await flushAll(6)
    const text = drawerOf().textContent
    expect(text).toContain('请填写团名称')
    expect(text).toContain('请选择团类型')
    expect(text).toContain('请选择专家分类')
    expect(text).toContain('请填写团介绍')
    expect(text).toContain('请填写 3 条"团队帮你做"示例问题')
    expect(api.createTeam).not.toHaveBeenCalled()
  })

  it('编辑态：已选成员按排位列出并带「团内负责什么」；没设主理人时协作关系标必填，AI 生成按钮在成员足够时可点（md §三.3 / §三.4 / §三.7）', async () => {
    api.getTeam.mockResolvedValue(detail())
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    expect(drawer.querySelector('.de-head-title').textContent).toBe('编辑专家团')
    expect(footBtns()).toEqual(['取消', '发布', '保存'])
    expect(api.listTeamMemberCandidates).toHaveBeenCalledWith({ type: 'SYSTEM_DEFAULT' })
    const rows = [...drawer.querySelectorAll('[data-testid="team-selected"] .et-row')]
    expect(rows.map((r) => r.querySelector('strong').textContent)).toEqual(['企业知识助手', '经营分析专家'])
    expect(rows.map((r) => r.querySelector('input').value)).toEqual(['检索依据', '补充口径'])
    // 候选 3 张卡，已选的打勾
    expect(drawer.querySelectorAll('.et-cand').length).toBe(3)
    expect(drawer.querySelectorAll('.et-cand.checked').length).toBe(2)
    // 没设主理人：协作关系必填
    const collab = drawer.querySelector('[data-testid="team-collab-card"]')
    expect(collab.textContent).toContain('没设主理人时必填')
    expect(collab.querySelector('.et-req')).toBeTruthy()
    // 未设主理人 → 不出现主理人职责区块
    expect(drawer.querySelector('[data-testid="team-leader-duty"]')).toBeNull()
    // 成员足够 → 团介绍的 AI 生成可点
    const aiBtn = [...drawer.querySelectorAll('.et-ai')].find((b) => b.textContent.includes('AI 生成'))
    expect(aiBtn.disabled).toBe(false)
  })

  it('设为主理人：主理人职责区块出现（初始为空，等管理员写或点 AI 生成），协作关系改为选填；取消主理人后区块消失；成员卡上没有「可带团」徽章（md §三.3.2 / §三.3.3 / §三.4）', async () => {
    api.getTeam.mockResolvedValue(detail())
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    const leaderBtn = (id) => [...drawer.querySelectorAll(`[data-testid="team-member-${id}"] .et-row-ops .el-button`)].find((b) => /主理人/.test(b.textContent))

    leaderBtn(201).click()
    await flushAll(6)
    const duty = drawer.querySelector('[data-testid="team-leader-duty"]')
    expect(duty).toBeTruthy()
    expect(duty.querySelector('textarea').value).toBe('')
    expect(drawer.textContent).not.toContain('可带团')
    expect(drawer.querySelector('[data-testid="team-member-201"] .et-leader-badge').textContent).toBe('主理人')
    expect(drawer.querySelector('[data-testid="team-collab-card"]').textContent).toContain('选填')
    expect(leaderBtn(201).textContent.trim()).toBe('取消主理人')

    leaderBtn(201).click()
    await flushAll(6)
    expect(drawer.querySelector('[data-testid="team-leader-duty"]')).toBeNull()
    expect(drawer.querySelector('[data-testid="team-collab-card"]').textContent).toContain('没设主理人时必填')
  })

  it('主理人那一行不再有「团内负责什么」输入框（与主理人职责重复），只提示见主理人职责；取消主理人后恢复且已填值保留（md §三.3.1）', async () => {
    api.getTeam.mockResolvedValue(detail())
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    const row = (id) => drawer.querySelector(`[data-testid="team-member-${id}"]`)
    const leaderBtn = (id) => [...row(id).querySelectorAll('.et-row-ops .el-button')].find((b) => /主理人/.test(b.textContent))
    expect(row(201).querySelector('input')).toBeTruthy()
    leaderBtn(201).click()
    await flushAll(6)
    expect(row(201).querySelector('input')).toBeNull()
    expect(row(201).querySelector('[data-testid="team-leader-row-note"]').textContent).toContain('主理人职责')
    expect(row(202).querySelector('input')).toBeTruthy() // 其他成员不受影响
    leaderBtn(201).click()
    await flushAll(6)
    expect(row(201).querySelector('input').value).toBe('补充口径')
    expect(row(201).querySelector('[data-testid="team-leader-row-note"]')).toBeNull()
  })

  it('移除主理人本人 → 主理人清空（md §三.3.2）', async () => {
    api.getTeam.mockResolvedValue(detail({ leaderId: 201, leaderDuty: '按经营口径' }))
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    expect(drawer.querySelector('[data-testid="team-leader-duty"] textarea').value).toBe('按经营口径')
    const remove = [...drawer.querySelectorAll('[data-testid="team-member-201"] .et-row-ops .el-button')].find((b) => b.textContent.trim() === '移除')
    remove.click()
    await flushAll(6)
    expect(drawer.querySelector('[data-testid="team-member-201"]')).toBeNull()
    expect(drawer.querySelector('[data-testid="team-leader-duty"]')).toBeNull()
  })

  it('试跑拆解本期不做：编辑器里没有试跑按钮、弹窗和「已试跑」提示（prd.专家团.md §三.9）', async () => {
    api.getTeam.mockResolvedValue(detail())
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    expect(drawer.querySelector('[data-testid="team-trial-btn"]')).toBeNull()
    expect(drawer.querySelector('[data-testid="team-trial-state"]')).toBeNull()
    expect(drawer.textContent).not.toContain('试跑')
  })

  it('成员上限 6 位（负责人 2026-10-12 由 20 调为 6）：区块说明与计数写 6；已选满后再勾选弹提示、不再增加', async () => {
    const ids = [11, 12, 13, 14, 15, 16]
    api.getTeam.mockResolvedValue(detail({ members: ids.map((id) => ({ expertId: id, duty: '', name: '专家' + id, category: '通用', avatar: '', unavailable: '' })) }))
    api.listTeamMemberCandidates.mockResolvedValue([...ids, 17].map((id) => ({ id, name: '专家' + id, intro: '', avatar: '', backgroundColor: '#DCF5E4', category: '通用', type: 'PLATFORM' })))
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    const card = drawer.querySelector('[data-testid="team-members-card"]')
    expect(card.textContent).toContain('最多 6 位')
    expect(card.querySelector('.et-count').textContent).toBe('已选 6/6')
    drawer.querySelector('[data-testid="team-cand-17"] input').click()
    await flushAll(6)
    expect(drawer.querySelectorAll('[data-testid="team-selected"] .et-row').length).toBe(6)
    expect(document.body.textContent).toContain('成员最多 6 位')
  })

  it('只读态：标题「查看专家团」、底部仅【关闭】、无候选区与 AI 按钮；不可用成员带红色原因标签（缺员，md §四）', async () => {
    api.getTeam.mockResolvedValue(
      detail({
        status: 'published', latestVersionLabel: 'v1.0.0',
        members: [
          { expertId: 202, duty: '检索依据', name: '企业知识助手', category: '通用', avatar: '⌕', unavailable: '' },
          { expertId: 201, duty: '补充口径', name: '经营分析专家', category: '投资', avatar: '▤', unavailable: '已回收' }
        ]
      })
    )
    // 被回收的 201 已不在「已发布」候选里
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES.filter((x) => x.id !== 201))
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302, readonly: true })
    await flushAll(14)
    const drawer = drawerOf()
    expect(drawer.querySelector('.de-head-title').textContent).toBe('查看专家团')
    expect(footBtns()).toEqual(['关闭'])
    expect(drawer.querySelector('.et-picker')).toBeNull()
    expect(drawer.querySelectorAll('.et-ai').length).toBe(0)
    expect(drawer.querySelector('[data-testid="team-member-201"] .et-warn-tag').textContent).toBe('已回收')
    expect(drawer.querySelector('.et-meta').textContent).toContain('最新版本：v1.0.0')
    expect(drawer.querySelector('input[placeholder="如 合同会审团"]').disabled).toBe(true)
  })
})

// yuepu#99：自写 #footer 的编辑器在加载失败 / 加载中也要把【保存】【发布】置灰、入口也拦、表单清空（同 ExpertEditor yuepu#49）
describe('ExpertTeamEditor · 加载失败 / 加载中不可保存发布（yuepu#99）', () => {
  const footerBtn = (text) =>
    [...drawerOf().querySelectorAll('.el-drawer__footer .el-button')].find((b) => b.textContent.trim() === text)

  it('加载失败 → 页脚已渲染，【保存】【发布】置灰，点了也不调 updateTeam', async () => {
    api.getTeam.mockRejectedValueOnce(new Error('炸了'))
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(12)
    expect(mounted.container.textContent).toContain('重试') // 前提：确实处于加载失败态
    expect(footerBtn('取消')).toBeTruthy() // 前提：页脚真渲染了
    for (const text of ['保存', '发布']) {
      const b = footerBtn(text)
      expect(b, text + ' 按钮应渲染').toBeTruthy()
      expect(b.disabled, text + ' 应置灰').toBe(true)
      b.click()
    }
    await flushAll(6)
    expect(api.updateTeam).not.toHaveBeenCalled()
  })

  it('加载中 → 置灰，加载完成后恢复可点', async () => {
    let release
    api.getTeam.mockImplementationOnce(() => new Promise((r) => { release = () => r(detail()) }))
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(8)
    for (const text of ['保存', '发布']) expect(footerBtn(text)?.disabled, text + ' 加载中应置灰').toBe(true)
    release()
    await flushAll(12)
    for (const text of ['保存', '发布']) expect(footerBtn(text)?.disabled, text + ' 加载完成应可点').toBe(false)
  })

  it('同一抽屉从 302 切到 303、303 加载失败：表单已清空，不残留 302 的值（否则点保存会写进 303）', async () => {
    api.getTeam.mockResolvedValueOnce(detail())
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    const state = reactive({ teamId: 302 })
    const Wrapper = { render: () => h(ExpertTeamEditor, { visible: true, teamId: state.teamId }) }
    mounted = mountReal(Wrapper)
    await flushAll(12)
    const form = () => mounted.container.querySelector('.el-drawer') && formOf()
    expect(formOf().name).toBe('知识问答团') // 前提：302 已回填

    api.getTeam.mockRejectedValueOnce(new Error('炸了'))
    state.teamId = 303
    await flushAll(12)
    expect(mounted.container.textContent).toContain('重试')
    expect(formOf().name).toBe('')
    expect(formOf().members).toEqual([])
    for (const text of ['保存', '发布']) footerBtn(text)?.click()
    await flushAll(6)
    expect(api.updateTeam).not.toHaveBeenCalled()
    void form
  })
})
