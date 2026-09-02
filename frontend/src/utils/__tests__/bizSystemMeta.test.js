import { describe, it, expect } from 'vitest'
import {
  connTypeLabel,
  credStateLabel,
  credStateTagType,
  credActionLabel,
  isHosted,
  CRED_STATE
} from '@/utils/bizSystemMeta'
import { validateBizSystemForm, BIZ_CONN_TYPES } from '@/utils/defValidate'

describe('connTypeLabel', () => {
  it('已知映射', () => {
    expect(connTypeLabel('login_session')).toBe('登录态托管')
  })
  it('未知 / 空 回退', () => {
    expect(connTypeLabel('foo')).toBe('foo')
    expect(connTypeLabel('')).toBe('登录态托管')
    expect(connTypeLabel(null)).toBe('登录态托管')
  })
})

describe('登录态三态文案 / 颜色 / 操作', () => {
  it('文案', () => {
    expect(credStateLabel('VALID')).toBe('已连接')
    expect(credStateLabel('EXPIRED')).toBe('已过期，请重新登录')
    expect(credStateLabel('NOT_HOSTED')).toBe('未连接')
    expect(credStateLabel('什么鬼')).toBe('未连接')
  })
  it('标签色', () => {
    expect(credStateTagType('VALID')).toBe('success')
    expect(credStateTagType('EXPIRED')).toBe('warning')
    expect(credStateTagType('NOT_HOSTED')).toBe('info')
  })
  it('主操作文案', () => {
    expect(credActionLabel('NOT_HOSTED')).toBe('连接')
    expect(credActionLabel('EXPIRED')).toBe('重新登录')
    expect(credActionLabel('VALID')).toBe('重新登录')
  })
  it('isHosted：仅 VALID/EXPIRED', () => {
    expect(isHosted('VALID')).toBe(true)
    expect(isHosted('EXPIRED')).toBe(true)
    expect(isHosted('NOT_HOSTED')).toBe(false)
  })
  it('状态常量稳定', () => {
    expect(CRED_STATE).toEqual({ NOT_HOSTED: 'NOT_HOSTED', VALID: 'VALID', EXPIRED: 'EXPIRED' })
  })
})

