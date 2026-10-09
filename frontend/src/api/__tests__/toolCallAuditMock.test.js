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
  KNOWLEDGE_RESULT_LABEL
} from '../toolCallAuditMock'

/**
 * toolCallAuditMock 三组数据的口径约束（PRD 正本 §一「记录单元」/ §八 / §九）。
 * 页面测试只验渲染；这里钉数据本身别自相矛盾——数据错了，页面上的统计卡片和详情会一起错。
 *
 * 2026-10-09 记录单元改版（与研发梅竹讨论后）整份重写：toolCallRecords / taskCallRecords
 * 的记录单元从「一次工具调用」改为「一次技能执行 / 一次任务运行」，每条记录带 calls 数组
 * （工具调用明细）与由 calls 推导出的 hasWrite / result 汇总字段；taskCallRecords
 * 的「预授权」（auth 字段）与「任务运行编号」（runId 字段）随改版废弃。
 *
 * 2026-10-09 同日第二轮改版：单次工具调用不记录耗时与具体执行时刻，系统本来就不采集；
 * 技能调用的结果收窄为 成功 / 失败，不展示"执行中"，原「待确认」的 PENDING 状态没有可展示
 * 的记录，C- 系列不再有示例；「用户确认」收窄为不需要确认 / 已确认两态，确认被拒绝时
 * confirm 为 null。
 *
 * 2026-10-09 第三轮改版（同日）：岗位自动化任务、知识库检索的整体结果也收窄为 成功 / 失败
 * 两态——原「执行前拦截」并入「失败」，原因文案保留。三组现在判定规则、取值集合完全一致，
 * 只是知识库检索的「失败」文案写法不同（"执行失败"），且继续不采用记录单元改版（见下）。
 */
