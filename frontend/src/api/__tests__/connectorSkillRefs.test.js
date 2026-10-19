import { describe, it, expect, vi } from 'vitest'

// 不碰 localStorage：持久化落盘与本用例无关（派生值本来也不落盘）
vi.mock('../mockPersist', () => ({ attachPersist: () => () => {} }))

/**
 * 连接器「被技能引用」反向派生（待办 yuepu#77，端到端）：
 * 引用关系的源头是技能的 SKILL.md「## 引用工具」（toolRefs），三个连接器的引用清单据此实时算出，
 * 不再是各连接器种子里与技能模块对不上的虚构技能名（原「报销单查询」「sk_1~sk_6」之类）。
 * 每例 vi.resetModules() 拿全新模块实例。
 */
async function fresh() {
  vi.resetModules()
  const skill = await import('../unifiedSkillMock')
  const mcp = await import('../mcpConnectorMock')
  const api = await import('../apiConnectorMock')
  const biz = await import('../bizSystemMock')
  return { skill, mcp, api, biz }
}

const namesOf = (rows) => (rows || []).map((r) => r.skillName).sort()

describe('连接器 referencedBySkills 由技能反向派生（yuepu#77）', () => {

  it('每个连接器的引用清单 = 引用它的技能（名称与 id 都取自技能模块），不含虚构技能名', async () => {
    const { skill, mcp, api, biz } = await fresh()
    const all = (await skill.listUnifiedSkills({ page: 1, size: 100 })).list
    expect(all.length).toBeGreaterThan(0)
    const expected = {}
    for (const s of all) {
      const detail = await skill.getSkillDetail(s.id)
      for (const t of detail.referencedTools) (expected[t.code] ||= []).push(s.name)
    }
    for (const m of mcp.listMcpSync()) expect(namesOf(m.referencedBySkills)).toEqual((expected[`mcp__${m.code}`] || []).sort())
    for (const a of api.listApisSync()) expect(namesOf(a.referencedBySkills)).toEqual((expected[`api__${a.code}`] || []).sort())
    for (const b of biz.listBizSystemsSync()) expect(namesOf(b.referencedBySkills)).toEqual((expected[`biz__${b.id}`] || []).sort())
    // 旧种子里的虚构技能 id 不再出现
    const fake = [...mcp.listMcpSync(), ...api.listApisSync(), ...biz.listBizSystemsSync()]
      .flatMap((r) => r.referencedBySkills)
      .filter((r) => /^sk_(ref_|b?\d{1,2}$)/.test(r.skillId))
    expect(fake).toEqual([])
  })

  it('种子有样例：未发布的 mail_center、api_1101、biz_2101 都被至少一个技能引用（演示「被引用的未发布连接器也能删」）', async () => {
    const { mcp, api, biz } = await fresh()
    expect((await mcp.getMcp('mail_center')).referencedBySkillCount).toBeGreaterThan(0)
    expect((await api.getApi('api_1101')).referencedBySkillCount).toBeGreaterThan(0)
    expect((await biz.getBizSystem('biz_2101')).referencedBySkillCount).toBeGreaterThan(0)
  })

  it('技能改 SKILL.md 去掉 / 加上工具引用 → 连接器侧引用清单随之变化', async () => {
    const { skill, mcp } = await fresh()
    const before = namesOf(mcp.listMcpSync().find((m) => m.code === 'calendar').referencedBySkills)
    expect(before).toEqual([]) // 种子里没有技能引用日历 MCP

    const id = 'sk_303'
    const md = (await skill.getSkillFile(id, 'SKILL.md')).content
    await skill.saveSkillFile(id, { path: 'SKILL.md', content: `${md}\n\n- @tool[mcp__calendar]\n` })
    const after = mcp.listMcpSync().find((m) => m.code === 'calendar').referencedBySkills
    expect(after.map((r) => r.skillId)).toEqual([id])

    await skill.saveSkillFile(id, { path: 'SKILL.md', content: md })
    expect(mcp.listMcpSync().find((m) => m.code === 'calendar').referencedBySkills).toEqual([])
  })
})
