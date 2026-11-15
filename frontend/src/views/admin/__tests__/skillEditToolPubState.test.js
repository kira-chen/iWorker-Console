// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { createPinia } from 'pinia'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * 技能编辑页 · 工具候选含未发布的连接器 + 发布校验（产品优化需求-202611 修改点 13（R4）），真实挂载走查。
 *
 * 页面 + 真实 SkillFocusEditor / ToolDock / ReferencedToolsPanel / VersionDrawer + 真 Element Plus 一起挂，
 * 数据走真实 unifiedSkillMock 与三个连接器 mock（同 adminSkillEditPageSmoke.test.js 的挂法，只桩 request 与 vue-router）。
 * 断言落在用户看得到的结果：工具卡与「本技能已引用」区的「未发布」「审核中」标签、版本管理弹窗的阻断提示与【提交发布】置灰。
 * 种子口径：邮件中心 MCP（mail_center）从未发布；CRM MCP（crm）、人力资源系统（biz_2102）审核中；企业知识库 MCP 已发布。
 * 每条用例自建草稿技能（名称带时间戳），不改共享种子。
 */
const memStore = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    get length() { return memStore.size },
    key: (i) => [...memStore.keys()][i] ?? null,
    getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => memStore.set(k, String(v)),
    removeItem: (k) => memStore.delete(k),
    clear: () => memStore.clear()
  },
  writable: true,
  configurable: true
})
afterAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
})

vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor({ code, message } = {}) {
      super(message)
      this.code = code
    }
  }
}))
const routeState = vi.hoisted(() => ({ id: 'sk_302' }))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ({ push: vi.fn(), resolve: vi.fn(() => ({ href: '#' })) }),
  useRoute: () => ({ meta: { skillSource: 'platform' }, params: routeState, query: {}, name: 'AdminSkillEdit' }),
  onBeforeRouteLeave: vi.fn()
}))

const AdminSkillEditPage = (await import('@/views/admin/AdminSkillEditPage.vue')).default
const skillMock = await import('@/api/unifiedSkillMock')

/** 自建一条发布必填项齐全的市场技能草稿，正文引用给定工具。 */
async function mkDraft(label, codes) {
  const name = `${label}${Date.now()}`
  const { skillId } = await skillMock.createSkill({ name, type: 'PLATFORM', categoryName: '办公效率' })
  await skillMock.updateSkill(skillId, {
    icon: '🧪',
    description: 'R4 走查用技能',
    exampleQuestion: '帮我查一下',
    skillMd: `# ${name}\n\n${codes.map((c) => `@tool[${c}]`).join('\n')}\n`
  })
  return skillId
}

let mounted
async function mountPage(skillId) {
  routeState.id = skillId
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mounted = mountReal(AdminSkillEditPage, {}, { plugins: [createPinia()] })
  await flushAll(12)
  // 详情 / 文件树 / 工具坞候选都有 mock delay；全量并发跑时固定等 400ms 不够，等到候选真正渲染出来
  await vi.waitFor(
    () => {
      if (!mounted.container.querySelector('.dtool')) throw new Error('工具坞候选还没渲染')
    },
    { timeout: 8000, interval: 50 }
  )
  await flushAll(8)
  return mounted.container
}
afterEach(() => {
  routeState.id = 'sk_302'
  mounted?.unmount()
  mounted = null
  document.querySelectorAll('.el-drawer, .el-overlay').forEach((n) => n.remove()) // 抽屉 teleport 到 body，卸载后清残留
  vi.restoreAllMocks()
})

const refRow = (el, name) => [...el.querySelectorAll('.ref-row')].find((r) => r.querySelector('.ref-code')?.textContent.trim() === name)
const toolCard = (el, name) => [...el.querySelectorAll('.dtool')].find((c) => c.querySelector('.dtool-name')?.textContent.trim() === name)

describe('技能编辑页 · 连接器发布态（R4，真实挂载）', () => {
  it('工具坞 MCP 页签候选含未发布、审核中的连接器，名称旁标「未发布」「审核中」，已发布的不标', async () => {
    const el = await mountPage(await mkDraft('R4候选', ['mcp__knowledge_hub']))
    const draft = toolCard(el, '邮件中心 MCP')
    const reviewing = toolCard(el, 'CRM MCP')
    const live = toolCard(el, '企业知识库 MCP')
    expect(draft?.querySelector('.pubtag')?.textContent.trim()).toBe('未发布')
    expect(reviewing?.querySelector('.pubtag')?.textContent.trim()).toBe('审核中')
    expect(live).toBeTruthy()
    expect(live.querySelector('.pubtag')).toBeNull()
  })

  it('「本技能已引用」区同样标发布态：未发布、审核中有标签，已发布无标签', async () => {
    const el = await mountPage(await mkDraft('R4已引用', ['mcp__mail_center', 'biz__biz_2102', 'mcp__knowledge_hub']))
    expect(refRow(el, '邮件中心 MCP')?.querySelector('.ref-pub')?.textContent.trim()).toBe('未发布')
    expect(refRow(el, '人力资源系统')?.querySelector('.ref-pub')?.textContent.trim()).toBe('审核中')
    expect(refRow(el, '企业知识库 MCP')).toBeTruthy()
    expect(refRow(el, '企业知识库 MCP').querySelector('.ref-pub')).toBeNull()
  })

  it('引用了未发布的连接器：【发布】可点，打开版本管理弹窗展示「引用的「名称」尚未发布…」，【提交发布】不可点', async () => {
    const el = await mountPage(await mkDraft('R4阻断', ['mcp__mail_center', 'mcp__knowledge_hub']))
    const publishBtn = el.querySelector('.topline-verpub')
    expect(publishBtn.disabled).toBe(false) // 必填项齐全：【发布】不因工具未发布置灰，否则弹窗打不开、提示看不到
    publishBtn.click()
    await flushAll(8)
    await new Promise((r) => setTimeout(r, 300)) // 抽屉内拉下一版本号 / 版本历史
    await flushAll(8)
    const drawer = document.querySelector('.el-drawer')
    expect(drawer.querySelector('.vd-gate')?.textContent.trim()).toBe('引用的「邮件中心 MCP」尚未发布，请先发布该连接器或移除引用')
    const submit = [...drawer.querySelectorAll('button')].find((b) => b.textContent.includes('提交发布'))
    expect(submit.disabled).toBe(true)
  })

  it('引用的连接器都已发布：版本管理弹窗无阻断提示', async () => {
    const el = await mountPage(await mkDraft('R4放行', ['mcp__knowledge_hub']))
    el.querySelector('.topline-verpub').click()
    await flushAll(8)
    await new Promise((r) => setTimeout(r, 300))
    await flushAll(8)
    const drawer = document.querySelector('.el-drawer')
    expect(drawer.querySelector('.vd-pub')).toBeTruthy() // 前提：发布表单已渲染
    expect(drawer.querySelector('.vd-gate')).toBeNull()
  })
})
