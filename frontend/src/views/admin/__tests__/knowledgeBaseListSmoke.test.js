// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * KnowledgeBaseList.vue 真实 Element Plus 挂载 —— 2026-10-08 测试审计补缺口。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md：
 * - 冒烟：整页真挂载不抛、console.error 零调用；右上角【新建知识库】（§三.1）与种子首行名称在；
 * - §三.2 L73 / §八.2「列表加载失败：保留查询条件，展示原因和【重试】」——点【重试】按同一组查询参数再取数；
 * - §八.2「重复提交：请求进行中禁用相关按钮」——行内【发布】在途期间该行操作按钮全部禁用。
 *
 * 与 knowledgeBaseList.test.js（全桩 el-*）互补：这里不桩任何组件。api 层默认透传到真实 knowledgeBaseMock
 * （种子数据、真 250ms 延迟），个别用例再按需改写返回值。
 */
vi.mock('vue-router', () => ({ useRoute: () => routeMock, useRouter: () => routerMock }))
const routeMock = { query: {} }
const routerMock = { replace: vi.fn() }

vi.mock('@/api/knowledgeBase', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    listKnowledgeBases: vi.fn(real.listKnowledgeBases),
    publishKnowledgeBase: vi.fn(real.publishKnowledgeBase)
  }
})
const api = await import('@/api/knowledgeBase')
const KnowledgeBaseList = (await import('@/views/admin/KnowledgeBaseList.vue')).default

let mounted, errorSpy
beforeEach(() => {
  routeMock.query = {}
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  api.listKnowledgeBases.mockClear()
  api.publishKnowledgeBase.mockClear()
})

const text = () => mounted.container.textContent
const rowOf = (name) => [...mounted.container.querySelectorAll('.el-table__body tr')].find((tr) => tr.textContent.includes(name))
const opBtns = (tr) => [...tr.querySelectorAll('.tbl-ops .el-button')]
async function mountPage() {
  mounted = mountReal(KnowledgeBaseList)
  await flushAll(6)
}

describe('KnowledgeBaseList · 真实挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；【新建知识库】与种子首行「产品与解决方案库」都在', async () => {
    await expect(mountPage()).resolves.toBeUndefined()
    await vi.waitFor(() => expect(rowOf('产品与解决方案库')).toBeTruthy(), { timeout: 3000 })
    expect(mounted.container.querySelector('.lt-create').textContent.trim()).toBe('新建知识库')
    expect(mounted.container.querySelector('.el-table__body tr').textContent).toContain('产品与解决方案库')
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('KnowledgeBaseList · 加载失败与重试（md §三.2 L73 / §八.2）', () => {
  const FAIL = '网络异常：知识库服务暂不可用'
  async function mountFailing() {
    routeMock.query = { kw: '白皮书', st: 'DRAFT' }
    api.listKnowledgeBases.mockRejectedValueOnce(new Error(FAIL))
    await mountPage()
    await vi.waitFor(() => expect(text()).toContain('加载失败'), { timeout: 3000 })
  }

  it('首次取数失败 → 出「加载失败」与【重试】，不出空态文案', async () => {
    await mountFailing()
    const retry = [...mounted.container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '重试')
    expect(retry).toBeTruthy()
    expect(text()).not.toContain('暂无符合条件的知识库')
    expect(text()).not.toContain('还没有知识库')
  })

  it('点【重试】→ 按同一组查询参数（关键词 / 状态 / 页码）再取一次，取到后出行', async () => {
    await mountFailing()
    expect(api.listKnowledgeBases).toHaveBeenCalledTimes(1)
    const first = api.listKnowledgeBases.mock.calls[0][0]
    expect(first).toMatchObject({ keyword: '白皮书', status: 'DRAFT', page: 1 })
    ;[...mounted.container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '重试').click()
    await flushAll(4)
    expect(api.listKnowledgeBases).toHaveBeenCalledTimes(2)
    expect(api.listKnowledgeBases.mock.calls[1][0]).toEqual(first)
    await vi.waitFor(() => expect(rowOf('2026 产品白皮书库')).toBeTruthy(), { timeout: 3000 })
  })

  // 疑似缺陷：ListStates 失败态只有固定的「加载失败」，useAdminList 的 loadError 是布尔值、不保留原因，
  // md §三.2 L73「失败展示错误原因和重试」、§八.2「列表加载失败：……展示原因和【重试】」。前提见上两条。
  it.fails('取数失败 → 页面上能看到失败原因（疑似缺陷：只显示「加载失败」，不显示原因；md §三.2 L73 / §八.2）', async () => {
    await mountFailing()
    expect(text()).toContain(FAIL)
  })
})

describe('KnowledgeBaseList · 防重复提交（md §八.2）', () => {
  it('行内【发布】确认后接口未返回期间 → 该行所有操作按钮禁用；返回后恢复', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    let finish
    api.publishKnowledgeBase.mockImplementationOnce(() => new Promise((r) => (finish = r)))
    await mountPage()
    await vi.waitFor(() => expect(rowOf('2026 产品白皮书库')).toBeTruthy(), { timeout: 3000 })
    const btns = () => opBtns(rowOf('2026 产品白皮书库'))
    expect(btns().map((b) => b.textContent.trim())).toEqual(['查看', '编辑', '发布', '删除'])
    expect(btns().every((b) => !b.disabled)).toBe(true)

    btns().find((b) => b.textContent.trim() === '发布').click()
    await flushAll(6)
    expect(api.publishKnowledgeBase).toHaveBeenCalledTimes(1)
    expect(btns().every((b) => b.disabled)).toBe(true)
    // 别的行不受影响
    expect(opBtns(rowOf('产品与解决方案库')).every((b) => !b.disabled)).toBe(true)

    finish({})
    await flushAll(6)
    await vi.waitFor(() => expect(btns().every((b) => !b.disabled)).toBe(true), { timeout: 3000 })
  })
})
