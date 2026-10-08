import { describe, it, expect } from 'vitest'
import { toolCallRecords, paramsOf, outputOf, listToolCallAudits } from '../toolCallAuditMock'

/**
 * toolCallAuditMock 详情抽屉取数（2026-10-08 /test-audit 补缺口新建）。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/05治理/工具调用审计/prd.工具调用审计.md：
 * - §5.4「实际请求参数」：敏感字段（联系方式、操作凭证）脱敏；暂无法提供时展示「【待补充】」（§七）；
 * - §5.4「实际响应结果」：未执行的调用（执行前拦截 / 用户取消 / 待确认）展示「工具未执行，因此没有实际响应结果」；
 *   执行失败展示失败原因；暂无法提供的原始响应展示「【待补充】」（§七）。
 * 覆盖 outputOf 四个分支（有实录的成功调用 / 未执行三类 / 执行失败 / 其余成功）与 paramsOf 两个分支（有实录 / 暂缺）。
 */
const rec = (id) => toolCallRecords.find((r) => r.id === id)

describe('outputOf · 实际响应结果（§5.4）', () => {
  it('有实录的成功调用（C-1011 创建报价单）→ 返回摘要与结果明细行', () => {
    expect(outputOf(rec('C-1011'))).toEqual({
      summary: '报价单创建成功',
      rows: [['报价单编号', 'QT-20260927-0083'], ['返回状态', '已创建']]
    })
  })

  it('执行前拦截 / 用户取消 / 待确认 → 都是「工具未执行，因此没有实际响应结果。」', () => {
    for (const result of ['BLOCKED', 'CANCELLED', 'PENDING']) {
      const r = toolCallRecords.find((x) => x.result === result)
      expect(outputOf(r)).toEqual({ text: '工具未执行，因此没有实际响应结果。' })
    }
  })

  it('执行失败 → 正文是失败原因，附「错误码及原始响应：【待补充】」', () => {
    expect(outputOf(rec('C-1010'))).toEqual({ text: '连接超时', note: '错误码及原始响应：【待补充】' })
  })

  it('其余成功调用 → 「调用成功，实际响应内容【待补充】。」', () => {
    expect(outputOf(rec('C-1002'))).toEqual({ text: '调用成功，实际响应内容【待补充】。' })
  })
})

describe('paramsOf · 实际请求参数（§5.4）', () => {
  it('有实录的调用（C-1011）→ 逐项列出参数，操作凭证与联系电话已脱敏', () => {
    const params = paramsOf(rec('C-1011'))
    expect(params.map((p) => p[1])).toEqual(['customer_id', 'customer_name', 'amount', 'discount_rate', 'operator_token', 'contact_phone'])
    expect(params.find((p) => p[1] === 'operator_token')[2]).toContain('已脱敏')
    expect(params.find((p) => p[1] === 'contact_phone')[2]).toBe('138••••5678 已脱敏')
  })

  it('没有实录的调用 → 一行「【待补充】」占位（§七：暂无法提供不视为异常）', () => {
    expect(paramsOf(rec('C-1007'))).toEqual([['请求数据', 'payload', '【待补充】本次调用的实际请求参数']])
  })
})

describe('listToolCallAudits', () => {
  it('返回全量记录（由页面本地筛选 / 排序 / 分页）', async () => {
    expect(await listToolCallAudits()).toHaveLength(toolCallRecords.length)
  })
})
