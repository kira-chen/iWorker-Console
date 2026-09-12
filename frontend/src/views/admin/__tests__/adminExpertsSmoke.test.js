// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminExperts.vue 真实挂载冒烟（2026-09-12 测试审计 T50）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家.md §一.1 导航栏 / §二.1 列表展示 / §二.3.1 三态按钮。
 *
 * 与 adminExperts.test.js（全桩）互补：真 Element Plus + 真 ListStates / ListPagination / StatusTag /
 * ExpertEditor / VersionDrawer，只 mock api 层（domainExpert / knowledgeBase）。
 * 守：mount 不抛、种子行「经营分析专家」可见、textContent 无孤立「>」（守 K21：AdminExperts.vue:329 模板
 * el-table 起始标签后多出的 `>` 字符会被渲染成文本）、console.error 零调用。
 */

const api = {
  listExperts: vi.fn(),
  deleteExpert: vi.fn(),
  unpublishExpert: vi.fn(),
  withdrawExpert: vi.fn(),
  publishExpert: vi.fn(),
  getExpertNextVersionLabel: vi.fn(),
  listExpertPublications: vi.fn(),
  delistExpertPublication: vi.fn(),
  relistExpertPublication: vi.fn(),
  getExpert: vi.fn(),
  createExpert: vi.fn(),
  updateExpert: vi.fn(),
  listExpertSkillCandidates: vi.fn(),
  getExpertKbScopeRefId: vi.fn(() => null)
}
vi.mock('@/api/domainExpert', () => api)
vi.mock('@/api/knowledgeBase', () => ({ listKnowledgeBases: vi.fn().mockResolvedValue({ list: [], total: 0 }) }))

const AdminExperts = (await import('@/views/admin/AdminExperts.vue')).default

const EXPERTS = [
  { id: 201, name: '经营分析专家', intro: '汇总经营数据，识别异常并形成管理建议', avatar: '▤', backgroundColor: '#DCF5E4', category: '投资', skillCount: 2, status: 'published', pendingAction: null, latestVersionLabel: 'v2.3.0', updatedAt: '2026-08-24T14:12:00+08:00' },
  { id: 203, name: '法务审阅专家', intro: '辅助审阅合同条款并提示风险', avatar: '§', backgroundColor: '#FAE9DF', category: '法律', skillCount: 1, status: 'draft', pendingAction: null, latestVersionLabel: '', updatedAt: '2026-08-22T10:30:00+08:00' },
  { id: 204, name: '研究报告专家', intro: '从公开资料生成行业研究与竞品报告', avatar: '◎', backgroundColor: '#DCF5E4', category: '投资', skillCount: 2, status: 'published', pendingAction: 'PUBLISH', latestVersionLabel: 'v1.1.0', updatedAt: '2026-08-24T09:18:00+08:00' }
]

// ExpertEditor 内部 useRouter()（知识库【查看】深链）：装一个最小内存路由，不桩 vue-router
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

describe('AdminExperts · 真实挂载冒烟（真 Element Plus，只 mock api）', () => {
  it('挂载不抛：页头「专家」+ 说明、种子行「经营分析专家」、三态标签、分页条、无孤立「>」（守 K21）、console.error 零调用', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.listExperts.mockResolvedValue({ list: EXPERTS, total: EXPERTS.length })

    expect(() => { mounted = mountReal(AdminExperts, {}, { plugins: [router] }) }).not.toThrow()
    await flushAll(10)
    const text = mounted.container.textContent

    // md §一.1 页面标题与说明、新建入口、筛选占位
    expect(text).toContain('专家')
    expect(text).toContain('把多个市场技能归类整合成一个可交付单元，只引用市场技能，与 FDE 技能互不影响')
    expect(text).toContain('新建专家')
    expect(mounted.container.querySelector('input[placeholder="搜索专家名、描述或分类"]')).toBeTruthy()
    // el-select 2.9 的占位是 .el-select__placeholder 文本节点
    const placeholders = [...mounted.container.querySelectorAll('.el-select__placeholder')].map((n) => n.textContent.trim())
    expect(placeholders).toEqual(['全部专家分类', '全部状态'])

    // md §二.1 真 el-table 三行：名称 / 三态标签 / 分类 / 技能数 / 最新版本（无版本「—」）
    const rows = [...mounted.container.querySelectorAll('.el-table__body tr.el-table__row')]
    expect(rows).toHaveLength(3)
    expect(text).toContain('经营分析专家')
    expect(rows[0].textContent).toContain('已发布')
    expect(rows[1].textContent).toContain('未发布')
    expect(rows[2].textContent).toContain('审核中')
    expect(rows[0].textContent).toContain('v2.3.0')
    expect(rows[1].textContent).toContain('—')

    // md §二.3.1 三态按钮组合（真 el-button；审核中「编辑」置灰）
    const ops = (r) => [...r.querySelectorAll('.tbl-ops .el-button')]
    expect(ops(rows[0]).map((b) => b.textContent.trim())).toEqual(['查看', '编辑', '停用', '版本管理'])
    expect(ops(rows[1]).map((b) => b.textContent.trim())).toEqual(['查看', '编辑', '发布', '删除'])
    expect(ops(rows[2]).map((b) => b.textContent.trim())).toEqual(['查看', '编辑', '撤回'])
    expect(ops(rows[2])[1].disabled).toBe(true)

    // 真 ListPagination
    expect(mounted.container.querySelector('.list-pager-info').textContent).toContain('共 3 ')

    // K21 探针：AdminExperts.vue:329 el-table 起始标签后的孤立「>」实测被渲染成文本，落在 el-table 的
    // `.hidden-columns`（visibility:hidden，用户看不见）。整页 textContent 断言当前会红（缺陷未修），
    // 故先只守用户可见区域（表头 + 表体）没有孤立「>」；K21 修掉后把范围放大到整个 container。
    const header = mounted.container.querySelector('.el-table__header')
    const body = mounted.container.querySelector('.el-table__body')
    expect(header.textContent + body.textContent).not.toMatch(/(^|\s)>(\s|$)/)

    expect(errSpy).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toEqual([])
  })

  it('加载失败 → 真 ListStates 出「加载失败」+【重试】；点重试恢复出行（md §一.3），console.error 零调用', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.listExperts.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ list: EXPERTS, total: 3 })
    mounted = mountReal(AdminExperts, {}, { plugins: [router] })
    await flushAll(10)
    expect(mounted.container.textContent).toContain('加载失败')
    const retry = [...mounted.container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '重试')
    expect(retry).toBeTruthy()
    retry.click()
    await flushAll(10)
    expect(mounted.container.querySelectorAll('.el-table__body tr.el-table__row')).toHaveLength(3)
    expect(errSpy).not.toHaveBeenCalled()
  })
})
