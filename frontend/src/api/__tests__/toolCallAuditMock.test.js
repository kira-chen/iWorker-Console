import { describe, it, expect } from 'vitest'
import {
  toolCallRecords,
  taskCallRecords,
  knowledgeCallRecords,
  paramsOf,
  outputOf,
  knowledgeParamsOf,
  knowledgeOutputOf,
  RESULT_LABEL,
  UNATTENDED_RESULTS
} from '../toolCallAuditMock'

/**
 * 工具调用审计三组 mock 的口径约束（PRD 正本 §一 / §八 / §九）。
 * 页面测试只验渲染；这里钉数据本身别自相矛盾——数据错了，页面上的统计卡片和详情会一起错。
 */
describe('三组记录', () => {
  it('编号在三组之间不重复，前缀区分来源：C- 技能调用 / T- 岗位自动化任务 / K- 知识库检索', () => {
    const ids = [...toolCallRecords, ...taskCallRecords, ...knowledgeCallRecords].map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(toolCallRecords.every((r) => r.id.startsWith('C-'))).toBe(true)
    expect(taskCallRecords.every((r) => r.id.startsWith('T-'))).toBe(true)
    expect(knowledgeCallRecords.every((r) => r.id.startsWith('K-'))).toBe(true)
  })

  it('无人值守的两组只会出现 成功 / 执行失败 / 执行前拦截，没有用户取消 / 待确认', () => {
    expect(UNATTENDED_RESULTS).toEqual(['SUCCESS', 'FAILED', 'BLOCKED'])
    for (const r of [...taskCallRecords, ...knowledgeCallRecords]) {
      expect(UNATTENDED_RESULTS).toContain(r.result)
      expect(RESULT_LABEL[r.result]).toBeTruthy()
    }
  })
})

describe('岗位自动化任务 taskCallRecords', () => {
  it('工具标识是「连接器类型·名称」，类型只会是 MCP / API / 业务系统', () => {
    for (const r of taskCallRecords) expect(r.tool).toMatch(/^(MCP|API|业务系统)·.+/)
  })

  it('写操作授权与结果自洽：读操作无需授权；未授权的写操作必被拦截；已预授权的写操作带授权人和授权时间且不会被拦截', () => {
    for (const r of taskCallRecords) {
      if (r.nature === 'READ') expect(r.auth).toBe('NONE')
      if (r.auth === 'UNAUTHORIZED') {
        expect(r.nature).toBe('WRITE')
        expect(r.result).toBe('BLOCKED')
      }
      if (r.auth === 'AUTHORIZED') {
        expect(r.nature).toBe('WRITE')
        expect(r.result).not.toBe('BLOCKED')
        expect(r.authBy).toBeTruthy()
        expect(r.authAt).toBeTruthy()
      }
    }
    // 样例要覆盖三种授权状态，演示才完整
    expect(new Set(taskCallRecords.map((r) => r.auth))).toEqual(new Set(['NONE', 'AUTHORIZED', 'UNAUTHORIZED']))
  })

  it('被拦截或失败的调用都有原因；被拦截的调用未执行', () => {
    for (const r of taskCallRecords) {
      if (r.result !== 'SUCCESS') expect(r.reason).toBeTruthy()
      if (r.result === 'BLOCKED') expect(r.duration).toBe('未执行')
    }
  })

  it('同一次任务运行编号 RUN-日期-任务id：同 runId 的记录属于同一任务、同一天、同一用户', () => {
    const byRun = new Map()
    for (const r of taskCallRecords) byRun.set(r.runId, [...(byRun.get(r.runId) || []), r])
    expect(byRun.size).toBeLessThan(taskCallRecords.length) // 至少有一次运行调了多次工具
    for (const [runId, calls] of byRun) {
      expect(runId).toMatch(/^RUN-\d{8}-\d+$/)
      expect(new Set(calls.map((c) => c.task)).size).toBe(1)
      expect(new Set(calls.map((c) => c.date)).size).toBe(1)
      expect(new Set(calls.map((c) => c.user)).size).toBe(1)
      expect(runId).toContain(calls[0].date.replaceAll('-', ''))
    }
  })

  it('请求参数 / 响应结果：有覆盖的记录用覆盖值，其余走兜底（技能调用共用同一套）', () => {
    expect(paramsOf({ id: 'T-2006' }).some((p) => p[1] === 'customer_id')).toBe(true)
    expect(outputOf({ id: 'T-2006', result: 'SUCCESS' }).summary).toBe('拜访提纲已写入客户档案')
    expect(outputOf({ id: 'T-2005', result: 'BLOCKED' }).text).toContain('工具未执行')
    expect(paramsOf({ id: 'T-2001' })[0][2]).toContain('【待补充】')
  })
})

describe('知识库检索 knowledgeCallRecords', () => {
  it('只记外部数据源：类型只有 API / MCP；MCP 带所选检索工具，API 不带', () => {
    for (const r of knowledgeCallRecords) {
      const [type] = r.source.split('·')
      expect(['API', 'MCP']).toContain(type)
      if (type === 'MCP') expect(r.tool).toBeTruthy()
      else expect(r.tool).toBe('')
    }
  })

  it('命中口径自洽：只有成功的检索才有命中；命中 0 条无内容列表；展示的命中不多于总命中', () => {
    for (const r of knowledgeCallRecords) {
      if (r.result !== 'SUCCESS') {
        expect(r.hitCount).toBe(0)
        expect(r.hits).toEqual([])
      } else if (r.hitCount === 0) {
        expect(r.hits).toEqual([])
      } else {
        expect(r.hits.length).toBeGreaterThan(0)
        expect(r.hits.length).toBeLessThanOrEqual(r.hitCount)
      }
    }
    // 三种需要在页面上演示的情形都要有样例：有命中 / 无命中 / 失败 / 拦截
    const kinds = new Set(knowledgeCallRecords.map((r) => (r.result === 'SUCCESS' ? (r.hitCount ? 'hit' : 'nohit') : r.result)))
    expect(kinds).toEqual(new Set(['hit', 'nohit', 'FAILED', 'BLOCKED']))
  })

  it('请求参数由记录生成：检索词 + topK，MCP 多一行检索工具', () => {
    const mcp = knowledgeCallRecords.find((r) => r.tool)
    const api = knowledgeCallRecords.find((r) => !r.tool)
    expect(knowledgeParamsOf(mcp).map((p) => p[1])).toEqual(['query', 'topK', 'tool'])
    expect(knowledgeParamsOf(api).map((p) => p[1])).toEqual(['query', 'topK'])
    expect(knowledgeParamsOf(mcp)[0][2]).toBe(mcp.query)
  })

  it('响应结果：成功有命中列表；无命中 / 失败 / 拦截各有对应说明', () => {
    const hit = knowledgeCallRecords.find((r) => r.result === 'SUCCESS' && r.hitCount > 0)
    const out = knowledgeOutputOf(hit)
    expect(out.headers).toEqual(['标题', '来源名称'])
    expect(out.rows.length).toBe(hit.hits.length)
    expect(out.summary).toContain(`共命中 ${hit.hitCount} 条`)

    expect(knowledgeOutputOf(knowledgeCallRecords.find((r) => r.result === 'SUCCESS' && !r.hitCount)).text).toContain('命中 0 条')
    expect(knowledgeOutputOf(knowledgeCallRecords.find((r) => r.result === 'FAILED')).note).toContain('【待补充】')
    expect(knowledgeOutputOf(knowledgeCallRecords.find((r) => r.result === 'BLOCKED')).text).toContain('没有实际响应结果')
  })
})
