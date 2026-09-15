// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'

/**
 * AdminFeedback.vue（用户反馈）列表页单测（2026-09-12 测试审计 T56 新建，此前 403 行零测试）。
 *
 * 对齐 md `prd.用户反馈.md`：
 * - §一 L8 页面说明；§二 查询区（占位「搜索用户名 / 反馈内容」、终端 Mac / Windows、【查询】回第 1 页）；
 * - §三 五列：终端 Mac 蓝 / Windows 紫标签、反馈时间 ↓↑ 默认倒序、反馈内容点击开全文、附图「▧ N」/ 无附件「—」；
 * - §四 「反馈详情」弹窗：用户 / 反馈时间 / 终端 + 完整内容，底部仅【关闭】；
 * - §五 「查看附图」弹窗：大图预览 + 附件序号，底部仅【关闭】；§七 L60 附图加载失败在弹窗内提示；
 * - §七 L59 空态「暂无用户反馈」；L61 正文为空显示「—」；L62 加载失败 + 【重试】。
 * 另验代码超集：行数据变化（翻页 / 重查）后释放上一页原图 objectURL 并先关附图弹窗（AdminFeedback.vue:120-127）。
 * 桩法照 userSkillReviews.test.js：ListToolbar / ListStates / ListPagination / StatusTag 真挂载，EP 原生控件桩。
 */

const listFeedbacks = vi.fn()
const fetchFeedbackImageBlob = vi.fn()
vi.mock('@/api/feedback', () => ({
  listFeedbacks: (...a) => listFeedbacks(...a),
  fetchFeedbackImageBlob: (...a) => fetchFeedbackImageBlob(...a)
}))
vi.mock('@/components/PageHeader.vue', () => ({
  default: {
    props: ['title', 'subtitle'],
    template: '<div class="page-header">{{ title }}<span class="ph-sub">{{ subtitle }}</span></div>'
  }
}))

const AdminFeedback = (await import('@/views/admin/AdminFeedback.vue')).default

const { RowCells, tableColStub } = makeElTableStubs({ renderHeader: true })
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'el-table' }, [
        h('div', { class: 'el-head' }, slots.default?.()),
        ...props.data.map((row, i) => h(RowCells, { row, colSlot: slots.default, key: row.id ?? i }))
      ])
  }
}
const elInput = {
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'keyup', 'clear'],
  template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup="$emit(\'keyup\', $event)" />'
}
const elSelect = {
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'change'],
  template:
    '<div class="el-select" :data-placeholder="placeholder" @pick="$emit(\'update:modelValue\', $event.detail); $emit(\'change\', $event.detail)"><slot /></div>'
}
const pick = (selectEl, value) => selectEl.dispatchEvent(new CustomEvent('pick', { detail: value }))
const elOption = { props: ['label', 'value'], template: '<div class="el-option" :data-value="value">{{ label }}</div>' }
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const elDialog = {
  props: ['modelValue', 'title', 'width'],
  emits: ['update:modelValue', 'closed'],
  template:
    '<div v-if="modelValue" class="el-dialog" :data-title="title"><div class="dlg-body"><slot /></div><div class="dlg-footer"><slot name="footer" /></div></div>'
}
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String, link: Boolean },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-type="type" @click="!disabled && $emit(\'click\')"><slot /></button>'
}

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminFeedback)
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-icon', passthrough('el-icon'))
  app.component('Search', { template: '<i class="icon-search" />' })
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-empty', elEmpty)
  app.component('el-dialog', elDialog)
  app.component('el-button', elButton)
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
  }
}
const rowEls = () => [...container.querySelectorAll('.el-row')]
const rowByUser = (u) => rowEls().find((el) => el.querySelector('[data-label="用户名"]').textContent.trim() === u)
const toolbarBtn = (text) => [...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)
const dialogByTitle = (t) => [...container.querySelectorAll('.el-dialog')].find((d) => d.dataset.title === t)

const img = (id, seq) => ({ seq, thumb_url: `mock-fb://${id}/${seq}`, url: `mock-fb://${id}/${seq}` })
// 夹具照 feedbackMock 种子形状（含一条正文为空的行，验 md §七 L61）
const ROWS = [
  { id: 1, username: 'zhangwei', createdAt: '2026-08-28 10:12', content: '希望对话中的引用来源可以一键复制，同时保留原始链接和更新时间。', terminal: 'WINDOWS', images: [img(1, 1), img(1, 2)] },
  { id: 2, username: 'li.na', createdAt: '2026-08-27 18:36', content: '任务执行完成后建议增加桌面通知，并支持只提醒失败任务。', terminal: 'MAC', images: [] },
  { id: 3, username: 'chenyu', createdAt: '2026-08-27 14:20', content: '', terminal: 'WINDOWS', images: [img(3, 1)] }
]