describe('三组记录', () => {
  it('编号在三组之间不重复，前缀区分来源：C- 技能调用 / T- 岗位自动化任务 / K- 知识库检索', () => {
    const ids = [...toolCallRecords, ...taskCallRecords, ...knowledgeCallRecords].map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(toolCallRecords.every((r) => r.id.startsWith('C-'))).toBe(true)
    expect(taskCallRecords.every((r) => r.id.startsWith('T-'))).toBe(true)
    expect(knowledgeCallRecords.every((r) => r.id.startsWith('K-'))).toBe(true)
  })

  it('三组记录的整体结果取值 key 集合相同（均只有 成功 / 失败），但"失败"显示文案各自独立', () => {
    expect(Object.keys(EXEC_RESULT_LABEL).sort()).toEqual(['FAILED', 'SUCCESS'])
    expect(Object.keys(KNOWLEDGE_RESULT_LABEL).sort()).toEqual(['FAILED', 'SUCCESS'])
    for (const r of taskCallRecords) {
      expect(['SUCCESS', 'FAILED']).toContain(r.result)
      expect(EXEC_RESULT_LABEL[r.result]).toBeTruthy()
    }
    for (const r of knowledgeCallRecords) {
      expect(['SUCCESS', 'FAILED']).toContain(r.result)
      expect(KNOWLEDGE_RESULT_LABEL[r.result]).toBeTruthy()
    }
    // 两个页签的 PRD 原文"失败"写法不一致（任务运行"失败"、知识库检索"执行失败"），
    // 不能共用同一份标签——这正是本条用例要钉住的，避免以后又合并成一个常量
    expect(EXEC_RESULT_LABEL.FAILED).toBe('失败')
    expect(KNOWLEDGE_RESULT_LABEL.FAILED).toBe('执行失败')
  })

  it('技能调用的整体结果只会是 成功 / 失败（不展示"执行中"）', () => {
    expect(EXEC_RESULT_LABEL).toEqual({ SUCCESS: '成功', FAILED: '失败' })
    for (const r of toolCallRecords) {
      expect(['SUCCESS', 'FAILED']).toContain(r.result)
      expect(EXEC_RESULT_LABEL[r.result]).toBeTruthy()
    }
  })

  it('单次工具调用不带 duration / endAt / confirmedAt / wait——这类过程时间数据系统不采集', () => {
    for (const c of [...toolCallRecords, ...taskCallRecords].flatMap((r) => r.calls)) {
      expect(c.duration).toBeUndefined()
      expect(c.endAt).toBeUndefined()
      expect(c.confirmedAt).toBeUndefined()
      expect(c.wait).toBeUndefined()
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

  it('hasWrite / result 由 calls 推导，与明细自洽（§一「记录单元」判定规则：看最后一次调用是否成功）', () => {
    for (const r of toolCallRecords) {
      expect(r.hasWrite).toBe(r.calls.some((c) => c.nature === 'WRITE'))
      const last = r.calls[r.calls.length - 1]
      expect(r.result).toBe(last.result === 'SUCCESS' ? 'SUCCESS' : 'FAILED')
    }
  })

  it('样例覆盖两种整体结果；至少一条执行里有多次工具调用（演示先失败后重试成功，仍记"成功"）', () => {
    expect(new Set(toolCallRecords.map((r) => r.result))).toEqual(new Set(['SUCCESS', 'FAILED']))
    const multi = toolCallRecords.filter((r) => r.calls.length > 1)
    expect(multi.length).toBeGreaterThan(0)
    const retried = multi.find((r) => r.calls.some((c) => c.result === 'FAILED') && r.result === 'SUCCESS')
    expect(retried).toBeTruthy()
  })

  it('失败的记录都有原因概要', () => {
    for (const r of toolCallRecords) {
      if (r.result === 'FAILED') expect(r.reason).toBeTruthy()
    }
  })

  it('单次工具调用的结果只有 成功 / 失败；写操作的 confirm 只会是 不需要确认 / 已确认 / null（确认被拒绝，由失败原因表达）', () => {
    for (const c of toolCallRecords.flatMap((r) => r.calls)) {
      expect(['SUCCESS', 'FAILED']).toContain(c.result)
      if (c.nature === 'WRITE') expect([null, 'NONE', 'CONFIRMED']).toContain(c.confirm)
    }
    const writeCalls = toolCallRecords.flatMap((r) => r.calls).filter((c) => c.nature === 'WRITE')
    expect(writeCalls.length).toBeGreaterThan(0)
    // 样例要覆盖"确认被拒绝"（confirm=null，由 reason 说明是用户取消）这一情形
    const rejected = writeCalls.find((c) => c.confirm === null)
    expect(rejected).toBeTruthy()
    expect(rejected.reason).toContain('取消')
  })

  it('paramsOf / outputOf 接收单次工具调用（call）：call 自带 params/output 则用，否则按结果兜底', () => {
    const withParams = toolCallRecords.flatMap((r) => r.calls).find((c) => c.params)
    expect(withParams).toBeTruthy()
    expect(paramsOf(withParams)).toBe(withParams.params)
    expect(paramsOf({ result: 'SUCCESS' })[0][2]).toContain('【待补充】')

    expect(outputOf(withParams)).toBe(withParams.output)
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

  it('hasWrite / result 由 calls 推导：看最后一次调用是否成功，与技能调用共用同一套规则（deriveExec）', () => {
    for (const r of taskCallRecords) {
      expect(r.hasWrite).toBe(r.calls.some((c) => c.nature === 'WRITE'))
      const last = r.calls[r.calls.length - 1]
      expect(r.result).toBe(last.result === 'SUCCESS' ? 'SUCCESS' : 'FAILED')
    }
  })

  it('样例覆盖两种整体结果，且至少各有一条写操作与读操作', () => {
    expect(new Set(taskCallRecords.map((r) => r.result))).toEqual(new Set(['SUCCESS', 'FAILED']))
    expect(taskCallRecords.some((r) => r.hasWrite)).toBe(true)
    expect(taskCallRecords.some((r) => !r.hasWrite)).toBe(true)
  })

  it('失败的记录都有原因概要；没有「未授权」这一类原因（自动化任务免授权已拍板）', () => {
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
    expect(kinds).toEqual(new Set(['hit', 'nohit', 'FAILED']))
  })

  it('请求参数由记录生成：检索词 + topK，MCP 多一行检索工具', () => {
    const mcp = knowledgeCallRecords.find((r) => r.tool)
    const api = knowledgeCallRecords.find((r) => !r.tool)
    expect(knowledgeParamsOf(mcp).map((p) => p[1])).toEqual(['query', 'topK', 'tool'])
    expect(knowledgeParamsOf(api).map((p) => p[1])).toEqual(['query', 'topK'])
    expect(knowledgeParamsOf(mcp)[0][2]).toBe(mcp.query)
  })

  it('响应结果：成功有命中列表；无命中 / 失败各有对应说明（失败统一走原因文案，含原"执行前拦截"的情形）', () => {
    const hit = knowledgeCallRecords.find((r) => r.result === 'SUCCESS' && r.hitCount > 0)
    const out = knowledgeOutputOf(hit)
    expect(out.headers).toEqual(['标题', '来源名称'])
    expect(out.rows.length).toBe(hit.hits.length)
    expect(out.summary).toContain(`共命中 ${hit.hitCount} 条`)

    expect(knowledgeOutputOf(knowledgeCallRecords.find((r) => r.result === 'SUCCESS' && !r.hitCount)).text).toContain('命中 0 条')
    const noAccess = knowledgeCallRecords.find((r) => r.reason.includes('访问权限'))
    expect(knowledgeOutputOf(noAccess).text).toBe(noAccess.reason)
    expect(knowledgeOutputOf(knowledgeCallRecords.find((r) => r.result === 'FAILED')).note).toContain('【待补充】')
  })
})
