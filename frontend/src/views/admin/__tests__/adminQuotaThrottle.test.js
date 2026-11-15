// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElMessage } from 'element-plus'
import { mountReal, flushAll } from './helpers/smokeMount'

/**
 * AdminQuotaThrottle.vue 页面级用例（2026-11-15 首版）。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/配额与限流/prd.配额与限流.md §二 页面结构、§三 IM 消息处理（字段 / 校验 / 保存 / 页面状态）。
 * 真实挂载，只 mock api 层；取值范围与审计规则见 api/__tests__/quotaThrottleMock.test.js。
 */
const api = {
  getQuotaThrottleSettings: vi.fn(),
  saveMergeWait: vi.fn()
}
vi.mock('@/api/quotaThrottle', () => api)

const AdminQuotaThrottle = (await import('@/views/admin/AdminQuotaThrottle.vue')).default

let mounted, successSpy, errorToastSpy, consoleErrorSpy
beforeEach(() => {
  vi.clearAllMocks()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  api.getQuotaThrottleSettings.mockResolvedValue({ mergeWaitSec: 5 })
  api.saveMergeWait.mockImplementation(async (v) => ({ mergeWaitSec: v }))
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close() {} }))
  errorToastSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close() {} }))
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  expect(consoleErrorSpy).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

async function mountPage() {
  mounted = mountReal(AdminQuotaThrottle)
  await flushAll(8)
  return mounted.container
}
const input = (root) => root.querySelector('input[data-testid="merge-wait-input"]')
const saveBtn = (root) => root.querySelector('[data-testid="merge-wait-save"]')
const errorText = (root) => root.querySelector('[data-testid="merge-wait-error"]')?.textContent.trim()
async function type(root, value) {
  input(root).value = value
  input(root).dispatchEvent(new Event('input'))
  await flushAll(2)
}
async function clickSave(root) {
  saveBtn(root).click()
  await flushAll(6)
}

describe('配额与限流 · 页面结构（§二、§三.1）', () => {
  it('标题、说明、「IM 消息处理」卡片与字段名、说明文案', async () => {
    const root = await mountPage()
    const text = root.textContent
    expect(text).toContain('配额与限流')
    expect(text).toContain('平台统一的运行参数，保存后对全部员工生效')
    expect(text).toContain('IM 消息处理')
    expect(text).toContain('消息合并等待时长')
    expect(text).toContain('员工在 IM 里连着发的几条消息，从最后一条算起等这么久，期间发来的合成一件事处理。时长越长，员工收到「收到」越晚。')
  })

  it('输入框展示当前已保存的值，后缀「秒」', async () => {
    api.getQuotaThrottleSettings.mockResolvedValue({ mergeWaitSec: 12 })
    const root = await mountPage()
    expect(input(root).value).toBe('12')
    expect(root.querySelector('.qt-input .el-input__suffix').textContent.trim()).toBe('秒')
  })
})

describe('配额与限流 · 保存（§三.2）', () => {
  it('值没改时【保存】置灰；改成同值的「05」仍置灰；改成别的值可点', async () => {
    const root = await mountPage()
    expect(saveBtn(root).disabled).toBe(true)
    await type(root, '05')
    expect(saveBtn(root).disabled).toBe(true)
    await type(root, '8')
    expect(saveBtn(root).disabled).toBe(false)
  })

  it('保存合法值：提交数字、提示「已保存，对全部员工的 IM 机器人生效」，保存后按钮重新置灰', async () => {
    const root = await mountPage()
    await type(root, '8')
    await clickSave(root)
    expect(api.saveMergeWait).toHaveBeenCalledWith(8)
    expect(successSpy).toHaveBeenCalledWith('已保存，对全部员工的 IM 机器人生效')
    expect(saveBtn(root).disabled).toBe(true)
  })

  it.each([
    ['', '请填写消息合并等待时长'],
    ['0', '请填写 1–30 之间的整数'],
    ['31', '请填写 1–30 之间的整数'],
    ['2.5', '请填写 1–30 之间的整数'],
    ['abc', '请填写 1–30 之间的整数']
  ])('输入 %j 点保存：输入框下方提示「%s」，不提交、不自动改写输入', async (value, message) => {
    const root = await mountPage()
    await type(root, value)
    await clickSave(root)
    expect(errorText(root)).toBe(message)
    expect(api.saveMergeWait).not.toHaveBeenCalled()
    expect(input(root).value).toBe(value)
  })

  it('再次输入时收起旧的错误提示', async () => {
    const root = await mountPage()
    await type(root, '99')
    await clickSave(root)
    expect(errorText(root)).toBeTruthy()
    await type(root, '9')
    expect(errorText(root)).toBeUndefined()
  })

  it('保存失败（非校验错误）：toast 提示原因，输入值保留可再保存', async () => {
    api.saveMergeWait.mockRejectedValueOnce(new Error('网络异常'))
    const root = await mountPage()
    await type(root, '8')
    await clickSave(root)
    expect(errorToastSpy).toHaveBeenCalledWith('网络异常')
    expect(input(root).value).toBe('8')
    expect(saveBtn(root).disabled).toBe(false)
  })
})

describe('配额与限流 · 页面状态（§三.4）', () => {
  it('读取失败：展示「配置读取失败」与原因、【重试】，不出输入框；重试成功后出现输入框', async () => {
    api.getQuotaThrottleSettings.mockRejectedValueOnce(new Error('服务不可用'))
    const root = await mountPage()
    expect(root.textContent).toContain('配置读取失败')
    expect(root.textContent).toContain('服务不可用')
    expect(input(root)).toBeNull()
    ;[...root.querySelectorAll('button')].find((b) => b.textContent.trim() === '重试').click()
    await flushAll(8)
    expect(input(root).value).toBe('5')
  })
})
