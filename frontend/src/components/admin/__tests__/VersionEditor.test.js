// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { h, reactive } from 'vue'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * VersionEditor.vue（版本编辑抽屉）单测。对齐 docs/PRD/数字员工管理端PRD/05治理/版本管理/prd.版本管理.md：
 * - §四 三态：新建「新建版本」/ 编辑「编辑版本」（终端置灰）/ 查看「查看版本」（只读、底部仅【关闭】、展示 SHA-256）；
 * - §4.1 字段（终端 / 版本号 / 版本包 / 更新说明均必填）；§4.2 版本包上传状态机（idle / uploading / done / error）；
 * - §4.3 校验提示与保存（版本号重复就地报错、保存成功提示「版本已保存」）；
 * - §九 上传中关闭需二次确认并中断上传。
 *
 * 真实挂载（真 Element Plus / 真 el-drawer / 真 el-upload），只 mock api 层与确认弹窗。
 * 抽屉 append-to-body，故 DOM 从 document.body 取。
 */

const api = { createVersion: vi.fn(), updateVersion: vi.fn(), uploadVersionPackage: vi.fn() }
vi.mock('@/api/version', () => api)
const confirmDialog = vi.fn()
vi.mock('@/composables/useConfirm', () => ({ confirmDialog: (...a) => confirmDialog(...a) }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }
})

const { ElMessage } = await import('element-plus')
const VersionEditor = (await import('@/components/admin/VersionEditor.vue')).default

const UPLOADED = { packageId: 'pkg_1', fileName: 'iWorker-Setup-1.4.0.exe', fileSize: 4096, sha256: 'b'.repeat(64) }
const DRAFT = {
  id: 4, terminal: 'WINDOWS', version: 'v1.3.0', packageName: 'iWorker-Setup-1.3.0.exe', packageSize: 92274688,
  sha256: 'c'.repeat(64), releaseNotes: '新增记忆管理', status: 'UNPUBLISHED',
  publishedAt: null, publishedBy: null, stoppedAt: null
}
const PUBLISHED = { ...DRAFT, id: 3, version: 'v1.2.0', status: 'PUBLISHED', publishedAt: '2026-08-20T10:30:00+08:00', publishedBy: 'li.na' }

let mounted
let state
let saved
let visibleChanges
const $ = (sel) => document.body.querySelector(sel)
const $$ = (sel) => [...document.body.querySelectorAll(sel)]
const footBtn = (label) => $$('.el-drawer__footer button').find((b) => b.textContent.trim() === label)
const file = (name, size = 4096) => new File([new Uint8Array(size)], name)
const setInput = (el, value) => {
  el.value = value
  el.dispatchEvent(new Event('input'))
}
async function pick(f) {
  const input = $('.ve-drop input[type=file]')
  Object.defineProperty(input, 'files', { value: [f], configurable: true })
  input.dispatchEvent(new Event('change'))
  await flushAll()
}
/**
 * 点【保存】后等校验 / 提交落地：EP 表单校验（async-validator）要跨宏任务，单靠 flushAll 冲微任务不够。
 * 传 cond 则轮询到条件成立（上限 2s）；不传则只多等一拍（用于「不该发生」的反向断言之前，先用 cond 等到校验已出结果）。
 */
async function settle(cond) {
  const t0 = Date.now()
  do {
    await flushAll(2)
    if (cond?.()) return
    await new Promise((r) => setTimeout(r, 10))
  } while (Date.now() - t0 < (cond ? 2000 : 60))
}
const errs = () => $$('.el-drawer .el-form-item__error').map((e) => e.textContent.trim())
async function chooseTerminal(label) {
  $$('.el-drawer .el-radio').find((r) => r.textContent.trim() === label).click()
  await flushAll()
}

/** 用外层状态驱动 visible（reset() 由 watch(visible) 触发，必须模拟真实「从关到开」）。 */
async function open(over = {}) {
  Object.assign(state, { version: null, readonly: false }, over, { visible: true })
  await flushAll(12)
}

