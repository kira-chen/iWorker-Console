import { describe, it, expect } from 'vitest'
import {
  toolCallRecords,
  taskCallRecords,
  knowledgeCallRecords,
  paramsOf,
  outputOf,
  knowledgeParamsOf,
  knowledgeOutputOf,
  EXEC_RESULT_LABEL,
  UNATTENDED_RESULT_LABEL,
  UNATTENDED_RESULTS
} from '../toolCallAuditMock'

/**
 * toolCallAuditMock 三组数据的口径约束（PRD 正本 §一「记录单元」/ §八 / §九）。
 * 页面测试只验渲染；这里钉数据本身别自相矛盾——数据错了，页面上的统计卡片和详情会一起错。
 *
 * 2026-10-09 记录单元改版（与研发梅竹讨论后）整份重写：toolCallRecords / taskCallRecords
 * 的记录单元从「一次工具调用」改为「一次技能执行 / 一次任务运行」，每条记录带 calls 数组
 * （工具调用明细）与由 calls 推导出的 hasWrite / pending / result 汇总字段；taskCallRecords
 * 的「预授权」（auth 字段）与「任务运行编号」（runId 字段）随改版废弃。
 */
describe('三组记录', () => {
  it('编号在三组之间不重复，前缀区分来源：C- 技能调用 / T- 岗位自动化任务 / K- 知识库检索', () => {
    const ids = [...toolCallRecords, ...taskCallRecords, ...knowledgeCallRecords].map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(toolCallRecords.every((r) => r.id.startsWith('C-'))).toBe(true)
    expect(taskCallRecords.every((r) => r.id.startsWith('T-'))).toBe(true)
    expect(knowledgeCallRecords.every((r) => r.id.startsWith('K-'))).toBe(true)
  })

  it('知识库检索的整体结果取值集合与任务运行共用（均无人值守，没有"进行中"）', () => {
    expect(UNATTENDED_RESULTS).toEqual(['SUCCESS', 'FAILED', 'BLOCKED'])
    for (const r of [...taskCallRecords, ...knowledgeCallRecords]) {
      expect(UNATTENDED_RESULTS).toContain(r.result)
      expect(UNATTENDED_RESULT_LABEL[r.result]).toBeTruthy()
    }
  })

  it('技能调用的整体结果只会是 成功 / 失败 / 进行中', () => {
    for (const r of toolCallRecords) {
      expect(['SUCCESS', 'FAILED', 'IN_PROGRESS']).toContain(r.result)
      expect(EXEC_RESULT_LABEL[r.result]).toBeTruthy()
    }
  })
})