let createObjectURL, revokeObjectURL
beforeEach(() => {
  // 每次返回新数组（真实 mock 返回 clone）：页面 watch(rows) 靠引用变化触发释放 objectURL
  listFeedbacks.mockReset().mockImplementation(() => Promise.resolve({ list: [...ROWS], total: ROWS.length }))
  fetchFeedbackImageBlob.mockReset().mockResolvedValue(new Blob(['<svg/>'], { type: 'image/svg+xml' }))
  // jsdom 没有 objectURL：桩成可断言的假地址
  let seq = 0
  createObjectURL = vi.fn(() => `blob:mock/${++seq}`)
  revokeObjectURL = vi.fn()
  globalThis.URL.createObjectURL = createObjectURL
  globalThis.URL.revokeObjectURL = revokeObjectURL
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  delete globalThis.URL.createObjectURL
  delete globalThis.URL.revokeObjectURL
})

describe('AdminFeedback · 用户反馈（md prd.用户反馈.md）', () => {
  it('页面说明取 md §一 L8；挂载即拉列表（默认 sortDir=desc、page=1）', async () => {
    await mount()
    expect(container.querySelector('.ph-sub').textContent).toBe('查看客户端用户提交的意见反馈与截图附件')
    expect(listFeedbacks).toHaveBeenCalledWith(expect.objectContaining({ sortDir: 'desc', page: 1 }))
  })

  it('查询区（md §二）：搜索框在终端筛选之前、占位「搜索用户名 / 反馈内容」、终端 Mac / Windows、【查询】', async () => {
    await mount()
    const toolbar = container.querySelector('.list-toolbar')
    expect(toolbar.querySelector('.el-input').placeholder).toBe('搜索用户名 / 反馈内容')
    const select = toolbar.querySelector('.el-select')
    expect(select.dataset.placeholder).toBe('全部终端')
    expect([...select.querySelectorAll('.el-option')].map((o) => o.textContent)).toEqual(['Mac', 'Windows'])
    expect(toolbar.querySelector('.el-input').compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toolbarBtn('查询')).toBeTruthy()
  })

  it('终端下拉选中 Mac → 即时按 terminal 重查回第 1 页、列表只剩 Mac 行；【查询】带 keyword 可组合（md §二 L17-19）', async () => {
    listFeedbacks.mockImplementation((p = {}) => {
      let list = ROWS
      if (p.terminal) list = list.filter((r) => r.terminal === p.terminal)
      if (p.keyword) list = list.filter((r) => r.username.includes(p.keyword) || r.content.includes(p.keyword))
      return Promise.resolve({ list, total: list.length })
    })
    await mount()
    expect(rowEls()).toHaveLength(3)
    listFeedbacks.mockClear()
    pick(container.querySelector('.el-select'), 'MAC')
    await flush()
    expect(listFeedbacks).toHaveBeenCalledWith(expect.objectContaining({ terminal: 'MAC', page: 1 }))
    expect(rowEls()).toHaveLength(1)
    expect(rowByUser('li.na')).toBeTruthy()
    const input = container.querySelector('.el-input')
    input.value = 'zhang'
    input.dispatchEvent(new Event('input'))
    await flush()
    toolbarBtn('查询').click()
    await flush()
    expect(listFeedbacks).toHaveBeenLastCalledWith(expect.objectContaining({ terminal: 'MAC', keyword: 'zhang', page: 1 }))
    expect(container.querySelector('.ls-empty').textContent).toContain('暂无用户反馈')
  })

  it('五列表头（反馈时间列头带 ↓）；终端 Mac 蓝（accent）/ Windows 紫（purple）标签；时间精确到分钟（md §三）', async () => {
    await mount()
    const heads = [...container.querySelectorAll('.el-head .el-table-column')].map((c) => c.textContent.replace(/\s+/g, ' ').trim())
    expect(heads).toEqual(['用户名', '终端', '反馈时间 ↓', '反馈内容', '附图'])
    const win = rowByUser('zhangwei').querySelector('.status-tag')
    expect(win.textContent.trim()).toBe('Windows')
    expect(win.classList.contains('st--purple')).toBe(true)
    const mac = rowByUser('li.na').querySelector('.status-tag')
    expect(mac.textContent.trim()).toBe('Mac')
    expect(mac.classList.contains('st--accent')).toBe(true)
    expect(rowByUser('zhangwei').textContent).toContain('2026-08-28 10:12')
  })

  it('附图列：有附件按顺序出「▧ 1」「▧ 2」编号按钮，无附件「—」；反馈正文为空显示「—」且其他元数据照常（md §三 L29 / §七 L61）', async () => {
    await mount()
    const thumbs = (row) => [...row.querySelectorAll('.fb-thumb')].map((b) => b.textContent.trim())
    expect(thumbs(rowByUser('zhangwei'))).toEqual(['▧ 1', '▧ 2'])
    expect(thumbs(rowByUser('li.na'))).toEqual([])
    expect(rowByUser('li.na').querySelector('[data-label="附图"]').textContent.trim()).toBe('—')
    const empty = rowByUser('chenyu')
    expect(empty.querySelector('.fb-content')).toBeNull()
    expect(empty.querySelector('[data-label="反馈内容"]').textContent.trim()).toBe('—')
    expect(empty.querySelector('.status-tag').textContent.trim()).toBe('Windows')
    expect(thumbs(empty)).toEqual(['▧ 1'])
  })

  it('点反馈内容 → 「反馈详情」弹窗：用户 / 反馈时间 / 终端 + 完整原文，底部仅【关闭】，点关闭即收起（md §四）', async () => {
    await mount()
    rowByUser('zhangwei').querySelector('.fb-content').click()
    await flush()
    const dlg = dialogByTitle('反馈详情')
    expect(dlg).toBeTruthy()
    const items = [...dlg.querySelectorAll('.fb-detail-item')].map((i) => [i.querySelector('dt').textContent, i.querySelector('dd').textContent])
    expect(items).toEqual([['用户', 'zhangwei'], ['反馈时间', '2026-08-28 10:12'], ['终端', 'Windows']])
    expect(dlg.querySelector('.fb-content-full').textContent).toBe('希望对话中的引用来源可以一键复制，同时保留原始链接和更新时间。')
    const footer = [...dlg.querySelectorAll('.dlg-footer .el-button')].map((b) => b.textContent.trim())
    expect(footer).toEqual(['关闭'])
    dlg.querySelector('.dlg-footer .el-button').click()
    await flush()
    expect(dialogByTitle('反馈详情')).toBeUndefined()
  })

  it('点「▧ 2」→ 「查看附图」弹窗：拉该张原图（fetchFeedbackImageBlob 收到 mock-fb://1/2）→ 大图 img[alt="反馈截图 2"] + 「附件 2」，底部仅【关闭】（md §五）', async () => {
    await mount()
    ;[...rowByUser('zhangwei').querySelectorAll('.fb-thumb')][1].click()
    await flush()
    const dlg = dialogByTitle('查看附图')
    expect(dlg).toBeTruthy()
    expect(fetchFeedbackImageBlob).toHaveBeenCalledWith('mock-fb://1/2')
    const image = dlg.querySelector('img.fb-image-large-img')
    expect(image).toBeTruthy()
    expect(image.getAttribute('alt')).toBe('反馈截图 2')
    expect(image.getAttribute('src')).toBe('blob:mock/1')
    expect(dlg.querySelector('.fb-image-caption').textContent.trim()).toBe('附件 2')
    expect([...dlg.querySelectorAll('.dlg-footer .el-button')].map((b) => b.textContent.trim())).toEqual(['关闭'])
    expect(dlg.querySelector('.fb-viewer-error')).toBeNull()
    // 同一张再点：走缓存不重复拉图
    dlg.querySelector('.dlg-footer .el-button').click()
    await flush()
    ;[...rowByUser('zhangwei').querySelectorAll('.fb-thumb')][1].click()
    await flush()
    expect(fetchFeedbackImageBlob).toHaveBeenCalledTimes(1)
  })

  it('原图拉取失败 → 弹窗预览区内展示「附图加载失败，请稍后重试。」与序号，不出 img（md §七 L60）', async () => {
    fetchFeedbackImageBlob.mockRejectedValueOnce(new Error('图片加载失败'))
    await mount()
    rowByUser('chenyu').querySelector('.fb-thumb').click()
    await flush()
    const dlg = dialogByTitle('查看附图')
    expect(dlg.querySelector('img')).toBeNull()
    expect(dlg.querySelector('.fb-viewer-error').textContent).toBe('附图加载失败，请稍后重试。')
    expect(dlg.querySelector('.fb-image-seq').textContent.trim()).toBe('反馈截图 1')
  })

  it('弹窗开着时重查（行数据变化）→ 先关附图弹窗再释放上一页原图 objectURL（AdminFeedback.vue:120-127）', async () => {
    await mount()
    rowByUser('zhangwei').querySelector('.fb-thumb').click()
    await flush()
    expect(dialogByTitle('查看附图')).toBeTruthy()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    toolbarBtn('查询').click()
    await flush()
    expect(dialogByTitle('查看附图')).toBeUndefined()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock/1')
    // 缓存已清：再点同一张会重新拉图
    rowByUser('zhangwei').querySelector('.fb-thumb').click()
    await flush()
    expect(fetchFeedbackImageBlob).toHaveBeenCalledTimes(2)
  })

  it('反馈时间列头点击 → 切正序 ↑ 并按 sortDir=asc 重查回第 1 页（md §三 L27 / §六 L53）', async () => {
    await mount()
    listFeedbacks.mockClear()
    container.querySelector('.fb-sort').click()
    await flush()
    expect(listFeedbacks).toHaveBeenCalledWith(expect.objectContaining({ sortDir: 'asc', page: 1 }))
    expect(container.querySelector('.fb-sort-arrow').textContent).toBe('↑')
  })

  it('空态「暂无用户反馈」（md §七 L59）；加载失败出「加载失败」+【重试】（md §七 L62）', async () => {
    listFeedbacks.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(container.querySelector('.ls-empty').textContent).toContain('暂无用户反馈')
    app.unmount(); container.remove()
    listFeedbacks.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
    expect([...container.querySelectorAll('.el-empty .el-button')].map((b) => b.textContent.trim())).toContain('重试')
  })
})
