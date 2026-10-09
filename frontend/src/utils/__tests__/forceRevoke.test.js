import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * utils/forceRevoke.js 单测（2026-10-09 /test-audit 补缺口，E 视角：新增共享函数此前零直接测试）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/ 下各模块「强制回收」小节（技能 / 专家 §3.5.1、MCP §3.6.1、API、业务系统）：
 * - 回收弹窗：标题「强制回收{类型}」，展示影响范围，红色警示，回收原因必填 ≤500 字，按钮【取消】【确认强制回收】；
 * - 二次确认：「将立即强制回收「X」，确认继续？」，按钮【再想想】【立即回收】；两步都过才返回原因，任一步取消返回 null；
 * - 回收信息（落到对象 revoked 字段）与「已回收」悬停文案。
 *
 * ElMessageBox 整体桩掉（jsdom 里不弹真窗），断言落在「传给弹窗的文案 / 校验函数」和「askForceRevoke 的返回值」。
 */
const prompt = vi.fn()
const confirm = vi.fn()
vi.mock('element-plus', () => ({ ElMessageBox: { prompt: (...a) => prompt(...a), confirm: (...a) => confirm(...a) } }))

const { askForceRevoke, makeRevokedInfo, revokedTip, FORCE_REVOKE_REASON_MAX } = await import('@/utils/forceRevoke')
const { currentDemoUsername } = await import('@/utils/demoIdentity')

/** 把弹窗正文（h() 渲染函数返回的 vnode 树）拍平成纯文本，便于断言用户可见文案。 */
function flatText(vnode) {
  if (vnode == null || typeof vnode === 'boolean') return ''
  if (typeof vnode === 'string' || typeof vnode === 'number') return String(vnode)
  if (Array.isArray(vnode)) return vnode.map(flatText).join('')
  return flatText(vnode.children)
}
/** 取第一次 prompt 调用的 [正文文本, 标题, 选项]。 */
function promptArgs() {
  const [msgFn, title, opts] = prompt.mock.calls[0]
  return { text: flatText(msgFn()), title, opts }
}

beforeEach(() => {
  prompt.mockReset().mockResolvedValue({ value: '  存在安全风险  ' })
  confirm.mockReset().mockResolvedValue('confirm')
})

describe('askForceRevoke · 回收弹窗（第一步）', () => {
  it('标题为「强制回收{类型}」，按钮为【取消】【确认强制回收】，输入框占位提示将展示给受影响的员工', async () => {
    await askForceRevoke({ typeLabel: 'MCP 服务', name: '报销 MCP' })
    const { title, opts } = promptArgs()
    expect(title).toBe('强制回收MCP 服务')
    expect(opts).toMatchObject({
      confirmButtonText: '确认强制回收',
      cancelButtonText: '取消',
      inputPlaceholder: '请输入回收原因，将展示给受影响的员工',
      inputType: 'textarea'
    })
  })

  it('正文：写明对象名与「立即生效且不可撤销」红色警示，并提示正常退役走【停用】', async () => {
    await askForceRevoke({ typeLabel: '技能', name: '财税合规助手' })
    const { text } = promptArgs()
    expect(text).toContain('「财税合规助手」')
    expect(text).toContain('强制回收立即生效且不可撤销')
    expect(text).toContain('引用它的自动化将被挂起')
    expect(text).toContain('正常退役请使用【停用】')
  })

  it('被引用时展示影响范围「已被 N 个{引用方}引用」；无引用不出这句', async () => {
    await askForceRevoke({ typeLabel: '技能', name: 'A', refCount: 3, refText: '岗位 / 专家' })
    expect(promptArgs().text).toContain('已被 3 个岗位 / 专家引用')
    prompt.mockClear()
    await askForceRevoke({ typeLabel: '技能', name: 'A', refCount: 0 })
    expect(promptArgs().text).not.toContain('引用（引用关系保留')
  })

  it('原因校验：空 / 纯空白提示「请输入回收原因」，501 字提示「最多 500 字」，500 字与正常文本通过', async () => {
    await askForceRevoke({ typeLabel: '专家', name: 'A' })
    const check = promptArgs().opts.inputValidator
    expect(FORCE_REVOKE_REASON_MAX).toBe(500)
    expect(check('')).toBe('请输入回收原因')
    expect(check('   ')).toBe('请输入回收原因')
    expect(check(undefined)).toBe('请输入回收原因')
    expect(check('x'.repeat(501))).toBe('回收原因最多 500 字')
    expect(check('x'.repeat(500))).toBe(true)
    expect(check('安全风险')).toBe(true)
  })
})

describe('askForceRevoke · 二次确认（第二步）与返回值', () => {
  it('两步都确认 → 返回去掉首尾空白的原因；二次确认文案与按钮为「再想想 / 立即回收」', async () => {
    const reason = await askForceRevoke({ typeLabel: 'API', name: '报表导出接口' })
    expect(reason).toBe('存在安全风险')
    const [msg, title, opts] = confirm.mock.calls[0]
    expect(msg).toBe('将立即强制回收「报表导出接口」，确认继续？')
    expect(title).toBe('二次确认')
    expect(opts).toMatchObject({ type: 'warning', confirmButtonText: '立即回收', cancelButtonText: '再想想' })
  })

  it('第一步点【取消】→ 返回 null，不弹二次确认', async () => {
    prompt.mockRejectedValue('cancel')
    expect(await askForceRevoke({ typeLabel: '技能', name: 'A' })).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('二次确认点【再想想】→ 返回 null（回收不执行）', async () => {
    confirm.mockRejectedValue('cancel')
    expect(await askForceRevoke({ typeLabel: '技能', name: 'A' })).toBeNull()
  })
})

describe('makeRevokedInfo / revokedTip', () => {
  it('回收信息 = 原因 + 当前时间（精确到分钟）+ 当前演示用户名', () => {
    const info = makeRevokedInfo('接口下线')
    expect(info).toEqual({ reason: '接口下线', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/), operator: currentDemoUsername() })
  })

  it('悬停文案：「回收原因：{原因}（{操作人} · {时间}）」；操作人缺失兜底「管理员」；无回收信息返回空串', () => {
    expect(revokedTip({ reason: '异常', at: '2026-10-09 10:00', operator: 'xiaomei' })).toBe('回收原因：异常（xiaomei · 2026-10-09 10:00）')
    expect(revokedTip({ reason: '异常', at: '2026-10-09 10:00' })).toBe('回收原因：异常（管理员 · 2026-10-09 10:00）')
    expect(revokedTip(null)).toBe('')
  })
})
