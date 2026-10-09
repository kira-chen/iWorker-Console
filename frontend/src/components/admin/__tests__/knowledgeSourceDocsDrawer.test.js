// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * KnowledgeSourceDocsDrawer.vue（上传类数据源的文档管理抽屉）——2026-10-08 测试审计补缺口（此前零用例）。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md §五.2 / §五.3：
 * - §五.2 各文档类型支持格式（FAQ：XLSX、CSV）；单文件最大 50MB；格式或大小不符在上传前拦截并说明支持范围；
 * - §五.3 存在解析中任务时每 3 秒自动刷新，全部结束后停止轮询；删除文档前二次确认；
 *   列表展示失败原因；顶部汇总文档总数和解析成功数。
 *
 * 真挂载 Element Plus（el-upload 真走 beforeUpload → httpRequest 链路），只 mock api 层。
 * 抽屉的取数挂在 visible 由假变真的跃迁上（watch 非 immediate），故先以 visible=false 挂载再打开。
 */

const api = {
  listKnowledgeDocs: vi.fn(),
  uploadKnowledgeDoc: vi.fn(),
  deleteKnowledgeDoc: vi.fn()
}
vi.mock('@/api/knowledgeBase', () => api)

const Drawer = (await import('@/components/admin/KnowledgeSourceDocsDrawer.vue')).default

const doc = (id, parseStatus, over = {}) => ({
  id,
  fileName: `${id}.pdf`,
  size: 2 * 1024 * 1024,
  chunkCount: parseStatus === 'PARSED' ? 40 : 0,
  parseStatus,
  errorReason: null,
  ...over
})

let mounted
afterEach(() => {
  vi.useRealTimers()
  ElMessage.closeAll()
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** 以 visible=false 挂载后打开；props 为 reactive，可在用例里改 visible 模拟关抽屉。 */
async function open({ docKind = 'DOC', docs = [] } = {}) {
  api.listKnowledgeDocs.mockResolvedValue(docs)
  const props = reactive({
    visible: false,
    source: { id: 'ks_t', name: '测试文档源', config: { docKind } },
    onChanged: vi.fn(),
    'onUpdate:visible': (v) => (props.visible = v)
  })
  mounted = mountReal(Drawer, props)
  await flushAll(4)
  props.visible = true
  await flushAll(10)
  return props
}
const drawer = () => document.querySelector('.el-drawer')
const pickFile = async (file) => {
  const input = drawer().querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flushAll(10)
}
const mkFile = (name, size) => {
  const f = new File(['x'], name)
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const rowOf = (fileName) => [...drawer().querySelectorAll('.el-table__body tr')].find((tr) => tr.textContent.includes(fileName))
const clickDelete = async (fileName) => {
  ;[...rowOf(fileName).querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '删除').click()
  await flushAll(10)
}

describe('KnowledgeSourceDocsDrawer · 上传前拦截（md §五.2）', () => {
  it('FAQ 类型选 .pdf → toast「不支持的格式：「FAQ」类型仅接受 .xlsx / .csv」，不调上传接口', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    await open({ docKind: 'FAQ' })
    await pickFile(mkFile('问答.pdf', 1024))
    expect(err).toHaveBeenCalledWith('不支持的格式：「FAQ」类型仅接受 .xlsx / .csv')
    expect(api.uploadKnowledgeDoc).not.toHaveBeenCalled()
  })

  it('文件恰好 50MB + 1 字节 → toast「文件过大：单个不超过 50 MB」，不调上传接口', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    await open({ docKind: 'DOC' })
    await pickFile(mkFile('大文件.pdf', 50 * 1024 * 1024 + 1))
    expect(err).toHaveBeenCalledWith('文件过大：单个不超过 50 MB')
    expect(api.uploadKnowledgeDoc).not.toHaveBeenCalled()
  })

  it('格式与大小都合规（FAQ 选 .xlsx、正好 50MB）→ 调上传接口、toast「已上传…正在解析」、通知外层刷新', async () => {
    const ok = vi.spyOn(ElMessage, 'success')
    const props = await open({ docKind: 'FAQ' })
    api.uploadKnowledgeDoc.mockResolvedValue({})
    await pickFile(mkFile('问答.xlsx', 50 * 1024 * 1024))
    expect(api.uploadKnowledgeDoc).toHaveBeenCalledTimes(1)
    expect(api.uploadKnowledgeDoc.mock.calls[0][0]).toBe('ks_t')
    expect(ok).toHaveBeenCalledWith('已上传「问答.xlsx」，正在解析')
    expect(props.onChanged).toHaveBeenCalled()
  })
})

describe('KnowledgeSourceDocsDrawer · 解析中轮询（md §五.3 每 3 秒刷新，全部结束停止）', () => {
  it('有「解析中」文档 → 3 秒后再取一次清单', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await open({ docs: [doc('d1', 'PARSING')] })
    expect(api.listKnowledgeDocs).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2999)
    expect(api.listKnowledgeDocs).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.listKnowledgeDocs).toHaveBeenCalledTimes(2)
  })

  it('刷新后全部「解析成功」→ 停止轮询，再过 10 秒也不再取数', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await open({ docs: [doc('d1', 'PARSING')] })
    api.listKnowledgeDocs.mockResolvedValue([doc('d1', 'PARSED')])
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.listKnowledgeDocs).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(api.listKnowledgeDocs).toHaveBeenCalledTimes(2)
  })

  it('仍有「解析中」时关闭抽屉 → 不再取数', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const props = await open({ docs: [doc('d1', 'PARSING')] })
    props.visible = false
    await flushAll(6)
    await vi.advanceTimersByTimeAsync(10000)
    expect(api.listKnowledgeDocs).toHaveBeenCalledTimes(1)
  })

  // yuepu#62⑦：刷新请求在途时关抽屉，stopPolling 先清了定时器，在途请求回来后 refresh()
  // 又调 schedulePoll()，3 秒轮询被重新挂上，抽屉关着也在取数。前提（3 秒后发起第二次取数）见上一条。
  it('yuepu#62⑦ 刷新请求在途时关闭抽屉 → 请求回来后不再重挂轮询（md §五.3 全部结束或离开即停止）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const props = await open({ docs: [doc('d1', 'PARSING')] })
    let resolveInflight
    api.listKnowledgeDocs.mockImplementationOnce(() => new Promise((r) => (resolveInflight = r)))
    await vi.advanceTimersByTimeAsync(3000) // 第二次取数发出、挂起
    props.visible = false
    await flushAll(6)
    resolveInflight([doc('d1', 'PARSING')])
    await flushAll(6)
    await vi.advanceTimersByTimeAsync(10000)
    expect(api.listKnowledgeDocs).toHaveBeenCalledTimes(2)
  })
})

