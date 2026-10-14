// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * ExpertTeamPanel.vue 真实挂载用例（2026-10-12 专家团管理端）。
 * 对齐 prd.专家团.md §二（列表列、操作按钮三态）/ §二.3.3 与 §三.8（发布前检查：阻断项 + 没主理人未试跑的提醒）/ §四（缺员标签）。
 * 真 Element Plus，只 mock api 层、版本侧栏与编辑抽屉（它们另有用例）。
 */
const api = {
  listTeams: vi.fn(),
  getTeam: vi.fn(),
  deleteTeam: vi.fn(),
  unpublishTeam: vi.fn(),
  publishTeam: vi.fn(),
  withdrawTeam: vi.fn(),
  getTeamNextVersionLabel: vi.fn(),
  listTeamPublications: vi.fn(),
  delistTeamPublication: vi.fn(),
  relistTeamPublication: vi.fn(),
  checkTeamPublishable: vi.fn(() => null)
}
vi.mock('@/api/expertTeam', () => api)
const ElMessage = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
const ElMessageBox = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('element-plus', async (orig) => ({ ...(await orig()), ElMessage, ElMessageBox }))
vi.mock('@/components/admin/ExpertTeamEditor.vue', () => ({
  default: { name: 'ExpertTeamEditor', props: ['visible', 'teamId', 'readonly'], template: '<i class="editor-stub" :data-visible="visible" :data-team="teamId" />' }
}))
vi.mock('@/components/admin/VersionDrawer.vue', () => ({
  default: { name: 'VersionDrawer', props: ['modelValue', 'adapter'], template: '<i class="version-stub" :data-open="modelValue" :data-entity="adapter && adapter.entityLabel" />' }
}))

const Panel = (await import('@/components/admin/ExpertTeamPanel.vue')).default