// 2026-09-01 PRD 对齐改造取代旧口径：名称 ≤64、图标必填、描述必填 ≤2000、
// 登录地址必填、示例问题固定 3 条均必填（每条 ≤60）。
describe('validateBizSystemForm（2026-09-01 PRD 对齐口径）', () => {
  const valid = {
    name: '客户管理系统 CRM', // ≤64
    icon: '◎',
    description: '销售办事主系统，记录与查询客户',
    loginUrl: 'https://crm.example.com/login',
    connType: 'login_session',
    bizPages: [{ url: 'https://crm.example.com/workspace', name: '工作台', description: '日常入口' }],
    exampleQuestions: ['帮我发起一个明天下午的请假审批', '帮我打开客户管理工作台', '帮我查询一份员工档案']
  }

  it('连接方式常量', () => {
    expect(BIZ_CONN_TYPES.map((c) => c.value)).toEqual(['login_session'])
  })

  it('合法表单通过', () => {
    expect(validateBizSystemForm(valid).ok).toBe(true)
  })

  it('不再校验 code（已移除，后端自动生成）', () => {
    // 即便误带 code，也不应产生 code 错误
    const r = validateBizSystemForm({ ...valid, code: '' })
    expect(r.ok).toBe(true)
    expect(r.errors.code).toBeUndefined()
  })

  it('系统名必填 + ≤64（原 ≤20，2026-09-01 对齐连接器名称口径）', () => {
    expect(validateBizSystemForm({ ...valid, name: '' }).errors.name).toBeTruthy()
    expect(validateBizSystemForm({ ...valid, name: 'x'.repeat(65) }).errors.name).toBeTruthy()
    expect(validateBizSystemForm({ ...valid, name: 'x'.repeat(64) }).errors.name).toBeUndefined()
  })

  it('图标必填（BQ5）', () => {
    expect(validateBizSystemForm({ ...valid, icon: '' }).errors.icon).toBeTruthy()
  })

  it('系统描述必填 + ≤2000（BQ3：原选填 ≤100）', () => {
    expect(validateBizSystemForm({ ...valid, description: '' }).errors.description).toBeTruthy()
    expect(validateBizSystemForm({ ...valid, description: 'd'.repeat(2000) }).errors.description).toBeUndefined()
    expect(validateBizSystemForm({ ...valid, description: 'd'.repeat(2001) }).errors.description).toBeTruthy()
  })

  it('登录地址必填 + http(s)://（原选填）', () => {
    expect(validateBizSystemForm({ ...valid, loginUrl: '' }).errors.loginUrl).toBeTruthy()
    expect(validateBizSystemForm({ ...valid, loginUrl: 'ftp://x' }).errors.loginUrl).toBeTruthy()
    expect(validateBizSystemForm({ ...valid, loginUrl: 'https://ok.example.com' }).errors.loginUrl).toBeUndefined()
  })

  it('示例问题固定 3 条均必填、每条 ≤60（BQ4）', () => {
    expect(validateBizSystemForm({ ...valid, exampleQuestions: ['a', '', 'c'] }).errors.exampleQuestions).toBeTruthy()
    expect(validateBizSystemForm({ ...valid, exampleQuestions: undefined }).errors.exampleQuestions).toBeTruthy()
    expect(
      validateBizSystemForm({ ...valid, exampleQuestions: ['q'.repeat(61), 'b', 'c'] }).errors.exampleQuestions
    ).toBeTruthy()
    expect(validateBizSystemForm(valid).errors.exampleQuestions).toBeUndefined()
  })

  it('连接方式非法报错', () => {
    expect(validateBizSystemForm({ ...valid, connType: 'weird' }).errors.connType).toBeTruthy()
  })

  it('业务页整体选填：0 条通过', () => {
    expect(validateBizSystemForm({ ...valid, bizPages: [] }).ok).toBe(true)
    expect(validateBizSystemForm({ ...valid, bizPages: undefined }).ok).toBe(true)
  })

  it('业务页逐项：url 必填且 http(s)://', () => {
    expect(
      validateBizSystemForm({ ...valid, bizPages: [{ url: '', name: '工作台' }] }).errors['bizPages.0.url']
    ).toBeTruthy()
    expect(
      validateBizSystemForm({ ...valid, bizPages: [{ url: 'not-a-url', name: '工作台' }] }).errors[
        'bizPages.0.url'
      ]
    ).toBeTruthy()
  })

  it('业务页逐项：name 必填且 ≤20', () => {
    expect(
      validateBizSystemForm({ ...valid, bizPages: [{ url: 'https://a.com', name: '' }] }).errors[
        'bizPages.0.name'
      ]
    ).toBeTruthy()
    expect(
      validateBizSystemForm({
        ...valid,
        bizPages: [{ url: 'https://a.com', name: 'n'.repeat(21) }]
      }).errors['bizPages.0.name']
    ).toBeTruthy()
  })

  it('业务页逐项：description 选填 ≤100', () => {
    expect(
      validateBizSystemForm({
        ...valid,
        bizPages: [{ url: 'https://a.com', name: '工作台', description: 'd'.repeat(101) }]
      }).errors['bizPages.0.description']
    ).toBeTruthy()
  })

  it('业务页条目数 ≤20', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      url: `https://a.com/${i}`,
      name: `p${i}`
    }))
    expect(validateBizSystemForm({ ...valid, bizPages: many }).errors.bizPages).toBeTruthy()
    const twenty = many.slice(0, 20)
    expect(validateBizSystemForm({ ...valid, bizPages: twenty }).errors.bizPages).toBeUndefined()
  })

  it('多行错误索引隔离：第 1 行非法不污染第 0 行', () => {
    const r = validateBizSystemForm({
      ...valid,
      bizPages: [
        { url: 'https://ok.com', name: '工作台' },
        { url: 'bad', name: '' }
      ]
    })
    expect(r.errors['bizPages.0.url']).toBeUndefined()
    expect(r.errors['bizPages.1.url']).toBeTruthy()
    expect(r.errors['bizPages.1.name']).toBeTruthy()
  })
})
