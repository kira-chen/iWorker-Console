// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { mountReal, flushAll } from '../../../views/admin/__tests__/helpers/smokeMount'

/**
 * 渠道 · 机器人页签【消息设置】弹窗用例（2026-11-16，由已删除的 adminQuotaThrottle.test.js 迁来，规则不变）。
 * 对齐 docs/PRD/数字员工管理端PRD/04运行/渠道/prd.渠道.md 第三章 6「消息设置」。
 * 真实挂载，只 mock api 层；取值范围与访问审计见 api/__tests__/channelMock.test.js。
 */
const api = { getMessageSettings: vi.fn(), saveMessageSettings: vi.fn() }
vi.mock('@/api/channel', () => api)

const Dialog = (await import('@/components/admin/channel/ChannelMessageSettingsDialog.vue')).default

let mounted, visible, successSpy, errorToastSpy, consoleErrorSpy
beforeEach(() => {
  vi.clearAllMocks()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  api.getMessageSettings.mockResolvedValue({ mergeWaitSec: 5 })
  api.saveMessageSettings.mockImplementation(async (v) => ({ mergeWaitSec: v }))
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

async function openDialog() {
  visible = ref(false)
  const Host = defineComponent({
    setup: () => () => h(Dialog, { modelValue: visible.value, 'onUpdate:modelValue': (v) => (visible.value = v) })
  })
  mounted = mountReal(Host)
  await flushAll(2)
  visible.value = true
  await flushAll(8)
}
const dlg = () => document.body.querySelector('.ms-dialog')
const input = () => dlg().querySelector('input[data-testid="merge-wait-input"]')
const saveBtn = () => dlg().querySelector('[data-testid="merge-wait-save"]')
const errorText = () => dlg().querySelector('[data-testid="merge-wait-error"]')?.textContent.trim()
async function type(value) {
  input().value = value
  input().dispatchEvent(new Event('input'))
  await flushAll(2)
}
async function clickSave() {
  saveBtn().click()
  await flushAll(6)
}

describe('消息设置 · 弹窗结构（第三章 6）', () => {
  it('标题「消息设置」，字段「消息合并等待时长」与说明文案', async () => {
    await openDialog()
    expect(dlg().querySelector('.el-dialog__title').textContent).toBe('消息设置')
    expect(dlg().textContent).toContain('消息合并等待时长')
    expect(dlg().textContent).toContain('员工在 IM 里连着发的几条消息，从最后一条算起等这么久，期间发来的合成一件事处理。时长越长，员工收到「收到」越晚。')
  })

  it('输入框展示当前已保存的值，后缀「秒」', async () => {
    api.getMessageSettings.mockResolvedValue({ mergeWaitSec: 12 })
    await openDialog()
    expect(input().value).toBe('12')
    expect(dlg().querySelector('.ms-input .el-input__suffix').textContent.trim()).toBe('秒')
  })

  it('底部【取消】【保存】', async () => {
    await openDialog()
    expect([...dlg().querySelectorAll('.el-dialog__footer button')].map((b) => b.textContent.trim())).toEqual(['取消', '保存'])
  })
})

describe('消息设置 · 保存（第三章 6）', () => {
  it('值与已保存相同时【保存】置灰；改成同值的「05」仍置灰；改成别的值可点', async () => {
    await openDialog()
    expect(saveBtn().disabled).toBe(true)
    await type('05')
    expect(saveBtn().disabled).toBe(true)
    await type('8')
    expect(saveBtn().disabled).toBe(false)
  })

  it('保存合法值：提交数字、提示「已保存，对全部 IM 机器人生效」并关闭弹窗', async () => {
    await openDialog()
    await type('8')
    await clickSave()
    expect(api.saveMessageSettings).toHaveBeenCalledWith(8)
    expect(successSpy).toHaveBeenCalledWith('已保存，对全部 IM 机器人生效')
    expect(visible.value).toBe(false)
  })

  it.each([
    ['', '请填写消息合并等待时长'],
    ['0', '请填写 1–30 之间的整数'],
    ['31', '请填写 1–30 之间的整数'],
    ['2.5', '请填写 1–30 之间的整数'],
    ['abc', '请填写 1–30 之间的整数']
  ])('输入 %j 点保存：输入框下方提示「%s」，不提交、不自动改写输入', async (value, message) => {
    await openDialog()
    await type(value)
    await clickSave()
    expect(errorText()).toBe(message)
    expect(api.saveMessageSettings).not.toHaveBeenCalled()
    expect(input().value).toBe(value)
  })

  it('再次输入时收起旧的错误提示', async () => {
    await openDialog()
    await type('99')
    await clickSave()
    expect(errorText()).toBeTruthy()
    await type('9')
    expect(errorText()).toBeUndefined()
  })

  it('保存失败：提示原因，弹窗不关、保留填写的值', async () => {
    api.saveMessageSettings.mockRejectedValueOnce(new Error('网络异常'))
    await openDialog()
    await type('8')
    await clickSave()
    expect(errorToastSpy).toHaveBeenCalledWith('网络异常')
    expect(visible.value).toBe(true)
    expect(input().value).toBe('8')
  })
})

describe('消息设置 · 读取失败（第三章 6）', () => {
  it('读取失败：展示「配置读取失败」与【重试】，不展示输入框；重试成功后出现输入框', async () => {
    api.getMessageSettings.mockRejectedValueOnce(new Error('服务不可用'))
    await openDialog()
    expect(dlg().textContent).toContain('配置读取失败')
    expect(input()).toBeNull()
    ;[...dlg().querySelectorAll('button')].find((b) => b.textContent.trim() === '重试').click()
    await flushAll(8)
    expect(input().value).toBe('5')
  })

  it('读取失败时【保存】不可点', async () => {
    api.getMessageSettings.mockRejectedValueOnce(new Error('服务不可用'))
    await openDialog()
    expect(saveBtn().disabled).toBe(true)
  })
})