describe('KnowledgeSourceDocsDrawer · 删除二次确认（md §五.3）', () => {
  it('点【删除】后在确认框里取消 → 不调删除接口', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    await open({ docs: [doc('d1', 'PARSED')] })
    await clickDelete('d1.pdf')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toBe('删除文档「d1.pdf」及其全部切片？')
    expect(api.deleteKnowledgeDoc).not.toHaveBeenCalled()
  })

  it('确认删除 → 调删除接口（源 id + 文档 id）、toast「文档已删除」、通知外层刷新', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const ok = vi.spyOn(ElMessage, 'success')
    api.deleteKnowledgeDoc.mockResolvedValue(null)
    const props = await open({ docs: [doc('d1', 'PARSED')] })
    await clickDelete('d1.pdf')
    expect(api.deleteKnowledgeDoc).toHaveBeenCalledWith('ks_t', 'd1')
    expect(ok).toHaveBeenCalledWith('文档已删除')
    expect(props.onChanged).toHaveBeenCalledTimes(1)
  })
})

describe('KnowledgeSourceDocsDrawer · 顶部汇总与失败原因（md §五.3）', () => {
  it('3 篇里 1 篇解析成功 → 顶部「共 3 篇 · 解析成功 1 篇」', async () => {
    await open({ docs: [doc('d1', 'PARSED'), doc('d2', 'FAILED', { errorReason: '文件已损坏' }), doc('d3', 'PENDING')] })
    expect(drawer().textContent).toContain('共 3 篇 · 解析成功 1 篇')
  })

  it('解析失败的行 → 状态格显示「解析失败」并带出失败原因', async () => {
    await open({ docs: [doc('d1', 'PARSED'), doc('d2', 'FAILED', { errorReason: '文件已损坏，无法读取' })] })
    const text = rowOf('d2.pdf').textContent
    expect(text).toContain('解析失败')
    expect(text).toContain('文件已损坏，无法读取')
    expect(rowOf('d1.pdf').textContent).not.toContain('文件已损坏')
  })
})