beforeEach(() => {
  api.createVersion.mockReset().mockResolvedValue({})
  api.updateVersion.mockReset().mockResolvedValue({})
  api.uploadVersionPackage.mockReset().mockResolvedValue(UPLOADED)
  confirmDialog.mockReset().mockResolvedValue(true)
  for (const k of ['success', 'error', 'warning', 'info']) ElMessage[k].mockReset()
  saved = vi.fn()
  visibleChanges = vi.fn()
  state = reactive({ visible: false, version: null, readonly: false })
  mounted = mountReal({
    setup: () => () =>
      h(VersionEditor, {
        visible: state.visible,
        version: state.version,
        readonly: state.readonly,
        onSaved: saved,
        'onUpdate:visible': (v) => {
          visibleChanges(v)
          state.visible = v
        }
      })
  })
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('VersionEditor · 新建态结构（PRD §四 / §4.1）', () => {
  it('标题「新建版本」；四个必填表单项带星标；底部【取消】【保存】；上传区在未选终端时置灰并提示先选终端', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await open()
    expect($('.el-drawer .de-head-title').textContent).toBe('新建版本')
    const labels = $$('.el-drawer .el-form-item__label').map((l) => l.textContent.trim())
    expect(labels).toEqual(['终端', '版本号', '版本包', '更新说明'])
    expect($$('.el-drawer .el-form-item.is-required')).toHaveLength(4)
    expect($$('.el-drawer__footer button').map((b) => b.textContent.trim())).toEqual(['取消', '保存'])
    expect($('.ve-drop .el-upload').className).toContain('is-disabled')
    expect($('.el-drawer').textContent).toContain('请先选择终端，再上传版本包')
    expect($$('.el-drawer .el-radio').map((r) => r.textContent.trim())).toEqual(['Windows', 'Mac'])
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('选终端后上传区可用，提示当前终端支持的格式与大小上限（Windows：exe/msi/zip；Mac：dmg/pkg/zip）', async () => {
    await open()
    await chooseTerminal('Windows')
    expect($('.el-drawer').textContent).toContain('Windows 支持 .exe / .msi / .zip，单个文件不超过 1 GB')
    expect($('.ve-drop .el-upload').className).not.toContain('is-disabled')
    await chooseTerminal('Mac')
    expect($('.el-drawer').textContent).toContain('Mac 支持 .dmg / .pkg / .zip，单个文件不超过 1 GB')
  })

  it('更新说明：占位、上限 2000 字并显示字数统计', async () => {
    await open()
    const ta = $('.el-drawer textarea')
    expect(ta.placeholder).toBe('简述本次更新了什么，将展示给用户端用户')
    expect(ta.maxLength).toBe(2000)
    expect($('.el-drawer .el-input__count')).toBeTruthy()
  })
})

describe('VersionEditor · 版本包上传状态机（PRD §4.2 / §4.3）', () => {
  it('选择文件时立即校验格式：不合法不开始上传，就地提示原因', async () => {
    await open()
    await chooseTerminal('Windows')
    await pick(file('notes.txt'))
    expect(api.uploadVersionPackage).not.toHaveBeenCalled()
    expect($('.el-drawer .ve-error').textContent).toBe('Windows 版本包仅支持 .exe / .msi / .zip')
  })

  it('空文件、超大文件同样在选择时被拦', async () => {
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe', 0))
    expect($('.el-drawer .ve-error').textContent).toBe('版本包不能为空文件')
    const big = file('b.exe', 1)
    Object.defineProperty(big, 'size', { value: 1024 ** 3 + 1 })
    await pick(big)
    expect($('.el-drawer .ve-error').textContent).toBe('版本包不能超过 1 GB')
    expect(api.uploadVersionPackage).not.toHaveBeenCalled()
  })

  it('上传中：展示文件名 / 大小 / 进度与【取消上传】，【保存】置灰；完成后转「重新上传 / 移除」', async () => {
    let resolveUpload, onProgress
    api.uploadVersionPackage.mockImplementation((_f, opts) => {
      onProgress = opts.onProgress
      return new Promise((r) => (resolveUpload = r))
    })
    await open()
    await chooseTerminal('Windows')
    await pick(file('iWorker-Setup-1.4.0.exe'))
    expect($('.ve-file').className).toContain('is-uploading')
    expect($('.ve-file').textContent).toContain('iWorker-Setup-1.4.0.exe')
    expect($('.ve-file').textContent).toContain('4 KB')
    expect($('.ve-file .el-progress')).toBeTruthy()
    expect($$('.ve-file-ops button').map((b) => b.textContent.trim())).toEqual(['取消上传'])
    expect(footBtn('保存').disabled).toBe(true)

    onProgress(60)
    await flushAll()
    expect($('.ve-file .el-progress__text').textContent).toContain('60%')

    resolveUpload(UPLOADED)
    await flushAll()
    expect($('.ve-file').className).toContain('is-done')
    expect($$('.ve-file-ops button').map((b) => b.textContent.trim())).toEqual(['重新上传', '移除'])
    expect(footBtn('保存').disabled).toBe(false)
  })

  it('上传失败：展示原因与【重试】【移除】，重试重传同一文件；【移除】回到未上传', async () => {
    api.uploadVersionPackage.mockRejectedValueOnce(new Error('网络中断，上传失败'))
    await open()
    await chooseTerminal('Windows')
    await pick(file('will-fail.exe'))
    expect($('.ve-file').className).toContain('is-error')
    expect($('.ve-file .ve-error').textContent).toBe('网络中断，上传失败')
    expect($$('.ve-file-ops button').map((b) => b.textContent.trim())).toEqual(['重试', '移除'])

    $$('.ve-file-ops button')[0].click() // 重试
    await flushAll()
    expect(api.uploadVersionPackage).toHaveBeenCalledTimes(2)
    expect(api.uploadVersionPackage.mock.calls[1][0].name).toBe('will-fail.exe')
    expect($('.ve-file').className).toContain('is-done')

    $$('.ve-file-ops button')[1].click() // 移除
    await flushAll()
    expect($('.ve-file')).toBeNull()
  })

  it('取消上传：中止请求（signal aborted）并回到未上传', async () => {
    let signal
    api.uploadVersionPackage.mockImplementation((_f, opts) => {
      signal = opts.signal
      return new Promise((_r, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))))
    })
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe'))
    $$('.ve-file-ops button')[0].click()
    await flushAll()
    expect(signal.aborted).toBe(true)
    expect($('.ve-file')).toBeNull()
    expect($('.el-drawer .ve-error')).toBeNull()
  })

  it('新建时改选终端：已传的包与新终端格式不符 → 提示并清空；.zip 两端通用不清', async () => {
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe'))
    expect($('.ve-file').className).toContain('is-done')
    await chooseTerminal('Mac')
    expect(ElMessage.warning).toHaveBeenCalledWith('已上传的版本包与所选终端不匹配，需重新上传')
    expect($('.ve-file')).toBeNull()

    ElMessage.warning.mockReset()
    api.uploadVersionPackage.mockResolvedValue({ ...UPLOADED, fileName: 'x.zip' })
    await pick(file('x.zip'))
    await chooseTerminal('Windows')
    expect(ElMessage.warning).not.toHaveBeenCalled()
    expect($('.ve-file').textContent).toContain('x.zip')
  })
})

describe('VersionEditor · 校验与保存（PRD §4.3）', () => {
  it('全空点【保存】：终端 / 版本号 / 更新说明就地报必填，版本包提示「请上传版本包」，不调接口', async () => {
    await open()
    footBtn('保存').click()
    await settle(() => errs().length >= 3)
    expect(errs()).toEqual(expect.arrayContaining(['请选择终端', '请填写版本号', '请填写更新说明']))
    expect($('.ve-pkg .ve-error').textContent).toBe('请上传版本包')
    expect(api.createVersion).not.toHaveBeenCalled()
  })

  it('版本号格式错误：提示「版本号格式应为 X.Y.Z，如 v1.2.0」；带 / 不带前缀 v 都合法', async () => {
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe'))
    setInput($('.el-drawer input[placeholder="如 v1.2.0"]'), '1.2')
    setInput($('.el-drawer textarea'), '说明')
    footBtn('保存').click()
    await settle(() => errs().includes('版本号格式应为 X.Y.Z，如 v1.2.0'))
    expect(errs()).toContain('版本号格式应为 X.Y.Z，如 v1.2.0')
    expect(api.createVersion).not.toHaveBeenCalled()

    setInput($('.el-drawer input[placeholder="如 v1.2.0"]'), '1.2.0')
    footBtn('保存').click()
    await settle(() => api.createVersion.mock.calls.length > 0)
    expect(api.createVersion).toHaveBeenCalledTimes(1)
  })

  it('更新说明只有空白 → 视同未填', async () => {
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe'))
    setInput($('.el-drawer input[placeholder="如 v1.2.0"]'), 'v1.2.0')
    setInput($('.el-drawer textarea'), '   ')
    footBtn('保存').click()
    await settle(() => errs().includes('请填写更新说明'))
    expect(errs()).toContain('请填写更新说明')
    expect(api.createVersion).not.toHaveBeenCalled()
  })

  it('保存成功：createVersion 收到终端 / 版本号 / 更新说明 / 版本包信息，提示「版本已保存」，关闭抽屉并通知父级刷新', async () => {
    await open()
    await chooseTerminal('Windows')
    await pick(file('iWorker-Setup-1.4.0.exe'))
    setInput($('.el-drawer input[placeholder="如 v1.2.0"]'), 'v1.4.0')
    setInput($('.el-drawer textarea'), '1. 新增记忆管理')
    footBtn('保存').click()
    await settle(() => saved.mock.calls.length > 0)
    expect(api.createVersion).toHaveBeenCalledWith({
      terminal: 'WINDOWS',
      version: 'v1.4.0',
      releaseNotes: '1. 新增记忆管理',
      package: { fileName: UPLOADED.fileName, fileSize: UPLOADED.fileSize, sha256: UPLOADED.sha256 }
    })
    expect(ElMessage.success).toHaveBeenCalledWith('版本已保存')
    expect(saved).toHaveBeenCalledTimes(1)
    expect(visibleChanges).toHaveBeenCalledWith(false)
  })

  it('服务端报「版本号重复」：就地挂在版本号字段下，抽屉保持打开、不通知刷新；再输入即消', async () => {
    api.createVersion.mockRejectedValueOnce(Object.assign(new Error('该终端下已存在版本 v1.2.0'), { field: 'version' }))
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe'))
    setInput($('.el-drawer input[placeholder="如 v1.2.0"]'), 'v1.2.0')
    setInput($('.el-drawer textarea'), '说明')
    footBtn('保存').click()
    await settle(() => errs().includes('该终端下已存在版本 v1.2.0'))
    expect(errs()).toContain('该终端下已存在版本 v1.2.0')
    expect(saved).not.toHaveBeenCalled()
    expect($('.el-drawer')).toBeTruthy()

    setInput($('.el-drawer input[placeholder="如 v1.2.0"]'), 'v1.2.1')
    await flushAll()
    expect(errs()).not.toContain('该终端下已存在版本 v1.2.0')
  })

  it('其它保存失败：toast 显示原因（缺省「保存失败，请重试」），抽屉保持打开并保留已填内容', async () => {
    api.createVersion.mockRejectedValueOnce({})
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe'))
    setInput($('.el-drawer input[placeholder="如 v1.2.0"]'), 'v1.2.0')
    setInput($('.el-drawer textarea'), '说明')
    footBtn('保存').click()
    await settle(() => ElMessage.error.mock.calls.length > 0)
    expect(ElMessage.error).toHaveBeenCalledWith('保存失败，请重试')
    expect($('.el-drawer textarea').value).toBe('说明')
    expect(saved).not.toHaveBeenCalled()
  })
})

describe('VersionEditor · 编辑 / 查看（PRD §四）', () => {
  it('编辑：标题「编辑版本」；终端置灰不可改；回填版本号 / 更新说明 / 已有版本包；保存调 updateVersion(id, …)', async () => {
    await open({ version: DRAFT })
    expect($('.el-drawer .de-head-title').textContent).toBe('编辑版本')
    expect($$('.el-drawer .el-radio.is-disabled')).toHaveLength(2)
    expect($('.el-drawer input[placeholder="如 v1.2.0"]').value).toBe('v1.3.0')
    expect($('.el-drawer textarea').value).toBe('新增记忆管理')
    expect($('.ve-file').className).toContain('is-done')
    expect($('.ve-file').textContent).toContain('iWorker-Setup-1.3.0.exe')

    footBtn('保存').click()
    await settle(() => api.updateVersion.mock.calls.length > 0)
    expect(api.updateVersion).toHaveBeenCalledWith(4, expect.objectContaining({ terminal: 'WINDOWS', version: 'v1.3.0' }))
    expect(api.createVersion).not.toHaveBeenCalled()
  })

  it('编辑时【重新上传】取消：还原为原版本包', async () => {
    api.uploadVersionPackage.mockImplementation((_f, opts) =>
      new Promise((_r, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))))
    )
    await open({ version: DRAFT })
    await pick(file('new.exe')) // 编辑态上传区被隐藏，但同一入口可用
    expect($('.ve-file').textContent).toContain('new.exe')
    $$('.ve-file-ops button')[0].click() // 取消上传
    await flushAll()
    expect($('.ve-file').className).toContain('is-done')
    expect($('.ve-file').textContent).toContain('iWorker-Setup-1.3.0.exe')
  })

  it('查看：标题「查看版本」，只读明细（终端 / 状态 / 发布人 / 发布时间 / 版本包 / SHA-256 / 更新说明），无表单，底部仅【关闭】', async () => {
    await open({ version: PUBLISHED, readonly: true })
    expect($('.el-drawer .de-head-title').textContent).toBe('查看版本')
    const t = $('.el-drawer').textContent.replace(/\s+/g, ' ')
    expect(t).toContain('Windows')
    expect(t).toContain('已发布')
    expect(t).toContain('li.na') // 发布人显示登录用户名
    expect(t).toContain('2026-08-20 10:30')
    expect(t).toContain('iWorker-Setup-1.3.0.exe')
    expect(t).toContain('88 MB')
    expect(t).toContain('校验值（SHA-256）')
    expect(t).toContain('c'.repeat(64))
    expect(t).toContain('新增记忆管理')
    expect($('.el-drawer form')).toBeNull()
    expect($$('.el-drawer__footer button').map((b) => b.textContent.trim())).toEqual(['关闭'])
  })
})

