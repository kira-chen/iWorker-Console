// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * ExpertEditor.vue 真实挂载冒烟（2026-09-12 测试审计 T50）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家.md §三.1 页面状态（新建标题「新建专家」、底部【取消】【创建专家】）/
 * §三.2 基本信息字段 / §三.3 示例问题 / §三.4 技能引用（2026-11-10 起按专家类型取候选，新建先选类型）/ §三.5 知识库。
 *
 * 与 expertEditor.test.js（el-drawer / el-form 全桩）互补：真 Element Plus + 真 DrawerEditor（el-drawer）/
 * IconField / SkillMilkdownEditor / KnowledgeSearchDialog，只 mock api 层。
 */

const api = {
  getExpert: vi.fn(),
  createExpert: vi.fn(),
  updateExpert: vi.fn(),
  listExpertSkillCandidates: vi.fn()
}
vi.mock('@/api/domainExpert', () => api)
vi.mock('@/api/knowledgeBase', () => ({ listKnowledgeBases: vi.fn().mockResolvedValue({ list: [], total: 0 }) }))

const ExpertEditor = (await import('@/components/admin/ExpertEditor.vue')).default

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })

let mounted
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

describe('ExpertEditor · 真实挂载冒烟（真 el-drawer / el-form，只 mock api）', () => {
  it('新建态挂载不抛：抽屉标题「新建专家」+ 说明条 + 六个基本信息字段 + 示例问题 3 行 + 选类型后出技能候选 + footer【取消】【创建专家】，console.error 零调用（md §三.1-§三.4）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.listExpertSkillCandidates.mockResolvedValue([
      { id: 302, name: '经营数据分析', description: '读取经营数据并生成趋势分析', category: '数据分析', type: 'PLATFORM' },
      { id: 303, name: '会议纪要整理', description: '提取会议结论、待办事项与责任人', category: '办公效率', type: 'SYSTEM_DEFAULT' }
    ])

    expect(() => { mounted = mountReal(ExpertEditor, { visible: true, expertId: null }, { plugins: [router] }) }).not.toThrow()
    await flushAll(12)
    // DrawerEditor 的 el-drawer 就地渲染（非 append-to-body），从 container 取
    const drawer = mounted.container.querySelector('.el-drawer')
    expect(drawer).toBeTruthy()
    const text = drawer.textContent

    expect(drawer.querySelector('.de-head-title').textContent).toBe('新建专家')
    expect(text).toContain('专家由多个技能组成。技能保持引用关系，技能更新后专家会同步使用最新内容。')
    // md §三.2 基本信息字段（真 el-form-item label）
    const labels = [...drawer.querySelectorAll('.el-form-item__label')].map((l) => l.textContent.trim())
    expect(labels).toEqual(['专家类型', '专家名', '分类', '图标', '背景色', '简介', '职责描述'])
    expect(drawer.querySelector('input[placeholder="如 经营分析专家"]')).toBeTruthy()
    // 图标行双按钮（真 IconField）
    const iconBtns = [...drawer.querySelectorAll('.icon-row .el-button')].map((b) => b.textContent.trim())
    expect(iconBtns).toEqual(['从图标库选择', '上传图标'])
    // md §三.3 示例问题固定 3 行 + 区级【AI 生成】
    expect(drawer.querySelectorAll('.ee-q-row').length).toBe(3)
    expect(text).toContain('AI 生成')
    // md §三.4 技能引用：没选专家类型时没有候选，提示先选类型
    expect(text).toContain('请先选择专家类型')
    expect(drawer.querySelectorAll('.ee-skill-check').length).toBe(0)
    // 选「市场专家」（真 el-radio-button）→ 按类型取候选：卡片 + 类型标签 + 汇总行
    const platformRadio = [...drawer.querySelectorAll('.ee-type-seg .el-radio-button')].find((l) => l.textContent.trim() === '市场专家')
    platformRadio.querySelector('input').click()
    await flushAll(12)
    expect(api.listExpertSkillCandidates).toHaveBeenLastCalledWith({ expertType: 'PLATFORM' })
    expect(drawer.textContent).toContain('已选择 0 个 · 共 2 个技能')
    expect([...drawer.querySelectorAll('.ee-skill-check .ee-skill-type')].map((t) => t.textContent)).toEqual(['市场技能', '通用技能'])
    // md §三.5 知识库区块在
    expect(text).toContain('当前专家可见范围内的知识库')
    // md §三.1 footer：新建 =【取消】【创建专家】，无【发布】
    const footBtns = [...drawer.querySelectorAll('.el-drawer__footer .el-button')].map((b) => b.textContent.trim())
    expect(footBtns).toEqual(['取消', '创建专家'])
    // 新建不展示时间条
    expect(drawer.querySelector('.ee-meta')).toBeNull()

    expect(errSpy).not.toHaveBeenCalled()
  })

  it('只读查看态：标题「查看专家」+ footer 仅【关闭】+ 输入禁用 + 时间条（md §三.1 / §三.6），console.error 零调用', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.listExpertSkillCandidates.mockResolvedValue([])
    api.getExpert.mockResolvedValue({
      id: 201, name: '经营分析专家', category: '投资', avatar: '▤', backgroundColor: '#DCF5E4', intro: '汇总经营数据',
      roleDesc: '你是一名经营分析专家。', status: 'published', pendingAction: null, latestVersionLabel: 'v2.3.0',
      createdAt: '2026-08-12T09:20:00+08:00', updatedAt: '2026-08-24T14:12:00+08:00', publishedAt: '2026-08-20T16:30:00+08:00',
      exampleQuestions: ['问一', '问二', '问三'], skillIds: [], skills: []
    })
    mounted = mountReal(ExpertEditor, { visible: true, expertId: 201, readonly: true }, { plugins: [router] })
    await flushAll(12)
    const drawer = mounted.container.querySelector('.el-drawer')
    expect(drawer.querySelector('.de-head-title').textContent).toBe('查看专家')
    expect(drawer.textContent).toContain('已发布')
    expect(drawer.querySelector('input[placeholder="如 经营分析专家"]').disabled).toBe(true)
    expect(drawer.querySelector('input[placeholder="如 经营分析专家"]').value).toBe('经营分析专家')
    expect(drawer.querySelector('.ee-meta').textContent).toContain('最新版本：v2.3.0')
    const footBtns = [...drawer.querySelectorAll('.el-drawer__footer .el-button')].map((b) => b.textContent.trim())
    expect(footBtns).toEqual(['关闭'])
    expect(errSpy).not.toHaveBeenCalled()
  })
})
