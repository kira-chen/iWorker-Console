// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * ExpertTeamEditor.vue 真实挂载用例（2026-10-12 专家团管理端）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家团.md §三（编辑页）：
 *   §三.1 三态标题与底部按钮 / §三.2 团类型未选时成员区置灰 / §三.3 成员与团长（设团长回填带团分工说明）/
 *   §三.4 协作关系「没设团长必填、设了选填」/ §三.7 AI 生成置灰条件 / §三.8 保存校验。
 * 真 Element Plus + 真 DrawerEditor，只 mock api 层。
 */

const api = {
  getTeam: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  listTeamMemberCandidates: vi.fn(),
  trialTeam: vi.fn()
}
vi.mock('@/api/expertTeam', () => api)
vi.mock('@/api/position', () => ({ listPositions: vi.fn().mockResolvedValue({ list: [] }) }))

const ExpertTeamEditor = (await import('@/components/admin/ExpertTeamEditor.vue')).default

const CANDIDATES = [
  { id: 201, name: '经营分析专家', intro: '汇总经营数据', avatar: '▤', backgroundColor: '#DCF5E4', category: '投资', type: 'PLATFORM', leadGuide: '先识别经营异常，再分给研究类专家' },
  { id: 202, name: '企业知识助手', intro: '检索制度', avatar: '⌕', backgroundColor: '#DCF5E4', category: '通用', type: 'SYSTEM_DEFAULT', leadGuide: '' },
  { id: 204, name: '研究报告专家', intro: '行业研究', avatar: '◎', backgroundColor: '#DCF5E4', category: '投资', type: 'PLATFORM', leadGuide: '' }
]
const detail = (over = {}) => ({
  id: 302, name: '知识问答团', type: 'SYSTEM_DEFAULT', positionIds: [], avatar: '⌕', backgroundColor: '#DCF5E4', category: '通用',
  intro: '解答制度类问题', leaderId: null, leaderDuty: '', collab: '先检索再补充', trialed: false,
  exampleQuestions: ['问一', '问二', '问三'], status: 'draft', pendingAction: null, latestVersionLabel: '',
  createdAt: '2026-09-06T09:20:00+08:00', updatedAt: '2026-09-09T11:00:00+08:00', publishedAt: null, revoked: null,
  members: [
    { expertId: 202, duty: '检索依据', name: '企业知识助手', category: '通用', avatar: '⌕', leadGuide: '', unavailable: '' },
    { expertId: 201, duty: '补充口径', name: '经营分析专家', category: '投资', avatar: '▤', leadGuide: '先识别经营异常，再分给研究类专家', unavailable: '' }
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

  it('字段顺序对齐专家详情页：基本信息卡（类型 / 名称 / 分类 / 图标 / 团介绍 + 末尾「团队帮你做」子分区）→ 团队成员与团长（卡内含团队协作关系）；团介绍在成员之前', async () => {
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

  it('AI 生成置灰时，原因直接显示在按钮旁（不靠悬停）：成员不足 2 位 → 团介绍 / 协作关系 / 试跑拆解都写明；补够后提示消失', async () => {
    api.getTeam.mockResolvedValue(detail({ members: [detail().members[0]] }))
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    const introHint = () => drawer.querySelector('[data-testid="team-intro-ai-hint"]')
    expect(introHint().textContent).toBe('请先选择至少 2 位成员')
    expect(drawer.querySelector('[data-testid="team-trial-hint"]').textContent).toBe('请先选择至少 2 位成员')
    expect([...drawer.querySelectorAll('.et-ai-hint')].map((h) => h.textContent)).toEqual(['请先选择至少 2 位成员', '请先选择至少 2 位成员', '请先选择至少 2 位成员'])
    const introBtn = [...drawer.querySelectorAll('.et-grid .et-ai')][0]
    expect(introBtn.disabled).toBe(true)
    drawer.querySelector('[data-testid="team-cand-201"] input').click()
    await flushAll(6)
    expect(introHint()).toBeNull()
    expect([...drawer.querySelectorAll('.et-grid .et-ai')][0].disabled).toBe(false)
    expect(drawer.querySelector('[data-testid="team-trial-hint"]')).toBeNull()
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

  it('编辑态：已选成员按排位列出并带「团内负责什么」；没设团长时协作关系标必填，AI 生成按钮在成员足够时可点（md §三.3 / §三.4 / §三.7）', async () => {
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
    // 没设团长：协作关系必填
    const collab = drawer.querySelector('[data-testid="team-collab-card"]')
    expect(collab.textContent).toContain('没设团长时必填')
    expect(collab.querySelector('.et-req')).toBeTruthy()
    // 未设团长 → 不出现团长职责区块
    expect(drawer.querySelector('[data-testid="team-leader-duty"]')).toBeNull()
    // 成员足够 → 团介绍的 AI 生成可点
    const aiBtn = [...drawer.querySelectorAll('.et-ai')].find((b) => b.textContent.includes('AI 生成'))
    expect(aiBtn.disabled).toBe(false)
  })

  it('设为团长：团长职责区块出现并回填该专家的「带团分工说明」，协作关系改为选填；取消团长后区块消失（md §三.3.2 / §三.3.3 / §三.4）', async () => {
    api.getTeam.mockResolvedValue(detail())
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    const drawer = drawerOf()
    const leaderBtn = (id) => [...drawer.querySelectorAll(`[data-testid="team-member-${id}"] .et-row-ops .el-button`)].find((b) => /团长/.test(b.textContent))

    leaderBtn(201).click()
    await flushAll(6)
    const duty = drawer.querySelector('[data-testid="team-leader-duty"]')
    expect(duty).toBeTruthy()
    expect(duty.querySelector('textarea').value).toBe('先识别经营异常，再分给研究类专家')
    expect(drawer.querySelector('[data-testid="team-member-201"] .et-leader-badge').textContent).toBe('团长')
    expect(drawer.querySelector('[data-testid="team-collab-card"]').textContent).toContain('选填')
    expect(leaderBtn(201).textContent.trim()).toBe('取消团长')

    leaderBtn(201).click()
    await flushAll(6)
    expect(drawer.querySelector('[data-testid="team-leader-duty"]')).toBeNull()
    expect(drawer.querySelector('[data-testid="team-collab-card"]').textContent).toContain('没设团长时必填')
  })

  it('移除团长本人 → 团长清空；成员少于 2 位时试跑拆解置灰并提示原因（md §三.3.2 / §三.9）', async () => {
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
    const trial = drawer.querySelector('[data-testid="team-trial-btn"]')
    expect(trial.disabled).toBe(true)
    expect(trial.title).toBe('请先选择至少 2 位成员')
  })

  it('试跑拆解：弹窗预填第 1 条示例问题，点【开始试跑】展示安排预览与「不会真正执行」说明（md §三.9）', async () => {
    api.getTeam.mockResolvedValue(detail())
    api.listTeamMemberCandidates.mockResolvedValue(CANDIDATES)
    api.trialTeam.mockResolvedValue({
      mode: 'system', leaderName: '', task: '问一',
      plan: [{ expertId: 202, name: '企业知识助手', duty: '检索依据', order: '先做' }, { expertId: 201, name: '经营分析专家', duty: '补充口径', order: '同时' }]
    })
    mounted = mountReal(ExpertTeamEditor, { visible: true, teamId: 302 })
    await flushAll(14)
    drawerOf().querySelector('[data-testid="team-trial-btn"]').click()
    await flushAll(8)
    const dlg = document.querySelector('[data-testid="team-trial-dialog"]')
    expect(dlg).toBeTruthy()
    expect(dlg.querySelector('input').value).toBe('问一')
    expect(dlg.textContent).toContain('仅为拆解预览，不会真正执行，不产生任务记录')
    dlg.querySelector('[data-testid="team-trial-run"]').click()
    await flushAll(10)
    expect(api.trialTeam).toHaveBeenCalledWith(expect.objectContaining({ task: '问一', leaderId: null }))
    expect(dlg.textContent).toContain('由系统按团队协作关系拆解')
    expect([...dlg.querySelectorAll('.et-trial-row')].map((r) => r.querySelector('.et-trial-order').textContent)).toEqual(['先做', '同时'])
    // 试跑成功 → 编辑页提示变为「已试跑」
    expect(drawerOf().querySelector('[data-testid="team-trial-state"]').textContent).toContain('已试跑')
  })

  it('只读态：标题「查看专家团」、底部仅【关闭】、无候选区与 AI 按钮；不可用成员带红色原因标签（缺员，md §四）', async () => {
    api.getTeam.mockResolvedValue(
      detail({
        status: 'published', latestVersionLabel: 'v1.0.0',
        members: [
          { expertId: 202, duty: '检索依据', name: '企业知识助手', category: '通用', avatar: '⌕', leadGuide: '', unavailable: '' },
          { expertId: 201, duty: '补充口径', name: '经营分析专家', category: '投资', avatar: '▤', leadGuide: '', unavailable: '已回收' }
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
