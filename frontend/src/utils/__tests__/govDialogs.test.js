// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { h, render } from 'vue'

/**
 * utils/govDialogs.js 单测（2026-09-12 测试审计 T40，治理组落地；共享组不写）。
 *
 * 对齐 md：
 * - `prd.审核中心.md` §5.2 L77「点击【通过】打开“确认通过审核”弹窗」；L79-80 发布 / 停用两种后果；
 * - `prd.我的申请.md` §4.1 L51「撤回前二次确认」；§4.3 L66「提交后弹出“提交成功”提示窗，
 *   说明“「对象名」已提交审核，进入待审核状态。”」。
 * 三个函数只负责「问用户 / 告诉用户」，请求成败由调用方处理——这里断弹窗标题、按钮、正文，
 * 以及 resolve/reject 如何映射成返回值（确认 → true、取消 → false、alert 关闭不抛）。
 */

const confirm = vi.fn()
const alert = vi.fn()
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: (...a) => confirm(...a), alert: (...a) => alert(...a) } }))

const { confirmApproveReview, confirmWithdrawMyApp, alertResubmitSuccess } = await import('@/utils/govDialogs')

/** ElMessageBox 的 message 可以是渲染函数（返回 VNode）——挂到 jsdom 取纯文本，好逐字断言。 */
function textOf(message) {
  if (typeof message === 'string') return message
  const el = document.createElement('div')
  render(h({ render: () => message() }), el)
  const text = el.textContent
  render(null, el)
  return text
}

beforeEach(() => {
  confirm.mockReset().mockResolvedValue('confirm')
  alert.mockReset().mockResolvedValue('confirm')
})

describe('confirmApproveReview（md 审核中心 §5.2）', () => {
  const publishRow = { name: '经营数据分析', requestAction: 'VERSION_PUBLISH' }
  const delistRow = { name: '人力资源系统', requestAction: 'DELIST' }

  it('发布类申请 → 标题「确认通过审核」/ 确认键「确认通过」/ 取消键「取消」；正文带对象名与「新版本发布」，提示行说「发布」', async () => {
    const ok = await confirmApproveReview(publishRow)
    expect(ok).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    const [message, title, options] = confirm.mock.calls[0]
    expect(title).toBe('确认通过审核')
    expect(options).toEqual({ confirmButtonText: '确认通过', cancelButtonText: '取消' })
    const text = textOf(message)
    expect(text).toContain('确认通过 经营数据分析 的新版本发布申请？')
    expect(text).toContain('通过后将立即发布并更新审核状态。')
    expect(text).not.toContain('停用')
  })

  it('停用申请 → 正文写「停用申请」、提示行说「停用」（md §5.2 L80 停用后不再对外提供）', async () => {
    await confirmApproveReview(delistRow)
    const text = textOf(confirm.mock.calls[0][0])
    expect(text).toContain('确认通过 人力资源系统 的停用申请？')
    expect(text).toContain('通过后将立即停用并更新审核状态。')
    expect(text).not.toContain('发布')
  })

  it('用户点取消（ElMessageBox reject）→ 返回 false，不抛错', async () => {
    confirm.mockRejectedValueOnce('cancel')
    await expect(confirmApproveReview(publishRow)).resolves.toBe(false)
  })
})

describe('confirmWithdrawMyApp（md 我的申请 §4.1 L51 撤回前二次确认）', () => {
  it('正文「确认撤回「X」的申请？撤回后可以修改并重新提交。」/ 标题「撤回申请」/ 确认键「确认撤回」；确认 → true', async () => {
    await expect(confirmWithdrawMyApp('客户资料查询')).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith(
      '确认撤回「客户资料查询」的申请？撤回后可以修改并重新提交。',
      '撤回申请',
      { confirmButtonText: '确认撤回', cancelButtonText: '取消' }
    )
  })

  it('取消 → false', async () => {
    confirm.mockRejectedValueOnce('cancel')
    await expect(confirmWithdrawMyApp('客户资料查询')).resolves.toBe(false)
  })
})

describe('alertResubmitSuccess（md 我的申请 §4.3 L66「提交成功」提示窗）', () => {
  it('正文「「X」已提交审核，进入待审核状态。」/ 标题「提交成功」/ 底部键「关闭」', async () => {
    await alertResubmitSuccess('经营分析岗')
    expect(alert).toHaveBeenCalledWith('「经营分析岗」已提交审核，进入待审核状态。', '提交成功', {
      confirmButtonText: '关闭'
    })
  })

  it('用户按 Esc / 点遮罩关闭（alert reject）→ 被吞掉不外抛，调用方 await 不会进 catch', async () => {
    alert.mockRejectedValueOnce('close')
    await expect(alertResubmitSuccess('经营分析岗')).resolves.toBeUndefined()
  })
})