const ROWS = [
  {
    id: 301, name: '经营研究团', type: 'PLATFORM', avatar: '◈', backgroundColor: '#DCECF7', category: '投资', intro: '经营与研究',
    memberCount: 2,
    memberNames: ['经营分析专家', '研究报告专家'], leaderId: 201, leaderName: '经营分析专家',
    missingCount: 1, missing: [{ expertId: 204, name: '研究报告专家', reason: '已回收' }],
    positionIds: [], positionCount: 0, status: 'published', pendingAction: null, latestVersionLabel: 'v1.0.0', revoked: null, updatedAt: '2026-09-08T15:30:00+08:00'
  },
  {
    id: 303, name: '岗位协同团', type: 'POSITION', avatar: '◎', backgroundColor: '#E7E4F7', category: '投资', intro: '服务经营分析岗',
    memberCount: 2, memberNames: ['研究报告专家', '企业知识助手'], leaderId: null, leaderName: '',
    missingCount: 0, missing: [], positionIds: [401], positionCount: 1, status: 'draft', pendingAction: null, latestVersionLabel: '', revoked: null, updatedAt: '2026-09-10T14:00:00+08:00'
  }
]
const DETAIL_303 = { ...ROWS[1], members: [{ expertId: 204, duty: 'a' }, { expertId: 202, duty: 'b' }] }

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.clearAllMocks()
  api.checkTeamPublishable.mockImplementation(() => null)
})
async function mountPanel() {
  api.listTeams.mockResolvedValue({ list: ROWS, total: 2 })
  mounted = mountReal(Panel)
  await flushAll(14)
  return mounted.container
}
const rowOf = (c, name) => [...c.querySelectorAll('.el-table__body tr')].find((r) => r.textContent.includes(name))
const btn = (row, text) => [...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

describe('ExpertTeamPanel · 专家团列表（真实挂载）', () => {
  it('列：团类型文案 / 专家数（没有成员、主理人两列）/ 引用情况（仅岗位私有有值）/ 已发布缺员标签（md §二.1 / §四）', async () => {
    const c = await mountPanel()
    const r1 = rowOf(c, '经营研究团')
    const r3 = rowOf(c, '岗位协同团')
    expect(r1.textContent).toContain('市场团')
    const headers = [...c.querySelectorAll('.el-table__header th')].map((h) => h.textContent.trim())
    // 列表不展示成员与主理人（只留专家数）
    expect(headers).not.toContain('成员')
    expect(headers).not.toContain('主理人')
    expect(headers).toContain('专家数')
    expect(r1.textContent).not.toContain('经营分析专家')
    const countCell = (r) => r.querySelectorAll('td')[headers.indexOf('专家数')].textContent.trim()
    expect(countCell(r1)).toBe('2')
    expect(countCell(r3)).toBe('2')
    expect(r1.querySelector('[data-testid="team-missing-tag"]').textContent).toBe('缺员 1')
    expect(r1.textContent).toContain('v1.0.0')
    expect(r3.textContent).toContain('岗位团')
    expect(r3.textContent).not.toContain('未设主理人')
    expect(r3.textContent).toContain('1个岗位引用')
    expect(r3.querySelector('[data-testid="team-missing-tag"]')).toBeNull()
    // 操作按钮三态：已发布 = 查看 编辑 停用 版本管理（强制回收并入停用弹窗，无独立按钮）；未发布 = 查看 编辑 发布 删除
    const names = (r) => [...r.querySelectorAll('.tbl-ops .el-button')].map((b) => b.textContent.trim())
    expect(names(r1)).toEqual(['查看', '编辑', '停用', '版本管理'])
    expect(names(r3)).toEqual(['查看', '编辑', '发布', '删除'])
  })

  it('空态文案、工具栏占位与新建入口（md 一）', async () => {
    api.listTeams.mockResolvedValue({ list: [], total: 0 })
    mounted = mountReal(Panel)
    await flushAll(14)
    const c = mounted.container
    expect(c.textContent).toContain('还没有专家团，点击「新建专家团」创建第一个')
    expect(c.querySelector('input[placeholder="搜索团名、介绍或分类"]')).toBeTruthy()
    expect(c.querySelector('[data-testid="team-create-btn"]').textContent).toContain('新建专家团')
  })

  it('发布前检查未通过 → 提示具体原因，不打开版本管理侧栏（md §三.8）', async () => {
    api.getTeam.mockResolvedValue(DETAIL_303)
    api.checkTeamPublishable.mockReturnValue({ field: 'members', message: '成员「研究报告专家」已回收，请移除或替换后再发布' })
    const c = await mountPanel()
    btn(rowOf(c, '岗位协同团'), '发布').click()
    await flushAll(8)
    expect(ElMessage.warning).toHaveBeenCalledWith('成员「研究报告专家」已回收，请移除或替换后再发布')
    expect(c.querySelector('.version-stub').dataset.open).toBe('false')
  })

  it('没设主理人的团发布前不再弹试跑提醒（试跑拆解本期不做）：通过发布前检查后直接开版本侧栏', async () => {
    api.getTeam.mockResolvedValue(DETAIL_303)
    const c = await mountPanel()
    btn(rowOf(c, '岗位协同团'), '发布').click()
    await flushAll(10)
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(c.querySelector('.version-stub').dataset.open).toBe('true')
    expect(c.querySelector('.version-stub').dataset.entity).toBe('专家团')
  })

  it('删除确认文案带成员数；停用文案同专家（md §二.3.5 / §二.3.8）', async () => {
    const c = await mountPanel()
    ElMessageBox.confirm.mockResolvedValueOnce()
    api.deleteTeam.mockResolvedValueOnce(2)
    btn(rowOf(c, '岗位协同团'), '删除').click()
    await flushAll(8)
    expect(ElMessageBox.confirm.mock.calls[0][0]).toBe('删除「岗位协同团」后会解除 2 位成员专家的引用，专家本体不受影响。确认删除？')
    expect(api.deleteTeam).toHaveBeenCalledWith(303)
    expect(ElMessage.success).toHaveBeenCalledWith('专家团已删除')

    // 停用：弹 DeactivateDialog（普通停用样式），确认 → unpublishTeam(id, 非强制)
    api.unpublishTeam.mockResolvedValue({})
    btn(rowOf(c, '经营研究团'), '停用').click()
    await flushAll(8)
    const dlg = () => document.querySelector('.el-dialog')
    expect(dlg().querySelector('[data-test="dd-plain"]').textContent).toBe('停用「经营研究团」需提交审核。审核通过前客户端仍可使用。')
    dlg().querySelector('[data-test="dd-confirm"]').click()
    await flushAll(8)
    expect(api.unpublishTeam).toHaveBeenLastCalledWith(301, { forceRevoke: false, reason: '' })
    expect(ElMessage.success).toHaveBeenLastCalledWith('已提交停用审核')
  })

  it('强制回收并入停用弹窗（PRD §二.3.6）：勾选 → 标题「强制回收专家团」、原因必填；填原因提交 → unpublishTeam(id, { forceRevoke: true, reason })；不弹二次确认', async () => {
    const c = await mountPanel()
    api.unpublishTeam.mockResolvedValue({})
    btn(rowOf(c, '经营研究团'), '停用').click()
    await flushAll(8)
    const dlg = () => document.querySelector('.el-dialog')
    const cb = dlg().querySelector('input[type="checkbox"]')
    cb.click()
    await flushAll(6)
    expect(dlg().textContent).toContain('强制回收专家团')
    expect(dlg().querySelector('[data-test="dd-danger"]').textContent).toContain('已召唤该专家团的员工将失去它')
    // 原因为空：就地提示，不调接口
    dlg().querySelector('[data-test="dd-confirm"]').click()
    await flushAll(6)
    expect(dlg().querySelector('[data-test="dd-error"]').textContent).toBe('请输入回收原因')
    expect(api.unpublishTeam).not.toHaveBeenCalled()
    const ta = dlg().querySelector('textarea')
    ta.value = '团配置异常'
    ta.dispatchEvent(new Event('input'))
    await flushAll(4)
    dlg().querySelector('[data-test="dd-confirm"]').click()
    await flushAll(8)
    expect(api.unpublishTeam).toHaveBeenCalledWith(301, { forceRevoke: true, reason: '团配置异常' })
    expect(ElMessage.success).toHaveBeenLastCalledWith('已提交强制回收审核')
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })
})
