// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * SkillCategories.vue 单测（N3 backlog：上移/下移无障碍排序 + 部分保存提示 + 重名前端预校验）。
 *
 * 切断 api/skillCategory 与 element-plus（ElMessage/ElMessageBox）。EP 组件用轻量存根。
 * 用 createApp 挂 jsdom；通过点「上移/下移」按钮触发 reorder，断言逐行 updateSkillCategory + 提示语义。
 */

const api = {
  listSkillCategories: vi.fn(),
  createSkillCategory: vi.fn(),
  updateSkillCategory: vi.fn(),
  getCategoryDeleteImpact: vi.fn(),
  deleteSkillCategory: vi.fn()
}
vi.mock('@/api/skillCategory', () => api)

const msg = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
const msgBox = { prompt: vi.fn(), confirm: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage: msg, ElMessageBox: msgBox }))

// connector.css 副作用 import：切断（jsdom 不解析 css）
vi.mock('@/assets/connector.css', () => ({}))

const stubs = {
  PageHeader: { template: '<div class="page-header"><slot /></div>' },
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  'el-empty': { props: ['description'], template: '<div class="el-empty"><slot /></div>' },
  'el-button': {
    props: ['disabled', 'loading', 'type', 'link'],
    emits: ['click'],
    template:
      '<button class="el-button" :disabled="disabled" :data-type="type" @click="$emit(\'click\')"><slot /></button>'
  }
}
// v-loading 指令存根
const vLoading = { mounted() {}, updated() {} }

const Plus = { template: '<span/>' }
const Rank = { template: '<span/>' }
const ArrowUp = { template: '<span class="i-up"/>' }
const ArrowDown = { template: '<span class="i-down"/>' }
vi.mock('@element-plus/icons-vue', () => ({ Plus, Rank, ArrowUp, ArrowDown }))

const SkillCategories = (await import('@/views/admin/SkillCategories.vue')).default

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(SkillCategories) })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.directive('loading', vLoading)
  app.mount(container)
  await nextTick()
  await Promise.resolve()
  await nextTick()
  return container
}

function rowEls(container) {
  return [...container.querySelectorAll('.sc-row')]
}
// 某行的上移/下移按钮（含对应 icon 的 button）
function moveBtn(rowEl, dir) {
  const sel = dir === 'up' ? '.i-up' : '.i-down'
  return [...rowEl.querySelectorAll('.el-button')].find((b) => b.querySelector(sel))
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listSkillCategories.mockResolvedValue([
    { id: 1, name: '甲', sort: 0, count: 2 },
    { id: 2, name: '乙', sort: 1, count: 0 },
    { id: 3, name: '丙', sort: 2, count: 1 }
  ])
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('SkillCategories · N3 backlog', () => {
  it('渲染三行；首行上移禁用、末行下移禁用（不越界）', async () => {
    const el = await mount()
    const rows = rowEls(el)
    expect(rows.length).toBe(3)
    expect(moveBtn(rows[0], 'up').disabled).toBe(true) // 首行不能上移
    expect(moveBtn(rows[2], 'down').disabled).toBe(true) // 末行不能下移
    expect(moveBtn(rows[0], 'down').disabled).toBe(false)
  })

  it('下移第一行 → 逐行提交 sort，全成功提示「排序已保存」', async () => {
    api.updateSkillCategory.mockResolvedValue({})
    const el = await mount()
    moveBtn(rowEls(el)[0], 'down').click()
    await nextTick(); await Promise.resolve(); await Promise.resolve(); await nextTick()
    // 甲(原0)↔乙(原1) 换位：乙落 sort0、甲落 sort1（丙仍 sort2 不变，不提交）
    expect(api.updateSkillCategory).toHaveBeenCalledWith(2, { sort: 0 })
    expect(api.updateSkillCategory).toHaveBeenCalledWith(1, { sort: 1 })
    expect(api.updateSkillCategory).toHaveBeenCalledTimes(2)
    expect(msg.success).toHaveBeenCalledWith('排序已保存')
  })

  it('部分失败（第二行提交抛错）→ 提示「部分已保存」+ 重拉，而非笼统失败', async () => {
    api.updateSkillCategory
      .mockResolvedValueOnce({}) // 第一行成功
      .mockRejectedValueOnce(new Error('boom')) // 第二行失败
    const el = await mount()
    api.listSkillCategories.mockClear() // 只观察失败后的重拉
    moveBtn(rowEls(el)[0], 'down').click()
    await nextTick(); await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(msg.warning).toHaveBeenCalledWith('部分已保存，剩余未保存已重新加载')
    expect(msg.error).not.toHaveBeenCalled()
    expect(api.listSkillCategories).toHaveBeenCalledTimes(1) // 重拉对齐
  })

  it('零落库（首个提交即失败）→ 回滚 + 「排序保存失败」', async () => {
    api.updateSkillCategory.mockRejectedValue(new Error('down'))
    const el = await mount()
    moveBtn(rowEls(el)[0], 'down').click()
    await nextTick(); await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(msg.error).toHaveBeenCalled()
    expect(msg.warning).not.toHaveBeenCalledWith('部分已保存，剩余未保存已重新加载')
  })

  it('新增：inputValidator 本地判重——同名（忽略大小写/空白）当场拦下', async () => {
    // 让 prompt reject('cancel') 以便走取消分支不落后端；只取其 inputValidator 做本地断言。
    msgBox.prompt.mockRejectedValue('cancel')
    const el = await mount()
    // 点「新增分类」
    ;[...el.querySelectorAll('.el-button')].find((b) => b.textContent.includes('新增分类')).click()
    await Promise.resolve()
    const opts = msgBox.prompt.mock.calls[0][2]
    expect(opts.inputValidator('')).toBe('分类名不能为空')
    expect(opts.inputValidator('  甲 ')).toBe('已有同名分类，请换个名字') // 与现有「甲」重名
    expect(opts.inputValidator(' jiaFEI ')).toBe(true) // 不重名放行
  })

  it('重命名：inputValidator 排除自身，仅与其它行判重', async () => {
    msgBox.prompt.mockRejectedValue('cancel')
    const el = await mount()
    // 点第一行（甲）的「重命名」
    const renameBtn = [...rowEls(el)[0].querySelectorAll('.el-button')].find((b) =>
      b.textContent.includes('重命名')
    )
    renameBtn.click()
    await Promise.resolve()
    const opts = msgBox.prompt.mock.calls[0][2]
    // 改成「乙」（别行已存在）→ 拦下
    expect(opts.inputValidator('乙')).toBe('已有同名分类，请换个名字')
    // 保持自身名「甲」→ 不算重名（排除自身），放行
    expect(opts.inputValidator('甲')).toBe(true)
  })
})