describe('VersionEditor · 关闭（PRD §九）', () => {
  it('未在上传：【取消】直接关闭，不弹确认', async () => {
    await open()
    footBtn('取消').click()
    await flushAll()
    expect(confirmDialog).not.toHaveBeenCalled()
    expect(visibleChanges).toHaveBeenCalledWith(false)
  })

  it('上传中点【取消】：二次确认；选「继续」则保持打开并继续上传，选「确认关闭」则中断上传并关闭', async () => {
    let signal
    api.uploadVersionPackage.mockImplementation((_f, opts) => {
      signal = opts.signal
      return new Promise((_r, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))))
    })
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe'))

    confirmDialog.mockResolvedValueOnce(false)
    footBtn('取消').click()
    await flushAll()
    expect(confirmDialog.mock.calls[0][0]).toBe('版本包正在上传，关闭将中断上传，确认关闭？')
    expect(visibleChanges).not.toHaveBeenCalled()
    expect(signal.aborted).toBe(false)

    confirmDialog.mockResolvedValueOnce(true)
    footBtn('取消').click()
    await flushAll()
    expect(signal.aborted).toBe(true)
    expect(visibleChanges).toHaveBeenCalledWith(false)
  })

  it('重新打开：新建态恢复空白（含版本包）；不残留上次填写', async () => {
    await open()
    await chooseTerminal('Windows')
    await pick(file('a.exe'))
    setInput($('.el-drawer input[placeholder="如 v1.2.0"]'), 'v9.9.9')
    state.visible = false
    await flushAll()
    await open()
    expect($('.el-drawer input[placeholder="如 v1.2.0"]').value).toBe('')
    expect($('.ve-file')).toBeNull()
    expect($$('.el-drawer .el-radio.is-checked')).toHaveLength(0)
  })
})