describe('技能调用 toolCallRecords（记录单元＝一次技能执行）', () => {
  it('每条记录至少有一次工具调用；calls 的工具标识均为「连接器类型·名称」', () => {
    for (const r of toolCallRecords) {
      expect(r.calls.length).toBeGreaterThan(0)
      for (const c of r.calls) expect(c.tool).toMatch(/^(MCP|API|业务系统)·.+/)
    }
  })

  it('hasWrite / pending / result 由 calls 推导，与明细自洽（§一「记录单元」判定规则）', () => {
    for (const r of toolCallRecords) {
      expect(r.hasWrite).toBe(r.calls.some((c) => c.nature === 'WRITE'))
      expect(r.pending).toBe(r.calls.some((c) => c.result === 'PENDING'))
      const last = r.calls[r.calls.length - 1]
      const expected = r.pending ? 'IN_PROGRESS' : last.result === 'SUCCESS' ? 'SUCCESS' : 'FAILED'
      expect(r.result).toBe(expected)
    }
  })

  it('样例覆盖三种整体结果；至少一条执行里有多次工具调用（演示先失败后重试成功，仍记"成功"）', () => {
    expect(new Set(toolCallRecords.map((r) => r.result))).toEqual(new Set(['SUCCESS', 'FAILED', 'IN_PROGRESS']))
    const multi = toolCallRecords.filter((r) => r.calls.length > 1)
    expect(multi.length).toBeGreaterThan(0)
    const retried = multi.find((r) => r.calls.some((c) => c.result === 'FAILED') && r.result === 'SUCCESS')
    expect(retried).toBeTruthy()
  })

  it('失败的记录都有原因概要；进行中的记录里有且仅有一次调用处于待确认', () => {
    for (const r of toolCallRecords) {
      if (r.result === 'FAILED') expect(r.reason).toBeTruthy()
      if (r.result === 'IN_PROGRESS') expect(r.calls.filter((c) => c.result === 'PENDING').length).toBeGreaterThan(0)
    }
  })

  it('写操作需要确认时 calls 里的 confirm 字段齐全（不需要确认 / 已确认 / 待确认 / 已取消）', () => {
    const writeCalls = toolCallRecords.flatMap((r) => r.calls).filter((c) => c.nature === 'WRITE')
    expect(writeCalls.length).toBeGreaterThan(0)
    for (const c of writeCalls) expect(['NONE', 'CONFIRMED', 'PENDING', 'CANCELLED']).toContain(c.confirm)
  })

  it('paramsOf / outputOf 接收单次工具调用（call）：call 自带 params/output 则用，否则按结果兜底', () => {
    const withParams = toolCallRecords.flatMap((r) => r.calls).find((c) => c.params)
    expect(withParams).toBeTruthy()
    expect(paramsOf(withParams)).toBe(withParams.params)
    expect(paramsOf({ result: 'SUCCESS' })[0][2]).toContain('【待补充】')

    expect(outputOf(withParams)).toBe(withParams.output)
    expect(outputOf({ result: 'BLOCKED' }).text).toContain('工具未执行')
    expect(outputOf({ result: 'FAILED', reason: '连接超时' })).toEqual({ text: '连接超时', note: '错误码及原始响应：【待补充】' })
    expect(outputOf({ result: 'SUCCESS' }).text).toContain('【待补充】')
  })
})

describe('岗位自动化任务 taskCallRecords（记录单元＝一次任务运行）', () => {
  it('每条记录至少有一次工具调用，字段里没有 confirm / auth / runId（预授权与运行编号已废弃）', () => {
    for (const r of taskCallRecords) {
      expect(r.calls.length).toBeGreaterThan(0)
      expect(r.runId).toBeUndefined()
      for (const c of r.calls) {
        expect(c.tool).toMatch(/^(MCP|API|业务系统)·.+/)
        expect(c.confirm).toBeUndefined()
        expect(c.auth).toBeUndefined()
      }
    }
  })

  it('hasWrite / result 由 calls 推导：看最后一次调用——成功记成功，拦截记执行前拦截，其余记失败', () => {
    for (const r of taskCallRecords) {
      expect(r.hasWrite).toBe(r.calls.some((c) => c.nature === 'WRITE'))
      const last = r.calls[r.calls.length - 1]
      const expected = last.result === 'SUCCESS' ? 'SUCCESS' : last.result === 'BLOCKED' ? 'BLOCKED' : 'FAILED'
      expect(r.result).toBe(expected)
    }
  })

  it('样例覆盖三种整体结果，且至少各有一条写操作与读操作', () => {
    expect(new Set(taskCallRecords.map((r) => r.result))).toEqual(new Set(['SUCCESS', 'FAILED', 'BLOCKED']))
    expect(taskCallRecords.some((r) => r.hasWrite)).toBe(true)
    expect(taskCallRecords.some((r) => !r.hasWrite)).toBe(true)
  })

  it('失败 / 拦截的记录都有原因概要；执行前拦截的运行没有「未授权」这一类原因（免授权已拍板）', () => {
    for (const r of taskCallRecords) {
      if (r.result !== 'SUCCESS') expect(r.reason).toBeTruthy()
      expect(r.reason).not.toContain('未授权')
      expect(r.reason).not.toContain('预授权')
    }
  })

  it('请求参数 / 响应结果：有覆盖的 call 用覆盖值，其余走兜底（与技能调用共用同一套 paramsOf / outputOf）', () => {
    const withParams = taskCallRecords.flatMap((r) => r.calls).find((c) => c.params)
    expect(withParams).toBeTruthy()
    expect(paramsOf(withParams).some((p) => p[1] === 'customer_id')).toBe(true)
    expect(outputOf(withParams).summary).toBeTruthy()
  })
})

describe('知识库检索 knowledgeCallRecords（2026-10-09 明确不采用记录单元改版，维持现状）', () => {
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
